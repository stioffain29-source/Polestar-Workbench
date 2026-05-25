import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse, drawSectionWithProse,
  drawFastFactsKpiCards, drawBulletSection, drawDisclaimer, drawFooters,
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
import {
  buildFuelWatchReportData,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "./fuelWatchReport";
import type { ProducerBuyerActionRow } from "./fuelNarratives";
import type { JetFuelPricePoint } from "./jetFuelTrajectory";
import {
  buildCargoSecurityRead,
  buildLogisticsHubRead,
  buildCargoWhatMatters,
  buildCargoImplications,
  buildCargoWatchNext,
  buildCargoPolestarView,
} from "./cargoNarratives";

/** Thrown by exportTopicReportPdf when Fuel Watch is missing required
 *  market data and the caller did not pass allowMissingMarketData. The
 *  editor catches this error code to surface its override button. */
export const FUEL_REQUIRED_DATA_MISSING_CODE = "FUEL_REQUIRED_DATA_MISSING";
export class FuelRequiredDataMissingError extends Error {
  readonly code = FUEL_REQUIRED_DATA_MISSING_CODE;
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`${FUEL_MISSING_REQUIRED_NOTE} Missing: ${missing.join(", ")}.`);
    this.name = "FuelRequiredDataMissingError";
    this.missing = missing;
  }
}

export interface ExportTopicReportPdfOptions {
  /** When true, Fuel Watch will export even with missing required data
   *  and surface the warnings in the document. Defaults to false (fail
   *  closed) so authors cannot accidentally ship a hollow report. */
  allowMissingMarketData?: boolean;
}

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
   * the Jet Fuel Price Trajectory chart and the jet fuel hard-number card.
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

/**
 * Producer and Buyer Actions table. 4-column layout matching the
 * on-screen preview: Actor / Category / Action (with date) / Operational
 * Read. Header bar in Navy with white text; rows separated by a thin
 * Polar Gray rule. Each row's height is the tallest wrapped cell.
 */
function drawProducerBuyerActionsTable(ctx: Ctx, rows: ProducerBuyerActionRow[]) {
  if (rows.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const colActorW = Math.round(CW * 0.16);
  const colCatW = Math.round(CW * 0.18);
  const colReadW = Math.round(CW * 0.30);
  const colActionW = CW - colActorW - colCatW - colReadW;
  const headerH = 18;
  const padX = 6;
  const lineH = 11;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, headerH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("ACTOR", MX + padX, ctx.y + 12);
    pdf.text("CATEGORY", MX + colActorW + padX, ctx.y + 12);
    pdf.text("ACTION", MX + colActorW + colCatW + padX, ctx.y + 12);
    pdf.text("OPERATIONAL READ", MX + colActorW + colCatW + colActionW + padX, ctx.y + 12);
    ctx.y += headerH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, headerH + 30);
  drawHeader();

  for (const r of rows) {
    const actionText = r.date ? `${r.action}\n${r.date}` : r.action;
    const actorLines: string[] = pdf.splitTextToSize(sanitize(r.actor), colActorW - padX * 2);
    const catLines: string[] = pdf.splitTextToSize(sanitize(r.category), colCatW - padX * 2);
    const actionLines: string[] = pdf.splitTextToSize(sanitize(actionText), colActionW - padX * 2);
    const readLines: string[] = pdf.splitTextToSize(sanitize(r.operationalRead), colReadW - padX * 2);
    const maxLines = Math.max(actorLines.length, catLines.length, actionLines.length, readLines.length);
    const rh = Math.max(20, maxLines * lineH + 8);

    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
    }

    // Row separator at the bottom of the row.
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text(actorLines, MX + padX, ctx.y + 12);

    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
    pdf.text(catLines, MX + colActorW + padX, ctx.y + 12);
    pdf.text(actionLines, MX + colActorW + colCatW + padX, ctx.y + 12);
    pdf.text(readLines, MX + colActorW + colCatW + colActionW + padX, ctx.y + 12);

    ctx.y += rh;
  }
  ctx.y += 8;
}

