import { createElement } from "react";
import { format, parseISO } from "date-fns";
import JetFuelTrajectoryChart from "@/components/JetFuelTrajectoryChart";
import FuelCoverageSummary from "@/components/FuelCoverageSummary";
import { buildFuelCoverageSummary } from "@/lib/fuelCoverage";
import { MarketPricesReportGrid, MARKET_PRICES_REPORT_EMPTY_TEXT } from "@/components/MarketPrices";
import { buildCountryIntensity } from "@/components/CountryChoroplethMap";
import EnergySituationVisual, { ENERGY_REPORT_MAP_HEIGHT } from "@/components/EnergySituationVisual";
import worldCompleteGeo from "@/assets/worldComplete.geo.json";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { MarketPrice } from "@workspace/api-client-react";
import {
  buildCargoPatternModel,
  type CargoAppendixRow,
  type CargoActivityMatrix,
  type CargoPatternCard,
  type CargoStageSummary,
} from "./cargoPatternModel";
import {
  formatTrendBarValue,
  trendChartValue,
  trendUsesDailyAverage,
} from "./cargoReportData";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  drawSubtitle,
  renderProse,
  drawSectionWithProse,
  drawSectionWithProseAndDisclaimer,
  drawFastFactsKpiCards,
  drawBulletSection,
  drawDisclaimer,
  DISCLAIMER_TEXT,
  ensureRoomForDisclaimer,
  drawFooters,
  drawPolestarCover,
  beginBodyPages,
  prepareCoverImage,
  COVER_TOP_BAND_H,
  COVER_BOTTOM_BLOCK_H,
  setFill,
  setStroke,
  setText,
  sanitize,
  setRoboto,
  ensureRobotoLoaded,
  NAVY,
  POLAR,
  DUSK,
  WHITE,
  SEV_COLOR,
  SEV_LABEL,
  sevKey,
  type Ctx,
  type KpiCardData,
} from "./pdfChrome";
import { layoutCallouts } from "./calloutLayout";
import { clipCalloutTitle, clipCalloutSummary, severityRank } from "./incidentCallout";
import { embedReactChartInPdf } from "./embedReportChartInPdf";
import { drawEnergyProse } from "./energyPdfFlow";
import {
  resolveReportWindow,
  filterIncidentsToWindow,
  reportCadence,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { resolveIncidentSummary } from "./incidentSummary";
import { displayIncidentTitle } from "./incidentTitle";
import { selectRelatedIncidents } from "./relatedIncidents";
import { assertFinalReportSectionsDistinct } from "./finalReportEvidenceAudit";
// Per-topic cover photography is registered in coverImages.ts so the
// on-screen ReportPreview and this exporter share one source of truth.
import { TOPIC_COVER_URLS } from "./coverImages";
import { isTopicRelevant } from "./topicRelevance";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import {
  makeSectionGate,
  applyFastFactOverrides,
  applyMarketPriceOverrides,
  applyMarketOperatorOverrides,
  type TopicSectionOverrides,
} from "./topicSectionOverrides";
import {
  resolveSimpleProse,
  stableDraftTopicReportProse,
  toDraftableIncidents,
  type TopicAiProse,
} from "./topicProseResolution";
import { segmentEnergySituationProse } from "./energySituationLayout";
import { isRegionalWeeklyTopic, type RegionalWeeklyTopic, type RegionalFutureEventInput, type RegionalCanonicalReport } from "./regionalWeekly";
import { buildApacBusinessImplications, buildApacGlanceMetrics, buildApacMapItems, buildApacWeeklyDevelopments, buildApacWeeklyWatchlist, buildRegionalBluf, buildRegionalBusinessRisk, buildRegionalBusinessImplicationsNarrative, buildRegionalDevelopments, buildRegionalDomainBriefs, buildRegionalGlanceItems, buildRegionalIntelligencePicture, buildRegionalMapPoints, buildRegionalOutlook, buildRegionalTravelImplications, buildRegionalVisualSummary, buildRegionalWatchlist, buildStructuredRegionalBluf, buildStructuredRegionalOutlook, clipTitleToMeaningfulWords, curateRegionalWeeklyIncidents, regionalCanonicalReportFromHardNumbers, resolveRegionalNarrative, validateRegionalWeeklyAssessment } from "./regionalWeekly";
// Single source of truth for the Fast Facts cards so the on-screen
// preview and this PDF exporter cannot drift.
import {
  computeTopicFastFacts,
  filterTopicReportIncidents,
} from "./topicFastFacts";
import {
  finalizeFuelPublication,
  fuelMarketLatestDate,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "./fuelWatchReport";
import {
  capFuelMarketSeverity,
  type ProducerBuyerActionRow,
} from "./fuelNarratives";
import { pickRead } from "./pickRead";
import { assertCargoReportValid } from "./cargoReportValidation";
import {
  buildCargoSecurityRead,
  buildLogisticsHubRead,
  buildCargoCountryBreakdown,
} from "./cargoNarratives";
import { countBandColor } from "./cargoChoropleth";

const ELECTRIC = "#465bff";

/** jsPDF-native horizontal bar chart — fallback when html2canvas embed fails. */
function drawSimpleBarChart(
  ctx: Ctx,
  heading: string,
  rows: Array<{ label: string; value: number; color?: string; displayValue?: string }>,
  opts: { caption?: string; emptyMessage?: string } = {},
): void {
  const labelW = 160;
  const valueW = 34;
  const rowH = 20;
  const gap = 5;
  const axisH = 14;
  const headingH = 22;
  const captionH = opts.caption ? 14 : 0;
  const projectedH = rows.length === 0 ? 30 : rows.length * (rowH + gap) + axisH + 6;
  ensureSpace(ctx, headingH + captionH + projectedH);
  drawSectionHeading(ctx, heading);
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) {
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(opts.emptyMessage ?? "No data reported this week."), MX, ctx.y + 10);
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }
  if (opts.caption) {
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(8);
    pdf.text(sanitize(opts.caption), MX, ctx.y + 6);
    setRoboto(pdf, "regular");
    ctx.y += captionH;
  }
  const trackX = MX + labelW + 6;
  const trackW = CW - labelW - 6 - valueW - 6;
  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const norm = rawMax / pow10;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const max = niceNorm * pow10;
  const step = (niceNorm <= 2 ? niceNorm / 2 : niceNorm / 5) * pow10 || 1;

  for (const r of rows) {
    const y = ctx.y;
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9.5);
    pdf.text(sanitize(r.label).slice(0, 28), MX, y + rowH - 7);
    setFill(pdf, "#F3F4F8");
    pdf.rect(trackX, y + 4, trackW, rowH - 8, "F");
    const w = (r.value / max) * trackW;
    if (w > 0) {
      setFill(pdf, r.color ?? ELECTRIC);
      pdf.rect(trackX, y + 4, w, rowH - 8, "F");
    }
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9.5);
    pdf.text(r.displayValue ?? String(r.value), trackX + trackW + 6, y + rowH - 7);
    setRoboto(pdf, "regular");
    ctx.y += rowH + gap;
  }
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.6);
  pdf.line(trackX, ctx.y + 2, trackX + trackW, ctx.y + 2);
  ctx.y += axisH + 6;
}

/** Native PDF fallback when React supply-chain graphic fails to rasterise. */
function drawCargoSupplyChainFallback(
  ctx: Ctx,
  stages: CargoStageSummary[],
  stageCategoryNote?: string,
): void {
  drawSectionHeading(ctx, "Supply-Chain Exposure");
  renderProse(
    ctx,
    "Where this period's cargo incidents fall across the movement chain.",
  );
  const active = stages.filter((s) => s.key !== "unattributed" && s.count > 0);
  if (active.length === 0) {
    renderProse(ctx, "No incidents identified this period.");
  } else {
    renderProse(
      ctx,
      active
        .map(
          (s) =>
            `${s.label}: ${s.count} incident${s.count === 1 ? "" : "s"} (${s.sharePct}% share)${s.mainCountry ? ` — mainly ${s.mainCountry}` : ""}.`,
        )
        .join("\n\n"),
    );
  }
  if (stageCategoryNote?.trim()) renderProse(ctx, stageCategoryNote.trim());
}

/** Native PDF fallback when React pattern dashboard fails to rasterise. */
function drawCargoPatternFallback(ctx: Ctx, patterns: CargoPatternCard[]): void {
  drawSectionHeading(ctx, "Operational Patterns");
  renderProse(
    ctx,
    "Leading incident types within the broader supply chain exposure.",
  );
  if (patterns.length === 0) {
    renderProse(
      ctx,
      "No single category rose to a distinct operational pattern this period.",
    );
    return;
  }
  renderProse(
    ctx,
    patterns
      .map(
        (p) =>
          `${p.name}: ${p.count} incident${p.count === 1 ? "" : "s"} (${p.sharePct}% share)${p.primaryGeography ? ` — ${p.primaryGeography}` : ""}. ${p.operationalConcern}`,
      )
      .join("\n\n"),
  );
}

/** Native PDF summary for the weekly activity matrix (preview still uses React). */
function drawCargoActivityFallback(ctx: Ctx, activity: CargoActivityMatrix): void {
  drawSectionHeading(ctx, "Weekly Activity by Pattern");
  if (activity.statement.trim()) {
    renderProse(ctx, activity.statement);
  }
  const activeRows = activity.rows.filter((r) => r.total > 0);
  if (activeRows.length > 0) {
    const weekHeader =
      activity.weeks.length > 0
        ? ` Weekly columns: ${activity.weeks.map((w) => w.label).join(", ")}.`
        : "";
    renderProse(
      ctx,
      activeRows
        .map((r) => {
          const weekPart =
            activity.weeks.length > 0
              ? ` (${activity.weeks.map((w, i) => `${w.label}: ${r.weekCounts[i] ?? 0}`).join("; ")})`
              : "";
          return `${r.label}: ${r.total} incident${r.total === 1 ? "" : "s"}${weekPart}.`;
        })
        .join("\n\n") + weekHeader,
    );
    return;
  }
  if (activity.sparseItems.length > 0) {
    renderProse(
      ctx,
      activity.sparseItems
        .slice(0, 8)
        .map(
          (i) =>
            `${i.dateLabel}: ${i.pattern}${i.location ? ` (${i.location})` : ""} — ${i.severityLabel}.`,
        )
        .join("\n\n"),
    );
    return;
  }
  const weekLabels = activity.weeks.map((w) => w.label).join(", ");
  renderProse(
    ctx,
    weekLabels
      ? `Activity across ${activity.total} incidents distributed over ${weekLabels}.`
      : "Insufficient dated activity to render the weekly matrix this period.",
  );
}

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
  /** Per-incident AI summaries keyed by incident id. When an id is absent a
   *  deterministic fallback summary is rendered, so the table always shows a
   *  summary line under each title in parity with the on-screen preview. */
  incidentSummaries?: Record<string, string>;
  /** Cached AI narrative for the report. Sits beneath any analyst edit
   *  and above the deterministic draft, mirroring the on-screen preview. */
  aiProse?: TopicAiProse | null;
  /** Live commodity-price rows for the Energy Watch report's Market Prices
   *  section. Fetched once by the caller from /api/market-prices?group=energy
   *  so preview and PDF read the identical dataset. */
  marketPrices?: MarketPrice[];
  /** Cargo Watch only. When true, appends the full deduplicated incident
   *  register as a readable annex on a fresh final page. Defaults to false —
   *  the standard report carries only the curated Selected Incidents. */
  includeFullAnnex?: boolean;
  /** Cargo Watch only. When true, exports even if the report fails the hard
   *  validation gate (spec pt7) and lets the caller surface the failures.
   *  Defaults to false (fail closed) so a failing report can never be shipped. */
  allowValidationFailures?: boolean;
  /** Canonical section keys hidden by the analyst. Gated in lockstep with the
   *  on-screen preview so preview == PDF. Cover and Disclaimer are never
   *  hideable. */
  hiddenSections?: string[];
  /** Analyst overrides persisted in reports.section_overrides — Fast Facts
   *  tiles and Market Prices rows. Applied here in lockstep with the
   *  on-screen preview so preview == PDF. */
  sectionOverrides?: TopicSectionOverrides | null;
  /** APAC Weekly only. Persisted forward-looking events are kept separate
   * from incidents and are filtered by the caller to the report's next-seven-
   * day window before export. */
  futureEvents?: RegionalFutureEventInput[];
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
  // Analyst overrides for the data-driven reads (blank → live generated read).
  cargoSecurityRead?: string | null;
  logisticsHubRead?: string | null;
  regionalCountryRead?: string | null;
  fuelMarketRead?: string | null;
  fuelOperationalRead?: string | null;
  fuelRegionalHighlights?: string | null;
  /**
   * Raw report.hardNumbers jsonb. Parsed by jetFuelTrajectory.ts to drive
   * the Jet Fuel Price Trajectory chart and the jet fuel hard-number card.
   */
  hardNumbers?: unknown;
}

