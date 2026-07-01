import { format, parseISO } from "date-fns";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  renderProse,
  drawSectionWithProse,
  drawFastFactsKpiCards,
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
  todayLabel,
  setRoboto,
  ensureRobotoLoaded,
  NAVY,
  ELECTRIC,
  POLAR,
  DUSK,
  WHITE,
  SEV_COLOR,
  SEV_LABEL,
  sevKey,
  type Ctx,
  type KpiCardData,
} from "./pdfChrome";
import { COUNTRY_COVER_URLS } from "./coverImages";
import { relatedIncidentsLimit } from "./reportWindow";
import { reportKindLabel } from "./reportKind";
import { classifyIncidentType } from "./incidentClassifier";
import {
  computeCountryFastFacts,
  COUNTRY_WINDOW_TOPIC,
  type CountryFastFactsIncident,
  type CountryFactsBreakdown,
} from "./countryFastFacts";
import type { CountryBaseline } from "./countryBaselines";
import {
  buildCountryLayers,
  resolveActiveCountryWindow,
  resolvePreviousCountryWindow,
  type WatchlistRow,
  type CountryCoverageStatus,
} from "./countryReportLayers";
import { buildSituationalContext } from "./situationalContext";
import { drawSituationalContextPdf } from "./situationalContextPdf";
import {
  buildJakartaCorridorStatuses,
  hazardSummaryLabel,
  type JakartaCorridorStatus,
} from "./jakartaCorridors";
import {
  buildJakartaReportDataset,
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  buildIndonesiaReportDataset,
  type PngReportDataset,
  type PngReportItem,
  type PngSourceIncident,
} from "./pngReportDataset";
import {
  buildCountryIncidentThemes,
  buildOperationalImpactBullets,
} from "./countryIncidentThemes";
import { acceptedCountryTokens } from "./countryMatch";
import type {
  JakartaTableRow,
  JakartaPriorityAreaRow,
  JakartaPortLogisticsRow,
  JakartaStaffMovementImpact,
  JakartaRoleAction,
  JakartaCrimeBusinessRow,
} from "./jakartaBrief";
import type { ReliefWebReport } from "@workspace/api-client-react";

export interface PdfIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  keyNumbers?:
    | { label: string; value: string; context?: string | null }[]
    | null;
}

export interface CountryPdfExtras {
  /** Auto-derived executive summary prose (natural, no banned openers). */
  executiveSummary?: string;
  /** Auto-derived "What Matters" prose. */
  whatMatters?: string;
  /** Optional "Watch Next" prose; rendered only if provided and non-empty. */
  watchNext?: string;
  /** Optional "Polestar View" prose; rendered only if provided and non-empty. */
  polestarView?: string;
  /** Supporting UN OCHA ReliefWeb situational reports. Rendered as a context
   *  layer (never counted as incidents); the section is skipped when empty. */
  situationalReports?: ReliefWebReport[] | null;
  /** PNG data-URL of the rendered preview map. Optional. */
  mapImage?: string;
  /** Curated country baseline (operating environment, security context,
   *  risk areas, key cities, infrastructure, medical / evac, resource
   *  exposure). When absent the baseline section is skipped. */
  baseline?: CountryBaseline | null;
  /** Watchlist breakdown — per-location 7d / 30d / 90d counts plus the
   *  worst severity observed across the 90-day lookback. Empty when
   *  no baseline is curated. */
  watchlist?: WatchlistRow[];
  /** Client-safe 30-day and 90-day context paragraphs. */
  lookback?: { thirtyDay: string; ninetyDay: string };
  /** Bucket sizes so the PDF can word the map caption honestly. */
  layerCounts?: { current: number; thirtyDay: number; ninetyDay: number };
  /** Coverage status for an empty weekly window. Rendered as a banner just
   *  below the data-as-of strip, mirroring the on-screen report. */
  coverage?: CountryCoverageStatus;
}

const SEV_ORDER = [
  "extreme",
  "high",
  "moderate",
  "low",
  "insignificant",
] as const;

function drawSeverityChart(ctx: Ctx, facts: CountryFactsBreakdown) {
  const total = SEV_ORDER.reduce((s, k) => s + facts.severityCounts[k], 0);
  const rowH = 18;
  const chartH = SEV_ORDER.length * rowH + 10;
  ensureSpace(ctx, 32 + (total === 0 ? 34 : chartH));
  drawSectionHeading(ctx, "Severity Distribution");
  if (total === 0) {
    renderProse(ctx, "No incidents reported this week to chart.");
    return;
  }
  const { pdf, MX, CW } = ctx;
  const labelW = 110;
  const countW = 36;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - countW - 8;

  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  SEV_ORDER.forEach((k, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(sanitize(SEV_LABEL[k] ?? k), MX, ry + 12);
    const n = facts.severityCounts[k];
    const w = total === 0 ? 0 : (n / total) * barAreaW;
    setFill(pdf, SEV_COLOR[k] ?? POLAR);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(String(n), barAreaX + barAreaW + 6, ry + 12);
    setRoboto(pdf, "regular");
  });
  ctx.y += chartH + 18;
}

