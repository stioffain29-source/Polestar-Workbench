import { format, parseISO, max as dateMax } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages,
  setFill, setStroke, setText, sanitize,
  NAVY, POLAR, DUSK, WHITE, SEV_COLOR, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
import {
  resolveReportWindow, filterIncidentsToWindow, relatedIncidentsLimit, reportCadence,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { isTopicRelevant, sanitizeFactValue } from "./topicRelevance";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";

export interface TopicReportData {
  title: string;
  topic: string;
  issueDate: string;
  author?: string | null;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
}

export interface TopicReportIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  // Used by the shared incident-type classifier — never displayed as a topic.
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

function computeFastFacts(
  data: TopicReportData,
  windowIncidents: TopicReportIncident[],
  topicLabels: Record<string, string>,
): KpiCardData[] {
  const reportingPeriod = resolveReportWindow(data.topic, data.issueDate).shortLabel;

  let highestKey = "";
  let highestRank = 0;
  for (const i of windowIncidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  const highestLabel = highestKey ? (SEV_LABEL[highestKey] ?? highestKey) : "—";

  const countryCount = new Map<string, number>();
  for (const i of windowIncidents) {
    const c = (i.country ?? "").trim();
    if (!c) continue;
    countryCount.set(c, (countryCount.get(c) ?? 0) + 1);
  }
  let topCountry = "—";
  let topCountryN = 0;
  for (const [c, n] of countryCount) {
    if (n > topCountryN) { topCountryN = n; topCountry = c; }
  }

  let latest = "—";
  if (windowIncidents.length > 0) {
    const dates = windowIncidents
      .map((i) => { try { return parseISO(i.occurredAt); } catch { return null; } })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) latest = format(dateMax(dates), "dd MMM yyyy");
  }

  const topicLabel = topicLabels[data.topic] ?? data.topic;

  // Derive real operational incident types — never use topic/product names.
  const typeCounts = new Map<string, number>();
  for (const i of windowIncidents) {
    const type = classifyIncidentType(i);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  let topTypeLabel = "—";
  let topTypeN = 0;
  for (const [t, n] of typeCounts) {
    if (n > topTypeN) { topTypeN = n; topTypeLabel = t; }
  }

  const safeType = sanitizeFactValue(data.topic, topTypeLabel);
  const safeCountry = topCountry === "—" ? "Country not identified" : sanitizeFactValue(data.topic, topCountry);

  return [
    { label: "Reporting Period", value: reportingPeriod },
    { label: "Total Records", value: String(windowIncidents.length), note: `${topicLabel} in window` },
    { label: "Highest Severity", value: highestLabel, severity: highestKey || undefined, note: highestKey ? "Worst rating in window" : undefined },
    {
      label: "Top Issue Type",
      value: safeType,
      note: topTypeN > 0 && safeType === topTypeLabel ? `${topTypeN} record${topTypeN === 1 ? "" : "s"}` : "Data quality issue",
    },
    {
      label: "Most Affected Country",
      value: safeCountry,
      note: topCountryN > 0 && safeCountry === topCountry ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}` : "Coverage gap",
    },
    { label: "Latest Incident", value: latest },
  ];
}

function drawRelatedIncidents(
  ctx: Ctx,
  windowIncidents: TopicReportIncident[],
  topic: string,
  _topicLabels: Record<string, string>,
) {
  if (windowIncidents.length === 0) return;
  const { max } = relatedIncidentsLimit(topic);
  const sorted = [...windowIncidents].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const rows = sorted.slice(0, max);
  const truncated = sorted.length - rows.length;

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

  ensureSpace(ctx, 16);
  setText(pdf, DUSK);
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(8);
  const note = truncated > 0
    ? `Showing ${rows.length} most recent of ${sorted.length} records in window. Older records remain available in the Workbench.`
    : `Older records remain available in the Workbench.`;
  pdf.text(sanitize(note), ctx.MX, ctx.y + 10);
  pdf.setFont("helvetica", "normal");
  ctx.y += 16;
  // Touch the cadence helper so removing it would not silently regress —
  // and to make the per-cadence behaviour obvious to readers of this code.
  void reportCadence(topic);
}

export async function exportTopicReportPdf(
  data: TopicReportData,
  incidents: TopicReportIncident[],
  topicLabels: Record<string, string>,
  filename: string,
): Promise<void> {
  const topicLabel = topicLabels[data.topic] ?? data.topic;
  // Canonical naming: cover title, running header and subtitle use the
  // canonical topic name. Regional words live in scope, not the title.
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({
    kind: resolvedTitle,
    issueDate: headerDate,
  });

  // Full-bleed Polestar cover (page 1).
  const win = resolveReportWindow(data.topic, data.issueDate);
  const eyebrow = canon.subtitle
    ? `${canon.topicLine.toUpperCase()} · ${canon.subtitle.toUpperCase()}`
    : `POLESTAR INSIGHTS · ${canon.topicLine.toUpperCase()}`;
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: `${canon.topicLine} · ${cadence}`,
    reportingPeriod: win.label,
    eyebrow,
  });
  void topicLabel;
  // Body pages start here, each with the gradient header band.
  beginBodyPages(ctx);

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  const rawWindow = filterIncidentsToWindow(incidents, data.topic, data.issueDate, { byTopic: true });
  // Strip records that match the topic field but are not operationally on
  // topic (e.g. hiking obituary that happens to mention "fuel"). The filter
  // is applied once and used for Fast Facts, prose data and the table.
  const windowIncidents = rawWindow.filter((i) =>
    isTopicRelevant(data.topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, computeFastFacts(data, windowIncidents, topicLabels));

  const sections: [string, string | null | undefined][] = [
    ["Situation", data.situation],
    ["What Happened", data.whatHappened],
    ["What Matters", data.whatMatters],
    ["Implications for Business", data.implications],
    ["Watch Next", data.watchNext],
    ["Polestar View", data.polestarView],
  ];
  for (const [label, body] of sections) {
    if (body && body.trim()) {
      drawSectionHeading(ctx, label);
      renderProse(ctx, body);
    }
  }

  drawRelatedIncidents(ctx, windowIncidents, data.topic, topicLabels);

  drawSourceNotes(ctx);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