export interface TopicReportIncident {
  id: number | string;
  title: string;
  displayTitle?: string | null;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  // Used by the shared incident-type classifier — never displayed as a topic.
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  analystNotes?: string | null;
  location?: string | null;
}

/**
 * Pre-measure the full Producer/Buyer Actions table (header + all rows +
 * trailing gap) so the caller can keep the whole block together and avoid
 * orphaning a row onto the next page.
 */
function measureProducerBuyerActionsTable(
  ctx: Ctx,
  rows: ProducerBuyerActionRow[],
): number {
  if (rows.length === 0) return 0;
  const { pdf, CW } = ctx;
  const colActorW = Math.round(CW * 0.16);
  const colCatW = Math.round(CW * 0.18);
  const colReadW = Math.round(CW * 0.3);
  const colActionW = CW - colActorW - colCatW - colReadW;
  const headerH = 18;
  const padX = 6;
  const lineH = 11;

  const prevSize = pdf.getFontSize();
  pdf.setFontSize(8);
  let total = headerH;
  for (const r of rows) {
    const actionText = r.date ? `${r.action}\n${r.date}` : r.action;
    const actorLines: string[] = pdf.splitTextToSize(
      sanitize(r.actor),
      colActorW - padX * 2,
    );
    const catLines: string[] = pdf.splitTextToSize(
      sanitize(r.category),
      colCatW - padX * 2,
    );
    const actionLines: string[] = pdf.splitTextToSize(
      sanitize(actionText),
      colActionW - padX * 2,
    );
    const readLines: string[] = pdf.splitTextToSize(
      sanitize(r.operationalRead),
      colReadW - padX * 2,
    );
    const maxLines = Math.max(
      actorLines.length,
      catLines.length,
      actionLines.length,
      readLines.length,
    );
    total += Math.max(20, maxLines * lineH + 8);
  }
  pdf.setFontSize(prevSize);
  return total + 8;
}

function drawProducerBuyerActionsTable(
  ctx: Ctx,
  rows: ProducerBuyerActionRow[],
) {
  if (rows.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const colActorW = Math.round(CW * 0.16);
  const colCatW = Math.round(CW * 0.18);
  const colReadW = Math.round(CW * 0.3);
  const colActionW = CW - colActorW - colCatW - colReadW;
  const headerH = 18;
  const padX = 6;
  const lineH = 11;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, headerH, "F");
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y, MX + CW, ctx.y);
    pdf.line(MX, ctx.y, MX, ctx.y + headerH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + headerH);
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("ACTOR", MX + padX, ctx.y + 12);
    pdf.text("CATEGORY", MX + colActorW + padX, ctx.y + 12);
    pdf.text("ACTION", MX + colActorW + colCatW + padX, ctx.y + 12);
    pdf.text(
      "OPERATIONAL READ",
      MX + colActorW + colCatW + colActionW + padX,
      ctx.y + 12,
    );
    ctx.y += headerH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };

  let headerDrawn = false;

  for (const r of rows) {
    const actionText = r.date ? `${r.action}\n${r.date}` : r.action;
    const actorLines: string[] = pdf.splitTextToSize(
      sanitize(r.actor),
      colActorW - padX * 2,
    );
    const catLines: string[] = pdf.splitTextToSize(
      sanitize(r.category),
      colCatW - padX * 2,
    );
    const actionLines: string[] = pdf.splitTextToSize(
      sanitize(actionText),
      colActionW - padX * 2,
    );
    const readLines: string[] = pdf.splitTextToSize(
      sanitize(r.operationalRead),
      colReadW - padX * 2,
    );
    const maxLines = Math.max(
      actorLines.length,
      catLines.length,
      actionLines.length,
      readLines.length,
    );
    const rh = Math.max(20, maxLines * lineH + 8);

    // Keep a header with its first row, and repeat it before every continued
    // page. This avoids both an orphan header and a row that starts beneath a
    // page footer without reserving space for the repeated header.
    if (!headerDrawn) {
      ensureSpace(ctx, headerH + rh);
      drawHeader();
      headerDrawn = true;
    } else if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      ensureSpace(ctx, headerH + rh);
      drawHeader();
    }

    // Row separator at the bottom of the row.
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text(actorLines, MX + padX, ctx.y + 12);

    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
    pdf.text(catLines, MX + colActorW + padX, ctx.y + 12);
    pdf.text(actionLines, MX + colActorW + colCatW + padX, ctx.y + 12);
    pdf.text(
      readLines,
      MX + colActorW + colCatW + colActionW + padX,
      ctx.y + 12,
    );

    ctx.y += rh;
  }
  ctx.y += 8;
}

function drawRelatedIncidents(
  ctx: Ctx,
  windowIncidents: TopicReportIncident[],
  topic: string,
  _topicLabels: Record<string, string>,
  summaries: Record<string, string>,
) {
  // Row selection (title dedupe, weak-bucket filtering, recency order, cap)
  // is delegated to the ONE shared selector so this PDF table renders the
  // exact same rows the on-screen preview does.
  const rows = selectRelatedIncidents(windowIncidents, topic);
  if (rows.length === 0) return;

  drawSectionHeading(ctx, "Related Incidents");

  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTypeW = 120;
  const colSevW = 75;
  const colTitleW = CW - colDateW - colTypeW - colSevW - 6;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y, MX + CW, ctx.y);
    pdf.line(MX, ctx.y, MX, ctx.y + rowH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rowH);
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    pdf.text("TYPE", MX + colDateW + 6, ctx.y + 12);
    pdf.text("TITLE", MX + colDateW + colTypeW + 6, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colTypeW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(7);
  };

  ensureSpace(ctx, rowH + 4);
  drawHeader();

  for (const i of rows) {
    const titleLines: string[] = pdf.splitTextToSize(
      sanitize(displayIncidentTitle(i.title, i.displayTitle)),
      colTitleW - 8,
    );
    pdf.setFontSize(6.5);
    const summaryLines: string[] = pdf.splitTextToSize(
      sanitize(resolveIncidentSummary(i, summaries)),
      colTitleW - 8,
    );
    pdf.setFontSize(7);
    const rh = Math.max(
      rowH,
      titleLines.length * 11 + summaryLines.length * 9 + 12,
    );
    // Prevent row from splitting across pages - ensure space for the entire row
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    let dateStr = "";
    try {
      dateStr = format(parseISO(i.occurredAt), "dd MMM yyyy");
    } catch {
      dateStr = i.occurredAt;
    }
    pdf.text(dateStr, MX + 6, ctx.y + 12);
    // Use the derived operational incident-type label, never the topic name.
    const incidentType = classifyIncidentType(i);
    const typeLines: string[] = pdf.splitTextToSize(
      sanitize(incidentType),
      colTypeW - 8,
    );
    pdf.text(typeLines, MX + colDateW + 6, ctx.y + 12);
    setText(pdf, NAVY);
    const titleX = MX + colDateW + colTypeW + 6;
    pdf.text(titleLines, titleX, ctx.y + 12);
    if (summaryLines.length > 0) {
      setText(pdf, DUSK);
      pdf.setFontSize(6.5);
      pdf.text(summaryLines, titleX, ctx.y + 12 + titleLines.length * 11 + 2);
      pdf.setFontSize(7);
    }

    const sevKeyStr = sevKey(i.severity);
    const sevDisplay = SEV_LABEL[sevKeyStr] ?? i.severity ?? "";
    setFill(pdf, SEV_COLOR[sevKeyStr] ?? SEV_COLOR.insignificant);
    const chipX = MX + colDateW + colTypeW + colTitleW + 6;
    const sevText = sanitize(sevDisplay.toUpperCase());
    const isSmallText = sevText === "HIGH" || sevText === "LOW";
    const chipW = isSmallText ? 40 : 50;
    pdf.rect(chipX, ctx.y + 3, chipW, 12, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6);
    pdf.text(sevText, chipX + chipW / 2, ctx.y + 11.5, { align: "center" });
    setRoboto(pdf, "regular");
    pdf.setFontSize(7);

    ctx.y += rh;
  }
  ctx.y += 8;

  // Touch the cadence helper so removing it would not silently regress —
  // and to make the per-cadence behaviour obvious to readers of this code.
  void reportCadence(topic);
}

function buildPdfRegionalDevelopments(
  incidents: TopicReportIncident[],
  issueDate: string,
  topic: RegionalWeeklyTopic,
) {
  const curated = curateRegionalWeeklyIncidents(incidents, topic, issueDate);
  return topic === "apac_weekly"
    ? buildApacWeeklyDevelopments(curated, issueDate)
    : buildRegionalDevelopments(curated, issueDate, topic);
}

function drawRegionalDevelopmentCards(ctx: Ctx, incidents: TopicReportIncident[], issueDate: string, topic: RegionalWeeklyTopic = "middle_east_weekly") {
  const developments = buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const { pdf, MX, CW } = ctx;
  if (developments.length === 0) {
    renderProse(ctx, "No qualifying developments were identified in the reporting period.");
    return;
  }
  for (const development of developments) {
    ensureSpace(ctx, 28);
    setRoboto(pdf, "bold");
    setText(pdf, NAVY);
    pdf.setFontSize(10);
    const titleLines = pdf.splitTextToSize(
      `${development.country} | ${development.title}`,
      CW,
    );
    for (const line of titleLines) {
      pdf.text(line, MX, ctx.y + 10);
      ctx.y += 13;
    }
    ctx.y += 3;
    if (isRegionalWeeklyTopic(topic)) {
      renderProse(
        ctx,
        `Category: ${development.category}\nCurrent Severity: ${development.severity}\nWhat Changed: ${development.whatChanged}\nOperational Impact: ${development.operationalImpact ?? development.operationalSignificance}\nPolestar View: ${development.polestarView ?? development.operationalSignificance}${development.outlook7Days ? `\nOutlook 7 Days: ${development.outlook7Days}` : ""}`,
      );
      if (development.sourceCount && development.sourceCount > 1) {
        setText(pdf, DUSK);
        setRoboto(pdf, "italic");
        pdf.setFontSize(7);
        pdf.text(`${development.sourceCount} corroborating source records consolidated`, MX, ctx.y);
        ctx.y += 11;
        setRoboto(pdf, "regular");
      }
    } else {
      renderProse(
        ctx,
        `Category: ${development.category}\nCurrent Severity: ${development.severity}\nWhat Changed: ${development.whatChanged}\nWhy It Matters: ${development.operationalSignificance}${development.whatToWatch ? `\nWhat To Watch: ${development.whatToWatch}` : ""}`,
      );
    }
  }
}

function drawRegionalGlance(ctx: Ctx, incidents: TopicReportIncident[], issueDate: string, topic: RegionalWeeklyTopic = "middle_east_weekly") {
  const developments = buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const items = buildRegionalGlanceItems(developments, topic);
  const { pdf, MX, CW } = ctx;
  drawSectionHeading(ctx, "Week at a Glance");
  for (const item of items) {
    ensureSpace(ctx, 24);
    setRoboto(pdf, "bold");
    setText(pdf, NAVY);
    pdf.setFontSize(8);
    pdf.text(item.category.toUpperCase(), MX, ctx.y + 8);
    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.setFontSize(7.5);
    const lines = pdf.splitTextToSize(item.statement, CW - 105);
    pdf.text(lines, MX + 105, ctx.y + 8);
    ctx.y += Math.max(18, lines.length * 9 + 5);
  }
}