function drawTypeChart(ctx: Ctx, facts: CountryFactsBreakdown) {
  const data = Array.from(facts.typeCounts.entries())
    .map(([type, n]) => ({ label: type, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const rowH = 18;
  const chartH = data.length * rowH + 10;
  ensureSpace(ctx, 32 + (data.length === 0 ? 34 : chartH));
  drawSectionHeading(ctx, "Incident Breakdown by Type");
  if (data.length === 0) {
    renderProse(ctx, "No incident types reported this week.");
    return;
  }
  const max = Math.max(...data.map((d) => d.n));
  const { pdf, MX, CW } = ctx;
  const labelW = 160;
  const countW = 36;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - countW - 8;

  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  data.forEach((d, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(sanitize(d.label), MX, ry + 12);
    const w = max === 0 ? 0 : (d.n / max) * barAreaW;
    setFill(pdf, ELECTRIC);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(String(d.n), barAreaX + barAreaW + 6, ry + 12);
    setRoboto(pdf, "regular");
  });
  ctx.y += chartH + 18;
}

// Jakarta corridor & access exposure table — the headless counterpart to the
// on-screen JakartaCorridorMap detail table, so the map section stays consistent
// with what the screen shows when no rasterised graphic is supplied.
function drawJakartaExposureTable(ctx: Ctx, statuses: JakartaCorridorStatus[]) {
  const { pdf, MX, CW } = ctx;
  const colAreaW = 150;
  const colExpW = 120;
  const restW = CW - colAreaW - colExpW;
  const colRelW = Math.round(restW / 2);
  const colActW = restW - colRelW;
  const rowH = 20;

  const header = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("AREA", MX + 6, ctx.y + 13);
    pdf.text("MAIN EXPOSURE", MX + colAreaW + 6, ctx.y + 13);
    pdf.text("OPERATIONAL RELEVANCE", MX + colAreaW + colExpW + 6, ctx.y + 13);
    pdf.text("ACTION", MX + colAreaW + colExpW + colRelW + 6, ctx.y + 13);
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 3);
  header();

  for (const s of statuses) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);
    const areaLines: string[] = pdf.splitTextToSize(
      sanitize(`${s.number}. ${s.area.name}`),
      colAreaW - 8,
    );
    const expLines: string[] = pdf.splitTextToSize(sanitize(hazardSummaryLabel(s)), colExpW - 8);
    const relLines: string[] = pdf.splitTextToSize(sanitize(s.relevance), colRelW - 8);
    const actLines: string[] = pdf.splitTextToSize(sanitize(s.action), colActW - 8);
    const statusLabel = s.elevated
      ? `Elevated · ${(SEV_LABEL[s.worstKey] ?? s.worstKey).toUpperCase()}`
      : "Monitored";
    const rh = Math.max(
      rowH,
      areaLines.length * 12 + 22,
      expLines.length * 12 + 10,
      relLines.length * 12 + 10,
      actLines.length * 12 + 10,
    );
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      header();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(areaLines, MX + 6, ctx.y + 14, textOpts);
    const statusColor = s.elevated ? SEV_COLOR[s.worstKey] ?? "#999999" : DUSK;
    setText(pdf, statusColor);
    pdf.setFontSize(6.5);
    pdf.text(
      sanitize(statusLabel.toUpperCase()),
      MX + 6,
      ctx.y + 14 + areaLines.length * 12 + 4,
    );
    pdf.setFontSize(8.5);

    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.text(expLines, MX + colAreaW + 6, ctx.y + 14, textOpts);
    pdf.text(relLines, MX + colAreaW + colExpW + 6, ctx.y + 14, textOpts);
    pdf.text(actLines, MX + colAreaW + colExpW + colRelW + 6, ctx.y + 14, textOpts);

    ctx.y += rh;
  }
  ctx.y += 4;
}

function drawMapSection(
  ctx: Ctx,
  opts: {
    mapImage?: string;
    plottedCount: number;
    totalInWindow: number;
    basisShort: string;
    jakartaExposure?: JakartaCorridorStatus[];
  },
) {
  ensureSpace(ctx, opts.mapImage ? 192 : 88);
  drawSectionHeading(ctx, "Map");
  const { pdf, MX, CW } = ctx;
  if (opts.mapImage) {
    try {
      const targetW = CW;
      // Estimate the image's aspect ratio from the dataURL by drawing into
      // a probe image element is not available in jsPDF here, so we fall
      // back to the on-screen ratio used in the preview (1400×360 area).
      const aspect = 360 / 1400;
      const imgH = Math.min(targetW * aspect, 280);
      ensureSpace(ctx, imgH + 12);
      pdf.addImage(
        opts.mapImage,
        "PNG",
        MX,
        ctx.y,
        targetW,
        imgH,
        undefined,
        "FAST",
      );
      ctx.y += imgH + 6;
    } catch (err) {
      console.warn("[exportCountryReportPdf] embedding map image failed", err);
    }
  } else if (opts.jakartaExposure && opts.jakartaExposure.length > 0) {
    drawJakartaExposureTable(ctx, opts.jakartaExposure);
  } else {
    renderProse(
      ctx,
      "The interactive incident map is available in the Workbench preview. Records without coordinates are included in totals and tables but cannot be plotted.",
    );
  }
  ensureSpace(ctx, 16);
  setRoboto(pdf, "italic");
  pdf.setFontSize(8);
  setText(pdf, DUSK);
  const note =
    opts.totalInWindow === 0
      ? `No records in the ${opts.basisShort} window to plot.`
      : opts.plottedCount === opts.totalInWindow
        ? `All ${opts.plottedCount} record${opts.plottedCount === 1 ? "" : "s"} in the ${opts.basisShort} window are plotted.`
        : `${opts.plottedCount} of ${opts.totalInWindow} record${opts.totalInWindow === 1 ? "" : "s"} plotted; records without coordinates are excluded from the map.`;
  pdf.text(sanitize(note), MX, ctx.y + 10);
  setRoboto(pdf, "regular");
  ctx.y += 18;
}

