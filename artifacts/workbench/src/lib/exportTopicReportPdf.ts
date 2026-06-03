import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse, drawSectionWithProse,
  drawFastFactsKpiCards, drawBulletSection, drawDisclaimer, measureDisclaimerHeight, drawFooters,
  drawPolestarCover, beginBodyPages, prepareCoverImage, drawDataAsOf,
  COVER_TOP_BAND_H, COVER_BOTTOM_BLOCK_H,
  setFill, setStroke, setText, sanitize, setRoboto, ensureRobotoLoaded,
  NAVY, POLAR, DUSK, WHITE, ELECTRIC, SEV_COLOR, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
import { computeDataAsOf, formatDataAsOfLine } from "./reportDataStatus";
import {
  resolveReportWindow, filterIncidentsToWindow, reportCadence,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { selectRelatedIncidents } from "./relatedIncidents";
// Per-topic cover photography is registered in coverImages.ts so the
// on-screen ReportPreview and this exporter share one source of truth.
import { TOPIC_COVER_URLS } from "./coverImages";
import { isTopicRelevant } from "./topicRelevance";
import {
  buildCargoReportExtras,
  formatCargoUsd,
  cargoUsdNote,
  cargoCommodityNote,
  niceCargoCountMax,
  type CargoTrendPoint,
} from "./cargoReportData";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
// Single source of truth for the Fast Facts cards so the on-screen
// preview and this PDF exporter cannot drift.
import { computeTopicFastFacts, filterTopicReportIncidents } from "./topicFastFacts";
import {
  buildFuelWatchReportData,
  fuelMarketLatestDate,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "./fuelWatchReport";
import { capFuelMarketSeverity, type ProducerBuyerActionRow } from "./fuelNarratives";
import type { JetFuelPricePoint } from "./jetFuelTrajectory";
import {
  buildCargoSecurityRead,
  buildCargoWhatHappened,
  buildLogisticsHubRead,
  buildCargoWhatMatters,
  buildCargoImplications,
  buildCargoWatchNext,
  buildCargoPolestarView,
  buildCargoSituation,
  buildCargoCountryBreakdown,
  type CargoCountryRow,
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
 * Draw the Weekly Cargo Theft Trend bar chart in the PDF. Mirrors the SVG
 * version in CargoTrendChart.tsx (electric-blue bars, navy/dusk labels,
 * polar-gray axes/gridlines, integer count ticks, Roboto throughout) so the
 * screen and the PDF render the same series in the same shape.
 */
function drawCargoTrendChart(ctx: Ctx, series: CargoTrendPoint[]) {
  const { pdf, MX, CW } = ctx;
  const headerH = 16;
  const chartH = 150;
  const captionH = 14;
  ensureSpace(ctx, headerH + chartH + captionH + 18);

  const total = series.reduce((s, d) => s + d.count, 0);

  // Header: title left, total/weeks right.
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(10);
  pdf.text("Weekly Cargo Theft Trend", MX, ctx.y + 11);
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  pdf.text(
    `${total} record${total === 1 ? "" : "s"} across ${series.length} weeks`,
    MX + CW,
    ctx.y + 11,
    { align: "right" },
  );

  const plotX0 = MX + 28;
  const plotY0 = ctx.y + headerH;
  const plotW = CW - 28 - 6;
  const plotH = chartH - 18;
  const xAxisY = plotY0 + plotH;
  const yMax = niceCargoCountMax(Math.max(...series.map((d) => d.count)));
  const ticks = yMax <= 4
    ? Array.from({ length: yMax + 1 }, (_, k) => k)
    : [0, 1, 2, 3, 4].map((k) => (k / 4) * yMax);

  const slot = plotW / series.length;
  const barW = slot * 0.6;
  const xAt = (i: number) => plotX0 + i * slot + slot / 2;
  const yAt = (v: number) => plotY0 + (1 - v / yMax) * plotH;

  // Axes.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(1);
  pdf.line(plotX0, plotY0, plotX0, xAxisY);
  pdf.line(plotX0, xAxisY, plotX0 + plotW, xAxisY);

  // Y gridlines + integer labels.
  pdf.setLineWidth(0.3);
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  for (const v of ticks) {
    const y = yAt(v);
    pdf.line(plotX0, y, plotX0 + plotW, y);
    pdf.text(String(Math.round(v)), plotX0 - 4, y + 3, { align: "right" });
  }

  // Bars.
  setFill(pdf, ELECTRIC);
  for (let i = 0; i < series.length; i++) {
    const h = xAxisY - yAt(series[i].count);
    if (h > 0) pdf.rect(xAt(i) - barW / 2, yAt(series[i].count), barW, h, "F");
  }

  // X tick labels (sampled to avoid crowding).
  const tickIdx = series.length <= 6
    ? series.map((_, i) => i)
    : [0, Math.floor((series.length - 1) / 3), Math.floor((2 * (series.length - 1)) / 3), series.length - 1];
  setText(pdf, DUSK);
  for (const i of tickIdx) {
    pdf.text(formatDateShortPdf(series[i].date), xAt(i), xAxisY + 11, { align: "center" });
  }

  // Caption.
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  const caption = `In-scope cargo incidents per week, ${formatDateShortPdf(series[0].date)} to ${formatDateShortPdf(series[series.length - 1].date)}.`;
  pdf.text(caption, MX, xAxisY + 26);

  ctx.y = xAxisY + 26 + 6;
}

/**
 * Producer and Buyer Actions table. 4-column layout matching the
 * on-screen preview: Actor / Category / Action (with date) / Operational
 * Read. Header bar in Navy with white text; rows separated by a thin
 * Polar Gray rule. Each row's height is the tallest wrapped cell.
 */
/**
 * Pre-measure the full Producer/Buyer Actions table (header + all rows +
 * trailing gap) so the caller can keep the whole block together and avoid
 * orphaning a row onto the next page.
 */
function measureProducerBuyerActionsTable(ctx: Ctx, rows: ProducerBuyerActionRow[]): number {
  if (rows.length === 0) return 0;
  const { pdf, CW } = ctx;
  const colActorW = Math.round(CW * 0.16);
  const colCatW = Math.round(CW * 0.18);
  const colReadW = Math.round(CW * 0.30);
  const colActionW = CW - colActorW - colCatW - colReadW;
  const headerH = 20;
  const padX = 6;
  const lineH = 11;

  const prevSize = pdf.getFontSize();
  pdf.setFontSize(8);
  let total = headerH;
  for (const r of rows) {
    const actionText = r.date ? `${r.action}\n${r.date}` : r.action;
    const actorLines: string[] = pdf.splitTextToSize(sanitize(r.actor), colActorW - padX * 2);
    const catLines: string[] = pdf.splitTextToSize(sanitize(r.category), colCatW - padX * 2);
    const actionLines: string[] = pdf.splitTextToSize(sanitize(actionText), colActionW - padX * 2);
    const readLines: string[] = pdf.splitTextToSize(sanitize(r.operationalRead), colReadW - padX * 2);
    const maxLines = Math.max(actorLines.length, catLines.length, actionLines.length, readLines.length);
    total += Math.max(22, maxLines * lineH + 10);
  }
  pdf.setFontSize(prevSize);
  return total + 8;
}

function drawProducerBuyerActionsTable(ctx: Ctx, rows: ProducerBuyerActionRow[]) {
  if (rows.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const colActorW = Math.round(CW * 0.16);
  const colCatW = Math.round(CW * 0.18);
  const colReadW = Math.round(CW * 0.30);
  const colActionW = CW - colActorW - colCatW - colReadW;
  const headerH = 20;
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
    const rh = Math.max(22, maxLines * lineH + 10);

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

// Country Risk Breakdown table for the Cargo Watch report. Mirrors
// drawProducerBuyerActionsTable but the third column is a coloured five-tier
// severity chip. Rows are built by buildCargoCountryBreakdown, the same source
// the on-screen preview renders — so screen and PDF never disagree.
function drawCargoCountryTable(ctx: Ctx, rows: CargoCountryRow[]) {
  if (rows.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const colCountryW = Math.round(CW * 0.18);
  const colPatternW = Math.round(CW * 0.3);
  const colSevW = Math.round(CW * 0.16);
  const colReadW = CW - colCountryW - colPatternW - colSevW;
  const headerH = 20;
  const padX = 6;
  const lineH = 11;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, headerH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("REGION / COUNTRY", MX + padX, ctx.y + 12);
    pdf.text("CURRENT PATTERN", MX + colCountryW + padX, ctx.y + 12);
    pdf.text("SEVERITY", MX + colCountryW + colPatternW + padX, ctx.y + 12);
    pdf.text("OPERATIONAL READ", MX + colCountryW + colPatternW + colSevW + padX, ctx.y + 12);
    ctx.y += headerH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, headerH + 30);
  drawHeader();

  for (const r of rows) {
    const countryText = `${r.country}\n${r.count} record${r.count === 1 ? "" : "s"}`;
    const countryLines: string[] = pdf.splitTextToSize(sanitize(countryText), colCountryW - padX * 2);
    const patternLines: string[] = pdf.splitTextToSize(sanitize(r.pattern), colPatternW - padX * 2);
    const readLines: string[] = pdf.splitTextToSize(sanitize(r.operationalRead), colReadW - padX * 2);
    const maxLines = Math.max(countryLines.length, patternLines.length, readLines.length, 2);
    const rh = Math.max(28, maxLines * lineH + 10);

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
    // First country line bold; the "N records" line subdued regular.
    pdf.text(countryLines.slice(0, 1), MX + padX, ctx.y + 12);
    if (countryLines.length > 1) {
      setText(pdf, DUSK);
      setRoboto(pdf, "regular");
      pdf.setFontSize(7);
      pdf.text(countryLines.slice(1), MX + padX, ctx.y + 12 + lineH);
      pdf.setFontSize(8);
    }

    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
    pdf.text(patternLines, MX + colCountryW + padX, ctx.y + 12);
    pdf.text(readLines, MX + colCountryW + colPatternW + colSevW + padX, ctx.y + 12);

    // Severity chip — coloured by the row's tier key, label may be a range.
    const sk = sevKey(r.severityKey);
    const sevColor = SEV_COLOR[sk] ?? "#999999";
    const chipX = MX + colCountryW + colPatternW + padX;
    const chipW = colSevW - padX * 2;
    setFill(pdf, sevColor);
    pdf.rect(chipX, ctx.y + 5, chipW, 12, "F");
    // Insignificant keeps dark text for contrast; every other tier is white.
    setText(pdf, sk === "insignificant" ? DUSK : WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    pdf.text(sanitize(r.severityLabel.toUpperCase()), chipX + chipW / 2, ctx.y + 13, {
      align: "center",
    });
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);

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
  // Row selection (title dedupe, weak-bucket filtering, recency ordering and the
  // per-topic cap) is shared with the on-screen preview via selectRelatedIncidents
  // so the two surfaces can never disagree.
  const rows = selectRelatedIncidents(windowIncidents, topic);
  if (rows.length === 0) return;
  // Cargo rows carry a source attribution under the title so the client can see
  // the table is sourced, not fabricated.
  const showSource = topic === "cargo_watch";
  const sourceOf = (i: TopicReportIncident): string =>
    showSource ? sanitize((i.source ?? "").trim()) : "";

  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTypeW = 120;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colTypeW - colSevW - 6;
  const rowH = 20;
  const ROW_PAD = 10;

  // Keep the whole table together. Pre-measure the header plus every row
  // (with the same regular 8pt metrics used to render the titles) and also
  // reserve room for the Disclaimer block that follows, then break to a
  // fresh page UP-FRONT if the combined block will not fit on the current
  // page. This prevents a "heading + one orphan row" at the foot of the
  // previous page and keeps the table and disclaimer sitting cleanly
  // together on one page.
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  const SOURCE_LINE_H = 10;
  const measureTable = (rs: TopicReportIncident[]): number => {
    let h = rowH; // column header band
    for (const i of rs) {
      const tl: string[] = pdf.splitTextToSize(sanitize(i.title), colTitleW - 8);
      const srcH = sourceOf(i) ? SOURCE_LINE_H : 0;
      h += Math.max(rowH, tl.length * 11 + ROW_PAD + srcH);
    }
    return h;
  };
  const HEADING_BLOCK_H = 50;     // pre-pad + heading line + divider + lead
  // Reserve the disclaimer's ACTUAL measured height (wrapped at the real width)
  // so the keep-together estimate matches what drawDisclaimer will draw, rather
  // than a fixed guess that can drift if the legal text or margins change.
  const DISCLAIMER_RESERVE_H = measureDisclaimerHeight(ctx);
  const usable = ctx.H - ctx.TOP - ctx.BOTTOM;
  // Row-reduction fallback: if the heading + full table + disclaimer cannot
  // fit even on a fresh page, drop rows from the bottom until the whole block
  // fits, so the section and its disclaimer always sit together on one page.
  let drawnRows = rows.slice();
  let tableH = measureTable(drawnRows);
  while (
    drawnRows.length > 0 &&
    HEADING_BLOCK_H + tableH + 8 + DISCLAIMER_RESERVE_H > usable
  ) {
    drawnRows = drawnRows.slice(0, -1);
    tableH = measureTable(drawnRows);
  }
  // `measureTable` was called after the loop with the regular 8pt font already
  // set; re-assert it before the render loop runs splitTextToSize again.
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  ensureSpace(ctx, HEADING_BLOCK_H + tableH + 8 + DISCLAIMER_RESERVE_H);

  drawSectionHeading(ctx, "Related Incidents");

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

  for (const i of drawnRows) {
    const titleLines: string[] = pdf.splitTextToSize(sanitize(i.title), colTitleW - 8);
    const src = sourceOf(i);
    const rh = Math.max(rowH, titleLines.length * 11 + ROW_PAD + (src ? SOURCE_LINE_H : 0));
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
    const titleX = MX + colDateW + colTypeW + 6;
    pdf.text(titleLines, titleX, ctx.y + 12);
    // Source attribution under the title (cargo) — shows the row is sourced.
    if (src) {
      setRoboto(pdf, "italic");
      pdf.setFontSize(7);
      setText(pdf, DUSK);
      const srcLine: string = pdf.splitTextToSize(
        `Source: ${src}`,
        colTitleW - 8,
      )[0];
      pdf.text(srcLine, titleX, ctx.y + 12 + titleLines.length * 11);
      setRoboto(pdf, "regular");
      pdf.setFontSize(8);
    }

    const effectiveSeverity =
      topic === "fuel"
        ? capFuelMarketSeverity(i.severity, i.title, i.summary ?? "")
        : i.severity;
    const sk = sevKey(effectiveSeverity);
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
  // notice. The table cap is internal Workbench logic (in selectRelatedIncidents)
  // and surfacing it weakens the PDF.
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
  // Fuel Watch is a MARKET product: its reporting-period END is the latest
  // market close the report carries, NOT the stored issue date (which may
  // sit a few days past the last available market close). Deriving the
  // render date here keeps the cover date, reporting-period label, incident
  // window and chart all anchored to the same market close. Other topics —
  // and a fuel draft with no dated market data yet — keep the stored date.
  const renderIssueDate =
    data.topic === "fuel"
      ? (fuelMarketLatestDate(data.hardNumbers) ?? data.issueDate)
      : data.issueDate;
  let headerDate = renderIssueDate;
  try { headerDate = format(parseISO(renderIssueDate), "yyyy-MM-dd"); } catch { /* keep */ }

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
  const win = resolveReportWindow(data.topic, renderIssueDate);
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
  drawDataAsOf(
    ctx,
    formatDataAsOfLine(
      computeDataAsOf({
        topic: data.topic,
        incidents,
        marketAsOf:
          data.topic === "fuel" ? fuelMarketLatestDate(data.hardNumbers) : null,
      }),
    ),
  );

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  const rawWindow = filterIncidentsToWindow(incidents, data.topic, renderIssueDate, { byTopic: true });
  // Strip records that match the topic field but are not operationally on
  // topic (e.g. hiking obituary that happens to mention "fuel"). The filter
  // is applied once and used for Fast Facts, prose data and the table.
  const windowIncidents: TopicReportIncident[] = data.topic === "cargo_watch"
    ? // Cargo Watch: use the SHARED selector the on-screen preview and the cargo
      // page use, so the PDF, the preview and the dashboard can never tally
      // differently (preview==PDF is mandatory). The cast is safe — the selector
      // returns the same row objects (id is always present on real incidents).
      (filterTopicReportIncidents(incidents, data.topic, renderIssueDate) as TopicReportIncident[])
    : rawWindow.filter((i) =>
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
        issueDate: renderIssueDate,
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

    // In-period jet-fuel lag note (only when jet data stops before the
    // period end). Mirrors the subdued note under the chart in the preview.
    if (fuelData.marketData.jetDataNote) {
      const { pdf, MX, CW } = ctx;
      setText(pdf, DUSK);
      setRoboto(pdf, "regular");
      pdf.setFontSize(8);
      const noteLines = pdf.splitTextToSize(
        fuelData.marketData.jetDataNote,
        CW,
      ) as string[];
      ensureSpace(ctx, noteLines.length * 10 + 6);
      for (const line of noteLines) {
        pdf.text(line, MX, ctx.y + 8);
        ctx.y += 10;
      }
      ctx.y += 2;
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
      // Keep the whole block together: measure the heading + full table and
      // push it onto the next page if it would otherwise orphan a row.
      const tableH = measureProducerBuyerActionsTable(ctx, fuelData.incidentData.producerBuyerActions);
      ensureSpace(ctx, 30 + tableH);
      drawSectionHeading(ctx, "Producer and Buyer Actions");
      drawProducerBuyerActionsTable(ctx, fuelData.incidentData.producerBuyerActions);
    }
    renderProseSection("What Matters", data.whatMatters);
    if (fuelData.narrativeData.implications && fuelData.narrativeData.implications.trim()) {
      drawBulletSection(ctx, "Implications for Business", fuelData.narrativeData.implications);
    }
    if (fuelData.narrativeData.watchNext && fuelData.narrativeData.watchNext.trim()) {
      drawBulletSection(ctx, "Watch Next", fuelData.narrativeData.watchNext, 8);
    }
    renderProseSection("Polestar View", data.polestarView);
  } else {
    const isCargo = data.topic === "cargo_watch";
    // Cargo Watch report extras — USD loss, most-stolen commodity and the
    // weekly trend — built from the SAME in-scope window the preview uses
    // (lib/cargoReportData.ts) so screen and PDF are identical.
    const cargoExtras = isCargo
      ? buildCargoReportExtras(
          windowIncidents.map((i) => ({
            title: i.title,
            summary: i.summary ?? null,
            source: i.source ?? null,
            location: i.location ?? null,
            country: i.country ?? null,
            occurredAt: i.occurredAt,
          })),
        )
      : null;

    drawSectionHeading(ctx, "Fast Facts");
    const fastFactCards = computeTopicFastFacts({
      topic: data.topic,
      issueDate: data.issueDate,
      incidents,
      topicLabel: topicLabels[data.topic] ?? data.topic,
    }) as KpiCardData[];
    if (cargoExtras) {
      fastFactCards.push({
        label: "Est. Cargo Loss (USD)",
        value: formatCargoUsd(cargoExtras.usd),
        note: cargoUsdNote(cargoExtras.usd),
      });
      fastFactCards.push({
        label: "Most Stolen Commodity",
        value: cargoExtras.commodity ?? "—",
        note: cargoCommodityNote(cargoExtras),
      });
    }
    drawFastFactsKpiCards(ctx, fastFactCards);

    if (cargoExtras && cargoExtras.trend.length >= 2) {
      drawSectionHeading(ctx, "Cargo Theft Trend");
      drawCargoTrendChart(ctx, cargoExtras.trend);
    }

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
      const leadReads: [string, string][] = [
        ["Cargo Security Read", cargoSecurity],
        ["Logistics Hub Read", cargoNode],
      ];
      for (const [label, body] of leadReads) {
        if (body && body.trim()) drawSectionWithProse(ctx, label, body);
      }
      // Country Risk Breakdown table + Regional Read — same data and section
      // order as the on-screen preview (after the two Reads, before Situation).
      const breakdown = buildCargoCountryBreakdown(windowIncidents);
      if (breakdown.rows.length > 0) {
        drawSectionHeading(ctx, "Country Risk Breakdown");
        drawCargoCountryTable(ctx, breakdown.rows);
        if (breakdown.regionalRead.trim()) {
          drawSectionWithProse(ctx, "Regional Read", breakdown.regionalRead);
        }
      }
      const proseSections: [string, string][] = [
        ["Situation", pickProse(data.situation, buildCargoSituation(windowIncidents))],
        ["What Happened", pickProse(data.whatHappened, buildCargoWhatHappened(windowIncidents))],
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