function drawRegionalHotspotMap(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
  canonicalPoints?: RegionalCanonicalReport["mapPoints"],
) {
  const points = canonicalPoints ?? buildRegionalMapPoints(incidents, topic);
  const { pdf, MX, CW } = ctx;
  const h = 180;
  ensureSpace(ctx, h + 22);
  drawSectionHeading(ctx, "Regional Hotspot Map");
  const gap = 10;
  const mapW = CW * 0.58;
  const railX = MX + mapW + gap;
  const railW = CW - mapW - gap;
  const bounds = topic === "apac_weekly"
    ? { minLng: 60, maxLng: 180, minLat: -50, maxLat: 55 }
    : { minLng: 25, maxLng: 65, minLat: 10, maxLat: 42 };
  const project = (lng: number, lat: number): [number, number] => [
    MX + 7 + ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (mapW - 14),
    ctx.y + 7 + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * (h - 14),
  ];
  setFill(pdf, "#dfeaf3");
  setStroke(pdf, "#bdc8d6");
  pdf.setLineWidth(0.4);
  pdf.rect(MX, ctx.y, mapW, h, "FD");
  const collection = worldCompleteGeo as unknown as FeatureCollection<Polygon | MultiPolygon>;
  for (const feature of collection.features) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const mapped = ring
          .filter(([lng, lat]) => lng >= bounds.minLng - 3 && lng <= bounds.maxLng + 3 && lat >= bounds.minLat - 3 && lat <= bounds.maxLat + 3)
          .map(([lng, lat]) => project(lng, lat));
        if (mapped.length < 3 || mapped.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
        setFill(pdf, "#f7f4ed");
        for (let index = 1; index < mapped.length - 1; index += 1) {
          pdf.triangle(mapped[0][0], mapped[0][1], mapped[index][0], mapped[index][1], mapped[index + 1][0], mapped[index + 1][1], "F");
        }
        setStroke(pdf, "#8999aa");
        for (let index = 0; index < mapped.length - 1; index += 1) {
          pdf.line(mapped[index][0], mapped[index][1], mapped[index + 1][0], mapped[index + 1][1]);
        }
      }
    }
  }
  setFill(pdf, "#f7f8fb");
  setStroke(pdf, "#d2d6e1");
  pdf.rect(railX, ctx.y, railW, h, "FD");
  if (points.length === 0) {
    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.setFontSize(8);
    pdf.text("No selected development has a verified plottable location.", railX + 10, ctx.y + 20);
    ctx.y += h + 8;
    return;
  }
  const selected = [...points]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.title.localeCompare(b.title))
    .slice(0, 3);
  selected.forEach((point, index) => {
    const [x, y] = project(point.lng, point.lat);
    const severityColor = SEV_COLOR[sevKey(point.severity)] ?? ELECTRIC;
    setFill(pdf, severityColor);
    setStroke(pdf, "#ffffff");
    pdf.setLineWidth(1);
    pdf.circle(x, y, 7, "FD");
    setText(pdf, "#ffffff");
    setRoboto(pdf, "bold");
    pdf.setFontSize(7.5);
    pdf.text(String(index + 1), x, y + 2.5, { align: "center" });
    const cardY = ctx.y + 8 + index * 56;
    setFill(pdf, "#ffffff");
    setStroke(pdf, "#c8cfda");
    pdf.setLineWidth(0.5);
    pdf.rect(railX + 7, cardY, railW - 14, 48, "FD");
    setFill(pdf, severityColor);
    pdf.rect(railX + 7, cardY, 4, 48, "F");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text(`${index + 1}  ${sanitize(point.label.toUpperCase())}`, railX + 16, cardY + 11);
    pdf.setFontSize(7.3);
    const titleLines = pdf.splitTextToSize(sanitize(clipCalloutTitle(point.title)), railW - 30).slice(0, 2);
    pdf.text(titleLines, railX + 16, cardY + 21);
    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(6.8);
    const detail = `${point.eventDate ? `${format(parseISO(point.eventDate), "d MMM")} · ` : ""}${clipCalloutSummary(point.summary || "")}`;
    const detailLines = pdf.splitTextToSize(sanitize(detail), railW - 30).slice(0, 2);
    pdf.text(detailLines, railX + 16, cardY + 37);
  });
  ctx.y += h + 8;
}

function drawRegionalTimeline(ctx: Ctx, incidents: TopicReportIncident[], issueDate: string, topic: RegionalWeeklyTopic = "middle_east_weekly", futureEvents: RegionalFutureEventInput[] = []) {
  const developments = buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const items = buildApacWeeklyWatchlist(developments, futureEvents, issueDate);
  if (items.length === 0) return;
  const { pdf, MX, CW } = ctx;
  ensureSpace(ctx, 42);
  setStroke(pdf, NAVY);
  pdf.setLineWidth(1);
  pdf.line(MX + 12, ctx.y + 15, MX + CW - 12, ctx.y + 15);
  items.forEach((item, index) => {
    const x = items.length === 1
      ? MX + CW / 2
      : MX + 12 + (index / (items.length - 1)) * (CW - 24);
    pdf.setFillColor(70, 91, 255);
    pdf.circle(x, ctx.y + 15, 3, "F");
    setRoboto(pdf, "bold");
    setText(pdf, NAVY);
    pdf.setFontSize(6);
    pdf.text(item.date.slice(5), x, ctx.y + 28, { align: "center" });
  });
  ctx.y += 38;
}

function drawRegionalDomainBriefs(ctx: Ctx, incidents: TopicReportIncident[], issueDate: string, topic: RegionalWeeklyTopic = "middle_east_weekly") {
  const developments = buildPdfRegionalDevelopments(incidents, issueDate, topic);
  ensureSpace(ctx, 60);
  renderProse(ctx, buildRegionalIntelligencePicture(developments));
}

function drawRegionalWatchlist(ctx: Ctx, incidents: TopicReportIncident[], issueDate: string, topic: RegionalWeeklyTopic = "middle_east_weekly", futureEvents: RegionalFutureEventInput[] = []) {
  const developments = buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const items = buildApacWeeklyWatchlist(developments, futureEvents, issueDate);
  if (items.length === 0) {
    renderProse(ctx, "No qualifying watch items were identified in the reporting period.");
    return;
  }
  for (const item of items) {
    ensureSpace(ctx, 24);
    setRoboto(ctx.pdf, "bold");
    setText(ctx.pdf, NAVY);
    ctx.pdf.setFontSize(9);
    ctx.pdf.text(`${item.date} | ${item.location} | ${item.trigger}`, ctx.MX, ctx.y + 10);
    ctx.y += 14;
    renderProse(
      ctx,
      `Date: ${item.date}\nLocation: ${item.location}\nTrigger / Event: ${item.trigger}\nWhy It Matters: ${item.whyItMatters}${item.currentSeverity ? `\nCurrent Severity: ${item.currentSeverity}` : ""}\nWhat To Watch: ${item.whatToWatch}`,
    );
  }
}

function drawApacBusinessImplicationBlocks(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  issueDate: string,
  topic: RegionalWeeklyTopic = "apac_weekly",
): void {
  const developments = buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const blocks = buildApacBusinessImplications(developments);
  if (blocks.length === 0) return;
  drawApacCompactHeading(ctx, "Business Implications");
  for (const block of blocks) {
    setRoboto(ctx.pdf, "bold");
    setText(ctx.pdf, NAVY);
    ctx.pdf.setFontSize(7.2);
    ctx.pdf.text(block.heading.toUpperCase(), ctx.MX, ctx.y + 7);
    ctx.y += 10;
    drawApacCompactText(ctx, block.body, 7.1, 8.2, 5);
  }
}

function drawApacBusinessImplicationGrid(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  issueDate: string,
  topic: RegionalWeeklyTopic = "apac_weekly",
): boolean {
  const blocks = buildApacBusinessImplications(
    buildPdfRegionalDevelopments(incidents, issueDate, topic),
  );
  if (blocks.length === 0) return true;
  const gap = 7;
  const cardW = (ctx.CW - gap) / 2;
  const rows = Math.ceil(blocks.length / 2);
  const heights = Array.from({ length: rows }, (_, row) => {
    let height = 0;
    for (let col = 0; col < 2; col += 1) {
      const block = blocks[row * 2 + col];
      if (!block) continue;
      ctx.pdf.setFontSize(7);
      height = Math.max(height, 22 + ctx.pdf.splitTextToSize(block.body, cardW - 14).length * 8.2);
    }
    return height;
  });
  const required = 24 + heights.reduce((sum, height) => sum + height + gap, 0);
  if (ctx.y + required > ctx.H - ctx.BOTTOM) return false;
  drawApacCompactHeading(ctx, "Business Implications");
  for (let row = 0; row < rows; row += 1) {
    const height = heights[row];
    for (let col = 0; col < 2; col += 1) {
      const block = blocks[row * 2 + col];
      if (!block) continue;
      const x = ctx.MX + col * (cardW + gap);
      const y = ctx.y;
      setFill(ctx.pdf, "#ffffff");
      setStroke(ctx.pdf, POLAR);
      ctx.pdf.setLineWidth(0.45);
      ctx.pdf.rect(x, y, cardW, height, "FD");
      setText(ctx.pdf, NAVY);
      setRoboto(ctx.pdf, "bold");
      ctx.pdf.setFontSize(7);
      ctx.pdf.text(block.heading.toUpperCase(), x + 7, y + 11);
      setText(ctx.pdf, DUSK);
      setRoboto(ctx.pdf, "regular");
      ctx.pdf.setFontSize(7);
      const lines = ctx.pdf.splitTextToSize(block.body, cardW - 14);
      ctx.pdf.text(lines, x + 7, y + 22, { lineHeightFactor: 8.2 / 7 });
    }
    ctx.y += height + gap;
  }
  return true;
}

/*
 * APAC Weekly has a deliberately fixed reader journey.  These compact
 * primitives do not call ensureSpace/newPage: the APAC branch allocates each
 * page explicitly, so a long source row cannot silently turn pages 4-5 into
 * an 11-page feed dump.  Text is wrapped, never clipped; the smaller type and
 * tighter leading are the space control.
 */
function drawApacCompactHeading(ctx: Ctx, title: string): void {
  setText(ctx.pdf, NAVY);
  setRoboto(ctx.pdf, "bold");
  ctx.pdf.setFontSize(13);
  ctx.pdf.text(sanitize(title.toUpperCase()), ctx.MX, ctx.y);
  ctx.y += 10;
  setStroke(ctx.pdf, ELECTRIC);
  ctx.pdf.setLineWidth(1.2);
  ctx.pdf.line(ctx.MX, ctx.y, ctx.MX + ctx.CW, ctx.y);
  ctx.y += 14;
}

function drawApacCompactText(
  ctx: Ctx,
  text: string,
  fontSize = 7.6,
  lineHeight = 9.1,
  gap = 4,
): number {
  setText(ctx.pdf, DUSK);
  setRoboto(ctx.pdf, "regular");
  ctx.pdf.setFontSize(fontSize);
  const lines = ctx.pdf.splitTextToSize(sanitize(text), ctx.CW);
  ctx.pdf.text(lines, ctx.MX, ctx.y + fontSize, { lineHeightFactor: lineHeight / fontSize });
  ctx.y += lines.length * lineHeight + gap;
  return lines.length;
}