function drawIncidentTable(ctx: Ctx, incidents: PdfIncident[]) {
  if (incidents.length === 0) return;
  ensureSpace(ctx, 24 + 18 + 40);
  drawSectionHeading(ctx, "Related Incidents");
  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTypeW = 120;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colTypeW - colSevW - 6;
  const rowH = 20;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("DATE", MX + 6, ctx.y + 13);
    pdf.text("TYPE", MX + colDateW + 6, ctx.y + 13);
    pdf.text("TITLE", MX + colDateW + colTypeW + 6, ctx.y + 13);
    pdf.text("SEVERITY", MX + colDateW + colTypeW + colTitleW + 6, ctx.y + 13);
    ctx.y += rowH;
  };

  const sorted = [...incidents].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const { max: ROW_MAX } = relatedIncidentsLimit(COUNTRY_WINDOW_TOPIC);
  const rows = sorted.slice(0, ROW_MAX);
  const truncated = sorted.length - rows.length;

  drawHeader();

  for (const i of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const titleLines: string[] = pdf.splitTextToSize(
      sanitize(i.title),
      colTitleW - 8,
    );
    const rh = Math.max(rowH, titleLines.length * 12 + 10);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.4 };
    let dateStr = "";
    try {
      dateStr = format(parseISO(i.occurredAt), "dd MMM yyyy");
    } catch {
      dateStr = i.occurredAt;
    }
    pdf.text(dateStr, MX + 6, ctx.y + 14, textOpts);
    const incidentType = classifyIncidentType(i);
    const typeLines: string[] = pdf.splitTextToSize(
      sanitize(incidentType),
      colTypeW - 8,
    );
    pdf.text(typeLines, MX + colDateW + 6, ctx.y + 14, textOpts);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colTypeW + 6, ctx.y + 14, textOpts);

    const sk = sevKey(i.severity);
    const sevColor = SEV_COLOR[sk] ?? "#999999";
    setFill(pdf, sevColor);
    const chipX = MX + colDateW + colTypeW + colTitleW + 6;
    pdf.rect(chipX, ctx.y + 4, 56, 12, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    const sevDisplay = SEV_LABEL[sk] ?? i.severity ?? "";
    pdf.text(sanitize(sevDisplay.toUpperCase()), chipX + 28, ctx.y + 12.5, {
      align: "center",
    });

    ctx.y += rh;
  }
  ctx.y += 8;

  // Client-facing reports intentionally omit the "Showing N latest of M"
  // notice. The table cap is internal Workbench logic.
  void truncated;
  void sorted;
}

function drawBaselineSection(ctx: Ctx, baseline: CountryBaseline) {
  drawSectionHeading(ctx, "Country Baseline");
  const labelled = (label: string, text: string) => {
    ensureSpace(ctx, 28);
    const { pdf, MX, CW } = ctx;
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    setText(pdf, NAVY);
    pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 9);
    ctx.y += 12;
    setRoboto(pdf, "regular");
    pdf.setFontSize(10);
    setText(pdf, DUSK);
    const lines: string[] = pdf.splitTextToSize(sanitize(text), CW);
    for (const line of lines) {
      ensureSpace(ctx, 13);
      pdf.text(line, ctx.MX, ctx.y + 10);
      ctx.y += 13;
    }
    ctx.y += 6;
  };
  const bullets = (label: string, items: string[]) => {
    ensureSpace(ctx, 28);
    const { pdf, MX, CW } = ctx;
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    setText(pdf, NAVY);
    pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 9);
    ctx.y += 12;
    setRoboto(pdf, "regular");
    pdf.setFontSize(10);
    setText(pdf, DUSK);
    for (const item of items) {
      const lines: string[] = pdf.splitTextToSize(
        sanitize(`• ${item}`),
        CW - 6,
      );
      for (const line of lines) {
        ensureSpace(ctx, 13);
        pdf.text(line, MX + 6, ctx.y + 10);
        ctx.y += 13;
      }
    }
    ctx.y += 6;
  };

  labelled("Operating Environment", baseline.operatingEnvironment);
  labelled("Security Context", baseline.securityContext);
  bullets("Known Risk Areas", baseline.knownRiskAreas);
  bullets("Key Cities / Provinces", baseline.keyCitiesProvinces);
  labelled("Movement Constraints", baseline.movementConstraints);
  labelled("Infrastructure Limits", baseline.infrastructureLimits);
  labelled("Medical / Evacuation", baseline.medicalEvac);
  labelled("Resource-Sector Exposure", baseline.resourceSectorExposure);
}

function drawWatchlistTable(ctx: Ctx, rows: WatchlistRow[]) {
  if (rows.length === 0) return;
  drawSectionHeading(ctx, "Location Watchlist");
  const { pdf, MX, CW } = ctx;
  const colLabelW = 130;
  const col7W = 32;
  const col30W = 32;
  const col90W = 32;
  const colSevW = 70;
  const colNoteW = CW - colLabelW - col7W - col30W - col90W - colSevW - 6;
  const rowH = 20;

  const header = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("LOCATION", MX + 6, ctx.y + 13);
    pdf.text("NOTE", MX + colLabelW + 6, ctx.y + 13);
    pdf.text("7D", MX + colLabelW + colNoteW + col7W - 4, ctx.y + 13, {
      align: "right",
    });
    pdf.text(
      "30D",
      MX + colLabelW + colNoteW + col7W + col30W - 4,
      ctx.y + 13,
      { align: "right" },
    );
    pdf.text(
      "90D",
      MX + colLabelW + colNoteW + col7W + col30W + col90W - 4,
      ctx.y + 13,
      { align: "right" },
    );
    pdf.text(
      "WORST (90D)",
      MX + colLabelW + colNoteW + col7W + col30W + col90W + 6,
      ctx.y + 13,
    );
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 3);
  header();

  for (const r of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const labelLines: string[] = pdf.splitTextToSize(
      sanitize(r.label),
      colLabelW - 8,
    );
    const noteLines: string[] = pdf.splitTextToSize(
      sanitize(r.note),
      colNoteW - 8,
    );
    const rh = Math.max(
      rowH,
      labelLines.length * 12 + 10,
      noteLines.length * 12 + 10,
    );
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      header();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(labelLines, MX + 6, ctx.y + 14, textOpts);

    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.text(noteLines, MX + colLabelW + 6, ctx.y + 14, textOpts);

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(
      String(r.currentCount),
      MX + colLabelW + colNoteW + col7W - 4,
      ctx.y + 14,
      { align: "right" },
    );
    pdf.text(
      String(r.thirtyDayCount),
      MX + colLabelW + colNoteW + col7W + col30W - 4,
      ctx.y + 14,
      { align: "right" },
    );
    pdf.text(
      String(r.ninetyDayCount),
      MX + colLabelW + colNoteW + col7W + col30W + col90W - 4,
      ctx.y + 14,
      { align: "right" },
    );
    setRoboto(pdf, "regular");

    const sk = sevKey(r.worstSeverity);
    if (r.worstSeverity) {
      const sevColor = SEV_COLOR[sk] ?? "#999999";
      setFill(pdf, sevColor);
      const chipX = MX + colLabelW + colNoteW + col7W + col30W + col90W + 6;
      pdf.rect(chipX, ctx.y + 4, 56, 12, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(6.5);
      pdf.text(
        sanitize((SEV_LABEL[sk] ?? r.worstSeverity).toUpperCase()),
        chipX + 28,
        ctx.y + 12.5,
        { align: "center" },
      );
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    } else {
      setText(pdf, DUSK);
      setRoboto(pdf, "italic");
      pdf.text(
        "No records",
        MX + colLabelW + colNoteW + col7W + col30W + col90W + 6,
        ctx.y + 14,
        textOpts,
      );
      setRoboto(pdf, "regular");
    }

    ctx.y += rh;
  }
  ctx.y += 8;
}

