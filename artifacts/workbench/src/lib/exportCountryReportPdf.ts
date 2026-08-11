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
import { applyIncidentCurations } from "./countrySectionOverrides";
import { upcomingSignalLine } from "./upcomingSignals";
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
  buildJakartaReportDataset,
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  buildIndonesiaReportDataset,
  buildThailandReportDataset,
  buildPhilippinesReportDataset,
  type PngReportDataset,
  type PngReportItem,
  type PngSourceIncident,
} from "./pngReportDataset";
import {
  buildCountryIncidentThemes,
  buildOperationalImpactBullets,
} from "./countryIncidentThemes";
import { acceptedCountryTokens } from "./countryMatch";
import { runCountryReportQc } from "./countryReportQc";
import type { JakartaOperatingPictureRow } from "./jakartaBrief";
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
  /** Persisted analyst curation (country_reports.section_overrides). The
   *  headless export applies the same incident excludes / severity overrides
   *  and Top-3 pins/removals the on-screen report applies, so audits see the
   *  curated brief. */
  sectionOverrides?: import("./countrySectionOverrides").CountrySectionOverrides | null;
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

function drawMapSection(
  ctx: Ctx,
  opts: {
    mapImage?: string;
    plottedCount: number;
    totalInWindow: number;
    basisShort: string;
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
      pdf.setFontSize(7.6);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.25 };
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
  const rowH = 18;

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
      pdf.setFontSize(7.6);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.25 };
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
// Jakarta shares the canonical structured brief (renderStructuredBrief +
// PngCountryReportBody); its tactical tables fold in as strand labels. These
// helpers reuse the same jakartaBrief.ts builders the screen uses, so the
// script-generated PDF and the on-screen DOM-rasterised PDF stay in lockstep.
// Reached for Jakarta only; every other theatre keeps the generic layout below.

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
// Keep-with-next: reserve room for the label PLUS at least two lines of the
// body that follows (~2×16px + padding), so the label can never sit orphaned
// at the bottom of a page with its content on the next one.
function drawJakartaStrandLabel(ctx: Ctx, label: string) {
  ensureSpace(ctx, 22 + 40);
  const { pdf, MX } = ctx;
  setRoboto(pdf, "bold");
  pdf.setFontSize(8);
  setText(pdf, ELECTRIC);
  pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 11);
  ctx.y += 20;
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
    pdf.setFontSize(7.6);
    const cellLines = r.map((c, i) => pdf.splitTextToSize(sanitize(c), widths[i] - 8) as string[]);
    const rh = Math.max(rowH, ...cellLines.map((ls) => ls.length * 10 + 8));
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      header();
      setRoboto(pdf, "regular");
      pdf.setFontSize(7.6);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.25 };
    cellLines.forEach((ls, i) => {
      const first = i === 0;
      setRoboto(pdf, first ? "bold" : "regular");
      setText(pdf, first ? NAVY : DUSK);
      const center = centerFirst && first;
      pdf.text(
        ls,
        center ? xs[i] + widths[i] / 2 : xs[i] + 6,
        ctx.y + 12,
        center ? { ...textOpts, align: "center" } : textOpts,
      );
    });

    ctx.y += rh;
  }
  ctx.y += 8;
}

// The single Jakarta table: rows exist only for corridors that carried a real
// driver this period. The empty path is rendered as prose by the caller so no
// header-only table can reach a client PDF.
function drawJakartaOperatingPictureTable(
  ctx: Ctx,
  rows: JakartaOperatingPictureRow[],
) {
  drawJakartaGridTable(
    ctx,
    ["Area", "Driver", "Impact", "Action"],
    [0.22, 0.17, 0.34, 0.27],
    rows.map((row) => [row.area, row.driver, row.impact, row.action]),
  );
}

function drawJakartaWatchLine(ctx: Ctx, label: string, text: string) {
  const { pdf, MX, CW } = ctx;
  setRoboto(pdf, "regular");
  pdf.setFontSize(9.5);
  const lines = pdf.splitTextToSize(sanitize(`${label}: ${text}`), CW) as string[];
  const lineH = 13;
  ensureSpace(ctx, lines.length * lineH + 5);
  setText(pdf, DUSK);
  pdf.text(lines, MX, ctx.y + 10, { lineHeightFactor: 1.35 });
  ctx.y += lines.length * lineH + 5;
}

