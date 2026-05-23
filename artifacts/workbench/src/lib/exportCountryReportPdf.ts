import { format, parseISO, min as dateMin, max as dateMax } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  setFill, setStroke, setText, sanitize, todayLabel,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";

export interface PdfIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
}

export interface PdfCountry {
  name: string;
  region: string;
  overview?: string | null;
  trendSummary?: string | null;
  implications?: string | null;
  keyNumbers?: { label: string; value: string; context?: string | null }[] | null;
}

function computeFastFacts(
  country: PdfCountry,
  incidents: PdfIncident[],
  topicLabels: Record<string, string>,
): KpiCardData[] {
  let period = "No incidents in window";
  let latest = "—";
  if (incidents.length > 0) {
    const dates = incidents
      .map((i) => { try { return parseISO(i.occurredAt); } catch { return null; } })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) {
      period = `${format(dateMin(dates), "dd MMM")} – ${format(dateMax(dates), "dd MMM yyyy")}`;
      latest = format(dateMax(dates), "dd MMM yyyy");
    }
  }

  let highestKey = "";
  let highestRank = 0;
  for (const i of incidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  const highestLabel = highestKey ? (SEV_LABEL[highestKey] ?? highestKey) : "—";

  const topicCount = new Map<string, number>();
  for (const i of incidents) topicCount.set(i.topic, (topicCount.get(i.topic) ?? 0) + 1);
  let mostCommonLabel = "—";
  let mostCommonN = 0;
  for (const [t, n] of topicCount) {
    if (n > mostCommonN) { mostCommonN = n; mostCommonLabel = topicLabels[t] ?? t; }
  }

  let mainArea = country.region || "—";
  if (country.keyNumbers && country.keyNumbers.length > 0) {
    const withCtx = country.keyNumbers.find((k) => !!k.context && k.context.trim().length > 0);
    if (withCtx?.context) mainArea = withCtx.context;
  }

  return [
    { label: "Reporting Period", value: period },
    { label: "Total Records", value: String(incidents.length), note: "Incidents on file for this country" },
    { label: "Highest Severity", value: highestLabel, severity: highestKey || undefined, note: highestKey ? "Worst rating in window" : undefined },
    { label: "Most Affected Area", value: mainArea },
    { label: "Latest Incident", value: latest },
    { label: "Key Issue Type", value: mostCommonLabel === "—" ? "—" : mostCommonLabel, note: mostCommonN > 0 ? `${mostCommonN} record${mostCommonN === 1 ? "" : "s"}` : undefined },
  ];
}

function drawCover(ctx: Ctx, country: PdfCountry) {
  const { pdf, MX, CW } = ctx;
  const heroH = 96;
  setFill(pdf, NAVY);
  pdf.rect(MX, ctx.y, CW, heroH, "F");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX + CW - 5, ctx.y, 5, heroH, "F");
  try {
    pdf.addImage(polestarLogo, "PNG", MX + 22, ctx.y + 30, 140, 21, undefined, "FAST");
  } catch { /* ignore */ }
  setText(pdf, WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text(sanitize(country.name.toUpperCase()), MX + CW - 20, ctx.y + 54, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(sanitize(`${country.region.toUpperCase()}  ·  COUNTRY REPORT`),
    MX + CW - 20, ctx.y + 74, { align: "right" });
  ctx.y += heroH + 20;
}

function drawTopicChart(ctx: Ctx, incidents: PdfIncident[], topicLabels: Record<string, string>) {
  if (incidents.length === 0) return;
  const counts = new Map<string, number>();
  for (const i of incidents) counts.set(i.topic, (counts.get(i.topic) ?? 0) + 1);
  const data = Array.from(counts.entries())
    .map(([topic, n]) => ({ label: topicLabels[topic] ?? topic, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  if (data.length === 0) return;
  const max = Math.max(...data.map((d) => d.n));

  drawSectionHeading(ctx, "Incident Breakdown by Type");
  const { pdf, MX, CW } = ctx;
  const rowH = 18;
  const labelW = 150;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - 40;
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
    pdf.text(String(d.n), barAreaX + w + 6, ry + 12);
    pdf.setFont("helvetica", "normal");
  });
  ctx.y += chartH + 18;
}

function drawIncidentTable(ctx: Ctx, incidents: PdfIncident[], topicLabels: Record<string, string>) {
  if (incidents.length === 0) return;
  drawSectionHeading(ctx, "Related Incidents");
  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTopicW = 92;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colTopicW - colSevW - 6;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    pdf.text("TOPIC", MX + colDateW + 6, ctx.y + 12);
    pdf.text("TITLE", MX + colDateW + colTopicW + 6, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colTopicW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, rowH + 4);
  drawHeader();

  const sorted = [...incidents].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  for (const i of sorted) {
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
    pdf.text(sanitize(topicLabels[i.topic] ?? i.topic), MX + colDateW + 6, ctx.y + 12);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colTopicW + 6, ctx.y + 12);

    const sk = sevKey(i.severity);
    const sevColor = SEV_COLOR[sk] ?? "#999999";
    setFill(pdf, sevColor);
    const chipX = MX + colDateW + colTopicW + colTitleW + 6;
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
  ctx.y += 10;
}

export async function exportCountryReportPdf(
  country: PdfCountry,
  incidents: PdfIncident[],
  topicLabels: Record<string, string>,
  filename: string,
): Promise<void> {
  const issueDate = todayLabel();
  const ctx = createCtx({
    kind: `${country.name} · Country Report`,
    issueDate,
  });

  drawCover(ctx, country);

  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, computeFastFacts(country, incidents, topicLabels));

  if (country.overview) {
    drawSectionHeading(ctx, "Situation");
    renderProse(ctx, country.overview);
  }
  if (country.trendSummary) {
    drawSectionHeading(ctx, "What Happened");
    renderProse(ctx, country.trendSummary);
  }
  if (country.implications) {
    drawSectionHeading(ctx, "Implications for Business");
    renderProse(ctx, country.implications);
  }

  drawTopicChart(ctx, incidents, topicLabels);
  drawIncidentTable(ctx, incidents, topicLabels);

  drawSourceNotes(ctx);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf, issueDate);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