function drawNarrative(
  ctx: Ctx,
  heading: string,
  body: string | null | undefined,
  fallback?: string,
) {
  const trimmed = (body ?? "").trim();
  const text = trimmed || (fallback ?? "");
  // Keep the heading with its first paragraph so country sections never
  // orphan at the bottom of a PDF page.
  drawSectionWithProse(ctx, heading, text || "Not populated for this report.");
}

// Coverage banner — mirrors the on-screen printable banner (POLAR border
// with an ELECTRIC left accent, NAVY title, DUSK body). No red: subdued red
// is reserved for the Extreme severity tier only.
function drawCoverageBanner(ctx: Ctx, coverage: CountryCoverageStatus) {
  if (!coverage.showBanner) return;
  const { pdf, MX, W } = ctx;
  const padX = 8;
  const innerW = W - MX * 2 - padX * 2;
  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  const lines = pdf.splitTextToSize(
    sanitize(coverage.detail),
    innerW,
  ) as string[];
  const boxH = 12 + 4 + lines.length * 11 + 8;
  ensureSpace(ctx, boxH + 8);
  const top = ctx.y;
  setFill(pdf, WHITE);
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.5);
  pdf.rect(MX, top, W - MX * 2, boxH, "FD");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX, top, 3, boxH, "F");
  setRoboto(pdf, "bold");
  pdf.setFontSize(8);
  setText(pdf, NAVY);
  pdf.text(sanitize(coverage.title.toUpperCase()), MX + padX, top + 11);
  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  setText(pdf, DUSK);
  pdf.text(lines, MX + padX, top + 24);
  setRoboto(pdf, "regular");
  ctx.y = top + boxH + 10;
}

// --- Jakarta tactical-brief renderers --------------------------------------
// The Jakarta city report carries its OWN 14-section structure (mirrors the
// on-screen JakartaReportBody). These headless renderers reuse the same
// jakartaBrief.ts builders the screen uses, so the script-generated PDF and the
// on-screen DOM-rasterised PDF stay in lockstep. Reached for Jakarta only;
// every other theatre keeps the generic country layout below.

function jakartaDateLine(item: PngReportItem): string {
  const reported = format(item.reportedDate, "dd MMM yyyy");
  if (item.occurredEarlier && item.incidentDate) {
    return `Occurred ${format(item.incidentDate, "dd MMM")} · reported ${reported}`;
  }
  return `Reported ${reported}`;
}

// A plain count-free bullet list. Breaks at the line level so a long list never
// orphans a whole block to the next page.
function drawJakartaBulletList(ctx: Ctx, items: string[]) {
  const { pdf, MX, CW } = ctx;
  const lineH = 16;
  for (const item of items) {
    setRoboto(pdf, "light");
    pdf.setFontSize(11);
    setText(pdf, DUSK);
    const lines: string[] = pdf.splitTextToSize(sanitize(`• ${item}`), CW - 6);
    for (const ln of lines) {
      ensureSpace(ctx, lineH);
      pdf.text(ln, MX + 6, ctx.y + 11);
      ctx.y += lineH;
    }
    ctx.y += 4;
  }
  ctx.y += 6;
}

// ELECTRIC strand sub-heading (used above the port-action list).
function drawJakartaStrandLabel(ctx: Ctx, label: string) {
  ensureSpace(ctx, 22);
  const { pdf, MX } = ctx;
  setRoboto(pdf, "bold");
  pdf.setFontSize(8);
  setText(pdf, ELECTRIC);
  pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 11);
  ctx.y += 20;
}

// A standing exposure table (Area | Why it matters | Action), the headless
// counterpart to the on-screen OpsTable.
function drawJakartaOpsTable(ctx: Ctx, rows: JakartaTableRow[]) {
  const { pdf, MX, CW } = ctx;
  const colAreaW = Math.round(CW * 0.24);
  const colWhyW = Math.round(CW * 0.42);
  const colActW = CW - colAreaW - colWhyW;
  const rowH = 20;

  const header = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("AREA", MX + 6, ctx.y + 13);
    pdf.text("WHY IT MATTERS", MX + colAreaW + 6, ctx.y + 13);
    pdf.text("ACTION", MX + colAreaW + colWhyW + 6, ctx.y + 13);
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  header();

  for (const r of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);
    const areaLines: string[] = pdf.splitTextToSize(sanitize(r.area), colAreaW - 8);
    const whyLines: string[] = pdf.splitTextToSize(sanitize(r.why), colWhyW - 8);
    const actLines: string[] = pdf.splitTextToSize(sanitize(r.action), colActW - 8);
    const rh = Math.max(
      rowH,
      areaLines.length * 12 + 10,
      whyLines.length * 12 + 10,
      actLines.length * 12 + 10,
    );
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      header();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(areaLines, MX + 6, ctx.y + 14, textOpts);
    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.text(whyLines, MX + colAreaW + 6, ctx.y + 14, textOpts);
    pdf.text(actLines, MX + colAreaW + colWhyW + 6, ctx.y + 14, textOpts);

    ctx.y += rh;
  }
  ctx.y += 8;
}