function drawJakartaMapCaption(ctx: Ctx, caption: string) {
  if (!caption.trim()) return;
  const { pdf, MX, CW } = ctx;
  setRoboto(pdf, "italic");
  pdf.setFontSize(8);
  const lines = pdf.splitTextToSize(sanitize(caption), CW) as string[];
  ensureSpace(ctx, lines.length * 11 + 8);
  setText(pdf, DUSK);
  pdf.text(lines, MX, ctx.y + 9, { lineHeightFactor: 1.3 });
  setRoboto(pdf, "regular");
  ctx.y += lines.length * 11 + 8;
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
  // Compact cards omit the business-impact body; Jakarta uses them to keep the
  // weekly city brief concise while retaining its severity-first development.
  compact = false,
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
  const bodyLines: string[] = compact
    ? []
    : pdf.splitTextToSize(sanitize(item.businessImpact), innerW);

  const titleBlockH = Math.max(titleLines.length * 14, 18);
  const cardH = compact
    ? padY + titleBlockH + 6 + metaLines.length * 11 + padY
    : padY + titleBlockH + 6 + metaLines.length * 11 + 6 + bodyLines.length * 12 + padY;

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

  // Business-impact body (omitted on compact Incident Details cards).
  if (!compact) {
    yy += metaLines.length * 11 + 6;
    pdf.setFontSize(9);
    setText(pdf, DUSK);
    pdf.text(bodyLines, MX + padX, yy + 8, { lineHeightFactor: 1.35 });
  }

  ctx.y = top + cardH + 10;
}

// The shared structured country brief (PNG / West Papua / Indonesia), rendered
// in the EXACT eight-section order the on-screen PngCountryReportBody uses, so
// the script-generated PDF and the on-screen DOM-rasterised PDF stay in
// lockstep. Reached for those three theatres only; Jakarta has its own
// renderer and every other theatre keeps the generic country layout below.
function renderJakartaWeeklyBrief(ctx: Ctx, dataset: PngReportDataset) {
  const d = dataset;
  const tactical = d.jakartaTacticalBrief;
  if (!tactical) return;

  drawSectionWithProse(ctx, "Bottom Line Up Front", d.bluf || "Not populated.");

  // A week with no developments renders NO "Top 3 Developments" section at all
  // — a headline section with nothing in it reads as a contradiction.
  const topThree = d.topThree;
  if (topThree.length > 0) {
    drawSectionHeading(ctx, "Top 3 Developments");
    for (const item of topThree) drawStructuredItemCard(ctx, item, true, true);
  }

  drawSectionHeading(ctx, "Area Situation This Week");
  if (tactical.operatingPicture.rows.length > 0) {
    drawJakartaOperatingPictureTable(ctx, tactical.operatingPicture.rows);
  } else {
    renderProse(ctx, tactical.operatingPicture.emptyNote);
  }

  drawSectionHeading(ctx, "Crime & Escalation Watch");
  drawJakartaWatchLine(ctx, "Crime", tactical.crimeEscalationWatch.crime);
  drawJakartaWatchLine(
    ctx,
    "Escalation triggers",
    tactical.crimeEscalationWatch.escalationTriggers,
  );
  ctx.y += 5;

  drawSectionHeading(ctx, "Recommended Actions");
  if (tactical.recommendedActions.length > 0) {
    drawJakartaBulletList(ctx, tactical.recommendedActions);
  } else {
    renderProse(ctx, d.businessImpactEmptyNote);
  }

  drawJakartaMapCaption(ctx, tactical.mapCaption);
}