function drawApacGeographicMap(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  topic: RegionalWeeklyTopic = "apac_weekly",
  canonical?: RegionalCanonicalReport,
): void {
  if (topic !== "apac_weekly") {
    const regionalPoints = buildRegionalMapPoints(incidents, topic);
    const items = regionalPoints.map((point) => ({
      id: point.label,
      country: point.label,
      lat: point.lat,
      lng: point.lng,
      developments: [{
        label: point.title,
        severity: point.severity ?? "moderate",
        fullTitle: point.title,
        summary: point.summary,
      }],
    }));
    drawApacRegionalMapItems(ctx, items);
    return;
  }
  const developments = canonical?.developments ?? (topic === "apac_weekly"
    ? buildApacWeeklyDevelopments(incidents)
    : buildRegionalDevelopments(incidents, undefined, topic));
  const selectedCountries = new Set(developments.map((row) => row.country));
  let items = canonical
    ? canonical.mapPoints.map((point, index) => ({
        id: 1000 + index,
        country: point.label,
        lat: point.lat,
        lng: point.lng,
        developments: [{
          label: point.title,
          severity: point.severity ?? "moderate",
          fullTitle: point.title,
          summary: `${format(parseISO(point.eventDate), "dd MMM").toUpperCase()} · ${point.summary}`,
        }],
      }))
    : buildApacMapItems(incidents).filter((item) => selectedCountries.has(item.country)).map((item) => {
    const development = developments.find((row) => row.country === item.country);
    if (!development) return item;
    return {
      ...item,
      developments: item.developments.map((mapDevelopment) => ({
        ...mapDevelopment,
        label: clipTitleToMeaningfulWords(development.title, 8),
        fullTitle: development.title,
        summary: development.whatChanged,
      })),
    };
  });
  const fallbackPoints = canonical ? [] : buildRegionalMapPoints(incidents, topic)
    .filter((point) => selectedCountries.has(point.label.replace(/ \(country-level\)$/, "")))
    .filter((point) => !items.some((item) => item.country === point.label.replace(/ \(country-level\)$/, "")))
    .slice(0, Math.max(0, 3 - items.length));
  items = [...items, ...fallbackPoints.map((point) => ({
    id: 900 + fallbackPoints.indexOf(point),
    country: point.label,
    lat: point.lat,
    lng: point.lng,
    developments: [{ label: point.title, severity: point.severity ?? "moderate", fullTitle: point.title, summary: "Country-level centroid fallback." }],
  }))];
  const mapH = ctx.CW * (280 / 535);
  const minLng = 67, maxLng = 178, minLat = -48, maxLat = 56;
  const project = (lng: number, lat: number): [number, number] => [
    ctx.MX + 8 + ((lng - minLng) / (maxLng - minLng)) * (ctx.CW - 16),
    ctx.y + 6 + ((maxLat - lat) / (maxLat - minLat)) * (mapH - 12),
  ];
  setFill(ctx.pdf, "#dfeaf3");
  setStroke(ctx.pdf, "#bdc8d6");
  ctx.pdf.setLineWidth(0.4);
  ctx.pdf.rect(ctx.MX, ctx.y, ctx.CW, mapH, "FD");
  const collection = worldCompleteGeo as unknown as FeatureCollection<Polygon | MultiPolygon>;
  for (const feature of collection.features) {
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const mapped = ring
          .filter(([lng, lat]) => lng >= minLng - 4 && lng <= maxLng + 4 && lat >= minLat - 4 && lat <= maxLat + 4)
          .map(([lng, lat]) => project(lng, lat));
        if (
          mapped.length < 3 ||
          mapped.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))
        ) continue;
        // Keep the renderer export-safe: jsPDF.lines expects relative vectors
        // and rejects absolute coordinate tuples. Draw a conservative fan fill
        // plus explicit outline segments instead.
        setFill(ctx.pdf, "#f7f4ed");
        for (let index = 1; index < mapped.length - 1; index += 1) {
          ctx.pdf.triangle(
            mapped[0][0], mapped[0][1],
            mapped[index][0], mapped[index][1],
            mapped[index + 1][0], mapped[index + 1][1],
            "F",
          );
        }
        setStroke(ctx.pdf, "#8999aa");
        for (let index = 0; index < mapped.length; index += 1) {
          const [x1, y1] = mapped[index];
          const [x2, y2] = mapped[(index + 1) % mapped.length];
          if (x1 !== x2 || y1 !== y2) ctx.pdf.line(x1, y1, x2, y2);
        }
      }
    }
  }
  const mapTop = ctx.y;

  // Project to local coordinates for layoutCallouts
  const projectLocal = (lng: number, lat: number): [number, number] => [
    8 + ((lng - minLng) / (maxLng - minLng)) * (ctx.CW - 16),
    6 + ((maxLat - lat) / (maxLat - minLat)) * (mapH - 12),
  ];

  const boxW = Math.min(158, ctx.CW * 0.34);

  const allIncidents = items.flatMap(i => i.developments.map(d => ({
    ...d,
    lat: i.lat,
    lng: i.lng,
    country: i.country,
  })));

  allIncidents.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const top3 = allIncidents.slice(0, 3);

  const prepared = top3.map((entry, index) => {
    const pointLocal = projectLocal(entry.lng, entry.lat);
    const title = entry.label.toUpperCase();
    const summary = clipCalloutSummary(entry.summary || entry.fullTitle);
    const severityColor = SEV_COLOR[sevKey(entry.severity)] ?? ELECTRIC;

    // Estimate height
    ctx.pdf.setFontSize(7.5);
    const titleLines = ctx.pdf.splitTextToSize(sanitize(title), boxW - 12);
    ctx.pdf.setFontSize(7);
    const summaryLines = ctx.pdf.splitTextToSize(sanitize(summary), boxW - 12);

    const height = 6 + (titleLines.length * 9) + 4 + (summaryLines.length * 8) + 6;

    return {
      id: String(index),
      pointLocal,
      titleLines,
      summaryLines,
      height,
      severityColor
    };
  });

  const inputs = prepared.map((p) => ({
    id: p.id,
    px: p.pointLocal[0],
    py: p.pointLocal[1],
    boxW,
    boxH: p.height
  }));

  const placements = layoutCallouts(ctx.CW, mapH, inputs);

  // Draw leaders first
  setStroke(ctx.pdf, "#888888");
  ctx.pdf.setLineWidth(0.4);
  for (const pos of placements) {
    ctx.pdf.line(ctx.MX + pos.leaderX1, mapTop + pos.leaderY1, ctx.MX + pos.leaderX2, mapTop + pos.leaderY2);
  }

  // Draw pins above leaders but below boxes
  for (const item of items) {
    const development = item.developments[0];
    const pointLocal = projectLocal(item.lng, item.lat);
    setFill(ctx.pdf, SEV_COLOR[sevKey(development?.severity)] ?? ELECTRIC);
    setStroke(ctx.pdf, "#ffffff");
    ctx.pdf.setLineWidth(1);
    ctx.pdf.circle(ctx.MX + pointLocal[0], mapTop + pointLocal[1], 3.5, "FD");
  }

  // Draw boxes
  for (const pos of placements) {
    const entry = prepared.find(p => p.id === pos.id)!;
    const boxX = ctx.MX + pos.boxX;
    const boxY = mapTop + pos.boxY;

    // Box shadow (basic)
    setFill(ctx.pdf, "#000000");
    ctx.pdf.setGState(new (ctx.pdf.GState as any)({ opacity: 0.1 }));
    ctx.pdf.rect(boxX + 1, boxY + 1, boxW, entry.height, "F");
    ctx.pdf.setGState(new (ctx.pdf.GState as any)({ opacity: 1.0 }));

    setFill(ctx.pdf, "#ffffff");
    setStroke(ctx.pdf, POLAR);
    ctx.pdf.setLineWidth(0.5);
    ctx.pdf.rect(boxX, boxY, boxW, entry.height, "FD");

    setFill(ctx.pdf, entry.severityColor);
    ctx.pdf.rect(boxX, boxY, 3, entry.height, "F");

    setText(ctx.pdf, NAVY);
    setRoboto(ctx.pdf, "bold");
    ctx.pdf.setFontSize(7.5);
    ctx.pdf.text(entry.titleLines, boxX + 8, boxY + 9);

    const summaryStartY = boxY + 9 + (entry.titleLines.length * 9) - 1;
    setText(ctx.pdf, DUSK);
    setRoboto(ctx.pdf, "regular");
    ctx.pdf.setFontSize(7);
    ctx.pdf.text(entry.summaryLines, boxX + 8, summaryStartY);
  }

  ctx.y += mapH + 7;
}

function drawApacRegionalMapItems(ctx: Ctx, items: Array<{ country: string; lat: number; lng: number }>): void {
  drawApacCompactHeading(ctx, "Regional Risk Map");
  const mapH = 190;
  const minLng = 35, maxLng = 65, minLat = 10, maxLat = 40;
  const project = (lng: number, lat: number): [number, number] => [
    ctx.MX + 8 + ((lng - minLng) / (maxLng - minLng)) * (ctx.CW - 16),
    ctx.y + 20 + (1 - (lat - minLat) / (maxLat - minLat)) * (mapH - 35),
  ];
  for (const item of items) {
    const [x, y] = project(item.lng, item.lat);
    ctx.pdf.setFillColor(70, 91, 255);
    ctx.pdf.circle(x, y, 3.2, "F");
    setRoboto(ctx.pdf, "bold");
    setText(ctx.pdf, NAVY);
    ctx.pdf.setFontSize(6.5);
    ctx.pdf.text(item.country, x + 5, y + 2);
  }
  ctx.y += mapH + 7;
}

function drawApacPageTwo(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  issueDate: string,
  bluf: string,
  topic: RegionalWeeklyTopic,
  futureEvents: RegionalFutureEventInput[] = [],
  canonical?: RegionalCanonicalReport,
): void {
  drawApacCompactHeading(ctx, "Regional Outlook");
  const blufLines = drawApacCompactText(ctx, bluf, 7.45, 8.8, 6);
  // Reserve from the measured wrapped-line advance, not a guessed paragraph
  // height, so the next heading cannot touch the final BLUF baseline.
  ctx.y += Math.max(8, blufLines > 0 ? 8 : 0);

  drawRegionalHotspotMap(ctx, incidents, topic, canonical?.mapPoints);
  const developments = canonical?.developments ?? buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const watchItems = canonical?.watchItems ?? buildApacWeeklyWatchlist(developments, futureEvents, issueDate);
  const glance = canonical?.glanceMetrics ?? buildApacGlanceMetrics(developments, watchItems);
  drawApacCompactHeading(ctx, "Week at a Glance");
  const gap = 7;
  const cardW = (ctx.CW - gap) / 2;
  glance.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = ctx.MX + col * (cardW + gap);
    const y = ctx.y + row * 31;
    setFill(ctx.pdf, "#ffffff");
    setStroke(ctx.pdf, POLAR);
    ctx.pdf.rect(x, y, cardW, 24, "FD");
    setFill(ctx.pdf, ELECTRIC);
    ctx.pdf.rect(x, y, 2.5, 24, "F");
    setText(ctx.pdf, NAVY);
    setRoboto(ctx.pdf, "bold");
    ctx.pdf.setFontSize(6.3);
    ctx.pdf.text(item.label.toUpperCase(), x + 8, y + 9);
    ctx.pdf.setFontSize(12);
    ctx.pdf.text(String(item.value), x + 8, y + 20);
  });
  ctx.y += Math.ceil(glance.length / 2) * 31 + 4;
}

function drawApacThemesPage(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  issueDate: string,
  topic: RegionalWeeklyTopic,
  canonical?: RegionalCanonicalReport,
): void {
  drawApacCompactHeading(ctx, "Regional Risk Picture");
  drawApacCompactText(
    ctx,
    canonical?.riskPicture ?? buildRegionalIntelligencePicture(buildPdfRegionalDevelopments(incidents, issueDate, topic)),
    7.2,
    8.3,
    6,
  );
  const developments = canonical?.developments ?? buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const visual = canonical?.visualSummary ?? {
    byCategory: [...new Set(developments.map((row) => row.category))].map((label) => ({ label, count: developments.filter((row) => row.category === label).length })),
    byCountry: [...new Set(developments.map((row) => row.country))].map((label) => ({ label, count: developments.filter((row) => row.country === label).length })),
  };
  drawSimpleBarChart(ctx, "Developments by Type", visual.byCategory.map((row) => ({
    label: row.label,
    value: row.count,
  })));
  if (visual.byCountry.length > 0) {
    drawSimpleBarChart(ctx, "Developments by Market", visual.byCountry.map((row) => ({
      label: row.label,
      value: row.count,
    })));
  }
}

function drawApacDevelopmentPage(
  ctx: Ctx,
  pageRows: ReturnType<typeof buildApacWeeklyDevelopments>,
): void {
  drawApacCompactHeading(ctx, "Key Developments");
  const gap = 7;
  const cols = 2;
  const cardW = (ctx.CW - gap) / cols;
  const rowCount = Math.ceil(pageRows.length / cols);
  const rowHeights = Array.from({ length: rowCount }, (_, row) => {
    let max = 0;
    for (let col = 0; col < cols; col++) {
      const development = pageRows[row * cols + col];
      if (!development) continue;
       ctx.pdf.setFontSize(7);
      const body = [
        `Category: ${development.category}`,
        `Current Severity: ${development.severity}`,
        `Assessment: ${development.whatChanged}`,
        `Polestar View: ${development.polestarView ?? development.operationalSignificance}`,
        ...(development.outlook7Days ? [`Outlook 7 Days: ${development.outlook7Days}`] : []),
      ].join("\n");
      const titleLines = ctx.pdf.splitTextToSize(
        `${development.country} | ${development.location ?? development.country}${development.eventDate ? `\n${format(parseISO(development.eventDate), "dd MMM yyyy")}` : ""}\n${development.title}`,
        cardW - 12,
      ).length;
      const bodyLines = ctx.pdf.splitTextToSize(sanitize(body), cardW - 12).length;
       max = Math.max(max, 12 + titleLines * 8.2 + bodyLines * 7.8 + 10);
    }
    return max;
  });
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      const development = pageRows[row * cols + col];
      if (!development) continue;
      const x = ctx.MX + col * (cardW + gap);
      const y = ctx.y;
      const h = rowHeights[row];
      setFill(ctx.pdf, "#ffffff");
      setStroke(ctx.pdf, POLAR);
      ctx.pdf.setLineWidth(0.45);
      ctx.pdf.rect(x, y, cardW, h, "FD");
      setFill(ctx.pdf, SEV_COLOR[sevKey(development.severity)] ?? ELECTRIC);
      ctx.pdf.rect(x, y, 2.5, h, "F");
      setText(ctx.pdf, NAVY);
      setRoboto(ctx.pdf, "bold");
       ctx.pdf.setFontSize(7.1);
      const titleLines = ctx.pdf.splitTextToSize(
        `${development.country} | ${development.location ?? development.country}${development.eventDate ? `\n${format(parseISO(development.eventDate), "dd MMM yyyy")}` : ""}\n${development.title}`,
        cardW - 12,
      );
      ctx.pdf.text(titleLines, x + 7, y + 10, { lineHeightFactor: 1.1 });
      const body = [
        `Category: ${development.category}`,
        `Current Severity: ${development.severity}`,
        `Assessment: ${development.whatChanged}`,
        `Polestar View: ${development.polestarView ?? development.operationalSignificance}`,
        ...(development.outlook7Days ? [`Outlook 7 Days: ${development.outlook7Days}`] : []),
      ].join("\n");
      setText(ctx.pdf, DUSK);
      setRoboto(ctx.pdf, "regular");
       ctx.pdf.setFontSize(7);
      const bodyLines = ctx.pdf.splitTextToSize(sanitize(body), cardW - 12);
       ctx.pdf.text(bodyLines, x + 7, y + 10 + titleLines.length * 8.2, { lineHeightFactor: 1.1 });
      if (development.sourceCount && development.sourceCount > 1) {
        setRoboto(ctx.pdf, "italic");
        ctx.pdf.setFontSize(5.5);
        ctx.pdf.text(`${development.sourceCount} corroborating sources`, x + 7, y + h - 5);
      }
    }
    ctx.y += rowHeights[row] + gap;
  }
}

