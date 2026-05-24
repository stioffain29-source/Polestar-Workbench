import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages, prepareCoverImage,
  COVER_TOP_BAND_H, COVER_BOTTOM_BLOCK_H,
  setFill, setStroke, setText, sanitize, setRoboto, ensureRobotoLoaded,
  NAVY, POLAR, DUSK, WHITE, ELECTRIC, SEV_COLOR, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
import {
  resolveReportWindow, filterIncidentsToWindow, relatedIncidentsLimit, reportCadence,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
// Per-topic cover photography is registered in coverImages.ts so the
// on-screen ReportPreview and this exporter share one source of truth.
import { TOPIC_COVER_URLS } from "./coverImages";
import { isTopicRelevant } from "./topicRelevance";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
// Single source of truth for the Fast Facts cards so the on-screen
// preview and this PDF exporter cannot drift.
import { computeTopicFastFacts } from "./topicFastFacts";
import { computeFuelHardNumbers } from "./fuelHardNumbers";
import { buildFuelRegionalHighlights, buildFuelProducerBuyerActions } from "./fuelNarratives";
import {
  getFuelJetFuelTrajectory,
  jetFuelBenchmarkLabel,
  type JetFuelPricePoint,
} from "./jetFuelTrajectory";

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
  /**
   * Raw report.hardNumbers jsonb. Parsed by jetFuelTrajectory.ts to drive
   * the Jet Fuel Price Trajectory chart and the Singapore Jet Fuel card.
   */
  hardNumbers?: unknown;
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

function formatDateShortPdf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate().toString().padStart(2, "0")} ${months[d.getUTCMonth()]}`;
}

/**
 * Draw the Jet Fuel Price Trajectory chart in the PDF. Mirrors the SVG
 * version in JetFuelTrajectoryChart.tsx (line plot, electric-blue
 * trajectory, navy latest-value marker, polar-gray axes/gridlines,
 * Roboto throughout). Annotations are drawn only when supplied by data.
 */
function drawJetFuelChart(ctx: Ctx, series: JetFuelPricePoint[], benchmark: string) {
  const { pdf, MX, CW } = ctx;
  const headerH = 18;
  const chartH = 150;
  const captionH = 14;
  const totalH = headerH + chartH + captionH + 8;
  ensureSpace(ctx, totalH + 10);

  // Pick a display unit from the first point that has one.
  let unit = "";
  for (const p of series) { if (p.unit) { unit = p.unit; break; } }

  // Header line: benchmark + unit on the left, latest value on the right.
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(10);
  pdf.text(`${benchmark}${unit ? ` (${unit})` : ""}`, MX, ctx.y + 11);
  const last = series[series.length - 1];
  const span = Math.max(
    Math.max(...series.map((p) => p.value)) - Math.min(...series.map((p) => p.value)),
    Math.abs(Math.max(...series.map((p) => p.value))) * 0.02,
    0.01,
  );
  const yDecimals = span >= 10 ? 0 : span >= 1 ? 1 : 2;
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  const latestStr = `Latest ${formatDateShortPdf(last.date)}: ${last.value.toFixed(yDecimals)}${unit ? ` ${unit}` : ""}`;
  pdf.text(latestStr, MX + CW, ctx.y + 11, { align: "right" });

  // Chart plot area.
  const plotX0 = MX + 36;
  const plotY0 = ctx.y + headerH;
  const plotW = CW - 36 - 6;
  const plotH = chartH - 18;
  const xAxisY = plotY0 + plotH;
  const minP = Math.min(...series.map((p) => p.value));
  const maxP = Math.max(...series.map((p) => p.value));
  const yMin = minP - span * 0.15;
  const yMax = maxP + span * 0.15;
  const xAt = (i: number) => plotX0 + (i / (series.length - 1)) * plotW;
  const yAt = (v: number) => plotY0 + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Axes.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(1);
  pdf.line(plotX0, plotY0, plotX0, xAxisY);
  pdf.line(plotX0, xAxisY, plotX0 + plotW, xAxisY);

  // Y gridlines + labels.
  const yTicks = [0, 1, 2, 3].map((k) => yMin + (k / 3) * (yMax - yMin));
  pdf.setLineWidth(0.3);
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  for (const v of yTicks) {
    const y = yAt(v);
    pdf.line(plotX0, y, plotX0 + plotW, y);
    pdf.text(v.toFixed(yDecimals), plotX0 - 4, y + 3, { align: "right" });
  }

  // X tick labels.
  const tickIdx = series.length <= 4
    ? series.map((_, i) => i)
    : [0, Math.floor((series.length - 1) / 3), Math.floor((2 * (series.length - 1)) / 3), series.length - 1];
  for (const i of tickIdx) {
    pdf.text(formatDateShortPdf(series[i].date), xAt(i), xAxisY + 11, { align: "center" });
  }

  // Annotations (data-supplied only).
  for (let i = 0; i < series.length; i++) {
    const ann = series[i].annotation;
    if (!ann) continue;
    setStroke(pdf, DUSK);
    pdf.setLineWidth(0.3);
    pdf.setLineDashPattern([2, 2], 0);
    pdf.line(xAt(i), plotY0, xAt(i), xAxisY);
    pdf.setLineDashPattern([], 0);
    setText(pdf, DUSK);
    pdf.setFontSize(7);
    pdf.text(ann, xAt(i) + 3, plotY0 + 8);
    pdf.setFontSize(8);
  }

  // Trajectory line.
  setStroke(pdf, ELECTRIC);
  pdf.setLineWidth(1.2);
  for (let i = 1; i < series.length; i++) {
    pdf.line(xAt(i - 1), yAt(series[i - 1].value), xAt(i), yAt(series[i].value));
  }

  // Latest-value marker — flat circle.
  setFill(pdf, NAVY);
  pdf.circle(xAt(series.length - 1), yAt(last.value), 2.2, "F");

  // Caption below.
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  const caption = `${benchmark}, ${series.length} observations from ${formatDateShortPdf(series[0].date)} to ${formatDateShortPdf(last.date)}.`;
  pdf.text(caption, MX, plotY0 + plotH + 28);

  ctx.y = plotY0 + plotH + 28 + 6;
}

function drawJetFuelEmptyCard(ctx: Ctx, benchmark: string) {
  // Bordered card matching JetFuelTrajectoryChart's preview empty-state:
  // Polar Gray 1pt border, Navy title, Dusk body, Roboto, no shadow.
  // The benchmark label is supplied from the same parser the preview
  // uses (jetFuelBenchmarkLabel) so the two empty-states match.
  const { pdf, MX, CW } = ctx;
  const titleH = 14;
  const bodyH = 18;
  const padX = 12;
  const padY = 12;
  const cardH = titleH + bodyH + padY * 2;
  ensureSpace(ctx, cardH + 8);
  setStroke(pdf, POLAR);
  pdf.setLineWidth(1);
  pdf.rect(MX, ctx.y, CW, cardH, "S");
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(10);
  pdf.text(benchmark, MX + padX, ctx.y + padY + 10);
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  pdf.text(
    "Jet fuel trajectory data is not available for this reporting cycle.",
    MX + padX,
    ctx.y + padY + titleH + 12,
  );
  ctx.y += cardH + 10;
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
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    pdf.text("TYPE", MX + colDateW + 6, ctx.y + 12);
    pdf.text("TITLE", MX + colDateW + colTypeW + 6, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colTypeW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    setRoboto(pdf, "regular");
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
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    const sevDisplay = SEV_LABEL[sk] ?? i.severity ?? "";
    pdf.text(sanitize(sevDisplay.toUpperCase()), chipX + 28, ctx.y + 12, { align: "center" });
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);

    ctx.y += rh;
  }
  ctx.y += 8;

  ensureSpace(ctx, 16);
  setText(pdf, DUSK);
  setRoboto(pdf, "italic");
  pdf.setFontSize(8);
  const note = truncated > 0
    ? `Showing ${rows.length} latest of ${sorted.length} records in window. Older records remain available in the Workbench.`
    : `Older records remain available in the Workbench.`;
  pdf.text(sanitize(note), ctx.MX, ctx.y + 10);
  setRoboto(pdf, "regular");
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
  // Embed Roboto on this pdf instance before drawing any text. Without this,
  // jsPDF silently falls back to Helvetica, which the brand spec forbids.
  await ensureRobotoLoaded(ctx.pdf);

  // Full-bleed Polestar cover (page 1). For topics with a registered cover
  // photo (see TOPIC_COVER_URLS), prepare the hero image the same way the
  // shipping report does and pass it through; otherwise fall back to the
  // gradient hero. The image load is wrapped in try/catch so a missing or
  // unreadable asset never blocks PDF export.
  const win = resolveReportWindow(data.topic, data.issueDate);
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  const topicCoverUrl = TOPIC_COVER_URLS[data.topic];
  if (topicCoverUrl) {
    try {
      const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
      coverImage = await prepareCoverImage(topicCoverUrl, ctx.W, heroH);
    } catch (err) {
      console.warn(`[exportTopicReportPdf] cover image load failed for topic ${data.topic}, falling back to gradient hero`, err);
    }
  }
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: "POLESTAR INSIGHTS",
    reportingPeriod: `REPORTING PERIOD: ${win.label.toUpperCase()}`,
    coverImage,
  });
  void topicLabel;
  void canon;
  void cadence;
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
  const isFuel = data.topic === "fuel";
  if (isFuel) {
    // Fuel Watch uses Hard Numbers in the slot Fast Facts occupies for
    // other topics. The cards are derived from incidents on file —
    // market-price cards are omitted entirely until a verified source
    // is wired in (no invented prices).
    drawSectionHeading(ctx, "Hard Numbers");
    drawFastFactsKpiCards(
      ctx,
      computeFuelHardNumbers({
        issueDate: data.issueDate,
        incidents,
        hardNumbersRaw: data.hardNumbers,
      }) as KpiCardData[],
    );

    // Jet Fuel Price Trajectory — render the real chart only when the
    // report carries a usable series (≥2 valid dated points). Otherwise
    // fall back to the honest empty-state card. Preview and PDF use the
    // same parser (getFuelJetFuelTrajectory) so they cannot drift.
    drawSectionHeading(ctx, "Jet Fuel Price Trajectory");
    const jetSeries = getFuelJetFuelTrajectory(data.hardNumbers);
    if (jetSeries) {
      drawJetFuelChart(ctx, jetSeries, jetFuelBenchmarkLabel(data.hardNumbers));
    } else {
      drawJetFuelEmptyCard(ctx, jetFuelBenchmarkLabel(data.hardNumbers));
    }

    const regional = buildFuelRegionalHighlights({ issueDate: data.issueDate, incidents });
    const producerBuyer = buildFuelProducerBuyerActions({ issueDate: data.issueDate, incidents });

    const fuelSections: [string, string | null | undefined][] = [
      ["Situation", data.situation],
      ["What Happened", data.whatHappened],
      ["Regional Highlights", regional],
      ["Producer and Buyer Actions", producerBuyer],
      ["What Matters", data.whatMatters],
      ["Implications for Business", data.implications],
      ["Watch Next", data.watchNext],
      ["Polestar View", data.polestarView],
    ];
    for (const [label, body] of fuelSections) {
      if (body && body.trim()) {
        drawSectionHeading(ctx, label);
        renderProse(ctx, body);
      }
    }
  } else {
    drawSectionHeading(ctx, "Fast Facts");
    drawFastFactsKpiCards(
      ctx,
      computeTopicFastFacts({
        topic: data.topic,
        issueDate: data.issueDate,
        incidents,
        topicLabel: topicLabels[data.topic] ?? data.topic,
      }) as KpiCardData[],
    );

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
  }

  drawRelatedIncidents(ctx, windowIncidents, data.topic, topicLabels);

  drawSourceNotes(ctx);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
