import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages, prepareCoverImage,
  COVER_TOP_BAND_H, COVER_BOTTOM_BLOCK_H,
  setFill, setStroke, setText, sanitize, todayLabel,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
// Per-country cover photography. Mirrors the shipping / fertiliser wiring:
// a full-bleed hero image sits behind the top band and bottom block. New
// countries opt in by adding an entry to COUNTRY_COVER_URLS below, keyed
// by the lower-cased country name.
import papuaNewGuineaCoverUrl from "@assets/image_1779624991006.png";
import papuaCoverUrl from "@assets/image_1779625036503.png";

const COUNTRY_COVER_URLS: Record<string, string> = {
  "papua new guinea": papuaNewGuineaCoverUrl,
  "papua": papuaCoverUrl,
};
import {
  resolveReportWindow, filterIncidentsToWindow, relatedIncidentsLimit,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { isCountryRelevant, sanitizeFactValue } from "./topicRelevance";

// Country reports are weekly products. The "country" pseudo-topic resolves
// to the weekly defaults (7-day default, 10-day cap) via reportWindow.ts.
const COUNTRY_WINDOW_TOPIC = "country";

export interface PdfIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  location?: string | null;
  // Used by the shared incident-type classifier — never displayed as a topic.
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}

export interface PdfCountry {
  name: string;
  region: string;
  overview?: string | null;
  trendSummary?: string | null;
  implications?: string | null;
  keyNumbers?: { label: string; value: string; context?: string | null }[] | null;
}

const NOT_IDENTIFIED = "Not identified";

interface DerivedFacts {
  validDates: Date[];
  earliest: Date | null;
  latest: Date | null;
  highestKey: string;
  highestLabel: string;
  topTypeLabel: string;
  topTypeCount: number;
  topAreaLabel: string;
  topAreaCount: number;
  severityCounts: Record<string, number>;
  // Counts keyed by *derived* operational incident type, never by topic.
  typeCounts: Map<string, number>;
}