function splitApacDevelopmentPages(
  ctx: Ctx,
  developments: ReturnType<typeof buildApacWeeklyDevelopments>,
): Array<ReturnType<typeof buildApacWeeklyDevelopments>> {
  const gap = 7;
  const cardW = (ctx.CW - gap) / 2;
  const usable = ctx.H - ctx.BOTTOM - ctx.TOP - 38;
  const rowHeights = developments.map((development) => {
    const body = [
      `Category: ${development.category}`,
      `Current Severity: ${development.severity}`,
      `What Changed: ${development.whatChanged}`,
      `Operational Impact: ${development.operationalImpact ?? development.operationalSignificance}`,
      `Polestar View: ${development.polestarView ?? development.operationalSignificance}`,
      ...(development.outlook7Days ? [`Outlook 7 Days: ${development.outlook7Days}`] : []),
    ].join("\n");
    ctx.pdf.setFontSize(7);
    const titleLines = ctx.pdf.splitTextToSize(
      `${development.country} | ${development.location ?? development.country}${development.eventDate ? `\n${format(parseISO(development.eventDate), "dd MMM yyyy")}` : ""}\n${development.title}`,
      cardW - 12,
    ).length;
    const bodyLines = ctx.pdf.splitTextToSize(sanitize(body), cardW - 12).length;
    return 12 + titleLines * 8.2 + bodyLines * 7.8 + 10;
  });
  const pages: Array<ReturnType<typeof buildApacWeeklyDevelopments>> = [];
  let page: ReturnType<typeof buildApacWeeklyDevelopments> = [];
  let height = 0;
  for (let index = 0; index < developments.length; index += 2) {
    const rowHeight = Math.max(rowHeights[index], rowHeights[index + 1] ?? 0) + gap;
    if (page.length > 0 && height + rowHeight > usable) {
      pages.push(page);
      page = [];
      height = 0;
    }
    page.push(...developments.slice(index, index + 2));
    height += rowHeight;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function drawApacFinalPage(
  ctx: Ctx,
  incidents: TopicReportIncident[],
  issueDate: string,
  futureEvents: RegionalFutureEventInput[] = [],
  topic: RegionalWeeklyTopic = "apac_weekly",
  canonical?: RegionalCanonicalReport,
): void {
  const developments = canonical?.developments ?? buildPdfRegionalDevelopments(incidents, issueDate, topic);
  const items = canonical?.watchItems ?? buildApacWeeklyWatchlist(developments, futureEvents, issueDate);
  drawApacCompactHeading(ctx, "7 Day Watch");
  if (futureEvents.length === 0) {
    drawApacCompactText(
      ctx,
      `The separate forward search returned no verified scheduled ${topic === "apac_weekly" ? "APAC" : "Middle East"} event for the next seven days.`,
      6.8,
      7.8,
      3,
    );
  }
  for (const item of items) {
    setText(ctx.pdf, NAVY);
    setRoboto(ctx.pdf, "bold");
    ctx.pdf.setFontSize(6.7);
    ctx.pdf.text(sanitize(`${item.date} | ${item.location} | ${item.trigger}`), ctx.MX, ctx.y + 7);
    ctx.y += 9;
    const detail = `${item.whyItMatters}${item.currentSeverity ? ` Current severity: ${item.currentSeverity}.` : ""} ${item.whatToWatch}`;
    drawApacCompactText(ctx, detail, 6.8, 7.8, 3);
  }
  ctx.y += 8;
  const outlook = canonical?.polestarOutlook ?? buildStructuredRegionalOutlook(developments, topic);
  drawApacCompactHeading(ctx, "Polestar Outlook");
  drawApacCompactText(ctx, outlook, 7.35, 8.5, 4);
}

// Compose the "Country — location" line for a curated card / annex row. Blank
// segments are dropped (no fabricated "not reported"); when both are absent the
// caller decides what to show.
function cargoPlaceLine(row: CargoAppendixRow): string {
  const country = sanitize(row.country);
  const loc = sanitize(row.location);
  if (country && loc && loc.toLowerCase() !== country.toLowerCase()) {
    return `${country} — ${loc}`;
  }
  return country || loc;
}

function cargoDateStr(iso: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "dd MMM yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

// Curated "Key Incidents" — up to MAX_SELECTED_INCIDENTS compact cards that best
// illustrate the period's main operational patterns (NOT the most recent). Each
// card carries Date + a Severity chip, Location · Incident type, a one-sentence
// summary, an Operational relevance line and (only where the source carries an
// explicit signal) a resolved Status. Confidence is deliberately omitted from
// the cards — it stays in the register and CSV. Blank fields are omitted (no
// fabricated placeholders). Mirrors CargoReportPreview's SelectedIncidents.
function drawSelectedIncidents(
  ctx: Ctx,
  rows: CargoAppendixRow[],
  opts: { heading?: string | null; subtitle?: string | null } = {},
) {
  const { pdf, MX, CW } = ctx;
  // Heading defaults to "Key Incidents"; pass null to render the cards under a
  // heading already drawn by the caller (the Enforcement Activity panel reuses
  // this card renderer but must NOT emit a second "Key Incidents" heading).
  const heading = opts.heading === undefined ? "Key Incidents" : opts.heading;
  // Subtitle defaults to the pattern-illustration blurb; pass null to omit it
  // (it is meaningless above enforcement outcomes).
  const subtitle =
    opts.subtitle === undefined
      ? "Incidents that best illustrate the main operational patterns identified during the reporting period."
      : opts.subtitle;
  if (heading) drawSectionHeading(ctx, heading);
  if (rows.length === 0) {
    renderProse(ctx, "No cargo-crime incidents were recorded this period.");
    return;
  }

  const PAD = 8;
  const innerW = CW - 2 * PAD;
  const SUM_FONT = 8.5;
  const META_FONT = 8;
  const REL_FONT = 8;
  const lineH = 11;
  const gap = 8;

  // Section subtitle (italic), mirroring the on-screen preview. Omitted when
  // the caller passes subtitle: null (e.g. the Enforcement Activity panel).
  if (subtitle) {
    setRoboto(pdf, "italic");
    pdf.setFontSize(META_FONT);
    setText(pdf, DUSK);
    const subLines: string[] = pdf.splitTextToSize(subtitle, CW);
    ensureSpace(ctx, subLines.length * lineH + 4);
    for (const line of subLines) {
      ctx.y += lineH;
      pdf.text(line, MX, ctx.y);
    }
    ctx.y += 6;
  }

  for (const r of rows) {
    // Pre-measure the card so it never splits across a page break.
    setRoboto(pdf, "regular");
    pdf.setFontSize(SUM_FONT);
    const summaryLines: string[] = pdf.splitTextToSize(
      sanitize(r.summary),
      innerW,
    );
    const place = cargoPlaceLine(r);
    const typeLine = sanitize(r.category);
    const hasMeta = !!(place || typeLine);

    // Operational relevance + resolved status (only where present).
    pdf.setFontSize(REL_FONT);
    const relText = sanitize(r.operationalRelevance || "");
    const relLines: string[] = relText
      ? pdf.splitTextToSize(`Operational relevance: ${relText}`, innerW)
      : [];
    const statusText = sanitize(r.clientStatus || "");
    const statusLines: string[] = statusText
      ? pdf.splitTextToSize(`Status: ${statusText}`, innerW)
      : [];
    // Source line (publisher name) — required alongside the date on every Key
    // Incident (spec pt5). Blank when the source is unknown (no fabrication).
    const sourceText = sanitize(r.source || "");
    const sourceLines: string[] = sourceText
      ? pdf.splitTextToSize(`Source: ${sourceText}`, innerW)
      : [];

    const cardH =
      PAD + // top pad
      lineH + // date + chip row
      (hasMeta ? lineH : 0) + // place · category
      summaryLines.length * lineH + // summary
      relLines.length * lineH + // operational relevance
      statusLines.length * lineH + // resolved status
      sourceLines.length * lineH + // source
      PAD; // bottom pad

    ensureSpace(ctx, cardH + gap);
    const top = ctx.y;

    // Card border.
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.7);
    pdf.rect(MX, top, CW, cardH);

    // Row 1: date (left) and severity chip (right). Confidence is intentionally
    // not drawn here — it lives in the register and CSV, not the card.
    let cursorY = top + PAD + 8;
    setRoboto(pdf, "bold");
    pdf.setFontSize(META_FONT);
    setText(pdf, NAVY);
    pdf.text(cargoDateStr(r.date), MX + PAD, cursorY);

    const sk = sevKey(r.severityKey);
    const label = (r.severityLabel || "").trim();
    if (label) {
      const sevText = sanitize(`SEVERITY: ${label.toUpperCase()}`);
      setRoboto(pdf, "bold");
      pdf.setFontSize(6.5);
      const chipTextW = pdf.getTextWidth(sevText);
      const chipW = chipTextW + 12;
      const chipH = 11;
      const chipLeft = MX + CW - PAD - chipW;
      setFill(pdf, SEV_COLOR[sk] ?? "#999999");
      pdf.rect(chipLeft, top + PAD + 1, chipW, chipH, "F");
      setText(pdf, WHITE);
      pdf.text(sevText, chipLeft + chipW / 2, top + PAD + 8.5, {
        align: "center",
      });
    }

    // Row 2: place · category.
    if (hasMeta) {
      cursorY += lineH;
      setRoboto(pdf, "medium");
      pdf.setFontSize(META_FONT);
      setText(pdf, DUSK);
      const meta = [place, typeLine].filter(Boolean).join("  ·  ");
      pdf.text(sanitize(meta), MX + PAD, cursorY);
    }

    // Summary (wrapped).
    cursorY += lineH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(SUM_FONT);
    setText(pdf, NAVY);
    for (const line of summaryLines) {
      pdf.text(line, MX + PAD, cursorY);
      cursorY += lineH;
    }

    // Operational relevance (wrapped).
    if (relLines.length) {
      setRoboto(pdf, "regular");
      pdf.setFontSize(REL_FONT);
      setText(pdf, DUSK);
      for (const line of relLines) {
        pdf.text(line, MX + PAD, cursorY);
        cursorY += lineH;
      }
    }

    // Resolved status (wrapped).
    if (statusLines.length) {
      setRoboto(pdf, "regular");
      pdf.setFontSize(REL_FONT);
      setText(pdf, DUSK);
      for (const line of statusLines) {
        pdf.text(line, MX + PAD, cursorY);
        cursorY += lineH;
      }
    }

    // Source (wrapped) — publisher name beside the date (spec pt5).
    if (sourceLines.length) {
      setRoboto(pdf, "regular");
      pdf.setFontSize(REL_FONT);
      setText(pdf, DUSK);
      for (const line of sourceLines) {
        pdf.text(line, MX + PAD, cursorY);
        cursorY += lineH;
      }
    }

    ctx.y = top + cardH + gap;
  }
  ctx.y += 2;
}

// Optional full incident annex — the complete deduplicated register in a
// readable, wrapped table. Off by default; when the author opts in it starts on
// a fresh final page. Unlike the retired 6.5pt appendix it uses an 8pt face and
// wraps the summary to variable-height rows so nothing is truncated.
function drawFullAnnex(ctx: Ctx, rows: CargoAppendixRow[]) {
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) return;
  newPage(ctx);
  drawSectionHeading(ctx, "Incident Annex");
  renderProse(
    ctx,
    "Complete deduplicated incident register for the period. Fields are left blank where the source did not report them.",
  );

  const colDateW = 60;
  const colLocW = 96;
  const colCatW = 84;
  const colSevW = 58;
  const colConfW = 48;
  const colSumW = CW - colDateW - colLocW - colCatW - colSevW - colConfW;
  const FONT = 8;
  const lineH = 10;
  const vPad = 5;
  const headerH = 15;
  const xDate = MX + 5;
  const xLoc = MX + colDateW + 5;
  const xCat = MX + colDateW + colLocW + 5;
  const xSum = MX + colDateW + colLocW + colCatW + 5;
  const sevColX = MX + colDateW + colLocW + colCatW + colSumW;
  const xConf = sevColX + colSevW + 5;

  const oneLine = (value: string, w: number): string => {
    const clean = sanitize(value);
    if (!clean) return "";
    const lines: string[] = pdf.splitTextToSize(clean, w);
    if (lines.length <= 1) return lines[0] ?? "";
    let first = lines[0];
    while (first.length > 1 && pdf.getTextWidth(first + "…") > w) {
      first = first.slice(0, -1);
    }
    return first + "…";
  };

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, headerH, "F");
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y, MX + CW, ctx.y);
    pdf.line(MX, ctx.y, MX, ctx.y + headerH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + headerH);
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(FONT);
    pdf.text("DATE", xDate, ctx.y + 10);
    pdf.text("LOCATION", xLoc, ctx.y + 10);
    pdf.text("CATEGORY", xCat, ctx.y + 10);
    pdf.text("INCIDENT SUMMARY", xSum, ctx.y + 10);
    pdf.text("SEVERITY", sevColX + 5, ctx.y + 10);
    pdf.text("CONF.", xConf, ctx.y + 10);
    ctx.y += headerH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(FONT);
  };

  ensureSpace(ctx, headerH + 24);
  drawHeader();

  for (const r of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(FONT);
    const summaryLines: string[] = pdf.splitTextToSize(
      sanitize(r.summary),
      colSumW - 8,
    );
    const rowH = Math.max(16, summaryLines.length * lineH + vPad * 2);

    if (ctx.y + rowH > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rowH, MX + CW, ctx.y + rowH);
    pdf.line(MX, ctx.y, MX, ctx.y + rowH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rowH);

    const baseY = ctx.y + vPad + 7;
    setText(pdf, DUSK);
    pdf.text(cargoDateStr(r.date), xDate, baseY);
    pdf.text(oneLine(cargoPlaceLine(r), colLocW - 8), xLoc, baseY);
    pdf.text(oneLine(r.category, colCatW - 8), xCat, baseY);
    setText(pdf, NAVY);
    let sumY = baseY;
    for (const line of summaryLines) {
      pdf.text(line, xSum, sumY);
      sumY += lineH;
    }
    setText(pdf, DUSK);
    if (r.confidenceLabel) {
      pdf.text(oneLine(r.confidenceLabel, colConfW - 8), xConf, baseY);
    }

    const sk = sevKey(r.severityKey);
    const sevText = sanitize((r.severityLabel || "").toUpperCase());
    if (sevText) {
      setFill(pdf, SEV_COLOR[sk] ?? "#999999");
      const chipW = colSevW - 8;
      pdf.rect(sevColX + 4, ctx.y + vPad, chipW, 11, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(6);
      pdf.text(sevText, sevColX + 4 + chipW / 2, ctx.y + vPad + 7.5, {
        align: "center",
      });
      setRoboto(pdf, "regular");
      pdf.setFontSize(FONT);
    }

    ctx.y += rowH;
  }
  ctx.y += 8;
}