// A generic count-free grid table (headed, fixed-width columns), the headless
// counterpart to the on-screen PriorityTable / PortTable. The first column is
// rendered bold-navy; widthFracs are fractions of the content width and must sum
// to ~1. `centerFirst` centres the first column (used for the priority number).
function drawJakartaGridTable(
  ctx: Ctx,
  headers: string[],
  widthFracs: number[],
  rows: string[][],
  centerFirst = false,
) {
  const { pdf, MX, CW } = ctx;
  const n = headers.length;
  const widths = widthFracs.map((f) => Math.round(CW * f));
  // Absorb rounding drift into the last column so the grid spans exactly CW.
  widths[n - 1] = CW - widths.slice(0, n - 1).reduce((a, b) => a + b, 0);
  const xs: number[] = [];
  let acc = MX;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }
  const rowH = 20;

  const header = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    headers.forEach((h, i) => {
      const center = centerFirst && i === 0;
      pdf.text(
        sanitize(h.toUpperCase()),
        center ? xs[i] + widths[i] / 2 : xs[i] + 6,
        ctx.y + 13,
        center ? { align: "center" } : undefined,
      );
    });
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  header();

  for (const r of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);
    const cellLines = r.map((c, i) => pdf.splitTextToSize(sanitize(c), widths[i] - 8) as string[]);
    const rh = Math.max(rowH, ...cellLines.map((ls) => ls.length * 12 + 10));
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      header();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    cellLines.forEach((ls, i) => {
      const first = i === 0;
      setRoboto(pdf, first ? "bold" : "regular");
      setText(pdf, first ? NAVY : DUSK);
      const center = centerFirst && first;
      pdf.text(
        ls,
        center ? xs[i] + widths[i] / 2 : xs[i] + 6,
        ctx.y + 14,
        center ? { ...textOpts, align: "center" } : textOpts,
      );
    });

    ctx.y += rh;
  }
  ctx.y += 8;
}

// A labelled prose block (ELECTRIC uppercase label + DUSK body), the headless
// counterpart to the on-screen LabelledBlock. Used for Staff Movement Impact and
// role-based Recommended Actions.
function drawJakartaLabelledBlock(ctx: Ctx, label: string, text: string) {
  const { pdf, MX, CW } = ctx;
  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  const bodyLines: string[] = pdf.splitTextToSize(sanitize(text), CW);
  const blockH = 16 + bodyLines.length * 13 + 8;
  ensureSpace(ctx, blockH);

  setRoboto(pdf, "bold");
  pdf.setFontSize(8);
  setText(pdf, ELECTRIC);
  pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 10);
  ctx.y += 16;

  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  setText(pdf, DUSK);
  pdf.text(bodyLines, MX, ctx.y + 9, { lineHeightFactor: 1.4 });
  ctx.y += bodyLines.length * 13 + 8;
}

// The Jakarta-only 14-section tactical operating brief, rendered in the exact
// order the on-screen JakartaReportBody uses. Section titles MUST stay in
// lockstep with JakartaReportBody and auditJakartaPdf CANONICAL_SECTIONS.
function renderJakartaBrief(
  ctx: Ctx,
  dataset: PngReportDataset,
  jakartaExposure: JakartaCorridorStatus[],
) {
  const d = dataset;
  const tactical = d.jakartaTacticalBrief;

  // 1. Bottom Line Up Front
  drawSectionWithProse(ctx, "Bottom Line Up Front", d.bluf || "Not populated.");

  // 2. Tactical Operating Picture
  drawSectionWithProse(
    ctx,
    "Tactical Operating Picture",
    d.executiveSummary || "Not populated.",
  );

  // 3. Crime Trends and Business Impact — dedicated crime section
  drawSectionHeading(ctx, "Crime Trends and Business Impact");
  if (tactical) {
    renderProse(ctx, tactical.crimeTrends.reportedThisPeriod);
    renderProse(ctx, tactical.crimeTrends.standingPattern);
    renderProse(ctx, tactical.crimeTrends.trendRead);
    drawJakartaCrimeTable(ctx, tactical.crimeTrends.businessImpact);
  } else {
    renderProse(ctx, "Not populated.");
  }

  // 4. Priority Areas This Week — ranked, data-driven table
  drawSectionHeading(ctx, "Priority Areas This Week");
  if (tactical) {
    drawJakartaPriorityTable(ctx, tactical.priorityAreas);
  } else {
    renderProse(ctx, "Not populated.");
  }

  // 5. Staff Movement Impact — broken out by movement type
  drawSectionHeading(ctx, "Staff Movement Impact");
  if (tactical) {
    const sm = tactical.staffMovement;
    const fields: Array<[string, keyof JakartaStaffMovementImpact]> = [
      ["Office access", "officeAccess"],
      ["Hotel to office movement", "hotelToOffice"],
      ["Airport transfer", "airportTransfer"],
      ["Client meeting movement", "clientMeeting"],
      ["Staff commute", "staffCommute"],
      ["Driver route planning", "driverRoute"],
      ["After hours movement", "afterHours"],
    ];
    for (const [label, key] of fields) drawJakartaLabelledBlock(ctx, label, sm[key]);
  } else {
    renderProse(ctx, "Not populated.");
  }

  // 6. Airport Transfer Impact
  drawSectionWithProse(
    ctx,
    "Airport Transfer Impact",
    tactical ? tactical.airportTransfer : "Not populated.",
  );

  // 7. Port and Logistics Impact (intro + 4-col table + port actions)
  drawSectionHeading(ctx, "Port and Logistics Impact");
  if (tactical) {
    renderProse(ctx, tactical.portLogistics.intro);
    drawJakartaPortTable(ctx, tactical.portLogistics.rows);
    drawJakartaStrandLabel(ctx, "Port Actions");
    drawJakartaBulletList(ctx, tactical.portLogistics.actions);
  } else {
    renderProse(ctx, "Not populated.");
  }

  // 8. Office, Hotel and Meeting Venue Exposure (intro + standing table)
  drawSectionHeading(ctx, "Office, Hotel and Meeting Venue Exposure");
  if (tactical) {
    renderProse(ctx, tactical.officeHotelVenue.intro);
    drawJakartaOpsTable(ctx, tactical.officeHotelVenue.rows);
  } else {
    renderProse(ctx, "Not populated.");
  }

  // 9. Route and Timing Guidance
  drawSectionHeading(ctx, "Route and Timing Guidance");
  if (tactical) drawJakartaBulletList(ctx, tactical.routeTiming);
  else renderProse(ctx, "Not populated.");

  // 10. Escalation Triggers
  drawSectionHeading(ctx, "Escalation Triggers");
  if (d.escalationIndicators.length === 0) {
    renderProse(ctx, "No specific escalation triggers flagged this period.");
  } else {
    drawJakartaBulletList(ctx, d.escalationIndicators);
  }

  // 11. Recommended Actions — role based
  drawSectionHeading(ctx, "Recommended Actions");
  if (tactical && tactical.roleActions.length > 0) {
    for (const a of tactical.roleActions) drawJakartaLabelledBlock(ctx, a.role, a.guidance);
  } else {
    renderProse(ctx, "Not populated.");
  }

  // 12. Seven Day Outlook
  drawSectionWithProse(ctx, "Seven Day Outlook", d.outlook || "Not populated.");

  // 13. Polestar View
  drawSectionWithProse(ctx, "Polestar View", d.polestarView || "Not populated.");

  // 14. Operational Map
  drawSectionHeading(ctx, "Operational Map");
  if (jakartaExposure.length > 0) drawJakartaExposureTable(ctx, jakartaExposure);
  renderProse(ctx, tactical ? tactical.areaSummary : "Not populated.");
}

