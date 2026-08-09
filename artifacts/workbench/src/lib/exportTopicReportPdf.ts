import { createElement } from "react";
import { format, parseISO } from "date-fns";
import JetFuelTrajectoryChart from "@/components/JetFuelTrajectoryChart";
import { MarketPricesReportGrid, MARKET_PRICES_REPORT_EMPTY_TEXT } from "@/components/MarketPrices";
import type { MarketPrice } from "@workspace/api-client-react";
import CargoTrendChart from "@/components/CargoTrendChart";
import CargoChoroplethStatic from "@/components/CargoChoroplethStatic";
import CargoSupplyChainExposure from "@/components/CargoSupplyChainExposure";
import CargoPatternDashboard from "@/components/CargoPatternDashboard";
import CargoActivityMatrix from "@/components/CargoActivityMatrix";
import {
  buildCargoPatternModel,
  type CargoAppendixRow,
} from "./cargoPatternModel";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  renderProse,
  drawSectionWithProse,
  drawFastFactsKpiCards,
  drawBulletSection,
  drawDisclaimer,
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
import { embedReactChartInPdf } from "./embedReportChartInPdf";
import {
  resolveReportWindow,
  filterIncidentsToWindow,
  reportCadence,
} from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { resolveIncidentSummary } from "./incidentSummary";
import { selectRelatedIncidents } from "./relatedIncidents";
// Per-topic cover photography is registered in coverImages.ts so the
// on-screen ReportPreview and this exporter share one source of truth.
import { TOPIC_COVER_URLS } from "./coverImages";
import { isTopicRelevant } from "./topicRelevance";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import {
  makeSectionGate,
  applyFastFactOverrides,
  applyMarketPriceOverrides,
  applyGulfBulletOverrides,
  applyMarketOperatorOverrides,
  resolvePanelRead,
  PANEL_READ_GULF_HORMUZ,
  type TopicSectionOverrides,
} from "./topicSectionOverrides";
import {
  resolveSimpleProse,
  stableDraftTopicReportProse,
  toDraftableIncidents,
  type TopicAiProse,
} from "./topicProseResolution";
// Single source of truth for the Fast Facts cards so the on-screen
// preview and this PDF exporter cannot drift.
import {
  computeTopicFastFacts,
  filterTopicReportIncidents,
} from "./topicFastFacts";
import {
  buildFuelWatchReportData,
  fuelMarketLatestDate,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "./fuelWatchReport";
import { assertFuelReportConsistent } from "./fuelCanonicalFacts";
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
   *  tiles, panel reads (gulf-hormuz) and Market Prices rows. Applied here in
   *  lockstep with the on-screen preview so preview == PDF. */
  sectionOverrides?: TopicSectionOverrides | null;
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
      sanitize(i.title),
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
    setFill(pdf, SEV_COLOR[sevKeyStr] ?? "#999999");
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
  const win = resolveReportWindow(data.topic, data.issueDate);
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
  const isFuel = data.topic === "fuel";
  // Canonical Fuel Watch payload — shared by preview/PDF/editor. Its Gulf &
  // Hormuz Chokepoint Watch is a bounded canonical subset, so it cannot
  // introduce records outside the report's qualifying incident total.
  // Fuel Watch is market-anchored: the effective report date is the latest
  // market close it carries (falling back to the stored issue date), exactly
  // as the on-screen preview computes it — so the canonical facts, the
  // incident window and the consistency gate are IDENTICAL in preview and PDF.
  const fuelIssueDate = isFuel
    ? (fuelMarketLatestDate(data.hardNumbers) ?? data.issueDate)
    : data.issueDate;
  const fuelData = isFuel
    ? buildFuelWatchReportData(
        {
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
      )
    : null;
  // Resolve the only editable Fuel narrative before validation. The section's
  // generated count still comes from the canonical qualifying set; if an
  // otherwise-current override claims a larger count, the gate below blocks
  // export rather than allowing a contradictory statement into the PDF.
  const renderedFuelGulfRead = fuelData?.incidentData.gulfChokepointWatch
    ? resolvePanelRead(
        options.sectionOverrides,
        PANEL_READ_GULF_HORMUZ,
        fuelData.incidentData.gulfChokepointWatch.read,
      ).text
    : undefined;
  // Pre-render Fuel Watch consistency gate. This runs after all canonical facts
  // exist and before the first report section is drawn; it is never bypassed by
  // analyst/AI prose or export override flags.
  if (fuelData) {
    assertFuelReportConsistent(fuelData.canonicalFacts, {
      ...fuelData.narrativeData.canonicalSections,
      gulfAndHormuzChokepointWatch: renderedFuelGulfRead,
    });
  }
  // Deterministic per-topic draft — the labelled fallback beneath the AI
  // narrative and any analyst edit. Built from the SAME windowed incident
  // set the on-screen preview uses so screen and PDF agree.
  const proseDraft = stableDraftTopicReportProse({
    topic: data.topic,
    issueDate: data.issueDate,
    incidents: toDraftableIncidents(
      filterTopicReportIncidents(incidents, data.topic, data.issueDate),
    ),
    fuelGulf: fuelData?.incidentData.gulfChokepointWatch ?? null,
  });

  const isCargo = data.topic === "cargo_watch";
  // Hoisted narrative-incident list shared by buildCargoPatternModel and the
  // three read builders so all derive from the exact same filtered window.
  const cargoNarrativeIncidents = isCargo
    ? filterTopicReportIncidents(incidents, data.topic, data.issueDate).map(
        (i) => ({
          id: i.id,
          topic: i.topic,
          title: i.title,
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
    fuelData
      ? fuelData.narrativeData.canonicalSections.executiveSummary
      : isCargo && cargoModel
        ? resolveSimpleProse(data.executiveSummary, null, cargoModel.executiveSummary)
        : resolveSimpleProse(
            data.executiveSummary,
            aiProse?.executiveSummary,
            proseDraft.executiveSummary,
          );
  if (show("executive-summary") && execText.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, execText);
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
  if (isFuel && fuelData) {
    // Fail closed: refuse to export a polished but hollow report unless
    // the caller explicitly opted in via options.allowMissingMarketData.
    if (
      !fuelData.validation.hasRequiredFuelWatchData &&
      !options.allowMissingMarketData
    ) {
      throw new FuelRequiredDataMissingError(
        fuelData.validation.missingRequired,
      );
    }

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

    if (show("market-read")) {
      renderProseSection(
        "Market Read",
        fuelData.narrativeData.canonicalSections.marketRead,
      );
    }
    if (show("situation")) {
      renderProseSection(
        "Situation",
        fuelData.narrativeData.canonicalSections.situation,
      );
    }
    if (show("what-happened")) {
      renderProseSection(
        "What Happened",
        fuelData.narrativeData.canonicalSections.whatHappened,
      );
    }
    if (show("operational-read")) {
      renderProseSection(
        "Operational Read",
        fuelData.narrativeData.canonicalSections.operationalRead,
      );
    }
    if (show("regional-highlights")) {
      renderProseSection(
        "Regional Highlights",
        fuelData.narrativeData.canonicalSections.regionalHighlights,
      );
    }
    // Gulf and Hormuz Chokepoint Watch — heading + prose (atomic) then the
    // dated anchor lines as bullets. Mirrors the on-screen preview exactly, so
    // screen == in-app PDF.
    if (show("gulf-hormuz") && fuelData.incidentData.gulfChokepointWatch) {
      const gulf = fuelData.incidentData.gulfChokepointWatch;
      // Owner per-bullet overrides (rewrite/suppress; blank = auto) — the
      // SAME applyGulfBulletOverrides call the preview uses, so screen == PDF.
      const gbOverrides = options.sectionOverrides?.gulfBulletOverrides;
      const currentLines = applyGulfBulletOverrides(gulf.currentItemLines, gbOverrides);
      const standingLines = applyGulfBulletOverrides(gulf.standingItemLines, gbOverrides);
      // Staleness-guarded override: a saved panel read applies only while the
      // generated read still equals the baseline it was written against, so a
      // frozen week-old paragraph can never outrank this week's reporting.
      drawSectionWithProse(
        ctx,
        "Gulf and Hormuz Chokepoint Watch",
        renderedFuelGulfRead ?? gulf.read,
      );
      if (currentLines.length > 0) {
        renderProse(ctx, currentLines.map((l) => `\u2022  ${l}`).join("\n"));
      }
      if (gulf.standingNote && standingLines.length > 0) {
        renderProse(ctx, gulf.standingNote);
        renderProse(ctx, standingLines.map((l) => `\u2022  ${l}`).join("\n"));
      }
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
      renderProseSection(
        "What Matters",
        fuelData.narrativeData.canonicalSections.whatMatters,
      );
    }
    // Render from the canonical fuel narrative payload (analyst edit -> AI ->
    // deterministic top-up), identical to the on-screen preview, so screen ==
    // in-app PDF for these two bullet sections.
    if (show("implications")) {
      drawBulletSection(
        ctx,
        "Implications for Business",
        fuelData.narrativeData.implications ?? "",
      );
    }
    if (show("watch-next")) {
      drawBulletSection(
        ctx,
        "Watch Next",
        fuelData.narrativeData.watchNext ?? "",
        8,
      );
    }
    if (show("polestar-view")) {
      renderProseSection(
        "Polestar View",
        fuelData.narrativeData.canonicalSections.polestarView,
      );
    }
  } else {
    // isCargo + cargoModel are hoisted above the Executive Summary so it can
    // read the model's deterministic executive summary.
    if (show("fast-facts")) {
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
        await embedReactChartInPdf(
          ctx,
          createElement(CargoChoroplethStatic, {
            intensity: cargoModel.intensity,
            title: cargoModel.mapTitle,
          }),
          { heading: cargoModel.mapTitle },
        );
        if (cargoModel.mapCaption.trim()) renderProse(ctx, cargoModel.mapCaption);
      }

      // Weekly trend AND activity table combined under ONE heading (spec pt6) so
      // the PDF does not spend two near-duplicate pages on the same dataset.
      if (show("weekly-trend") && (cargoModel.extras.trend.length >= 2 || cargoModel.activity.total > 0)) {
        if (cargoModel.extras.trend.length >= 2) {
          await embedReactChartInPdf(
            ctx,
            createElement(CargoTrendChart, { data: cargoModel.extras.trend }),
            { heading: "Weekly Trend and Activity" },
          );
          if (cargoModel.trendCaption.trim())
            renderProse(ctx, cargoModel.trendCaption);
          if (cargoModel.activity.total > 0) {
            await embedReactChartInPdf(
              ctx,
              createElement(CargoActivityMatrix, {
                activity: cargoModel.activity,
              }),
            );
          }
        } else if (cargoModel.activity.total > 0) {
          // No trend line (too few periods) — the activity matrix carries its own
          // internal title, so give it the combined section heading.
          await embedReactChartInPdf(
            ctx,
            createElement(CargoActivityMatrix, {
              activity: cargoModel.activity,
            }),
            { heading: "Weekly Trend and Activity" },
          );
        }
      }

      // Operational pattern graphics — supply-chain exposure and the pattern
      // dashboard. Each is the SAME React component the preview renders,
      // rasterised here, and each answers a DIFFERENT analytical question
      // (spec pt6). They carry their OWN internal GraphicFrame titles, and the
      // preview renders them WITHOUT an external section heading — so no external
      // drawSectionHeading here either (avoids double-titling, keeps preview==PDF).
      if (cargoModel.totalUnique > 0) {
        await embedReactChartInPdf(
          ctx,
          createElement(CargoSupplyChainExposure, {
            stages: cargoModel.stages,
            total: cargoModel.totalUnique,
          }),
        );

        await embedReactChartInPdf(
          ctx,
          createElement(CargoPatternDashboard, {
            patterns: cargoModel.patterns,
          }),
        );
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
    } else {
      const proseSections: [string, string, string][] = [
        [
          "situation",
          "Situation",
          resolveSimpleProse(data.situation, aiProse?.situation, proseDraft.situation),
        ],
        [
          "what-happened",
          "What Happened",
          resolveSimpleProse(
            data.whatHappened,
            aiProse?.whatHappened,
            proseDraft.whatHappened,
          ),
        ],
        [
          "what-matters",
          "What Matters",
          resolveSimpleProse(
            data.whatMatters,
            aiProse?.whatMatters,
            proseDraft.whatMatters,
          ),
        ],
      ];
      for (const [key, label, body] of proseSections) {
        if (show(key) && body && body.trim()) drawSectionWithProse(ctx, label, body);
      }
      if (show("implications")) {
        const implBody = resolveSimpleProse(
          data.implications,
          aiProse?.implications,
          proseDraft.implications,
        );
        if (implBody.trim()) {
          drawBulletSection(ctx, "Implications for Business", implBody);
        }
      }
      if (show("watch-next")) {
        const wnBody = resolveSimpleProse(
          data.watchNext,
          aiProse?.watchNext,
          proseDraft.watchNext,
        );
        if (wnBody.trim()) {
          drawBulletSection(ctx, "Watch Next", wnBody, 8);
        }
      }
      if (show("polestar-view")) {
        const psBody = resolveSimpleProse(
          data.polestarView,
          aiProse?.polestarView,
          proseDraft.polestarView,
        );
        if (psBody.trim()) {
          drawSectionWithProse(ctx, "Polestar View", psBody);
        }
      }
    }
  }

  // Related Incidents shares the preview's exact input
  // (filterTopicReportIncidents) and selector (selectRelatedIncidents) so the
  // PDF table can never disagree with the on-screen preview. Fuel uses a
  // bespoke price-led layout that intentionally carries no related table, so
  // the PDF omits it here too (matching the fuel preview branch). Cargo Watch
  // is a pattern report — it renders its own condensed appendix (one row per
  // unique incident) inside its branch above, so it omits both the Cargo
  // Incident Clusters and Related Incidents sections here.
  if (
    data.topic !== "fuel" &&
    data.topic !== "cargo_watch" &&
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

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