function drawRelatedIncidents(
  ctx: Ctx,
  windowIncidents: TopicReportIncident[],
  topic: string,
  _topicLabels: Record<string, string>,
) {
  if (windowIncidents.length === 0) return;
  const { max } = relatedIncidentsLimit(topic);
  // Prioritise operationally meaningful rows. When the classifier
  // returns its weakest bucket (e.g. "Other fuel incident") we push
  // those rows to the bottom; if we have at least a handful of
  // operationally classified rows, the weakest bucket is dropped
  // entirely so the table does not drag the report down.
  function weakBucket(label: string): boolean {
    return /^other\s.+incident$/i.test(label) || label === "Unclassified maritime record";
  }
  // For Cargo specifically the source data carries a lot of generic
  // "Warehouse theft - Other" / "Container theft - Other" /
  // "Warehouse theft - Electronics" titles that repeat across the
  // window. Treat any title ending in a generic suffix as a weak row
  // so the table prefers named-place / named-corridor / named-cargo
  // records when they exist.
  function isGenericCargoTitle(title: string): boolean {
    return /\b(warehouse|container|cargo|truck|depot)\s+theft\s+-\s+(other|unknown|misc|miscellaneous|general|electronics|goods|items|various|assorted)\s*$/i.test(
      (title ?? "").trim(),
    );
  }
  // Title-based dedupe: collapse syndicated / repeated rows so the
  // Related Incidents table does not list the same loss four times.
  function titleKey(s: string): string {
    const STOP = new Set([
      "the", "a", "an", "of", "in", "on", "at", "to", "for", "and",
      "as", "by", "off", "near", "after", "amid", "with", "from", "into", "over",
      "says", "say", "said", "reports", "report",
    ]);
    return (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w && !STOP.has(w))
      .slice(0, 8)
      .join(" ");
  }
  const seen = new Set<string>();
  const deduped: TopicReportIncident[] = [];
  for (const i of windowIncidents) {
    const k = titleKey(i.title);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    deduped.push(i);
  }
  const annotated = deduped.map((i) => ({
    i,
    weak:
      weakBucket(classifyIncidentType(i)) ||
      (topic === "cargo_watch" && isGenericCargoTitle(i.title)),
  }));
  const strong = annotated.filter((r) => !r.weak).map((r) => r.i);
  const weak = annotated.filter((r) => r.weak).map((r) => r.i);
  const STRONG_FLOOR = 4;
  // Cargo: generic-suffix titles ("Warehouse theft - Other" /
  // "Container theft - Electronics" etc.) are hard-excluded regardless
  // of strong-row count — they add noise without operational signal.
  // Other topics keep the existing weak-fallback behaviour so sparse
  // windows still produce a usable table.
  const ordered =
    topic === "cargo_watch"
      ? strong
      : strong.length >= STRONG_FLOOR ? strong : [...strong, ...weak];
  const sorted = [...ordered].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  // Per-topic caps. Fuel was already tighter; Cargo and the generic
  // path are now held at 10 so the Source Notes / Disclaimer block can
  // be pulled back onto the same page rather than orphaned on a near-
  // empty final page.
  const effectiveMax =
    topic === "fuel" ? Math.min(max, 8)
    : topic === "cargo_watch" ? Math.min(max, 10)
    : Math.min(max, 10);
  const rows = sorted.slice(0, effectiveMax);
  const truncated = sorted.length - rows.length;
  if (rows.length === 0) return;

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

  // Client-facing reports intentionally omit the "Showing N latest of M"
  // notice. The table cap is internal Workbench logic and surfacing it
  // weakens the PDF.
  void truncated;
  void sorted;
  // Touch the cadence helper so removing it would not silently regress —
  // and to make the per-cadence behaviour obvious to readers of this code.
  void reportCadence(topic);
}

