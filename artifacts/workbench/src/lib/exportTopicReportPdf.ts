import { createElement } from "react";
import { format, parseISO } from "date-fns";
import JetFuelTrajectoryChart from "@/components/JetFuelTrajectoryChart";
import CargoTrendChart from "@/components/CargoTrendChart";
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
import { buildCargoReportExtras } from "./cargoReportData";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
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
import {
  capFuelMarketSeverity,
  type ProducerBuyerActionRow,
} from "./fuelNarratives";
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
  buildCargoPortBreakdown,
  type CargoCountryRow,
  type CargoPortBreakdown,
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
  const headerH = 20;
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
    total += Math.max(22, maxLines * lineH + 10);
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

  ensureSpace(ctx, headerH + 30);
  drawHeader();

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

    // Prevent row from splitting across pages - ensure space for the entire row
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
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
    pdf.text(
      "OPERATIONAL READ",
      MX + colCountryW + colPatternW + colSevW + padX,
      ctx.y + 12,
    );
    ctx.y += headerH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, headerH + 30);
  drawHeader();

  for (const r of rows) {
    const countryText = `${r.country}\n${r.count} record${r.count === 1 ? "" : "s"}`;
    const countryLines: string[] = pdf.splitTextToSize(
      sanitize(countryText),
      colCountryW - padX * 2,
    );
    const patternLines: string[] = pdf.splitTextToSize(
      sanitize(r.pattern),
      colPatternW - padX * 2,
    );
    const readLines: string[] = pdf.splitTextToSize(
      sanitize(r.operationalRead),
      colReadW - padX * 2,
    );
    const maxLines = Math.max(
      countryLines.length,
      patternLines.length,
      readLines.length,
      2,
    );
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
    pdf.text(
      readLines,
      MX + colCountryW + colPatternW + colSevW + padX,
      ctx.y + 12,
    );

    // Severity chip — coloured by the row's tier key, label may be a range.
    const sk = sevKey(r.severityKey);
    const sevColor = SEV_COLOR[sk] ?? "#999999";
    const chipX = MX + colCountryW + colPatternW + padX;
    const chipW = colSevW - padX * 2;
    setFill(pdf, sevColor);
    pdf.rect(chipX, ctx.y + 5, chipW, 12, "F");
    // Every tier (incl. petrol-blue Insignificant) uses white chip text.
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    pdf.text(
      sanitize(r.severityLabel.toUpperCase()),
      chipX + chipW / 2,
      ctx.y + 13,
      {
        align: "center",
      },
    );
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);

    ctx.y += rh;
  }
  ctx.y += 8;
}