// The ranked Priority Areas table (# | Area | Driver | Business impact | Action).
function drawJakartaPriorityTable(ctx: Ctx, rows: JakartaPriorityAreaRow[]) {
  drawJakartaGridTable(
    ctx,
    ["#", "Area", "Driver", "Business impact", "Action"],
    [0.09, 0.23, 0.17, 0.29, 0.22],
    rows.map((r) => [
      String(r.priority),
      r.elevated ? `${r.area} (active this week)` : r.area,
      r.driver,
      r.businessImpact,
      r.action,
    ]),
    true,
  );
}

// The 4-column Port and Logistics table.
function drawJakartaPortTable(ctx: Ctx, rows: JakartaPortLogisticsRow[]) {
  drawJakartaGridTable(
    ctx,
    ["Area", "Operational relevance", "Possible impact", "Required action"],
    [0.22, 0.24, 0.27, 0.27],
    rows.map((r) => [r.area, r.operationalRelevance, r.possibleImpact, r.requiredAction]),
  );
}

// The standing Crime exposure table (Operating context | Crime exposure |
// Precaution), the headless counterpart to the on-screen CrimeTable.
function drawJakartaCrimeTable(ctx: Ctx, rows: JakartaCrimeBusinessRow[]) {
  drawJakartaGridTable(
    ctx,
    ["Operating context", "Crime exposure", "Precaution"],
    [0.28, 0.4, 0.32],
    rows.map((r) => [r.context, r.exposure, r.precaution]),
  );
}

// One structured-brief incident card — the headless counterpart to the
// on-screen ItemCard (PngCountryReportBody). Title, severity chip, a meta line
// (display category · province · date · source) and the deterministic
// business-impact body. Used for the Top 3 Developments cards. When
// `suppressEmptyLocation` is set an absent province is omitted (mirrors the
// on-screen Top-3 cards) rather than printing "Location not specified".
function drawStructuredItemCard(
  ctx: Ctx,
  item: PngReportItem,
  suppressEmptyLocation = false,
) {
  const { pdf, MX, CW } = ctx;
  const sk = sevKey(item.severity);
  const color = SEV_COLOR[sk] ?? ELECTRIC;
  const padX = 12;
  const padY = 12;
  const chipW = 64;
  const innerW = CW - padX * 2;

  setRoboto(pdf, "bold");
  pdf.setFontSize(11);
  const titleText = item.developmentTitle ?? item.title;
  const titleLines: string[] = pdf.splitTextToSize(
    sanitize(titleText),
    innerW - chipW - 10,
  );

  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  const metaParts = [
    item.displayCategory,
    item.province ?? (suppressEmptyLocation ? "" : "Location not specified"),
    jakartaDateLine(item),
  ].filter(Boolean);
  if (item.source) metaParts.push(item.source);
  const metaLines: string[] = pdf.splitTextToSize(
    sanitize(metaParts.join("  ·  ")),
    innerW,
  );

  pdf.setFontSize(9);
  const bodyLines: string[] = pdf.splitTextToSize(
    sanitize(item.businessImpact),
    innerW,
  );

  const titleBlockH = Math.max(titleLines.length * 14, 18);
  const cardH =
    padY + titleBlockH + 6 + metaLines.length * 11 + 6 + bodyLines.length * 12 + padY;

  if (ctx.y + cardH > ctx.H - ctx.BOTTOM) newPage(ctx);
  const top = ctx.y;

  setFill(pdf, WHITE);
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.5);
  pdf.rect(MX, top, CW, cardH, "FD");
  setFill(pdf, color);
  pdf.rect(MX, top, 4, cardH, "F");

  // Title.
  setRoboto(pdf, "bold");
  pdf.setFontSize(11);
  setText(pdf, NAVY);
  pdf.text(titleLines, MX + padX, top + padY + 11, { lineHeightFactor: 1.25 });

  // Severity chip, top-right.
  const chipX = MX + CW - padX - chipW;
  setFill(pdf, color);
  pdf.rect(chipX, top + padY, chipW, 14, "F");
  setText(pdf, WHITE);
  setRoboto(pdf, "bold");
  pdf.setFontSize(6.5);
  pdf.text(
    sanitize((SEV_LABEL[sk] ?? item.severityLabel ?? "").toUpperCase()),
    chipX + chipW / 2,
    top + padY + 9.5,
    { align: "center" },
  );

  // Meta line.
  let yy = top + padY + titleBlockH + 6;
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  setText(pdf, DUSK);
  pdf.text(metaLines, MX + padX, yy + 8, { lineHeightFactor: 1.3 });

  // Business-impact body.
  yy += metaLines.length * 11 + 6;
  pdf.setFontSize(9);
  setText(pdf, DUSK);
  pdf.text(bodyLines, MX + padX, yy + 8, { lineHeightFactor: 1.35 });

  ctx.y = top + cardH + 10;
}