export async function exportTopicReportPdf(
  data: TopicReportData,
  incidents: TopicReportIncident[],
  topicLabels: Record<string, string>,
  filename: string,
  options: ExportTopicReportPdfOptions = {},
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
    // Canonical Fuel Watch payload — shared by preview/PDF/editor.
    const fuelData = buildFuelWatchReportData(
      {
        title: data.title,
        issueDate: data.issueDate,
        author: data.author,
        executiveSummary: data.executiveSummary,
        situation: data.situation,
        whatHappened: data.whatHappened,
        whatMatters: data.whatMatters,
        implications: data.implications,
        polestarView: data.polestarView,
        watchNext: data.watchNext,
        hardNumbers: data.hardNumbers,
      },
      incidents,
    );

    // Fail closed: refuse to export a polished but hollow report unless
    // the caller explicitly opted in via options.allowMissingMarketData.
    if (!fuelData.validation.hasRequiredFuelWatchData && !options.allowMissingMarketData) {
      throw new FuelRequiredDataMissingError(fuelData.validation.missingRequired);
    }

    drawSectionHeading(ctx, "Fast Facts");
    if (!fuelData.validation.hasRequiredFuelWatchData) {
      // Override path: render a visible warning at the top of Fast Facts.
      renderProse(
        ctx,
        `${FUEL_MISSING_REQUIRED_NOTE} Missing: ${fuelData.validation.missingRequired.join(", ")}.`,
      );
    }
    if (fuelData.marketData.fastFactsCards.length === 0) {
      // No marketData at all but the user overrode — emit warnings only.
      for (const w of fuelData.validation.warnings) renderProse(ctx, w);
    } else {
      const kpis: KpiCardData[] = fuelData.marketData.fastFactsCards.map(toRenderableCard);
      drawFastFactsKpiCards(ctx, kpis);
      for (const w of fuelData.validation.warnings) renderProse(ctx, w);
    }

    // Jet Fuel Price Trajectory — render only when the series has
    // ≥2 valid dated points (the canonical data already enforces this).
    drawSectionHeading(ctx, "Jet Fuel Price Trajectory");
    if (fuelData.marketData.jetFuelTrajectory.length >= 2) {
      drawJetFuelChart(
        ctx,
        fuelData.marketData.jetFuelTrajectory,
        fuelData.marketData.jetFuelBenchmarkLabel,
      );
    } else {
      drawJetFuelEmptyCard(ctx, fuelData.marketData.jetFuelBenchmarkLabel);
    }

    // Ordered Fuel Watch sections. Auto-derived sections (Market Read,
    // Operational Read, Regional Highlights, Producer and Buyer Actions)
    // sit alongside the editor-authored prose so the report reads 60%
    // analysis / 40% data rather than dashboard-style cards.
    // Use the atomic heading+first-paragraph renderer for every Fuel
    // Watch section so a heading is never stranded at the foot of a
    // page while its body lands on the next one.
    const renderProseSection = (label: string, body: string | null | undefined) => {
      if (body && body.trim()) drawSectionWithProse(ctx, label, body);
    };

    renderProseSection("Market Read", fuelData.marketData.marketRead);
    renderProseSection("Situation", data.situation);
    renderProseSection("What Happened", data.whatHappened);
    renderProseSection("Operational Read", fuelData.incidentData.operationalRead);
    renderProseSection("Regional Highlights", fuelData.incidentData.regionalHighlights);
    if (fuelData.incidentData.producerBuyerActions.length > 0) {
      // Guard against an orphaned section heading: if there isn't room
      // for the heading + table header + a couple of rows, push the
      // whole block to the next page before drawing the heading.
      ensureSpace(ctx, 24 + 18 + 60);
      drawSectionHeading(ctx, "Producer and Buyer Actions");
      drawProducerBuyerActionsTable(ctx, fuelData.incidentData.producerBuyerActions);
    }
    renderProseSection("What Matters", data.whatMatters);
    if (data.implications && data.implications.trim()) {
      drawBulletSection(ctx, "Implications for Business", data.implications);
    }
    if (data.watchNext && data.watchNext.trim()) {
      drawBulletSection(ctx, "Watch Next", data.watchNext, 8);
    }
    renderProseSection("Polestar View", data.polestarView);
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

    const isCargo = data.topic === "cargo_watch";
    const pickProse = (editor: string | null | undefined, auto: string): string => {
      const t = (editor ?? "").trim();
      return t.length > 0 ? t : auto;
    };

    if (isCargo) {
      const cargoSecurity = buildCargoSecurityRead(windowIncidents);
      const cargoNode = buildLogisticsHubRead(windowIncidents);
      // Editor text always wins on the four standard analyst sections;
      // auto-prose fills in when the editor leaves a field blank so the
      // cargo report reads at Fuel-Watch substance out of the box.
      const proseSections: [string, string][] = [
        ["Cargo Security Read", cargoSecurity],
        ["Logistics Hub Read", cargoNode],
        ["Situation", (data.situation ?? "").trim()],
        ["What Happened", (data.whatHappened ?? "").trim()],
        ["What Matters", pickProse(data.whatMatters, buildCargoWhatMatters(windowIncidents))],
      ];
      for (const [label, body] of proseSections) {
        if (body && body.trim()) drawSectionWithProse(ctx, label, body);
      }
      const implBody = pickProse(data.implications, buildCargoImplications(windowIncidents));
      if (implBody && implBody.trim()) drawBulletSection(ctx, "Implications for Business", implBody);
      const wnBody = pickProse(data.watchNext, buildCargoWatchNext(windowIncidents));
      if (wnBody && wnBody.trim()) drawBulletSection(ctx, "Watch Next", wnBody, 8);
      const psBody = pickProse(data.polestarView, buildCargoPolestarView(windowIncidents));
      if (psBody && psBody.trim()) drawSectionWithProse(ctx, "Polestar View", psBody);
    } else {
      const proseSections: [string, string | null | undefined][] = [
        ["Situation", data.situation],
        ["What Happened", data.whatHappened],
        ["What Matters", data.whatMatters],
      ];
      for (const [label, body] of proseSections) {
        if (body && body.trim()) drawSectionWithProse(ctx, label, body);
      }
      if (data.implications && data.implications.trim()) {
        drawBulletSection(ctx, "Implications for Business", data.implications);
      }
      if (data.watchNext && data.watchNext.trim()) {
        drawBulletSection(ctx, "Watch Next", data.watchNext, 8);
      }
      if (data.polestarView && data.polestarView.trim()) {
        drawSectionWithProse(ctx, "Polestar View", data.polestarView);
      }
    }
  }

  drawRelatedIncidents(ctx, windowIncidents, data.topic, topicLabels);

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