function deriveFacts(
  incidents: PdfIncident[],
  _topicLabels: Record<string, string>,
): DerivedFacts {
  const validDates: Date[] = [];
  for (const i of incidents) {
    try {
      const d = parseISO(i.occurredAt);
      if (!isNaN(d.getTime())) validDates.push(d);
    } catch { /* skip */ }
  }
  validDates.sort((a, b) => a.getTime() - b.getTime());
  const earliest = validDates[0] ?? null;
  const latest = validDates[validDates.length - 1] ?? null;

  let highestKey = "";
  let highestRank = 0;
  const severityCounts: Record<string, number> = {
    extreme: 0, high: 0, moderate: 0, low: 0, insignificant: 0,
  };
  for (const i of incidents) {
    const k = sevKey(i.severity);
    if (k in severityCounts) severityCounts[k] += 1;
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  const highestLabel = highestKey ? (SEV_LABEL[highestKey] ?? highestKey) : NOT_IDENTIFIED;

  // Derive real operational incident types — never use topic/product names.
  const typeCounts = new Map<string, number>();
  for (const i of incidents) {
    const type = classifyIncidentType(i);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  let topTypeLabel = NOT_IDENTIFIED;
  let topTypeCount = 0;
  for (const [t, n] of typeCounts) {
    if (n > topTypeCount) { topTypeCount = n; topTypeLabel = t; }
  }

  const areaCounts = new Map<string, number>();
  for (const i of incidents) {
    const loc = (i.location ?? "").trim();
    if (!loc) continue;
    if (/^unknown$/i.test(loc)) continue;
    const first = loc.split(/[;,/]/)[0].trim();
    if (!first) continue;
    areaCounts.set(first, (areaCounts.get(first) ?? 0) + 1);
  }
  let topAreaLabel = NOT_IDENTIFIED;
  let topAreaCount = 0;
  for (const [a, n] of areaCounts) {
    if (n > topAreaCount) { topAreaCount = n; topAreaLabel = a; }
  }

  return {
    validDates, earliest, latest, highestKey, highestLabel,
    topTypeLabel, topTypeCount, topAreaLabel, topAreaCount,
    severityCounts, typeCounts,
  };
}

function periodString(facts: DerivedFacts): string {
  if (!facts.earliest || !facts.latest) return "No incidents on file";
  if (facts.earliest.getTime() === facts.latest.getTime()) {
    return format(facts.earliest, "dd MMM yyyy");
  }
  return `${format(facts.earliest, "dd MMM yyyy")} - ${format(facts.latest, "dd MMM yyyy")}`;
}

function buildKpiCards(
  facts: DerivedFacts,
  incidents: PdfIncident[],
): KpiCardData[] {
  const safeArea = sanitizeFactValue("country", facts.topAreaLabel === NOT_IDENTIFIED ? "" : facts.topAreaLabel);
  const safeType = sanitizeFactValue("country", facts.topTypeLabel === NOT_IDENTIFIED ? "" : facts.topTypeLabel);
  return [
    { label: "Reporting Period", value: periodString(facts) },
    { label: "Total Records", value: String(incidents.length), note: "Incidents on file for this country" },
    {
      label: "Highest Severity",
      value: facts.highestLabel,
      severity: facts.highestKey || undefined,
      note: facts.highestKey ? "Worst rating in window" : undefined,
    },
    {
      label: "Most Affected Area",
      value: safeArea,
      note: facts.topAreaCount > 0 && safeArea === facts.topAreaLabel
        ? `${facts.topAreaCount} record${facts.topAreaCount === 1 ? "" : "s"}`
        : "Coverage gap",
    },
    {
      label: "Latest Incident",
      value: facts.latest ? format(facts.latest, "dd MMM yyyy") : "Coverage gap",
    },
    {
      label: "Main Issue Type",
      value: safeType,
      note: facts.topTypeCount > 0 && safeType === facts.topTypeLabel
        ? `${facts.topTypeCount} record${facts.topTypeCount === 1 ? "" : "s"}`
        : "Data quality issue",
    },
  ];
}

function buildExecutiveSummary(
  country: PdfCountry,
  facts: DerivedFacts,
  incidents: PdfIncident[],
): string {
  if (incidents.length === 0) {
    return `No incidents are currently on file for ${country.name}. This report will populate as records are added to the Polestar Workbench.`;
  }
  const parts: string[] = [];
  parts.push(
    `Polestar holds ${incidents.length} record${incidents.length === 1 ? "" : "s"} for ${country.name} (${country.region}) covering ${periodString(facts)}.`,
  );
  if (facts.topTypeCount > 0) {
    parts.push(
      `The main issue type is ${facts.topTypeLabel} with ${facts.topTypeCount} record${facts.topTypeCount === 1 ? "" : "s"}.`,
    );
  }
  if (facts.highestKey) {
    parts.push(`The highest severity recorded is ${facts.highestLabel}.`);
  }
  if (facts.topAreaCount > 0) {
    parts.push(`The most affected area on file is ${facts.topAreaLabel}.`);
  }
  return parts.join(" ");
}


function drawSeverityChart(ctx: Ctx, facts: DerivedFacts) {
  const order = ["extreme", "high", "moderate", "low", "insignificant"] as const;
  const total = order.reduce((s, k) => s + facts.severityCounts[k], 0);
  if (total === 0) return;

  drawSectionHeading(ctx, "Severity Distribution");
  const { pdf, MX, CW } = ctx;
  const rowH = 18;
  const labelW = 110;
  const countW = 36;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - countW - 8;
  const chartH = order.length * rowH + 10;
  ensureSpace(ctx, chartH);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  order.forEach((k, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(sanitize(SEV_LABEL[k] ?? k), MX, ry + 12);
    const n = facts.severityCounts[k];
    const w = total === 0 ? 0 : (n / total) * barAreaW;
    setFill(pdf, SEV_COLOR[k] ?? POLAR);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.text(String(n), barAreaX + barAreaW + 6, ry + 12);
    pdf.setFont("helvetica", "normal");
  });
  ctx.y += chartH + 18;
}

function drawTypeChart(ctx: Ctx, facts: DerivedFacts) {
  const data = Array.from(facts.typeCounts.entries())
    .map(([type, n]) => ({ label: type, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  if (data.length === 0) return;
  const max = Math.max(...data.map((d) => d.n));

  drawSectionHeading(ctx, "Incident Breakdown by Type");
  const { pdf, MX, CW } = ctx;
  const rowH = 18;
  const labelW = 150;
  const countW = 36;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - countW - 8;
  const chartH = data.length * rowH + 10;
  ensureSpace(ctx, chartH);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  data.forEach((d, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(sanitize(d.label), MX, ry + 12);
    const w = max === 0 ? 0 : (d.n / max) * barAreaW;
    setFill(pdf, ELECTRIC);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.text(String(d.n), barAreaX + barAreaW + 6, ry + 12);
    pdf.setFont("helvetica", "normal");
  });
  ctx.y += chartH + 18;
}

function drawIncidentTable(
  ctx: Ctx,
  incidents: PdfIncident[],
  _topicLabels: Record<string, string>,
) {
  if (incidents.length === 0) return;
  drawSectionHeading(ctx, "Related Incidents");
  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTypeW = 120;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colTypeW - colSevW - 6;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    pdf.text("TYPE", MX + colDateW + 6, ctx.y + 12);
    pdf.text("TITLE", MX + colDateW + colTypeW + 6, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colTypeW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
  };

  // Sort newest first, then limit to the weekly cap (10-15 rows).
  const sorted = [...incidents].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const { max: ROW_MAX } = relatedIncidentsLimit(COUNTRY_WINDOW_TOPIC);
  const rows = sorted.slice(0, ROW_MAX);
  const truncated = sorted.length - rows.length;

  ensureSpace(ctx, rowH + 4);
  drawHeader();

  for (const i of rows) {
    const titleLines: string[] = pdf.splitTextToSize(sanitize(i.title), colTitleW - 8);
    const rh = Math.max(rowH, titleLines.length * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    let dateStr = "";
    try { dateStr = format(parseISO(i.occurredAt), "dd MMM yyyy"); } catch { dateStr = i.occurredAt; }
    pdf.text(dateStr, MX + 6, ctx.y + 12);
    // Use the derived operational incident-type label, never the topic name.
    const incidentType = classifyIncidentType(i);
    const typeLines: string[] = pdf.splitTextToSize(sanitize(incidentType), colTypeW - 8);
    pdf.text(typeLines, MX + colDateW + 6, ctx.y + 12);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colTypeW + 6, ctx.y + 12);

    const sk = sevKey(i.severity);
    const sevColor = SEV_COLOR[sk] ?? "#999999";
    setFill(pdf, sevColor);
    const chipX = MX + colDateW + colTypeW + colTitleW + 6;
    pdf.rect(chipX, ctx.y + 5, 56, 10, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    const sevDisplay = SEV_LABEL[sk] ?? i.severity ?? "";
    pdf.text(sanitize(sevDisplay.toUpperCase()), chipX + 28, ctx.y + 12, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);

    ctx.y += rh;
  }
  ctx.y += 8;

  if (truncated > 0) {
    ensureSpace(ctx, 16);
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8);
    pdf.text(
      sanitize(`Showing ${rows.length} most recent of ${sorted.length} records in window. Older records remain available in the Workbench.`),
      ctx.MX,
      ctx.y + 10,
    );
    pdf.setFont("helvetica", "normal");
    ctx.y += 16;
  }
}

// Render a narrative section only when the source field is populated.
// Empty sections are skipped entirely — no placeholder text per brand spec.
function drawNarrativeIfPresent(ctx: Ctx, heading: string, body: string | null | undefined) {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return;
  drawSectionHeading(ctx, heading);
  renderProse(ctx, trimmed);
}

export async function exportCountryReportPdf(
  country: PdfCountry,
  incidents: PdfIncident[],
  topicLabels: Record<string, string>,
  filename: string,
): Promise<void> {
  const issueDate = todayLabel();
  const ctx = createCtx({
    kind: `${country.name} Country Report`,
    issueDate,
  });

  // Enforce the weekly reporting window: records older than 10 days are
  // excluded from every section of the country report.
  const todayIso = new Date().toISOString().slice(0, 10);
  const win = resolveReportWindow(COUNTRY_WINDOW_TOPIC, todayIso);
  const rawWindowed = filterIncidentsToWindow(incidents, COUNTRY_WINDOW_TOPIC, todayIso);
  // Strip live news blogs and other off-topic noise so Fast Facts, charts
  // and the related incidents table only include operational records.
  const windowedIncidents = rawWindowed.filter((i) =>
    isCountryRelevant({
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );

  // Full-bleed Polestar cover (page 1) — title, subtitle, reporting period.
  // Countries with a registered cover photo (see COUNTRY_COVER_URLS) get the
  // same hero treatment as the shipping report; everything else falls back
  // to the gradient hero. Image load is wrapped in try/catch so a missing
  // asset never blocks PDF export.
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  const countryCoverUrl = COUNTRY_COVER_URLS[country.name.trim().toLowerCase()];
  if (countryCoverUrl) {
    try {
      const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
      coverImage = await prepareCoverImage(countryCoverUrl, ctx.W, heroH);
    } catch { /* fall back to gradient hero */ }
  }
  drawPolestarCover(ctx, {
    title: country.name,
    subtitle: "POLESTAR INSIGHTS",
    reportingPeriod: `REPORTING PERIOD: ${win.label.toUpperCase()}`,
    coverImage,
  });
  beginBodyPages(ctx);

  const facts = deriveFacts(windowedIncidents, topicLabels);

  // 1. Executive Summary (auto-derived from data — always populated honestly)
  drawSectionHeading(ctx, "Executive Summary");
  renderProse(ctx, buildExecutiveSummary(country, facts, windowedIncidents));

  // 2. Fast Facts
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, buildKpiCards(facts, windowedIncidents));

  // 3. Narrative sections — empty sections are skipped (no placeholder text).
  drawNarrativeIfPresent(ctx, "Situation", country.overview);
  drawNarrativeIfPresent(ctx, "What Happened", country.trendSummary);
  drawNarrativeIfPresent(ctx, "What Matters", null);
  drawNarrativeIfPresent(ctx, "Implications for Business", country.implications);
  drawNarrativeIfPresent(ctx, "Watch Next", null);
  drawNarrativeIfPresent(ctx, "Polestar View", null);

  // 4. Visuals — Incident Breakdown by Type uses derived operational labels.
  drawSeverityChart(ctx, facts);
  drawTypeChart(ctx, facts);

  // 5. Related incidents — limited to the weekly window, newest first.
  drawIncidentTable(ctx, windowedIncidents, topicLabels);

  // 6. Source Notes / Disclaimer
  drawSourceNotes(ctx);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