// The shared structured country brief (PNG / West Papua / Indonesia), rendered
// in the EXACT eight-section order the on-screen PngCountryReportBody uses, so
// the script-generated PDF and the on-screen DOM-rasterised PDF stay in
// lockstep. Reached for those three theatres only; Jakarta has its own
// renderer and every other theatre keeps the generic country layout below.
function renderStructuredBrief(ctx: Ctx, dataset: PngReportDataset) {
  const d = dataset;

  // 1. Bottom Line Up Front
  drawSectionWithProse(ctx, "Bottom Line Up Front", d.bluf || "Not populated.");

  // 2. Top 3 Developments — at most three cards.
  drawSectionHeading(ctx, "Top 3 Developments");
  const topThree = d.topThree.slice(0, 3);
  if (topThree.length === 0) {
    renderProse(ctx, d.emptyLocationFallback);
  } else {
    for (const it of topThree) drawStructuredItemCard(ctx, it, true);
    ctx.y += 4;
  }

  // 3. Incident Details — meaningful theme groups of the incidents not already
  // shown as Top 3 developments. Mirrors the on-screen empty-note logic.
  drawSectionHeading(ctx, "Incident Details");
  const incidentThemes =
    d.incidentThemesOverride ??
    buildCountryIncidentThemes(d.incidentDetailsItems);
  if (incidentThemes.length === 0) {
    renderProse(
      ctx,
      d.windowItems.length === 0
        ? d.emptyLocationFallback
        : d.incidentDetailsItems.length === 0
          ? "No further incident reporting beyond the developments above this period."
          : "Remaining reporting this period was limited to isolated, lower-severity incidents that did not warrant separate detail.",
    );
  } else {
    for (const g of incidentThemes) {
      drawJakartaStrandLabel(ctx, g.heading);
      renderProse(ctx, g.paragraph);
    }
  }

  // 4. Current Situation
  drawSectionWithProse(
    ctx,
    "Current Situation",
    d.executiveSummary || "Not populated.",
  );

  // 5. Operational Impact — per-theme impact lines (≤5).
  drawSectionHeading(ctx, "Operational Impact");
  const operationalImpact =
    d.operationalImpactOverride ??
    buildOperationalImpactBullets(d.windowItems).slice(0, 5);
  if (operationalImpact.length === 0) {
    renderProse(ctx, d.businessImpactEmptyNote);
  } else {
    drawJakartaBulletList(ctx, operationalImpact);
  }

  // 6. Recommended Actions — operating-risk theatres (Indonesia) render a flat
  // priorities list; PNG / West Papua render grouped action blocks.
  drawSectionHeading(ctx, "Recommended Actions");
  if (d.proseVariant === "operating-risk") {
    if (d.businessImpact.length === 0) renderProse(ctx, d.businessImpactEmptyNote);
    else drawJakartaBulletList(ctx, d.businessImpact);
  } else if (d.recommendedActions.length === 0) {
    renderProse(ctx, d.businessImpactEmptyNote);
  } else {
    for (const g of d.recommendedActions) {
      drawJakartaStrandLabel(ctx, g.heading);
      drawJakartaBulletList(ctx, g.actions);
    }
  }

  // 7. Outlook: Next Seven Days — outlook prose + escalation indicators (≤3).
  drawSectionWithProse(
    ctx,
    "Outlook: Next Seven Days",
    d.outlook || "Not populated.",
  );
  const escalationIndicators = d.escalationIndicators.slice(0, 3);
  if (escalationIndicators.length > 0) {
    drawJakartaStrandLabel(ctx, "Escalation Indicators");
    drawJakartaBulletList(ctx, escalationIndicators);
  }

  // 8. Polestar View — closes the written brief.
  drawSectionWithProse(
    ctx,
    "Polestar View",
    d.polestarView || "Not populated.",
  );
}

function buildKpiCards(facts: CountryFactsBreakdown): KpiCardData[] {
  return facts.cards.map((c) => ({
    label: c.label,
    value: c.value,
    note: c.note,
    severity: c.severity,
  }));
}

