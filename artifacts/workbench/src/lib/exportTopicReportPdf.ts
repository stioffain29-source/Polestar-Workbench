import { format, parseISO, max as dateMax } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  setFill, setStroke, setText, sanitize,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
import {
  resolveReportWindow, filterIncidentsToWindow, relatedIncidentsLimit, reportCadence,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";

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

  return [
    { label: "Reporting Period", value: reportingPeriod },
    { label: "Total Records", value: String(windowIncidents.length), note: `${topicLabel} in window` },
    { label: "Highest Severity", value: highestLabel, severity: highestKey || undefined, note: highestKey ? "Worst rating in window" : undefined },
    {
      label: "Top Issue Type",
      value: topTypeLabel,
      note: topTypeN > 0 ? `${topTypeN} record${topTypeN === 1 ? "" : "s"}` : undefined,
    },
    { label: "Most Affected Country", value: topCountry, note: topCountryN > 0 ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}` : undefined },
    { label: "Latest Incident", value: latest },
  ];
}

function drawCover(ctx: Ctx, data: TopicReportData, topicLabel: string) {
  const { pdf, MX, CW } = ctx;
  const heroH = 110;
  setFill(pdf, NAVY);
  pdf.rect(MX, ctx.y, CW, heroH, "F");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX + CW - 5, ctx.y, 5, heroH, "F");
  try {
    pdf.addImage(polestarLogo, "PNG", MX + 22, ctx.y + 22, 140, 21, undefined, "FAST");
  } catch { /* ignore */ }

  const subhead = data.topic === "protests" ? "FLASHPOINT" : topicLabel.toUpperCase();
  const tertiary = data.topic === "protests" ? "Activism, Protests & Civil Unrest" : "";

  setText(pdf, WHITE);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(sanitize(`POLESTAR INSIGHTS  ·  ${subhead}`), MX + 22, ctx.y + 60);

  if (tertiary) {
    pdf.setFontSize(7);
    pdf.text(sanitize(tertiary), MX + 22, ctx.y + 70);
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  const titleLines: string[] = pdf.splitTextToSize(sanitize(data.title || "Untitled report"), CW - 44);
  pdf.text(titleLines.slice(0, 2), MX + 22, ctx.y + (tertiary ? 92 : 82));

  let metaY = ctx.y + heroH - 14;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  let issueDateText = data.issueDate;
  try { issueDateText = format(parseISO(data.issueDate), "d MMMM yyyy"); } catch { /* keep raw */ }
  const meta = [issueDateText, data.author].filter(Boolean).join("  ·  ");
  pdf.text(sanitize(meta), MX + 22, metaY);

  ctx.y += heroH + 20;
}

function drawReportingPeriodBanner(ctx: Ctx, label: string) {
  const { pdf, MX, CW } = ctx;
  const h = 22;
  ensureSpace(ctx, h + 6);
  setFill(pdf, POLAR);
  pdf.rect(MX, ctx.y, CW, h, "F");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX, ctx.y, 4, h, "F");
  setText(pdf, NAVY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(sanitize(label.toUpperCase()), MX + 12, ctx.y + 14);
  pdf.setFont("helvetica", "normal");
  ctx.y += h + 14;
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
  const cadence = data.topic === "cargo_watch" ? "Monthly Briefing" : "Weekly Briefing";
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({
    kind: `${topicLabel} · ${cadence}`,
    issueDate: headerDate,
  });

  drawCover(ctx, data, topicLabel);

  // Reporting period banner — visible near the top of every report.
  const win = resolveReportWindow(data.topic, data.issueDate);
  drawReportingPeriodBanner(ctx, win.label);

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  const windowIncidents = filterIncidentsToWindow(incidents, data.topic, data.issueDate, { byTopic: true });
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

  const reportDate = (() => {
    try { return format(parseISO(data.issueDate), "dd MMM yyyy"); } catch { return data.issueDate; }
  })();
  drawFooters(ctx.pdf, reportDate);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