// Named Port Breakdown table for the Cargo Watch report. Mirrors
// drawCargoCountryTable but the first column is the port (with a "country ·
// N records" subline) and the widths match CargoPortTable in ReportPreview so
// the screen preview and this PDF never disagree. Always renders: an empty set
// draws "Not reported." and the coverage caption (which carries the only count,
// keeping the narrative free of parenthetical record annotations).
function drawCargoPortTable(ctx: Ctx, breakdown: CargoPortBreakdown) {
  const { pdf, MX, CW } = ctx;
  const rows = breakdown.rows;
  if (rows.length === 0) {
    ensureSpace(ctx, 26);
    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(9);
    pdf.text("Not reported.", MX, ctx.y + 11);
    ctx.y += 16;
  } else {
    const colPortW = Math.round(CW * 0.22);
    const colPatternW = Math.round(CW * 0.28);
    const colSevW = Math.round(CW * 0.16);
    const colReadW = CW - colPortW - colPatternW - colSevW;
    const headerH = 20;
    const padX = 6;
    const lineH = 11;

    const drawHeader = () => {
      setFill(pdf, NAVY);
      pdf.rect(MX, ctx.y, CW, headerH, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(8);
      pdf.text("PORT", MX + padX, ctx.y + 12);
      pdf.text("CURRENT PATTERN", MX + colPortW + padX, ctx.y + 12);
      pdf.text("SEVERITY", MX + colPortW + colPatternW + padX, ctx.y + 12);
      pdf.text(
        "OPERATIONAL READ",
        MX + colPortW + colPatternW + colSevW + padX,
        ctx.y + 12,
      );
      ctx.y += headerH;
      setRoboto(pdf, "regular");
      pdf.setFontSize(8);
    };

    ensureSpace(ctx, headerH + 30);
    drawHeader();

    for (const r of rows) {
      const portText = `${r.port}\n${r.country} \u00b7 ${r.count} record${r.count === 1 ? "" : "s"}`;
      const portLines: string[] = pdf.splitTextToSize(
        sanitize(portText),
        colPortW - padX * 2,
      );
      const patternLines: string[] = pdf.splitTextToSize(
        sanitize(r.pattern),
        colPatternW - padX * 2,
      );
      const readLines: string[] = pdf.splitTextToSize(
        sanitize(r.operationalRead),
        colReadW - padX * 2,
      );
      const maxLines = Math.max(
        portLines.length,
        patternLines.length,
        readLines.length,
        2,
      );
      const rh = Math.max(28, maxLines * lineH + 10);

      if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
        newPage(ctx);
        drawHeader();
      }

      setStroke(pdf, POLAR);
      pdf.setLineWidth(0.3);
      pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

      setText(pdf, NAVY);
      setRoboto(pdf, "bold");
      pdf.setFontSize(8);
      // First port line bold; the "country · N records" line subdued regular.
      pdf.text(portLines.slice(0, 1), MX + padX, ctx.y + 12);
      if (portLines.length > 1) {
        setText(pdf, DUSK);
        setRoboto(pdf, "regular");
        pdf.setFontSize(7);
        pdf.text(portLines.slice(1), MX + padX, ctx.y + 12 + lineH);
        pdf.setFontSize(8);
      }

      setText(pdf, DUSK);
      setRoboto(pdf, "regular");
      pdf.setFontSize(8);
      pdf.text(patternLines, MX + colPortW + padX, ctx.y + 12);
      pdf.text(
        readLines,
        MX + colPortW + colPatternW + colSevW + padX,
        ctx.y + 12,
      );

      const sk = sevKey(r.severityKey);
      const sevColor = SEV_COLOR[sk] ?? "#999999";
      const chipX = MX + colPortW + colPatternW + padX;
      const chipW = colSevW - padX * 2;
      setFill(pdf, sevColor);
      pdf.rect(chipX, ctx.y + 5, chipW, 12, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(6.5);
      pdf.text(
        sanitize(r.severityLabel.toUpperCase()),
        chipX + chipW / 2,
        ctx.y + 13,
        { align: "center" },
      );
      setRoboto(pdf, "regular");
      pdf.setFontSize(8);

      ctx.y += rh;
    }
    ctx.y += 6;
  }

  // Coverage caption — subdued, italic, mirrors the preview's caption line.
  ensureSpace(ctx, 16);
  setText(pdf, DUSK);
  setRoboto(pdf, "italic");
  pdf.setFontSize(7.5);
  pdf.text(sanitize(breakdown.coverageLabel), MX, ctx.y + 8);
  setRoboto(pdf, "regular");
  ctx.y += 16;
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

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
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
    if (
      !fuelData.validation.hasRequiredFuelWatchData &&
      !options.allowMissingMarketData
    ) {
      throw new FuelRequiredDataMissingError(
        fuelData.validation.missingRequired,
      );
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
      const kpis: KpiCardData[] =
        fuelData.marketData.fastFactsCards.map(toRenderableCard);
      drawFastFactsKpiCards(ctx, kpis);
      for (const w of fuelData.validation.warnings) renderProse(ctx, w);
    }

    // Jet Fuel Price Trajectory — rasterise the same React chart the preview
    // uses so chart styling cannot drift from a hand-ported jsPDF replica.
    drawSectionHeading(ctx, "Jet Fuel Price Trajectory");
    ensureSpace(ctx, 220);
    await embedReactChartInPdf(
      ctx,
      createElement(JetFuelTrajectoryChart, {
        data:
          fuelData.marketData.jetFuelTrajectory.length >= 2
            ? fuelData.marketData.jetFuelTrajectory
            : null,
        benchmarkLabel: fuelData.marketData.jetFuelBenchmarkLabel,
      }),
    );

    // Ordered Fuel Watch sections. Auto-derived sections (Market Read,
    // Operational Read, Regional Highlights, Producer and Buyer Actions)
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

    renderProseSection("Market Read", fuelData.marketData.marketRead);
    renderProseSection("Situation", data.situation);
    renderProseSection("What Happened", data.whatHappened);
    renderProseSection(
      "Operational Read",
      fuelData.incidentData.operationalRead,
    );
    renderProseSection(
      "Regional Highlights",
      fuelData.incidentData.regionalHighlights,
    );
    if (fuelData.incidentData.producerBuyerActions.length > 0) {
      // Guard against an orphaned section heading: if there isn't room
      // for the heading + table header + a couple of rows, push the
      // whole block to the next page before drawing the heading.
      ensureSpace(ctx, 24 + 18 + 60);
      drawSectionHeading(ctx, "Producer and Buyer Actions");
      drawProducerBuyerActionsTable(
        ctx,
        fuelData.incidentData.producerBuyerActions,
      );
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
    const pickProse = (
      editor: string | null | undefined,
      auto: string,
    ): string => {
      const t = (editor ?? "").trim();
      return t.length > 0 ? t : auto;
    };

    if (isCargo) {
      const cargoTrendSource = filterTopicReportIncidents(
        incidents,
        data.topic,
        data.issueDate,
      ).map((i) => ({
        title: i.title,
        summary: i.summary ?? null,
        source: i.source ?? null,
        location: i.location ?? null,
        country: i.country ?? null,
        occurredAt: i.occurredAt,
      }));
      const cargoExtras = buildCargoReportExtras(cargoTrendSource);
      if (cargoExtras.trend.length >= 2) {
        drawSectionHeading(ctx, "Cargo Theft Trend");
        ensureSpace(ctx, 220);
        await embedReactChartInPdf(
          ctx,
          createElement(CargoTrendChart, { data: cargoExtras.trend }),
        );
      }

      const cargoSecurity = buildCargoSecurityRead(windowIncidents);
      const cargoNode = buildLogisticsHubRead(windowIncidents);
      // Cargo Security Read + Logistics Hub Read lead the analysis, in the same
      // order the on-screen preview renders them.
      for (const [label, body] of [
        ["Cargo Security Read", cargoSecurity],
        ["Logistics Hub Read", cargoNode],
      ] as [string, string][]) {
        if (body && body.trim()) drawSectionWithProse(ctx, label, body);
      }

      // Country Risk Breakdown table + Regional Read, then the Named Port
      // Breakdown — mirrors ReportPreview's cargo section order (between the
      // Logistics Hub Read and the Situation) so screen and PDF never disagree.
      const cargoCountry = buildCargoCountryBreakdown(windowIncidents);
      if (cargoCountry.rows.length > 0) {
        ensureSpace(ctx, 24 + 20 + 56);
        drawSectionHeading(ctx, "Country Risk Breakdown");
        drawCargoCountryTable(ctx, cargoCountry.rows);
        if (cargoCountry.regionalRead && cargoCountry.regionalRead.trim()) {
          drawSectionWithProse(ctx, "Regional Read", cargoCountry.regionalRead);
        }
      }
      const cargoPorts = buildCargoPortBreakdown(windowIncidents);
      ensureSpace(ctx, 24 + 20 + 40);
      drawSectionHeading(ctx, "Named Port Breakdown");
      drawCargoPortTable(ctx, cargoPorts);

      // Editor text always wins on the standard analyst sections; auto-prose
      // fills in when the editor leaves a field blank so the cargo report reads
      // at Fuel-Watch substance out of the box.
      const proseSections: [string, string][] = [
        [
          "Situation",
          pickProse(data.situation, buildCargoSituation(windowIncidents)),
        ],
        [
          "What Happened",
          pickProse(data.whatHappened, buildCargoWhatHappened(windowIncidents)),
        ],
        [
          "What Matters",
          pickProse(data.whatMatters, buildCargoWhatMatters(windowIncidents)),
        ],
      ];
      for (const [label, body] of proseSections) {
        if (body && body.trim()) drawSectionWithProse(ctx, label, body);
      }
      const implBody = pickProse(
        data.implications,
        buildCargoImplications(windowIncidents),
      );
      if (implBody && implBody.trim())
        drawBulletSection(ctx, "Implications for Business", implBody);
      const wnBody = pickProse(
        data.watchNext,
        buildCargoWatchNext(windowIncidents),
      );
      if (wnBody && wnBody.trim())
        drawBulletSection(ctx, "Watch Next", wnBody, 8);
      const psBody = pickProse(
        data.polestarView,
        buildCargoPolestarView(windowIncidents),
      );
      if (psBody && psBody.trim())
        drawSectionWithProse(ctx, "Polestar View", psBody);
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

  // Related Incidents shares the preview's exact input
  // (filterTopicReportIncidents) and selector (selectRelatedIncidents) so the
  // PDF table can never disagree with the on-screen preview. Fuel uses a
  // bespoke price-led layout that intentionally carries no related table, so
  // the PDF omits it here too (matching the fuel preview branch).
  if (data.topic !== "fuel") {
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