export async function exportCountryReportPdf(
  country: PdfCountry,
  incidents: PdfIncident[],
  _topicLabels: Record<string, string>,
  filename: string,
  extras: CountryPdfExtras = {},
): Promise<void> {
  const issueDate = todayLabel();
  const ctx = createCtx({
    kind: `${country.name} ${reportKindLabel(country.name)}`,
    issueDate,
  });
  await ensureRobotoLoaded(ctx.pdf);

  const todayIso = new Date().toISOString().slice(0, 10);
  const layers = buildCountryLayers(
    incidents as CountryFastFactsIncident[],
    todayIso,
  );
  const active = resolveActiveCountryWindow(layers, todayIso);
  const facts = computeCountryFastFacts({
    issueDate: todayIso,
    incidents: incidents as CountryFastFactsIncident[],
    windowIncidents: active.incidents,
    standingIncidents: layers.ninetyDay,
    periodLabel: active.periodShortLabel,
  });
  const windowIncidents = facts.windowIncidents as PdfIncident[];
  const plottedCount = windowIncidents.filter(
    (i) =>
      typeof i.latitude === "number" &&
      typeof i.longitude === "number" &&
      !Number.isNaN(i.latitude) &&
      !Number.isNaN(i.longitude),
  ).length;

  // Polestar cover (page 1)
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  const countryCoverUrl = COUNTRY_COVER_URLS[country.name.trim().toLowerCase()];
  if (countryCoverUrl) {
    try {
      const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
      coverImage = await prepareCoverImage(countryCoverUrl, ctx.W, heroH);
    } catch (err) {
      console.warn(
        `[exportCountryReportPdf] cover image load failed for country ${country.name}`,
        err,
      );
    }
  }
  drawPolestarCover(ctx, {
    title: country.name,
    subtitle: "POLESTAR INSIGHTS",
    reportingPeriod: `REPORTING PERIOD: ${active.periodLabel.toUpperCase()}`,
    coverImage,
  });
  beginBodyPages(ctx);

  // Coverage banner — only renders when the weekly window is empty.
  if (extras.coverage) drawCoverageBanner(ctx, extras.coverage);

  // Jakarta carries its OWN 14-section tactical operating brief (mirrors the
  // on-screen JakartaReportBody). Build the same dataset the screen uses and
  // render those sections, then close the document and return early so the
  // generic country layout below never runs for Jakarta. Every other theatre
  // falls through unchanged.
  if (country.name.trim().toLowerCase() === "jakarta") {
    const jakartaDataset = buildJakartaReportDataset({
      windowIncidents: active.incidents as unknown as PngSourceIncident[],
      previousWindowIncidents: resolvePreviousCountryWindow(
        layers,
        todayIso,
      ) as unknown as PngSourceIncident[],
      thirtyDay: layers.thirtyDay as unknown as PngSourceIncident[],
      ninetyDay: layers.ninetyDay as unknown as PngSourceIncident[],
      baselineWatchlist: (extras.baseline?.locationWatchlist ?? []).map(
        (w) => w.label,
      ),
      periodLabel: active.basisLabel,
    });
    const jakartaExposure = buildJakartaCorridorStatuses(
      active.incidents as unknown as CountryFastFactsIncident[],
    ).statuses;
    renderJakartaBrief(ctx, jakartaDataset, jakartaExposure);

    drawDisclaimer(ctx);
    drawFooters(ctx.pdf);
    ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
    return;
  }

  // PNG / West Papua / Indonesia carry their OWN structured eight-section brief
  // (mirrors the on-screen PngCountryReportBody). Build the SAME dataset the
  // screen uses with the matching builder, render those sections in the same
  // order, then close the document and return early so the generic country
  // layout below never runs for these theatres. Every other country falls
  // through unchanged.
  const structuredTokens = acceptedCountryTokens(country.name ?? "");
  const structuredBuilder = structuredTokens.includes("papua new guinea")
    ? buildPngReportDataset
    : structuredTokens.includes("papua")
      ? buildWestPapuaReportDataset
      : structuredTokens.includes("indonesia")
        ? buildIndonesiaReportDataset
        : null;
  if (structuredBuilder) {
    const structuredDataset = structuredBuilder({
      windowIncidents: active.incidents as unknown as PngSourceIncident[],
      previousWindowIncidents: resolvePreviousCountryWindow(
        layers,
        todayIso,
      ) as unknown as PngSourceIncident[],
      thirtyDay: layers.thirtyDay as unknown as PngSourceIncident[],
      ninetyDay: layers.ninetyDay as unknown as PngSourceIncident[],
      baselineWatchlist: (extras.baseline?.locationWatchlist ?? []).map(
        (w) => w.label,
      ),
      periodLabel: active.basisLabel,
    });
    renderStructuredBrief(ctx, structuredDataset);

    // Situational Context (UN OCHA ReliefWeb) — supporting layer, not counted;
    // mirrors the on-screen CountryReportVisuals below the written brief.
    drawSituationalContextPdf(
      ctx,
      buildSituationalContext(extras.situationalReports ?? [], {
        country: country.name,
        max: 6,
      }),
    );

    drawDisclaimer(ctx);
    drawFooters(ctx.pdf);
    ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
    return;
  }

  // 1. Executive Summary
  drawNarrative(
    ctx,
    "Executive Summary",
    extras.executiveSummary,
    `Brief for ${country.name} covering the ${active.basisShort} reporting period. See the sections below for the operating picture, what changed, why it matters, implications and what to watch next.`,
  );

  // 2. Fast Facts
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, buildKpiCards(facts));

  // 3. Situation (overview)
  drawNarrative(ctx, "Situation", country.overview);

  // 4. What Happened (trendSummary)
  drawNarrative(ctx, "What Happened", country.trendSummary);

  // 5. What Matters (auto)
  drawNarrative(ctx, "What Matters", extras.whatMatters);

  // 6. Implications for Business (implications)
  drawNarrative(ctx, "Implications for Business", country.implications);

  // 6a. Country Baseline (only if curated)
  if (extras.baseline) {
    drawBaselineSection(ctx, extras.baseline);
  }

  // 6b. Location Watchlist (only if curated baseline carries one)
  if (extras.watchlist && extras.watchlist.length > 0) {
    drawWatchlistTable(ctx, extras.watchlist);
  }

  // 6c. 30-Day Context
  drawNarrative(
    ctx,
    "30-Day Context",
    extras.lookback?.thirtyDay,
    `No 30-day lookback computed for ${country.name}.`,
  );

  // 6d. Background Operating Picture (90-day)
  drawNarrative(
    ctx,
    "Background Operating Picture",
    extras.lookback?.ninetyDay,
    `No 90-day lookback computed for ${country.name}.`,
  );

  // 7. Map — Jakarta swaps the incident-dot map for the corridor & access
  // exposure table (no rasterised graphic available headless), all others use
  // the standard map image / preview note.
  const isJakarta = country.name.trim().toLowerCase() === "jakarta";
  drawMapSection(ctx, {
    mapImage: isJakarta ? undefined : extras.mapImage,
    plottedCount,
    totalInWindow: windowIncidents.length,
    basisShort: active.basisShort,
    jakartaExposure: isJakarta
      ? buildJakartaCorridorStatuses(
          windowIncidents as unknown as CountryFastFactsIncident[],
        ).statuses
      : undefined,
  });
  // Honest caption so the map is never read as the full risk picture.
  {
    const { pdf, MX } = ctx;
    ensureSpace(ctx, 14);
    setRoboto(pdf, "italic");
    pdf.setFontSize(8);
    setText(pdf, DUSK);
    pdf.text(
      sanitize(
        `The map reflects ${active.basisShort} window records only. The Country Baseline, Location Watchlist and 30 / 90-day context sections above carry the standing operating picture.`,
      ),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 16;
  }

  // 8. Severity Distribution
  drawSeverityChart(ctx, facts);

  // 9. Incident Breakdown by Type
  drawTypeChart(ctx, facts);

  // 9a / 9b. Watch Next + Polestar View — rendered before Related
  // Incidents to mirror the preview's section order exactly.
  drawNarrative(ctx, "Watch Next", extras.watchNext);
  drawNarrative(ctx, "Polestar View", extras.polestarView);

  // 9c. Situational Context (UN OCHA ReliefWeb) — supporting layer, not counted.
  drawSituationalContextPdf(
    ctx,
    buildSituationalContext(extras.situationalReports ?? [], {
      country: country.name,
      max: 6,
    }),
  );

  // 10. Related Incidents
  drawIncidentTable(ctx, windowIncidents);

  // 12. Disclaimer
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