// The shared structured country brief remains unchanged for the other
// theatres. Jakarta takes the dedicated city-weekly renderer above so it never
// regains the generic Current Situation / Outlook / Polestar sections.
function renderStructuredBrief(ctx: Ctx, dataset: PngReportDataset) {
  const d = dataset;
  if (d.jakartaTacticalBrief) {
    renderJakartaWeeklyBrief(ctx, d);
    return;
  }

  drawSectionWithProse(ctx, "Bottom Line Up Front", d.bluf || "Not populated.");

  // No developments → omit the section entirely (matches the on-screen body).
  const topThree = d.topThree;
  if (topThree.length > 0) {
    drawSectionHeading(ctx, "Top 3 Developments");
    for (const it of topThree) drawStructuredItemCard(ctx, it, true);
    ctx.y += 4;
  }

  // Current Situation — same inclusion gate as PngCountryReportBody: the
  // section renders only when it has framing prose, themes, or window items.
  const incidentThemes =
    d.incidentThemesOverride ??
    buildCountryIncidentThemes(d.incidentDetailsItems);
  if (
    d.executiveSummary.trim() !== "" ||
    incidentThemes.length > 0 ||
    d.windowItems.length > 0
  ) {
    drawSectionHeading(ctx, "Current Situation");
    if (d.executiveSummary.trim() !== "") renderProse(ctx, d.executiveSummary);
    if (incidentThemes.length === 0) {
      if (d.windowItems.length > 0) {
        renderProse(
          ctx,
          d.incidentDetailsItems.length === 0
            ? "No further incident reporting beyond the developments above this period."
            : "Remaining reporting this period was limited to isolated, lower-severity incidents that did not warrant separate detail.",
        );
      }
    } else {
      for (const group of incidentThemes) {
        drawJakartaStrandLabel(ctx, group.heading);
        renderProse(ctx, group.paragraph);
      }
    }
  }

  // Actions & Outlook — merged block (owner ruling, 11 Aug 2026): Operational
  // Impact, Recommended Actions and the Outlook render as strands under ONE
  // section heading. Inclusion gates mirror PngCountryReportBody EXACTLY: each
  // strand renders only when it has content, and the section renders only when
  // at least one strand does — no headless-only fallback prose.
  const operationalImpact =
    d.operationalImpactOverride ??
    buildOperationalImpactBullets(d.windowItems).slice(0, 5);
  const hasActions =
    d.proseVariant === "operating-risk"
      ? d.businessImpact.length > 0
      : d.recommendedActions.length > 0;
  if (operationalImpact.length > 0 || hasActions || d.outlook.trim() !== "") {
    drawSectionHeading(ctx, "Actions & Outlook");
    if (operationalImpact.length > 0) {
      drawJakartaStrandLabel(ctx, "Operational Impact");
      drawJakartaBulletList(ctx, operationalImpact);
    }
    if (hasActions) {
      drawJakartaStrandLabel(ctx, "Recommended Actions");
      if (d.proseVariant === "operating-risk") {
        drawJakartaBulletList(ctx, d.businessImpact);
      } else {
        for (const group of d.recommendedActions) {
          drawJakartaStrandLabel(ctx, group.heading);
          drawJakartaBulletList(ctx, group.actions);
        }
      }
    }
    if (d.outlook.trim() !== "") {
      drawJakartaStrandLabel(ctx, "Outlook: Next Seven Days");
      renderProse(ctx, d.outlook);
      const escalationIndicators = d.escalationIndicators.slice(0, 3);
      if (escalationIndicators.length > 0) {
        drawJakartaStrandLabel(ctx, "Escalation Indicators");
        drawJakartaBulletList(ctx, escalationIndicators);
      }
      if ((d.upcomingSignals ?? []).length > 0) {
        drawJakartaStrandLabel(ctx, "Reported Upcoming Activity");
        drawJakartaBulletList(ctx, (d.upcomingSignals ?? []).map(upcomingSignalLine));
        renderProse(
          ctx,
          "Forward-looking signals drawn from reporting that announces scheduled or planned activity. Dates shown are announcement dates, not confirmed event dates.",
        );
      }
    }
  }

  // Polestar View — omitted when empty, matching the on-screen body.
  if (d.polestarView.trim() !== "") {
    drawSectionWithProse(ctx, "Polestar View", d.polestarView);
  }
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
  // Apply the analyst's persisted curation (report-wide incident excludes and
  // exact severity overrides) BEFORE any layer/facts/dataset derivation, so the
  // headless export sees the same curated pool as the on-screen report.
  if (extras.sectionOverrides) {
    incidents = applyIncidentCurations(
      incidents as Array<PdfIncident & { severity: string }>,
      extras.sectionOverrides,
    ) as PdfIncident[];
  }
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

  // PNG / West Papua / Indonesia / Thailand / Philippines / Jakarta all carry
  // their OWN canonical brief (mirrors the on-screen PngCountryReportBody). Build
  // the SAME dataset the screen uses with the matching builder, render those
  // sections in the same order, then close the document and return early so the
  // generic country layout below never runs for these theatres. Jakarta's tactical
  // evidence tables are folded INSIDE the canonical sections by renderStructuredBrief
  // and its posture table + area summary ride the analyst-placed map slot. Every
  // other country falls through unchanged.
  const structuredTokens = acceptedCountryTokens(country.name ?? "");
  const isJakartaBrief = country.name.trim().toLowerCase() === "jakarta";
  const structuredBuilder = isJakartaBrief
    ? buildJakartaReportDataset
    : structuredTokens.includes("papua new guinea")
      ? buildPngReportDataset
      : structuredTokens.includes("papua")
        ? buildWestPapuaReportDataset
        : structuredTokens.includes("indonesia")
          ? buildIndonesiaReportDataset
          : structuredTokens.includes("thailand")
            ? buildThailandReportDataset
            : structuredTokens.includes("philippines")
              ? buildPhilippinesReportDataset
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
      // Analyst Top-3 pins/removals — same curation the on-screen builder gets.
      top3Curation: {
        pinnedIds: extras.sectionOverrides?.top3PinnedIds ?? [],
        excludedIds: extras.sectionOverrides?.top3ExcludedIds ?? [],
      },
      // Mirror the on-screen CountryReport window start (issueDate-6, start of
      // day) so the headless PDF's out-of-window flagging matches the in-app
      // DOM-rasterised export. See PngReportItem.occurredOutOfWindow.
      windowStart: (() => {
        let end: Date;
        try {
          end = parseISO(todayIso);
        } catch {
          end = new Date();
        }
        if (isNaN(end.getTime())) end = new Date();
        end.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() - 6);
        return end;
      })(),
      // Mirror the on-screen build: a coverage-problem week renders every
      // empty-week surface as "Not Assessed" rather than confirmed quiet.
      coverageUnconfirmed: extras.coverage?.state === "coverage-problem",
    });
    // Surface the §33 fail-closed gate result in headless runs too (the
    // on-screen page blocks the PDF on a critical failure; the headless font
    // audit at minimum needs the result visible in its log).
    if (typeof console !== "undefined") {
      const g = structuredDataset.gate;
      // eslint-disable-next-line no-console
      console.log(
        `[countryGate] ${country.name}: passed=${g.passed}` +
          ` hasPriorData=${structuredDataset.gateReport?.hasPriorData ?? false}` +
          (g.failures.length
            ? ` failures=${g.failures.map((f) => `${f.check}(${f.severity})`).join(", ")}`
            : ""),
      );
    }
    renderStructuredBrief(ctx, structuredDataset);

    // Non-blocking §13 quality-control pass (mirrors the on-screen advisory
    // banner). Logged only — the headless export never blocks — using the SAME
    // window incidents the map plots from.
    try {
      const qcWarnings = runCountryReportQc(
        structuredDataset,
        active.incidents as unknown as CountryFastFactsIncident[],
      );
      if (qcWarnings.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[countryReportQc] ${country.name}: ${qcWarnings.length} advisory finding(s)\n  - ${qcWarnings.join("\n  - ")}`,
        );
      }
    } catch {
      // QC is best-effort; never let it break the export.
    }

    // Jakarta's approved city-weekly stops after its compact map caption; other
    // structured country reports retain the supporting situational-context layer.
    if (!isJakartaBrief) {
      drawSituationalContextPdf(
        ctx,
        buildSituationalContext(extras.situationalReports ?? [], {
          country: country.name,
          max: 6,
        }),
      );
    }
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

  // 7. Map — structured city reports return above; this generic path uses the
  // standard incident map for every remaining country.
  drawMapSection(ctx, {
    mapImage: extras.mapImage,
    plottedCount,
    totalInWindow: windowIncidents.length,
    basisShort: active.basisShort,
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