export async function exportTopicReportPdf(
  data: TopicReportData,
  incidents: TopicReportIncident[],
  topicLabels: Record<string, string>,
  filename: string,
  options: ExportTopicReportPdfOptions = {},
): Promise<void> {
  const regionalTopic: RegionalWeeklyTopic = data.topic === "apac_weekly"
    ? "apac_weekly"
    : "middle_east_weekly";
  const regionalCanonical = isRegionalWeeklyTopic(data.topic)
    ? regionalCanonicalReportFromHardNumbers(data.hardNumbers, data.topic, data.issueDate)
    : null;
  if (isRegionalWeeklyTopic(data.topic) && !regionalCanonical) {
    throw new Error(
      `${data.topic === "apac_weekly" ? "APAC Weekly" : "Middle East Weekly"} has no valid persisted canonical report object; refusing PDF regeneration`,
    );
  }
  const regionalPdfIncidents = isRegionalWeeklyTopic(data.topic)
    ? curateRegionalWeeklyIncidents(incidents, data.topic, data.issueDate)
    : incidents;
  if (isRegionalWeeklyTopic(data.topic)) {
    const regionalErrors = validateRegionalWeeklyAssessment(
      regionalCanonical!.developments,
      data.topic,
    );
    if (regionalErrors.length > 0) {
      // Do not strand the analyst in the editor. Regional Weekly already renders
      // from the curated, event-clustered set above; quality findings remain
      // diagnostic rather than preventing the user from downloading and editing
      // the PDF further.
      console.warn("[Regional Weekly PDF quality advisory]", regionalErrors);
    }
  }
  if (data.topic === "fuel") {
    console.info("[FUEL_PDF_TRACE] EXPORT FUNCTION CALLED");
  }
  const show = makeSectionGate(options.hiddenSections);
  const ffOverrides = options.sectionOverrides?.fastFactOverrides;
  const topicLabel = topicLabels[data.topic] ?? data.topic;
  // Canonical naming: cover title, running header and subtitle use the
  // canonical topic name. Regional words live in scope, not the title.
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try {
    headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd");
  } catch {
    /* keep */
  }

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
  const isFuel = data.topic === "fuel";
  const isRegionalWeekly = isRegionalWeeklyTopic(data.topic);
  const fuelIssueDate = isFuel
    ? (fuelMarketLatestDate(data.hardNumbers) ?? data.issueDate)
    : data.issueDate;
  const win = resolveReportWindow(data.topic, fuelIssueDate);
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  const topicCoverUrl = TOPIC_COVER_URLS[data.topic];
  if (topicCoverUrl) {
    try {
      const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
      coverImage = await prepareCoverImage(topicCoverUrl, ctx.W, heroH);
    } catch (err) {
      console.warn(
        `[exportTopicReportPdf] cover image load failed for topic ${data.topic}, falling back to gradient hero`,
        err,
      );
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

  const aiProse = options.aiProse ?? null;
  // fuelIssueDate computed above for cover/body parity with preview.
  const fuelBundle = isFuel
    ? finalizeFuelPublication({
        report: {
          title: data.title,
          issueDate: fuelIssueDate,
          author: data.author,
          executiveSummary: data.executiveSummary,
          situation: data.situation,
          whatHappened: data.whatHappened,
          whatMatters: data.whatMatters,
          implications: resolveSimpleProse(
            data.implications,
            aiProse?.implications,
            "",
          ),
          polestarView: data.polestarView,
          watchNext: resolveSimpleProse(data.watchNext, aiProse?.watchNext, ""),
          hardNumbers: data.hardNumbers,
        },
        incidents,
        aiProse,
      })
    : null;
  const fuelData = fuelBundle?.reportData ?? null;
  // FINAL EFFECTIVE Fuel narrative — analyst edit -> AI -> canonical
  // deterministic, resolved by the ONE shared resolver the preview and the
  // editor prefill also call, so all three surfaces render byte-identical
  // section text.
  const fuelEffective = fuelBundle?.effectiveSections ?? null;
  // Deterministic per-topic draft — the labelled fallback beneath the AI
  // narrative and any analyst edit. Built from the SAME windowed incident
  // set the on-screen preview uses so screen and PDF agree.
  const proseDraft = stableDraftTopicReportProse({
    topic: data.topic,
    issueDate: data.issueDate,
    incidents: toDraftableIncidents(
      isRegionalWeekly
        ? incidents
        : filterTopicReportIncidents(incidents, data.topic, data.issueDate),
    ),
    fuelGulf: fuelData?.incidentData.gulfChokepointWatch ?? null,
  });
  if (!isFuel) {
    assertFinalReportSectionsDistinct({
      executiveSummary: resolveSimpleProse(data.executiveSummary, aiProse?.executiveSummary, proseDraft.executiveSummary),
      situation: resolveSimpleProse(data.situation, aiProse?.situation, proseDraft.situation),
      whatHappened: resolveSimpleProse(data.whatHappened, aiProse?.whatHappened, proseDraft.whatHappened),
      whatMatters: resolveSimpleProse(data.whatMatters, aiProse?.whatMatters, proseDraft.whatMatters),
      implications: resolveSimpleProse(data.implications, aiProse?.implications, proseDraft.implications),
      watchNext: resolveSimpleProse(data.watchNext, aiProse?.watchNext, proseDraft.watchNext),
      polestarView: resolveSimpleProse(data.polestarView, aiProse?.polestarView, proseDraft.polestarView),
    });
  }

  const isCargo = data.topic === "cargo_watch";
  // Hoisted narrative-incident list shared by buildCargoPatternModel and the
  // three read builders so all derive from the exact same filtered window.
  const cargoNarrativeIncidents = isCargo
    ? filterTopicReportIncidents(incidents, data.topic, data.issueDate).map(
        (i) => ({
          id: i.id,
          topic: i.topic,
          title: displayIncidentTitle(i.title, i.displayTitle),
          summary: i.summary ?? null,
          source: i.source ?? null,
          sourceUrl: i.sourceUrl ?? null,
          location: i.location ?? null,
          country: i.country ?? null,
          severity: i.severity ?? "",
          occurredAt: i.occurredAt,
        }),
      )
    : null;
  // Cargo Watch is a pattern report: one shared model drives Fast Facts, the
  // four operational graphics, the deterministic assessment prose, the
  // executive summary and the curated Key Incidents — built ONCE, above the
  // Executive Summary, from the SAME windowed set the on-screen preview uses so
  // screen == PDF. Hoisted here so the Executive Summary can read it.
  const cargoModel = isCargo
    ? buildCargoPatternModel(
        cargoNarrativeIncidents!.map((i) => ({
          id: i.id,
          topic: i.topic,
          title: i.title,
          summary: i.summary ?? null,
          source: i.source ?? null,
          sourceUrl: i.sourceUrl ?? null,
          location: i.location ?? null,
          country: i.country ?? null,
          severity: i.severity ?? null,
          occurredAt: i.occurredAt,
        })),
        {
          issueDate: data.issueDate,
          topicLabel: topicLabels[data.topic] ?? data.topic,
        },
      )
    : null;

  // HARD validation gate (spec pt7). A Cargo Watch report that fails any check
  // must not export — the gate runs over the SAME model + resolved (editor-or-
  // auto) section text the report renders, so the block is identical to the
  // preview's blocking panel. Fail-closed unless the caller opts out.
  if (isCargo && cargoModel && !options.allowValidationFailures) {
    assertCargoReportValid(
      cargoModel,
      {
        situation: data.situation,
        whatMatters: data.whatMatters,
        implications: data.implications,
        watchNext: data.watchNext,
        polestarView: data.polestarView,
      },
      data.issueDate,
      {
        situation: aiProse?.situation,
        whatMatters: aiProse?.whatMatters,
        implications: aiProse?.implications,
        watchNext: aiProse?.watchNext,
        polestarView: aiProse?.polestarView,
      },
    );
  }

  // Executive Summary. For Cargo Watch it is the deterministic, analytical
  // paragraph from the model (spec TASK A) — an owner override wins, the AI
  // layer is deliberately NOT consulted so the strict format rules always hold.
  // Every other topic keeps the AI narrative + template fallback stack.
  const execText =
    isRegionalWeekly
      ? regionalCanonical!.regionalOutlook
      : fuelEffective
      ? (fuelEffective.executiveSummary ?? "")
      : isCargo && cargoModel
        ? resolveSimpleProse(data.executiveSummary, null, cargoModel.executiveSummary)
        : resolveSimpleProse(
            data.executiveSummary,
            aiProse?.executiveSummary,
            proseDraft.executiveSummary,
          );
  if (
    data.topic !== "energy" &&
    show("executive-summary") &&
    execText.trim()
  ) {
    if (isRegionalWeekly) {
      drawApacPageTwo(ctx, regionalPdfIncidents, data.issueDate, execText, regionalTopic, options.futureEvents, regionalCanonical ?? undefined);
    } else {
      drawSectionHeading(ctx, isRegionalWeekly ? "BLUF — Regional Outlook" : "Executive Summary");
      renderProse(ctx, execText);
      if (isCargo && cargoModel?.highSeverityNote.trim()) {
        renderProse(ctx, cargoModel.highSeverityNote);
      }
    }
  }

  const rawWindow = filterIncidentsToWindow(
    incidents,
    data.topic,
    data.issueDate,
    { byTopic: true },
  );
  // Strip records that match the topic field but are not operationally on
  // topic (e.g. hiking obituary that happens to mention "fuel"). Used for
  // Fast Facts and prose data. The Related Incidents table does NOT read this
  // set — it derives its rows from filterTopicReportIncidents (the same input
  // the on-screen preview uses) so the two surfaces cannot disagree.
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

  // Energy has a fixed information hierarchy, not fixed physical pages.
  if (data.topic === "energy") {
    if (show("fast-facts")) {
      drawSectionHeading(ctx, "Fast Facts");
      drawFastFactsKpiCards(
        ctx,
        applyFastFactOverrides(
          computeTopicFastFacts({
            topic: data.topic,
            issueDate: data.issueDate,
            incidents,
            topicLabel: topicLabels[data.topic] ?? data.topic,
          }) as KpiCardData[],
          ffOverrides,
        ),
        true,
      );
    }
    if (show("executive-summary") && execText.trim()) {
      // BLUF replaces the generic "Executive Summary" heading. execText is
      // rendered directly below it so its paragraphs and wording are not
      // rewritten.
      drawEnergyProse(ctx, "BLUF", execText);
    }
    if (show("situation")) {
      const countryCounts = new Map<string, number>();
      for (const incident of windowIncidents) {
        const country = incident.country?.trim();
        if (!country || /^unknown$/i.test(country)) continue;
        countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      }
      const intensity = buildCountryIntensity(
        Array.from(countryCounts.entries()).map(([country, count]) => ({
          country,
          count,
        })),
      );
      await embedReactChartInPdf(
        ctx,
        createElement(EnergySituationVisual, {
          intensity,
          mapHeight: ENERGY_REPORT_MAP_HEIGHT,
        }),
        { heading: "Energy Situation Map", fitRemaining: false, useCssPixelUnits: true },
      );
    }

    // Prices may share a page when they fit at their normal readable size.
    if (show("market-prices")) {
      const rows = applyMarketPriceOverrides(
        options.marketPrices ?? [],
        options.sectionOverrides?.marketPriceOverrides,
      );
      if (rows.length === 0) {
        drawEnergyProse(ctx, "Market Prices", MARKET_PRICES_REPORT_EMPTY_TEXT);
      } else {
        await embedReactChartInPdf(
          ctx,
          createElement(MarketPricesReportGrid, { rows, compact: true }),
          { heading: "Market Prices", fitRemaining: false, useCssPixelUnits: true },
        );
      }
    }

    // Energy Situation prose, followed by the saved What Happened
    // prose in the same block, then What Matters. Only the explicit saved
    // geography labels are promoted without changing any paragraph text.
    const energySituation = resolveSimpleProse(
      data.situation,
      aiProse?.situation,
      proseDraft.situation,
    );
    const whatHappened = resolveSimpleProse(
      data.whatHappened,
      aiProse?.whatHappened,
      proseDraft.whatHappened,
    );
    let energyHeadingPending = true;
    let savedLocationHeading = "";
    const renderEnergySituationSegments = (text: string) => {
      for (const segment of segmentEnergySituationProse(text)) {
        if (segment.kind === "standalone-label") {
          savedLocationHeading = segment.heading ?? segment.text;
          continue;
        }
        const locationHeading = savedLocationHeading || segment.heading;
        drawEnergyProse(ctx, energyHeadingPending ? "Energy Situation" : undefined, segment.text, {
          subheading: locationHeading || undefined,
        });
        energyHeadingPending = false;
        savedLocationHeading = "";
      }
    };
    if (show("situation") || (show("what-happened") && whatHappened.trim())) {
      // One pass across both fields: repeated explicit sections are grouped
      // once, just as in the preview. Mentions in overview prose aren't labels.
      renderEnergySituationSegments([
        show("situation") ? energySituation : "",
        show("what-happened") ? whatHappened : "",
      ].filter(Boolean).join("\n\n"));
    }
    if (show("what-matters")) {
      const whatMatters = resolveSimpleProse(
        data.whatMatters,
        aiProse?.whatMatters,
        proseDraft.whatMatters,
      );
      if (whatMatters.trim()) {
        drawEnergyProse(ctx, "What Matters", whatMatters);
      }
    }

    // Client actions follow the narrative without an unconditional page break.
    if (show("implications")) {
      const implications = resolveSimpleProse(
        data.implications,
        aiProse?.implications,
        proseDraft.implications,
      );
      if (implications.trim()) {
        drawEnergyProse(ctx, "Implications for Business", implications, { bullets: true });
      }
    }
    if (show("watch-next")) {
      const watchNext = resolveSimpleProse(
        data.watchNext,
        aiProse?.watchNext,
        proseDraft.watchNext,
      );
      if (watchNext.trim()) drawEnergyProse(ctx, "Watch Next", watchNext, { bullets: true });
    }
    // The legal block follows the intact judgement, moving separately if
    // needed. Never distort the assessment to reserve a disclaimer-only page.
    const disclaimerFontSize = 9;
    const disclaimerLineHeightFactor = 1.2;
    const disclaimerLineHeight = disclaimerFontSize * disclaimerLineHeightFactor;
    setRoboto(ctx.pdf, "light");
    ctx.pdf.setFontSize(disclaimerFontSize);
    const disclaimerLines: string[] = ctx.pdf.splitTextToSize(sanitize(DISCLAIMER_TEXT), ctx.CW - 20);
    const disclaimerHeight = 32 + disclaimerLines.length * disclaimerLineHeight;
    if (show("polestar-view")) {
      const polestarView = resolveSimpleProse(
        data.polestarView,
        aiProse?.polestarView,
        proseDraft.polestarView,
      );
      if (polestarView.trim()) {
        drawEnergyProse(ctx, "Polestar View", polestarView, { atomic: true });
      }
    }

    // Related Incidents remains removed. The full legal text follows Polestar
    // View on the plain page; it is never overlaid at a fixed footer position.
    ensureSpace(ctx, disclaimerHeight + 12);
    const disclaimerY = ctx.y + 12;
    setText(ctx.pdf, NAVY);
    setRoboto(ctx.pdf, "bold");
    ctx.pdf.setFontSize(8);
    ctx.pdf.text("DISCLAIMER", ctx.MX + 10, disclaimerY + 15);
    setText(ctx.pdf, DUSK);
    setRoboto(ctx.pdf, "light");
    ctx.pdf.setFontSize(disclaimerFontSize);
    ctx.pdf.text(disclaimerLines, ctx.MX + 10, disclaimerY + 29, {
      lineHeightFactor: disclaimerLineHeightFactor,
    });
    drawFooters(ctx.pdf, undefined, undefined, true);
    ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
    return;
  }

  if (isFuel && fuelData) {
    if (show("fast-facts")) {
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
        const kpis: KpiCardData[] = applyFastFactOverrides(
          fuelData.marketData.fastFactsCards.map(toRenderableCard),
          ffOverrides,
        );
        drawFastFactsKpiCards(ctx, kpis);
        for (const w of fuelData.validation.warnings) renderProse(ctx, w);
      }
      if (fuelBundle) {
        const coverageModel = buildFuelCoverageSummary(fuelBundle.canonicalFacts);
        // Keep the visual atomic but paginate the country register as bounded
        // readable chunks. The embed helper must never shrink a full-country
        // table into an illegible strip merely to fit the current page tail.
        const countryRows = coverageModel.affectedCountries;
        const chunkSize = 12;
        const countryChunks =
          countryRows.length === 0
            ? [[]]
            : Array.from(
                { length: Math.ceil(countryRows.length / chunkSize) },
                (_, index) => countryRows.slice(index * chunkSize, (index + 1) * chunkSize),
              );
        for (const [index, rows] of countryChunks.entries()) {
          await embedReactChartInPdf(
            ctx,
            createElement(FuelCoverageSummary, {
              model: coverageModel,
              countryRows: rows,
              showMetrics: index === 0,
              continued: index > 0,
            }),
            // CSS pixels are converted to jsPDF points by the helper. A
            // bounded chunk either fits at readable size or starts naturally
            // on the next page; it is never arbitrarily scaled down.
            { useCssPixelUnits: true, fitRemaining: false },
          );
        }
      }
    }

    // Jet Fuel Price Trajectory — rasterise the same React chart the preview
    // uses so chart styling cannot drift from a hand-ported jsPDF replica.
    if (show("jet-fuel-trajectory")) {
      await embedReactChartInPdf(
        ctx,
        createElement(JetFuelTrajectoryChart, {
          data:
            fuelData.marketData.jetFuelTrajectory.length >= 2
              ? fuelData.marketData.jetFuelTrajectory
              : null,
          benchmarkLabel: fuelData.marketData.jetFuelBenchmarkLabel,
        }),
        { heading: "Jet Fuel Price Trajectory" },
      );
      // Jet-fuel lag note — mirror the preview (ReportPreview.tsx) so the PDF
      // also explains why the jet "as of" date trails the daily Brent/WTI close
      // (EIA's publication of the daily U.S. Gulf Coast jet fuel series itself
      // lags by a few business days). Keeps screen == PDF.
      if (fuelData.marketData.jetDataNote) {
        renderProse(ctx, fuelData.marketData.jetDataNote);
      }
    }

    // Ordered Fuel Watch sections. Auto-derived sections (Market Read,
    // Operational Read, Regional Highlights, Market and Operator Responses)
    // sit alongside the editor-authored prose so the report reads 60%
    // analysis / 40% data rather than dashboard-style cards.
    // Use the atomic heading+first-paragraph renderer for every Fuel
    // Watch section so a heading is never stranded at the foot of a
    // page while its body lands on the next one.
    const renderProseSection = (
      label: string,
      body: string | null | undefined,
    ) => {
      if (body && body.trim()) drawSectionWithProse(ctx, label, body);
    };

    // FINAL EFFECTIVE narrative (analyst edit -> AI -> canonical) from the ONE
    // shared resolver — identical to the on-screen preview and editor prefill.
    if (show("market-read")) {
      renderProseSection("Market Read", fuelEffective?.marketRead);
    }
    if (show("situation")) {
      renderProseSection("Situation", fuelEffective?.situation);
    }
    if (show("what-happened")) {
      renderProseSection("What Happened", fuelEffective?.whatHappened);
    }
    if (show("operational-read")) {
      renderProseSection("Operational Read", fuelEffective?.operationalRead);
    }
    if (show("regional-highlights")) {
      renderProseSection(
        "Regional Highlights",
        fuelEffective?.regionalHighlights,
      );
    }
    // Owner per-row overrides (rewrite cells / suppress rows) — same
    // applyMarketOperatorOverrides call as the preview, so screen == PDF.
    // The section is omitted entirely when every row is suppressed.
    const producerRows = applyMarketOperatorOverrides(
      fuelData.incidentData.producerBuyerActions,
      options.sectionOverrides?.marketOperatorOverrides,
    );
    if (show("producer-buyer") && producerRows.length > 0) {
      // Reserve only the heading, table header and first row. Reserving the
      // entire table created large empty page tails for longer response tables;
      // the shared renderer now repeats its header safely on continuation pages.
      ensureSpace(ctx, 24 + 18 + 34);
      drawSectionHeading(ctx, "Market and Operator Responses");
      drawProducerBuyerActionsTable(ctx, producerRows);
    }
    if (show("what-matters")) {
      renderProseSection("What Matters", fuelEffective?.whatMatters);
    }
    // Fuel narrative sections must render as the same full paragraphs and in
    // the same order as ReportPreview. The generic bullet renderer splits and
    // truncates prose, so it must not be used for these sections.
    if (show("implications")) {
      renderProseSection(
        "Implications for Business",
        fuelEffective?.implications,
      );
    }
    if (show("polestar-view")) {
      renderProseSection("Polestar View", fuelEffective?.polestarView);
    }
    if (show("watch-next")) {
      renderProseSection("Watch Next", fuelEffective?.watchNext);
    }
    drawDisclaimer(ctx);
  } else {
    // isCargo + cargoModel are hoisted above the Executive Summary so it can
    // read the model's deterministic executive summary.
    if (!isRegionalWeekly && show("fast-facts")) {
      drawSectionHeading(ctx, "Fast Facts");
      drawFastFactsKpiCards(
        ctx,
        applyFastFactOverrides(
          (cargoModel
            ? cargoModel.fastFacts
            : computeTopicFastFacts({
                topic: data.topic,
                issueDate: data.issueDate,
                incidents,
                topicLabel: topicLabels[data.topic] ?? data.topic,
              })) as KpiCardData[],
          ffOverrides,
        ),
      );
    }

    if (
      (data.topic === "energy" || data.topic === "fertiliser") &&
      show("market-prices")
    ) {
      const rows = applyMarketPriceOverrides(
        options.marketPrices ?? [],
        options.sectionOverrides?.marketPriceOverrides,
      );
      if (rows.length === 0) {
        drawSectionHeading(ctx, "Market Prices");
        renderProse(ctx, MARKET_PRICES_REPORT_EMPTY_TEXT);
      } else {
        await embedReactChartInPdf(
          ctx,
          createElement(MarketPricesReportGrid, { rows }),
          { heading: "Market Prices" },
        );
      }
    }

    if (cargoModel) {
      // Geographic distribution. The map heading follows the theft-only
      // predicate (spec pt3); the same title is passed into the component so the
      // external heading and the internal chart title agree. Caption strings are
      // data-derived in the model, so they render identically on screen and PDF.
      if (show("map") && cargoModel.intensity.size > 0) {
        const mapRows = [...cargoModel.intensity.entries()]
          .map(([label, v]) => ({
            label,
            value: v.count,
            color: countBandColor(v.count) ?? ELECTRIC,
          }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
          .slice(0, 12);
        // Native PDF bars — html2canvas often rasterises choropleth SVGs blank off-screen.
        drawSimpleBarChart(ctx, cargoModel.mapTitle, mapRows, {
          caption: cargoModel.mapCaption.trim() || undefined,
          emptyMessage: "No identified incident countries reported this period.",
        });
      }

      // Weekly trend AND activity table combined under ONE heading (spec pt6) so
      // the PDF does not spend two near-duplicate pages on the same dataset.
      if (show("weekly-trend") && (cargoModel.extras.trend.length >= 2 || cargoModel.activity.total > 0)) {
        if (cargoModel.extras.trend.length >= 2) {
          const perDay = trendUsesDailyAverage(cargoModel.extras.trend);
          const trendRows = cargoModel.extras.trend.map((t) => {
            const value = trendChartValue(t);
            return {
              label: t.label ?? t.date,
              value,
              displayValue: formatTrendBarValue(value, perDay),
            };
          });
          drawSimpleBarChart(ctx, "Weekly Trend and Activity", trendRows, {
            caption: cargoModel.trendCaption.trim() || undefined,
          });
          if (cargoModel.activity.total > 0) {
            drawCargoActivityFallback(ctx, cargoModel.activity);
          }
        } else if (cargoModel.activity.total > 0) {
          drawCargoActivityFallback(ctx, cargoModel.activity);
        }
      }

      // Supply-chain exposure and pattern dashboard — native PDF prose/bullets.
      // html2canvas often rasterises these React graphics as blank off-screen pages.
      if (cargoModel.totalUnique > 0) {
        drawCargoSupplyChainFallback(
          ctx,
          cargoModel.stages,
          cargoModel.stageCategoryNote,
        );
        drawCargoPatternFallback(ctx, cargoModel.patterns);
      }

      // Enforcement outcomes — arrests, seizures and recoveries in their OWN
      // panel, EXCLUDED from every operational total above (spec pt1). The
      // statement is data-derived and never a "media coverage" claim.
      if (show("enforcement") && cargoModel.enforcement.total > 0) {
        drawSectionWithProse(
          ctx,
          "Enforcement Activity",
          cargoModel.enforcement.statement,
        );
        // The enforcement outcomes render with the SAME card layout as Key
        // Incidents but belong under the "Enforcement Activity" heading already
        // drawn above — so suppress this renderer's own heading + the
        // pattern-illustration subtitle (mirrors the preview, keeps preview==PDF).
        drawSelectedIncidents(ctx, cargoModel.enforcement.rows, {
          heading: null,
          subtitle: null,
        });
      }

      // Data-driven reads — editor override wins; auto-generated text fills
      // any blank field so the section always carries substance.
      // Drawn after enforcement and before the analyst assessment, matching
      // the CargoReportPreview order so screen == PDF.
      if (show("cargo-security-read")) {
        const secRead = pickRead(
          data.cargoSecurityRead,
          buildCargoSecurityRead(cargoNarrativeIncidents!),
        );
        if (secRead.trim()) drawSectionWithProse(ctx, "Cargo Security Read", secRead);
      }
      if (show("logistics-hub-read")) {
        const hubRead = pickRead(
          data.logisticsHubRead,
          buildLogisticsHubRead(cargoNarrativeIncidents!),
        );
        if (hubRead.trim()) drawSectionWithProse(ctx, "Logistics Hub Read", hubRead);
      }
      if (show("regional-read")) {
        const regRead = pickRead(
          data.regionalCountryRead,
          buildCargoCountryBreakdown(cargoNarrativeIncidents!).regionalRead,
        );
        if (regRead.trim()) drawSectionWithProse(ctx, "Regional Read", regRead);
      }

      // Operational assessment. Editor text wins; the deterministic model
      // assessment fills any blank field so the report reads with substance
      // out of the box. Bullet lists join on newlines for drawBulletSection.
      const a = cargoModel.assessment;
      // Editor override wins; otherwise the AI narrative (when configured) fills
      // the section, falling back to the deterministic model assessment. Mirrors
      // CargoReportPreview exactly so the on-screen preview == this PDF.
      if (show("situation")) {
        const sit = resolveSimpleProse(data.situation, aiProse?.situation, a.situation);
        if (sit.trim()) drawSectionWithProse(ctx, "Situation", sit);
      }
      if (show("what-matters")) {
        const wm = resolveSimpleProse(data.whatMatters, aiProse?.whatMatters, a.whatMatters.join("\n"));
        if (wm.trim()) drawBulletSection(ctx, "What Matters", wm, 3);
      }
      if (show("implications")) {
        const bp = resolveSimpleProse(data.implications, aiProse?.implications, a.implications.join("\n"));
        if (bp.trim()) drawBulletSection(ctx, "Implications", bp, 3);
      }
      if (show("watch-next")) {
        const wn = resolveSimpleProse(data.watchNext, aiProse?.watchNext, a.watchNext.join("\n"));
        if (wn.trim()) drawBulletSection(ctx, "Watch Next", wn, 4);
      }

      // Curated "Key Incidents" — up to MAX_SELECTED_INCIDENTS cards that best
      // illustrate the period's operational patterns (NOT the most recent). The
      // full deduplicated register lives in the Workbench and the CSV export; it
      // only appears in the PDF when the author opts into the annex below.
      if (show("key-incidents")) {
        drawSelectedIncidents(ctx, cargoModel.selected);
      }

      if (show("polestar-view")) {
        const pv = resolveSimpleProse(data.polestarView, aiProse?.polestarView, a.polestarView);
        if (pv.trim()) drawSectionWithProse(ctx, "Polestar View", pv);
      }

      // Optional full incident annex — off by default. When enabled it is the
      // last thing before the disclaimer, on its own fresh page.
      if (show("incident-annex") && options.includeFullAnnex) {
        drawFullAnnex(ctx, cargoModel.appendix);
      }
    } else if (isRegionalWeekly) {
      if (regionalTopic === "apac_weekly" || regionalCanonical) {
        const apacDevelopments = regionalCanonical!.developments;
        newPage(ctx);
        if (show("situation")) {
          drawApacThemesPage(ctx, regionalPdfIncidents, data.issueDate, regionalTopic, regionalCanonical!);
        }
        const developmentPages = show("what-happened")
          ? splitApacDevelopmentPages(
              ctx,
              apacDevelopments,
            )
          : [];
        if (developmentPages.length > 0) {
          developmentPages.forEach((pageRows) => {
            newPage(ctx);
            drawApacDevelopmentPage(ctx, pageRows);
          });
        }

        newPage(ctx);
        if (show("implications")) {
          drawSectionWithProse(
            ctx,
            "Business Implications",
            resolveRegionalNarrative(
              regionalCanonical!.businessImplicationsNarrative,
              null,
              regionalCanonical!.businessImplicationsNarrative,
            ),
          );
        }
        if (show("watch-next") || show("polestar-view")) {
          drawApacFinalPage(
            ctx,
            regionalPdfIncidents,
            data.issueDate,
            options.futureEvents,
            regionalTopic,
            regionalCanonical!,
          );
        }
      } else {
        newPage(ctx);
        drawSectionHeading(ctx, "Regional Risk Picture");
        if (show("situation")) {
          drawRegionalDomainBriefs(ctx, regionalPdfIncidents, data.issueDate, regionalTopic);
        }

        newPage(ctx);
        if (show("what-happened")) {
          drawApacDevelopmentPage(
            ctx,
            buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic),
          );
        }

        newPage(ctx);
        if (show("watch-next")) {
          drawSectionHeading(ctx, "7 Day Watch");
          drawRegionalTimeline(ctx, regionalPdfIncidents, data.issueDate, regionalTopic, options.futureEvents);
          drawRegionalWatchlist(ctx, regionalPdfIncidents, data.issueDate, regionalTopic, options.futureEvents);
        }
        if (show("implications")) {
          const businessImplications = resolveRegionalNarrative(
            data.implications,
            aiProse?.implications,
            buildRegionalBusinessImplicationsNarrative(
              buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic),
            ),
          );
          if (businessImplications.trim()) drawSectionWithProse(ctx, "Business Implications", businessImplications);
        }

        newPage(ctx);
        if (show("polestar-view")) {
          const outlook = resolveRegionalNarrative(
            data.polestarView,
            aiProse?.polestarView,
            buildStructuredRegionalOutlook(
              buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic),
              regionalTopic,
            ),
          );
          if (outlook.trim()) drawSectionWithProse(ctx, "Polestar Outlook", outlook);
        }
      }
    } else {
      const proseSections: [string, string, string][] = [
        [
          "situation",
          isRegionalWeekly ? "Regional Intelligence Picture" : "Situation",
          isRegionalWeekly
            ? resolveRegionalNarrative(
                data.situation,
                aiProse?.situation,
                buildRegionalIntelligencePicture(buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic)),
              )
            : resolveSimpleProse(data.situation, aiProse?.situation, proseDraft.situation),
        ],
        ...(!isRegionalWeekly
          ? [[
              "what-happened",
              "What Happened",
              resolveSimpleProse(
                data.whatHappened,
                aiProse?.whatHappened,
                proseDraft.whatHappened,
              ),
            ] as [string, string, string]]
          : []),
        [
          "what-matters",
          isRegionalWeekly ? "Business & Operational Risk" : "What Matters",
          isRegionalWeekly
            ? resolveRegionalNarrative(
                data.whatMatters,
                aiProse?.whatMatters,
                buildRegionalBusinessRisk(buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic)),
              )
            : resolveSimpleProse(data.whatMatters, aiProse?.whatMatters, proseDraft.whatMatters),
        ],
      ];
      for (const [key, label, body] of proseSections) {
        if (show(key) && body && body.trim()) drawSectionWithProse(ctx, label, body);
      }
      if (show("implications")) {
        const implBody = isRegionalWeekly
          ? resolveRegionalNarrative(
              data.implications,
              aiProse?.implications,
              buildRegionalTravelImplications(buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic)),
            )
          : resolveSimpleProse(data.implications, aiProse?.implications, proseDraft.implications);
        if (implBody.trim()) {
          drawBulletSection(ctx, isRegionalWeekly ? "Travel & Personnel" : "Implications for Business", implBody);
        }
      }
      if (show("watch-next")) {
        const wnBody = isRegionalWeekly
          ? ""
          : resolveSimpleProse(data.watchNext, aiProse?.watchNext, proseDraft.watchNext);
        if (isRegionalWeekly) {
          drawSectionHeading(ctx, "7-Day Watchlist");
          if (wnBody.trim()) renderProse(ctx, wnBody);
          drawRegionalWatchlist(ctx, regionalPdfIncidents, data.issueDate, regionalTopic, options.futureEvents);
        } else if (wnBody.trim()) {
          drawBulletSection(ctx, isRegionalWeekly ? "7-Day Watchlist" : "Watch Next", wnBody, 8);
        }
      }
      if (show("polestar-view")) {
        const psBody = isRegionalWeekly
          ? resolveRegionalNarrative(
              data.polestarView,
              aiProse?.polestarView,
              buildRegionalOutlook(buildPdfRegionalDevelopments(regionalPdfIncidents, data.issueDate, regionalTopic)),
            )
          : resolveSimpleProse(data.polestarView, aiProse?.polestarView, proseDraft.polestarView);
        if (psBody.trim()) {
          drawSectionWithProse(ctx, isRegionalWeekly ? "Polestar Outlook" : "Polestar View", psBody);
        }
      }
    }
  }

  // Related Incidents shares the preview's exact input
  // (filterTopicReportIncidents) and selector (selectRelatedIncidents) so the
  // PDF table can never disagree with the on-screen preview. Fuel renders its
  // canonical-family register inside the Fuel branch above. Cargo Watch is a
  // pattern report — it renders its own condensed appendix (one row per unique
  // incident) inside its branch above, so it omits both the Cargo Incident
  // Clusters and Related Incidents sections here.
  if (
    data.topic !== "fuel" &&
    data.topic !== "cargo_watch" &&
    !isRegionalWeekly &&
    show("related-incidents")
  ) {
    drawRelatedIncidents(
      ctx,
      filterTopicReportIncidents(incidents, data.topic, data.issueDate),
      data.topic,
      topicLabels,
      options.incidentSummaries ?? {},
    );
  }

  if (data.topic !== "fuel") {
    ensureRoomForDisclaimer(ctx);
    drawDisclaimer(ctx);
  }
  drawFooters(ctx.pdf);
  if (data.topic === "fuel") {
    const bytes = ctx.pdf.output("arraybuffer") as ArrayBuffer;
    console.info("[FUEL_PDF_TRACE] PDF BYTES CREATED", {
      byteCount: bytes.byteLength,
    });
    const blob = new Blob([bytes], { type: "application/pdf" });
    console.info("[FUEL_PDF_TRACE] BLOB CREATED", {
      byteCount: blob.size,
      type: blob.type,
    });
    const downloadName = filename.endsWith(".pdf")
      ? filename
      : `${filename}.pdf`;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = downloadName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    console.info("[FUEL_PDF_TRACE] DOWNLOAD TRIGGERED", {
      filename: downloadName,
      byteCount: blob.size,
    });
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
