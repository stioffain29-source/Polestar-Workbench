import { format, parseISO } from "date-fns";
import { buildShippingCommercialCategories } from "./shippingCommercialCategories";
import { resolveIncidentSummary } from "./incidentSummary";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  drawSubtitle,
  renderProse,
  drawSectionWithProse,
  setRoboto,
  ensureRobotoLoaded,
  drawFastFactsKpiCards,
  drawBulletSection,
  drawDisclaimer,
  drawFooters,
  drawPolestarCover,
  beginBodyPages,
  prepareCoverImage,
  COVER_TOP_BAND_H,
  COVER_BOTTOM_BLOCK_H,
  HEADER_BAND_H,
  FOOTER_BAND_H,
  DISCLAIMER_TEXT,
  setFill,
  setStroke,
  setText,
  sanitize,
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
import shippingCoverUrl from "@assets/william-william-NndKt2kF1L4-unsplash_1779617475306.jpg";
import { resolveReportWindow } from "./reportWindow";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import type { TopicSectionOverrides } from "./topicSectionOverrides";
import type { TopicAiProse } from "./topicProseResolution";
import { LOCATION_NOT_IDENTIFIED as _LOCATION_NOT_IDENTIFIED } from "./shippingCountry";
import {
  type ShippingReportIncident,
  type BarRow,
  type ChokepointRow,
  type EnrichedIncident,
  type VesselRow,
  type PiracyRow,
} from "./shippingReportDataset";
import type { MaritimeMovement, MaritimeSecurityEvent } from "@workspace/api-client-react";
import {
  MARITIME_RISK_COLOR,
  type MaritimeIntelligence,
} from "./maritimeIntelligence";
import {
  assertShippingPublication,
  finalizeShippingPublication,
} from "./shippingPublication";
import {
  MARITIME_SECURITY_SOURCE_LABEL,
  maritimeTypeColor,
  type MaritimeSecuritySummary,
} from "./maritimeSecurity";
import {
  MARITIME_CHOKEPOINT_CARDS_TITLE,
  MARITIME_COVERAGE_STATUS_LABEL,
  MARITIME_SUBSECTION_ORDER,
  maritimeExecCards,
  maritimeReportChokepointCards,
  maritimeReportMovementTheatres,
  formatMaritimeMovementDate,
  formatMaritimeMovementSample,
  type MaritimeReportCompleteness,
} from "./maritimeReportView";
import {
  projectShippingRegionalPoint,
  SHIPPING_REGIONAL_MAP_BOUNDS,
  SHIPPING_REGIONAL_GEO,
  SHIPPING_REGIONAL_MAP_POINTS,
  SHIPPING_REGIONAL_MAP_LABEL_OFFSETS,
} from "./shippingRegionalMap";
import type { ShippingSevenPagePresentation } from "./shippingSevenPagePresentation";

void _LOCATION_NOT_IDENTIFIED;

// Subtle bar styling helpers. jspdf does not expose CSS rgba directly, so we
// approximate translucency by lightening the fill toward white (the bars sit
// on a near-white track) and pair it with a slightly darker stroke in the
// same hue. Keeps the look premium and restrained, no gradients or shadows.
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}
function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const f = 1 - amount;
  return toHex(r * f, g * f, b * f);
}

// Shipping report PDF. The current publication order is implemented as six
// explicit interior pages after the existing cover:
//   Maritime Situation -> Chokepoint Watch -> Threat Picture ->
//   Commercial and Regional Impact -> What Matters -> Polestar View.
// Every body surface reads from the final Shipping publication bundle.

export interface ShippingReportData {
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
  // Analyst overrides for each data-driven read (blank → live generated read).
  chokepointRouteRead?: string | null;
  vesselPiracyRead?: string | null;
  commercialImpactRead?: string | null;
  maritimeSecurityRead?: string | null;
  regionalCountryRead?: string | null;
}

export type { ShippingReportIncident };

// Chokepoint Watch -----------------------------------------------------------

function drawChokepointWatch(
  ctx: Ctx,
  rows: ChokepointRow[],
  windowLabel: string,
) {
  const populated = rows.filter((row) => row.count > 0);
  if (populated.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const colNameW = 130;
  const colCountW = 50;
  const colSevW = 75;
  const colDateW = 86;
  const colReadW = CW - colNameW - colCountW - colSevW - colDateW;
  const rowH = 20;

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
    pdf.text("CHOKEPOINT / ROUTE", MX + 6, ctx.y + 13);
    pdf.text("RECORDS", MX + colNameW + 6, ctx.y + 13);
    pdf.text("SEVERITY", MX + colNameW + colCountW + 6, ctx.y + 13);
    pdf.text("LATEST", MX + colNameW + colCountW + colSevW + 6, ctx.y + 13);
    pdf.text(
      "OPERATIONAL READ",
      MX + colNameW + colCountW + colSevW + colDateW + 6,
      ctx.y + 13,
    );
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  for (const row of populated) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const readLines: string[] = pdf.splitTextToSize(
      sanitize(row.readText),
      colReadW - 8,
    );
    const rh = Math.max(rowH, readLines.length * 12 + 10);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(sanitize(row.name), MX + 6, ctx.y + 14, textOpts);

    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.text(String(row.count), MX + colNameW + 6, ctx.y + 14, textOpts);

    if (row.highestSeverityKey) {
      setFill(pdf, SEV_COLOR[row.highestSeverityKey] ?? "#999999");
      const sevText = sanitize(row.highestSeverityLabel.toUpperCase());
      const isSmallText = sevText === "HIGH" || sevText === "LOW";
      const chipW = isSmallText ? 40 : 50;
      pdf.rect(MX + colNameW + colCountW + 6, ctx.y + 4, chipW, 12, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(6.5);
      pdf.text(
        sevText,
        MX + colNameW + colCountW + 6 + chipW / 2,
        ctx.y + 12.5,
        { align: "center" },
      );
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    } else {
      setText(pdf, DUSK);
      pdf.text("-", MX + colNameW + colCountW + 6, ctx.y + 14, textOpts);
    }

    setText(pdf, DUSK);
    pdf.text(
      row.latestDate ? format(row.latestDate, "dd MMM yyyy") : "-",
      MX + colNameW + colCountW + colSevW + 6,
      ctx.y + 14,
      textOpts,
    );
    pdf.text(
      readLines,
      MX + colNameW + colCountW + colSevW + colDateW + 6,
      ctx.y + 14,
      textOpts,
    );

    ctx.y += rh;
  }
  ctx.y += 8;
}

// Generic incident table -----------------------------------------------------

interface IncidentRowOpts<T extends EnrichedIncident> {
  showActColumn?: boolean;
  actFor?: (i: T) => string;
  emptyMessage: string;
  rowLimit?: number;
}

function drawIncidentTable<T extends EnrichedIncident>(
  ctx: Ctx,
  heading: string | null,
  rows: T[],
  opts: IncidentRowOpts<T>,
) {
  if (rows.length === 0) {
    // Empty operational tables do not get a stranded subtitle or a panel
    // containing only an apologetic sentence.
    return;
  }
  if (heading) drawSubtitle(ctx, heading);
  const { pdf, MX, CW } = ctx;
  const colDateW = 80;
  const colActW = opts.showActColumn ? 110 : 0;
  const colSevW = 75;
  const colTitleW = CW - colDateW - colActW - colSevW - 6;
  const rowH = 20;

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
    pdf.text("DATE", MX + 6, ctx.y + 13);
    let cursor = MX + colDateW + 6;
    if (opts.showActColumn && opts.actFor) {
      pdf.text("ACTOR", cursor, ctx.y + 13);
      cursor += colActW;
    }
    pdf.text("TITLE", cursor, ctx.y + 13);
    pdf.text("SEVERITY", MX + colDateW + colActW + colTitleW + 6, ctx.y + 13);
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  const limited = rows.slice(0, opts.rowLimit ?? 15);
  for (const i of limited) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    let titleLines: string[] = [];
    let actLines: string[] = [];
    if (opts.showActColumn && opts.actFor) {
      actLines = pdf.splitTextToSize(sanitize(opts.actFor(i)), colActW - 8);
    }
    titleLines = pdf.splitTextToSize(sanitize(i.title), colTitleW - 8);
    const maxLines = Math.max(titleLines.length, actLines.length);
    const rh = Math.max(rowH, maxLines * 12 + 10);
    // Prevent row from splitting across pages - ensure space for the entire row
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.4 };
    pdf.text(format(i.date, "dd MMM yyyy"), MX + 6, ctx.y + 14, textOpts);

    let cursor = MX + colDateW + 6;
    if (opts.showActColumn && opts.actFor) {
      pdf.text(actLines, cursor, ctx.y + 14, textOpts);
      cursor += colActW;
    }
    setText(pdf, NAVY);
    pdf.text(titleLines, cursor, ctx.y + 14, textOpts);

    const sk = sevKey(i.severity);
    setFill(pdf, SEV_COLOR[sk] ?? "#999999");
    const chipX = MX + colDateW + colActW + colTitleW + 6;
    const sevText = sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase());
    const isSmallText = sevText === "HIGH" || sevText === "LOW";
    const chipW = isSmallText ? 40 : 50;
    pdf.rect(chipX, ctx.y + 4, chipW, 12, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    pdf.text(sevText, chipX + chipW / 2, ctx.y + 12.5, { align: "center" });

    ctx.y += rh;
  }

  // Client-facing reports intentionally omit the "Showing N latest of M"
  // notice. The table cap is internal Workbench logic.
  ctx.y += 13;
}

// Hand-drawn horizontal bar chart -------------------------------------------

// Pick a "nice" rounded scale max + tick step (1/2/5 * 10^k) so the
// gridlines land on round numbers (e.g. 0, 5, 10 rather than 0, 4.5).
function niceScale(rawMax: number): { max: number; step: number } {
  if (rawMax <= 1) return { max: 1, step: 1 };
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const norm = rawMax / pow10;
  let niceNorm: number;
  if (norm <= 1) niceNorm = 1;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  const max = niceNorm * pow10;
  const step = (niceNorm <= 2 ? niceNorm / 2 : niceNorm / 5) * pow10;
  return { max, step: Math.max(step, 1) };
}

function drawHorizontalBarChart(
  ctx: Ctx,
  heading: string | null,
  rows: BarRow[],
  opts: { labelW?: number; barColor?: string; emptyMessage?: string } = {},
) {
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) {
    // Do not leave an empty chart title or a panel whose only content is an
    // empty-state sentence in a client-facing report.
    return;
  }
  if (heading) drawSubtitle(ctx, heading);
  const labelW = opts.labelW ?? 160;
  const valueW = 34;
  const trackX = MX + labelW + 6;
  const trackW = CW - labelW - 6 - valueW - 6;
  const rowH = 20;
  const gap = 5;
  const axisH = 14;
  const totalH = rows.length * (rowH + gap) + axisH;
  ensureSpace(ctx, totalH + 6);

  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const { max, step } = niceScale(rawMax);

  for (const r of rows) {
    const y = ctx.y;
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9.5);
    const labelLines: string[] = pdf.splitTextToSize(
      sanitize(r.label),
      labelW - 4,
    );
    pdf.text(labelLines.slice(0, 1), MX, y + rowH - 7);

    // Track background.
    setFill(pdf, "#F3F4F8");
    pdf.rect(trackX, y + 4, trackW, rowH - 8, "F");

    // Grid lines inside the track.
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.4);
    for (let v = 0; v <= max; v += step) {
      const gx = trackX + (v / max) * trackW;
      pdf.line(gx, y + 4, gx, y + 4 + rowH - 8);
    }

    const w = (r.value / max) * trackW;
    const baseColor = r.color ?? opts.barColor ?? ELECTRIC;
    if (w > 0) {
      setFill(pdf, lightenHex(baseColor, 0.12));
      setStroke(pdf, darkenHex(baseColor, 0.22));
      pdf.setLineWidth(0.5);
      pdf.rect(trackX, y + 4, w, rowH - 8, "FD");
    }

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9.5);
    pdf.text(String(r.value), trackX + trackW + 6, y + rowH - 7);
    setRoboto(pdf, "regular");

    ctx.y += rowH + gap;
  }

  // Axis tick row with numeric scale.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.6);
  pdf.line(trackX, ctx.y + 2, trackX + trackW, ctx.y + 2);
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(7);
  for (let v = 0; v <= max; v += step) {
    const gx = trackX + (v / max) * trackW;
    pdf.line(gx, ctx.y + 2, gx, ctx.y + 5);
    pdf.text(String(v), gx, ctx.y + 12, { align: "center" });
  }
  ctx.y += axisH;
  ctx.y += 16;
}

// Related Incidents ---------------------------------------------------------

function drawRelatedIncidents(
  ctx: Ctx,
  rows: EnrichedIncident[],
  summaries: Record<string, string>,
) {
  if (rows.length === 0) return;
  // Guard against a stranded heading at the foot of a page: pre-allocate
  // heading + header row + a couple of body rows.
  ensureSpace(ctx, 24 + 18 + 40);
  drawSectionHeading(ctx, "Related Incidents");

  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colIssueW = 120;
  const colSevW = 75;
  const colTitleW = CW - colDateW - colIssueW - colSevW - 6;
  const rowH = 20;

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
    pdf.text("DATE", MX + 6, ctx.y + 13);
    pdf.text("ISSUE", MX + colDateW + 6, ctx.y + 13);
    pdf.text("TITLE", MX + colDateW + colIssueW + 6, ctx.y + 13);
    pdf.text("SEVERITY", MX + colDateW + colIssueW + colTitleW + 6, ctx.y + 13);
    ctx.y += rowH;
  };
  drawHeader();

  for (const i of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const titleLines: string[] = pdf.splitTextToSize(
      sanitize(i.title),
      colTitleW - 8,
    );
    const issueLines: string[] = pdf.splitTextToSize(
      sanitize(i.issue),
      colIssueW - 8,
    );
    pdf.setFontSize(7);
    const summaryLines: string[] = pdf.splitTextToSize(
      sanitize(resolveIncidentSummary(i, summaries)),
      colTitleW - 8,
    );
    pdf.setFontSize(8.5);
    const titleBlockH = titleLines.length * 12 + summaryLines.length * 9 + 4;
    const rh = Math.max(
      rowH,
      Math.max(titleBlockH, issueLines.length * 12) + 10,
    );
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.4 };
    pdf.text(format(i.date, "dd MMM yyyy"), MX + 6, ctx.y + 14, textOpts);
    pdf.text(issueLines, MX + colDateW + 6, ctx.y + 14, textOpts);
    setText(pdf, NAVY);
    const titleX = MX + colDateW + colIssueW + 6;
    pdf.text(titleLines, titleX, ctx.y + 14, textOpts);
    if (summaryLines.length > 0) {
      setText(pdf, DUSK);
      pdf.setFontSize(7);
      pdf.text(
        summaryLines,
        titleX,
        ctx.y + 14 + titleLines.length * 12 + 2,
        textOpts,
      );
      pdf.setFontSize(8.5);
    }

    const sk = sevKey(i.severity);
    setFill(pdf, SEV_COLOR[sk] ?? "#999999");
    const chipX = MX + colDateW + colIssueW + colTitleW + 6;
    const sevText = sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase());
    const isSmallText = sevText === "HIGH" || sevText === "LOW";
    const chipW = isSmallText ? 40 : 50;
    pdf.rect(chipX, ctx.y + 4, chipW, 12, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    pdf.text(sevText, chipX + chipW / 2, ctx.y + 12.5, { align: "center" });

    ctx.y += rh;
  }
  ctx.y += 13;
}

// Maritime Security (ICC CCS / IMB) ----------------------------------------
// Mirrors the "Maritime Security (ICC CCS / IMB)" section in
// ShippingReportPreview.tsx — same prose, type chips and table columns, in the
// same order, so preview == PDF. These events are a standalone source and are
// never part of any incident count.

function drawMaritimeSecurity(
  ctx: Ctx,
  summary: MaritimeSecuritySummary,
  read: string,
) {
  ensureSpace(ctx, 24 + 30);
  drawSectionHeading(ctx, "Maritime Security (ICC CCS / IMB)");
  renderProse(ctx, read);

  const { pdf, MX, CW } = ctx;

  // Per-classification count chips.
  if (summary.byType.length > 0) {
    ensureSpace(ctx, 22);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    let cx = MX;
    const chipH = 14;
    const chipGap = 6;
    for (const b of summary.byType) {
      const label = `${b.type}: ${b.count}`;
      const w = pdf.getTextWidth(label) + 14;
      if (cx + w > MX + CW) {
        cx = MX;
        ctx.y += chipH + 4;
        ensureSpace(ctx, chipH + 4);
      }
      setFill(pdf, maritimeTypeColor(b.type));
      pdf.rect(cx, ctx.y, w, chipH, "F");
      setText(pdf, WHITE);
      pdf.text(sanitize(label), cx + 7, ctx.y + 9.6);
      cx += w + chipGap;
    }
    ctx.y += chipH + 12;
  }

  if (summary.rows.length === 0) {
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize(
        `No piracy or armed-robbery activity recorded for this period by the ${MARITIME_SECURITY_SOURCE_LABEL}.`,
      ),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 24;
    return;
  }

  const colDateW = 86;
  const colTypeW = 130;
  const colCountryW = 120;
  const colLocW = CW - colDateW - colTypeW - colCountryW - 6;
  const rowH = 20;

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
    pdf.text("DATE", MX + 6, ctx.y + 13);
    pdf.text("TYPE", MX + colDateW + 6, ctx.y + 13);
    pdf.text("LOCATION", MX + colDateW + colTypeW + 6, ctx.y + 13);
    pdf.text("COASTAL STATE", MX + colDateW + colTypeW + colLocW + 6, ctx.y + 13);
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  for (const r of summary.rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);
    const typeLines = pdf.splitTextToSize(sanitize(r.type), colTypeW - 16);
    const locLines = pdf.splitTextToSize(sanitize(r.location ?? "—"), colLocW - 8);
    const countryLines = pdf.splitTextToSize(
      sanitize(r.country ?? "—"),
      colCountryW - 8,
    );
    const maxLines = Math.max(typeLines.length, locLines.length, countryLines.length);
    const rh = Math.max(rowH, maxLines * 12 + 10);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    setText(pdf, DUSK);
    pdf.text(r.date ? format(r.date, "dd MMM yyyy") : "—", MX + 6, ctx.y + 14, textOpts);
    // Type swatch + label.
    setFill(pdf, maritimeTypeColor(r.type));
    pdf.rect(MX + colDateW + 6, ctx.y + 6, 7, 7, "F");
    setText(pdf, NAVY);
    pdf.text(typeLines, MX + colDateW + 17, ctx.y + 14, textOpts);
    setText(pdf, DUSK);
    pdf.text(locLines, MX + colDateW + colTypeW + 6, ctx.y + 14, textOpts);
    pdf.text(countryLines, MX + colDateW + colTypeW + colLocW + 6, ctx.y + 14, textOpts);

    ctx.y += rh;
  }
  ctx.y += 13;
}

// Maritime Intelligence (shared board) -------------------------------------
// Mirrors MaritimeIntelligenceReportSection in ShippingReportPreview.tsx —
// same sections, same order, same dataset, so preview == PDF.


// Bullets without a section heading — mirrors drawBulletSection's body so the
// indent, circle marker and line spacing match the rest of the report.
function drawMiniBullets(ctx: Ctx, items: string[], maxBullets = 8) {
  const bullets = items.slice(0, maxBullets);
  if (bullets.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const lineH = 17;
  const bulletIndent = 14;
  const gapBetween = 10;
  const applyProseStyle = () => {
    setRoboto(pdf, "light");
    setText(pdf, DUSK);
    pdf.setFontSize(11);
  };
  applyProseStyle();
  for (const b of bullets) {
    const lines: string[] = pdf.splitTextToSize(sanitize(b), CW - bulletIndent);
    const blockH = lines.length * lineH + gapBetween;
    if (ctx.y + blockH > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      applyProseStyle();
    }
    setFill(pdf, DUSK);
    pdf.circle(MX + 4, ctx.y + 7, 1.5, "F");
    for (const ln of lines) {
      ensureSpace(ctx, lineH);
      applyProseStyle();
      pdf.text(ln, MX + bulletIndent, ctx.y + 11);
      ctx.y += lineH;
    }
    ctx.y += gapBetween;
  }
  ctx.y += 6;
}

// Filled navy BLUF callout — the white-on-navy "Bottom Line Up Front" box that
// opens the preview's Maritime Intelligence section.
function drawBlufBox(ctx: Ctx, text: string) {
  const { pdf, MX, CW } = ctx;
  const padH = 10;
  const padV = 10;
  const labelH = 14;
  const lineH = 15;
  setRoboto(pdf, "light");
  pdf.setFontSize(11);
  const lines: string[] = pdf.splitTextToSize(sanitize(text), CW - padH * 2);
  const boxH = padV + labelH + lines.length * lineH + padV;
  if (ctx.y + boxH > ctx.H - ctx.BOTTOM) newPage(ctx);
  setFill(pdf, NAVY);
  pdf.rect(MX, ctx.y, CW, boxH, "F");
  setRoboto(pdf, "bold");
  pdf.setFontSize(8);
  setText(pdf, POLAR);
  pdf.text("BOTTOM LINE UP FRONT", MX + padH, ctx.y + padV + 8);
  setRoboto(pdf, "light");
  pdf.setFontSize(11);
  setText(pdf, WHITE);
  let yy = ctx.y + padV + labelH + 11;
  for (const ln of lines) {
    pdf.text(ln, MX + padH, yy);
    yy += lineH;
  }
  ctx.y += boxH + 14;
}

function drawMaritimeCoverageDisclosure(
  ctx: Ctx,
  completeness: MaritimeReportCompleteness,
) {
  const disclosure =
    completeness.complete ? "" : (completeness.disclosure ?? "").trim();
  if (!disclosure) return;
  drawSubtitle(ctx, MARITIME_COVERAGE_STATUS_LABEL);
  renderProse(ctx, disclosure);
}

function drawMaritimeIntelligence(
  ctx: Ctx,
  board: MaritimeIntelligence,
  completeness: MaritimeReportCompleteness,
) {
  const { pdf, MX } = ctx;
  const { bluf, confirmedIncidents } = board;
  const movementTheatres = maritimeReportMovementTheatres(board);
  const chokepointCards = maritimeReportChokepointCards(board);

  drawSectionHeading(ctx, "Maritime Intelligence");

  // Situation KPI cards (risk, confirmed incidents, affected
  // chokepoints and, when populated, business impact). Built from the SHARED
  // view contract (maritimeReportView) so they are byte-identical to the
  // on-screen board.
  const execCards: KpiCardData[] = maritimeExecCards(board, completeness);
  drawFastFactsKpiCards(ctx, execCards);
  drawMaritimeCoverageDisclosure(ctx, completeness);

  drawBlufBox(ctx, bluf);

  // Chokepoint cards are a populated-only report surface. The live board keeps
  // zero-count cards for monitoring, but empty client-facing cards add noise.
  if (chokepointCards.length > 0) {
    drawSubtitle(ctx, MARITIME_CHOKEPOINT_CARDS_TITLE);
    for (const card of chokepointCards) {
      ensureSpace(ctx, 20);
      setRoboto(pdf, "bold");
      pdf.setFontSize(10);
      const pendingRisk = card.risk.label === "Assessment pending";
      setText(pdf, pendingRisk ? "#626773" : MARITIME_RISK_COLOR[card.risk.level]);
      pdf.text(
        sanitize(`${card.key} \u2014 ${pendingRisk ? card.risk.label : `L${card.risk.level} \u00b7 ${card.risk.label}`}`),
        MX,
        ctx.y + 9,
      );
      ctx.y += 13;
      const lines: string[] = [];
      lines.push(`${card.incidentCount} confirmed \u00b7 7 days`);
      if (card.lastConfirmed) {
        let when = card.lastConfirmed.occurredAt;
        try {
          when = format(parseISO(card.lastConfirmed.occurredAt), "d MMM");
        } catch {
          /* keep raw */
        }
        lines.push(`Last incident: ${when} \u2014 ${card.lastConfirmed.title}`);
      }
      if (card.movement) {
        lines.push(
          `Movement: ${formatMaritimeMovementDate(card.movement.dataAsOf)} \u2014 ${formatMaritimeMovementSample(card.movement)}`,
        );
      }
      drawMiniBullets(ctx, lines, lines.length);
    }
  }

  // Confirmed maritime incidents — allowed categories only; movement/AIS never
  // appears here.
  if (confirmedIncidents.length > 0) {
    drawSubtitle(ctx, MARITIME_SUBSECTION_ORDER[0]);
    const rows = confirmedIncidents.map((r) => {
      let when = r.occurredAt;
      try {
        when = format(parseISO(r.occurredAt), "d MMM");
      } catch {
        /* keep raw */
      }
      const sev = SEV_LABEL[sevKey(r.severity ?? "")] ?? r.severity ?? "";
      const cp = r.chokepoint ? ` \u00b7 ${r.chokepoint}` : "";
      return `${when} \u2014 ${r.category} \u00b7 ${sev}${cp}: ${r.title}`;
    });
    drawMiniBullets(ctx, rows, rows.length);
  }

  // Maritime context — vessel movement (AIS). CONTEXT only.
  if (movementTheatres.length > 0) {
    drawSubtitle(ctx, MARITIME_SUBSECTION_ORDER[1]);
    const items = movementTheatres.map(
      (t) =>
        `${t.theatre} \u2014 ${formatMaritimeMovementDate(t.dataAsOf)} \u2014 ${formatMaritimeMovementSample(t)}`,
    );
    drawMiniBullets(ctx, items, items.length);
  }

  // The board's internal Polestar View / Watch Next block is NOT rendered in
  // the report — the report carries exactly one Polestar View and one Watch
  // Next in the standalone sections. Mirrors the preview byte-for-byte.
}

// Seven-page Shipping Watch layout -------------------------------------------
//
// The older renderer above is retained for the other report adapters that
// still import its small drawing primitives.  Shipping Watch itself uses the
// explicit page renderer below.  Every page is opened deliberately; none of
// these page-local surfaces call ensureSpace/newPage, which makes the
// publication contract (cover + six interior pages) deterministic even when a
// saved analyst paragraph is unusually long.

function normalizeMapKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fitTextLines(
  ctx: Ctx,
  text: string,
  width: number,
  maxHeight: number,
  opts: {
    color?: string;
    font?: "light" | "regular" | "bold";
    maxSize?: number;
    minSize?: number;
    lineFactor?: number;
    paragraphGap?: number;
  } = {},
  originX = 0,
  originY = 0,
): number {
  const { pdf } = ctx;
  const paragraphs = sanitize(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0 || maxHeight <= 0) return 0;

  const maxSize = opts.maxSize ?? 10;
  const minSize = opts.minSize ?? 4;
  const lineFactor = opts.lineFactor ?? 1.28;
  const paragraphGap = opts.paragraphGap ?? 3;
  let size = maxSize;
  let measured: Array<string[]> = [];
  let lineH = size * lineFactor;
  let height = Number.POSITIVE_INFINITY;
  while (size >= minSize) {
    setRoboto(pdf, opts.font ?? "light");
    pdf.setFontSize(size);
    measured = paragraphs.map((p) => pdf.splitTextToSize(p, width));
    lineH = size * lineFactor;
    height =
      measured.reduce((sum, lines) => sum + lines.length * lineH, 0) +
      Math.max(0, measured.length - 1) * paragraphGap;
    if (height <= maxHeight) break;
    size -= 0.25;
  }
  // An analyst can paste arbitrary-length text.  Continue reducing the text
  // size (rather than clipping or silently dropping prose) so all of it stays
  // on the designated page.
  if (height > maxHeight) {
    setRoboto(pdf, opts.font ?? "light");
    pdf.setFontSize(minSize);
    measured = paragraphs.map((p) => pdf.splitTextToSize(p, width));
    const rawLines = measured.reduce((sum, lines) => sum + lines.length, 0);
    const gaps = Math.max(0, measured.length - 1) * paragraphGap;
    size = Math.max(2.8, (maxHeight - gaps) / Math.max(1, rawLines * lineFactor));
    setRoboto(pdf, opts.font ?? "light");
    pdf.setFontSize(size);
    measured = paragraphs.map((p) => pdf.splitTextToSize(p, width));
    lineH = size * lineFactor;
  }

  if (opts.color) setText(pdf, opts.color);
  let y = 0;
  for (const [paragraphIndex, lines] of measured.entries()) {
    for (const line of lines) {
      pdf.text(line, originX, originY + y + size);
      y += lineH;
    }
    if (paragraphIndex < measured.length - 1) y += paragraphGap;
  }
  return y;
}

/**
 * Draw fitTextLines at a real origin. Keeping the fit calculation in one
 * helper prevents analyst edits from being cut off by fixed page geometry.
 */
function drawFitText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  width: number,
  maxHeight: number,
  opts: Parameters<typeof fitTextLines>[4] = {},
): number {
  // fitTextLines uses native jsPDF text calls, so analyst prose stays
  // selectable in the generated PDF.
  return fitTextLines(ctx, text, width, maxHeight, opts, x, y);
}

function drawInteriorTitle(ctx: Ctx, title: string, subtitle?: string) {
  const { pdf, MX } = ctx;
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(15);
  pdf.text(sanitize(title.toUpperCase()), MX, HEADER_BAND_H + 15);
  setStroke(pdf, ELECTRIC);
  pdf.setLineWidth(1.3);
  pdf.line(MX, HEADER_BAND_H + 23, MX + ctx.CW, HEADER_BAND_H + 23);
  if (subtitle) {
    setText(pdf, DUSK);
    setRoboto(pdf, "light");
    pdf.setFontSize(7.5);
    pdf.text(sanitize(subtitle), MX, HEADER_BAND_H + 36);
  }
}

function startInteriorPage(ctx: Ctx, title: string, subtitle?: string) {
  newPage(ctx);
  drawInteriorTitle(ctx, title, subtitle);
}

function publicationFact(
  publication: ReturnType<typeof finalizeShippingPublication>,
  label: string,
): KpiCardData | undefined {
  const autoIndex = publication.dataset.fastFacts.findIndex((item) => item.label === label);
  const fact =
    (autoIndex >= 0 ? publication.fastFacts[autoIndex] : undefined) ??
    publication.fastFacts.find((item) => item.label === label);
  return fact
    ? {
        label: fact.label,
        value: fact.value,
        note: fact.note,
        severity: fact.severity,
        accent: fact.accent,
      }
    : undefined;
}

function brandRiskAccent(label: string, pending: boolean): string {
  if (pending) return POLAR;
  const normalized = label.toLowerCase();
  if (normalized === "extreme") return NAVY;
  if (normalized === "high" || normalized === "moderate") return ELECTRIC;
  return POLAR;
}

function drawFiveFastFacts(
  ctx: Ctx,
  publication: ReturnType<typeof finalizeShippingPublication>,
) {
  const { pdf, MX, CW } = ctx;
  const board = publication.maritimeBoard;
  const riskLabel = board.risk.label.toLowerCase();
  const pending =
    !publication.completeness.complete ||
    board.risk.level === 1 ||
    riskLabel.includes("pending") ||
    riskLabel.includes("not assessed");
  const main = publicationFact(publication, "Main Affected Chokepoint");
  const facts: KpiCardData[] = [
    {
      label: "Overall Risk",
      value: board.risk.label,
      note: pending ? "Coverage incomplete" : `Confidence: ${board.risk.confidence}`,
      accent: brandRiskAccent(board.risk.label, pending),
    },
    publicationFact(publication, "Confirmed Incidents") ?? {
      label: "Confirmed Incidents",
      value: String(board.incidentSnapshot.total),
    },
    {
      label: "Chokepoints Affected",
      value: `${board.chokepointsAffected} / 7`,
      note: "Tracked routes",
      accent: ELECTRIC,
    },
    {
      label: "Vessel Attacks / Seizures",
      // This is intentionally the uncapped canonical count. vesselRows is a
      // bounded display table and must never drive this Fast Fact.
      value:
        publicationFact(publication, "Vessel Attacks / Seizures")?.value ??
        String(publication.dataset.vesselAttackSeizureCount),
      note:
        publicationFact(publication, "Vessel Attacks / Seizures")?.note ??
        "Full count",
      accent: ELECTRIC,
    },
    {
      label: "Main Affected Chokepoint",
      value: main?.value ?? "—",
      note: main?.note,
      accent: ELECTRIC,
    },
  ];

  const cardW = CW / facts.length;
  const rowH = 70;
  const y = HEADER_BAND_H + 34;
  setStroke(pdf, NAVY);
  pdf.setLineWidth(1);
  pdf.line(MX, y, MX + CW, y);
  pdf.line(MX, y + rowH, MX + CW, y + rowH);
  for (const [index, card] of facts.entries()) {
    const x = MX + index * cardW;
    if (index > 0) {
      setStroke(pdf, POLAR);
      pdf.setLineWidth(0.5);
      pdf.line(x, y + 8, x, y + rowH - 8);
    }
    setText(pdf, DUSK);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.3);
    const labelLines = pdf.splitTextToSize(sanitize(card.label.toUpperCase()), cardW - 12);
    pdf.text(labelLines.slice(0, 2), x + cardW / 2, y + 15, {
      align: "center",
      lineHeightFactor: 1.1,
    });
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    let valueSize = card.value.length > 18 ? 9 : 13;
    while (valueSize > 7 && (setRoboto(pdf, "bold"), pdf.setFontSize(valueSize), pdf.getTextWidth(sanitize(card.value)) > cardW - 12)) {
      valueSize -= 0.25;
    }
    pdf.setFontSize(valueSize);
    pdf.text(sanitize(card.value), x + cardW / 2, y + 39, { align: "center" });
    if (card.note) {
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(5.6);
      pdf.text(pdf.splitTextToSize(sanitize(card.note), cardW - 12).slice(0, 2), x + cardW / 2, y + 57, {
        align: "center",
        lineHeightFactor: 1.05,
      });
    }
  }
  ctx.y = y + rowH + 12;
}

function drawBlufPanel(ctx: Ctx, text: string) {
  const { pdf, MX, CW } = ctx;
  const y = ctx.y;
  const h = 76;
  setFill(pdf, NAVY);
  pdf.rect(MX, y, CW, h, "F");
  setText(pdf, POLAR);
  setRoboto(pdf, "bold");
  pdf.setFontSize(7);
  pdf.text("BLUF", MX + 12, y + 14);
  drawFitText(ctx, text, MX + 12, y + 20, CW - 24, h - 27, {
    color: WHITE,
    font: "light",
    maxSize: 10.5,
    minSize: 3.6,
    lineFactor: 1.25,
    paragraphGap: 3,
  });
  ctx.y = y + h + 12;
}

function drawShippingRegionalMap(
  ctx: Ctx,
  presentation: ShippingSevenPagePresentation,
) {
  const { pdf, MX, CW } = ctx;
  const frame = {
    x: MX,
    y: ctx.y + 20,
    width: CW,
    height: Math.min(330, ctx.H - ctx.BOTTOM - (ctx.y + 55)),
  };
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(9);
  pdf.text("MARITIME SITUATION MAP", MX, ctx.y + 10);

  setFill(pdf, WHITE);
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.5);
  pdf.rect(frame.x, frame.y, frame.width, frame.height, "FD");

  // Longitude/latitude graticule makes the geographic placement explicit
  // even in headless/native PDF exports where a tile basemap is unavailable.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.3);
  for (let longitude = 30; longitude <= 110; longitude += 10) {
    const p = projectShippingRegionalPoint(
      { longitude, latitude: SHIPPING_REGIONAL_MAP_BOUNDS.minLatitude },
      frame,
    );
    pdf.line(p.x, frame.y, p.x, frame.y + frame.height);
  }
  for (let latitude = 0; latitude <= 30; latitude += 5) {
    const p = projectShippingRegionalPoint(
      { longitude: SHIPPING_REGIONAL_MAP_BOUNDS.minLongitude, latitude },
      frame,
    );
    pdf.line(frame.x, p.y, frame.x + frame.width, p.y);
  }

  // Draw the same filtered country GeoJSON used by ShippingSituationMap.tsx.
  // This is intentionally not a hand-drawn regional silhouette: the native
  // exporter uses the real local polygons so browser preview and PDF geography
  // remain recognisably the same.
  setFill(pdf, POLAR);
  setStroke(pdf, WHITE);
  pdf.setLineWidth(0.35);
  const drawRing = (ring: unknown, style: "FD" | "S") => {
    if (!Array.isArray(ring) || ring.length < 3) return;
    const coordinates = ring as Array<[number, number]>;
    const points = coordinates.map(([longitude, latitude]) =>
      projectShippingRegionalPoint({ longitude, latitude }, frame),
    );
    const first = points[0];
    if (!first) return;
    const vectors = points.slice(1).map((point, index) => [
      point.x - points[index].x,
      point.y - points[index].y,
    ]);
    // `lines` is the jsPDF native path primitive and stays selectable/vector
    // in both browser and Node exports. Fill outer rings and retain interior
    // rings as stroked holes; this preserves the source topology without
    // inventing a hand-drawn coastline.
    pdf.lines(vectors, first.x, first.y, [1, 1], style, true);
  };
  pdf.saveGraphicsState();
  pdf.rect(frame.x, frame.y, frame.width, frame.height);
  pdf.clip();
  pdf.discardPath();
  for (const feature of SHIPPING_REGIONAL_GEO.features) {
    const geometry = feature.geometry as
      | { type: "Polygon"; coordinates: unknown[] }
      | { type: "MultiPolygon"; coordinates: unknown[][] }
      | null;
    if (!geometry) continue;
    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach((ring, index) =>
        drawRing(ring, index === 0 ? "FD" : "S"),
      );
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        polygon.forEach((ring, index) =>
          drawRing(ring, index === 0 ? "FD" : "S"),
        );
      }
    }
  }

  pdf.restoreGraphicsState();
  for (const [pointIndex, point] of SHIPPING_REGIONAL_MAP_POINTS.entries()) {
    const row = presentation.matrix.find(
      (candidate) => normalizeMapKey(candidate.key) === normalizeMapKey(point.key),
    );
    const projected = projectShippingRegionalPoint(point, frame);
    // A non-complete publication is explicitly ungraded. Do not let a
    // bounded row's historical severity leak onto the map while the overall
    // coverage state is pending.
    const active = Boolean(row && !row.risk.pending && row.incidents > 0);
    const marker = active ? ELECTRIC : WHITE;
    setFill(pdf, marker);
    setStroke(pdf, NAVY);
    pdf.setLineWidth(0.8);
    pdf.circle(projected.x, projected.y, active ? 5 : 3.5, "FD");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    const [dx, dy] = SHIPPING_REGIONAL_MAP_LABEL_OFFSETS[pointIndex];
    const labelX = Math.min(frame.x + frame.width - 40, Math.max(frame.x + 40, projected.x + dx * frame.width / 750));
    const labelY = projected.y + dy * frame.height / 340;
    pdf.line(projected.x, projected.y, labelX, labelY);
    setFill(pdf, WHITE);
    pdf.rect(labelX - 48, labelY - 9, 96, active ? 22 : 14, "F");
    pdf.text(
      sanitize(point.key),
      labelX,
      labelY,
      { align: "center" },
    );
    setRoboto(pdf, "regular");
    pdf.setFontSize(5.4);
    const risk = row?.risk.pending
      ? row.risk.display
      : active
        ? row?.risk.display ?? "Assessment pending"
        : "No confirmed incident";
    if (active) pdf.text(sanitize(risk), labelX, labelY + 10, { align: "center" });
  }

  setText(pdf, DUSK);
  setRoboto(pdf, "light");
  pdf.setFontSize(6.2);
  pdf.text(
    "Outlined markers: assessment pending. AIS is not used to rate incident risk.",
    frame.x,
    frame.y + frame.height + 13,
  );
  ctx.y = frame.y + frame.height + 22;
}

function movementForChokepoint(
  board: MaritimeIntelligence,
  name: string,
) {
  const theatres = maritimeReportMovementTheatres(board);
  const normalized = normalizeMapKey(name);
  return theatres.find((theatre) => {
    const values = [theatre.theatre, theatre.chokepoint ?? ""].map(normalizeMapKey);
    return values.some((value) => value.includes(normalized) || normalized.includes(value));
  });
}

function drawChokepointMatrix(
  ctx: Ctx,
  presentation: ShippingSevenPagePresentation,
) {
  const { pdf, MX, CW } = ctx;
  const rows = presentation.matrix;
  const columns = {
    name: 91,
    risk: 54,
    incidents: 43,
    movement: 111,
  };
  const latest = CW - columns.name - columns.risk - columns.incidents - columns.movement;
  const headerH = 20;
  let y = ctx.TOP + 40;
  setFill(pdf, NAVY);
  pdf.rect(MX, y, CW, headerH, "F");
  setText(pdf, WHITE);
  setRoboto(pdf, "bold");
  pdf.setFontSize(6.4);
  const headers = [
    ["CHOKEPOINT NAME", 6],
    ["RISK LEVEL", columns.name + 6],
    ["INCIDENTS", columns.name + columns.risk + 6],
    ["MOVEMENT", columns.name + columns.risk + columns.incidents + 6],
    ["LATEST INCIDENT", CW - latest + 6],
  ] as const;
  for (const [label, offset] of headers) pdf.text(label, MX + offset, y + 13);
  y += headerH;

  // Always render the fixed seven-route vocabulary, including quiet routes.
  for (const row of rows) {
    const movementText = row.movement
      ? `${formatMaritimeMovementDate(row.movement.dataAsOf)}\n${row.movement.totalVessels == null ? "Sample size unavailable" : `${row.movement.totalVessels} vessels tracked`}`
      : "No AIS sample";
    const latestText = row.latestIncident
      ? format(row.latestIncident.date, "dd MMM yyyy")
      : "—";
    setRoboto(pdf, "regular");
    pdf.setFontSize(7);
    const movementLines = pdf.splitTextToSize(
      sanitize(movementText),
      columns.movement - 9,
    );
    const latestLines = pdf.splitTextToSize(sanitize(latestText), latest - 9);
    const rowH = Math.max(
      60,
      Math.max(movementLines.length, latestLines.length) * 8 + 12,
    );
    setFill(pdf, row.incidents > 0 ? POLAR : WHITE);
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.45);
    pdf.rect(MX, y, CW, rowH, "FD");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7.2);
    pdf.text(sanitize(row.key), MX + 6, y + 13);
    setText(pdf, row.risk.pending ? DUSK : ELECTRIC);
    setRoboto(pdf, "bold");
    pdf.text(
      sanitize(row.risk.pending ? "Pending" : row.risk.label),
      MX + columns.name + 6,
      y + 13,
    );
    setText(pdf, DUSK);
    setRoboto(pdf, "bold");
    pdf.text(String(row.incidents), MX + columns.name + columns.risk + 6, y + 13);
    setRoboto(pdf, "regular");
    pdf.text(
      movementLines,
      MX + columns.name + columns.risk + columns.incidents + 6,
      y + 12,
      { lineHeightFactor: 1.15 },
    );
    pdf.text(
      latestLines,
      MX + CW - latest + 6,
      y + 12,
      { lineHeightFactor: 1.15 },
    );
    const impact = row.operationalRead;
    setText(pdf, DUSK);
    setRoboto(pdf, "light");
    pdf.setFontSize(6.1);
    const impactLines = pdf.splitTextToSize(
      sanitize(`Operational impact: ${impact}`),
      CW - 12,
    );
    pdf.text(impactLines, MX + 6, y + rowH - 10, { lineHeightFactor: 1.1 });
    y += rowH;
  }
  ctx.y = y;
}

function drawThreatRow(
  ctx: Ctx,
  row: {
    date: Date;
    location: string;
    type: string;
    severity: string;
    title: string;
  },
  y: number,
  width: number,
  major: boolean,
): number {
  const { pdf, MX } = ctx;
  const titleLines = pdf.splitTextToSize(sanitize(row.title), width - 190);
  const rowH = Math.max(52, titleLines.length * 8 + 22);
  setFill(pdf, major ? POLAR : WHITE);
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.45);
  pdf.rect(MX, y, width, rowH, "FD");
  setFill(pdf, major ? NAVY : ELECTRIC);
  pdf.circle(MX + 10, y + 12, major ? 4 : 3, "F");
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(7);
  pdf.text(format(row.date, "dd MMM"), MX + 20, y + 13);
  pdf.text(sanitize(row.location), MX + 65, y + 13);
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(6.8);
  pdf.text(sanitize(row.type), MX + 65, y + 24);
  setText(pdf, ELECTRIC);
  pdf.text(sanitize(row.severity.toUpperCase()), MX + 65, y + 37);
  setText(pdf, NAVY);
  setRoboto(pdf, "regular");
  pdf.text(titleLines, MX + 190, y + 13, { lineHeightFactor: 1.15 });
  return rowH;
}

function drawThreatPicture(
  ctx: Ctx,
  presentation: ShippingSevenPagePresentation,
  visible: { vessel: boolean; piracy: boolean },
) {
  const { pdf, MX, CW } = ctx;
  const toThreatRow = (row: ShippingSevenPagePresentation["timeline"]["rows"][number]) => ({
    date: row.date,
    location: row.physicalLocation ?? row.country ?? "Location not established",
    type: row.type,
    severity: row.severityLabel,
    title: row.title,
    major: row.major,
  });
  const vesselRows = presentation.timeline.rows.map(toThreatRow);
  const piracyRows = presentation.piracySecondary.rows.map(toThreatRow);

  let y = ctx.TOP + 43;
  const shownVessel = vesselRows.slice(0, 6);
  const shownPiracy = piracyRows.slice(0, 4);
  if (visible.vessel) {
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9);
    pdf.text("THREAT TIMELINE", MX, y);
    y += 8;
    if (presentation.timeline.countNote) {
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(6.6);
      pdf.text(presentation.timeline.countNote, MX, y + 10);
      y += 18;
    } else {
      y += 6;
    }
    for (const row of shownVessel) {
      y += drawThreatRow(ctx, row, y, CW, row.major) + 4;
    }
    if (presentation.timeline.capped) {
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(6.3);
      pdf.text(
        presentation.timeline.countNote ??
          `Showing ${shownVessel.length} of ${presentation.timeline.totalCount} incidents.`,
        MX,
        y,
      );
      y += 13;
    }
    if (shownVessel.length === 0) {
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(8);
      pdf.text("No validated commercial-vessel attack or seizure event is reported.", MX, y + 9);
      y += 22;
    }
  }

  if (visible.piracy) {
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9);
    pdf.text("PIRACY AND ARMED ROBBERY", MX, y + 8);
    y += 17;
    for (const row of shownPiracy) {
      y += drawThreatRow(ctx, row, y, CW, row.major) + 3;
    }
    if (presentation.piracySecondary.capped) {
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(6.3);
      pdf.text(
        presentation.piracySecondary.countNote ??
          `Showing ${shownPiracy.length} of ${presentation.piracySecondary.totalCount} incidents.`,
        MX,
        y,
      );
      y += 12;
    }
    if (shownPiracy.length === 0) {
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(8);
      pdf.text("No validated piracy or armed-robbery event is reported.", MX, y + 9);
      y += 22;
    }
  }

  // AIS is explicitly a context strip, never another incident category.
  const theatres = presentation.matrix
    .map((row) => row.movement)
    .filter((movement): movement is NonNullable<typeof movement> => Boolean(movement));
  if (theatres.length > 0 && y < ctx.H - ctx.BOTTOM - 36) {
    setFill(pdf, POLAR);
    setStroke(pdf, POLAR);
    pdf.rect(MX, y + 3, CW, 25, "FD");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.2);
    pdf.text("AIS MOVEMENT CONTEXT", MX + 7, y + 14);
    setText(pdf, DUSK);
    setRoboto(pdf, "light");
    pdf.setFontSize(5.8);
    const movement = theatres
      .slice(0, 4)
      .map((theatre) => `${theatre.theatre}: ${formatMaritimeMovementSample(theatre)}`)
      .join("  |  ");
    pdf.text(pdf.splitTextToSize(sanitize(movement), CW - 105).slice(0, 2), MX + 105, y + 11);
  }
}

function drawCommercialConsequenceGrid(
  ctx: Ctx,
  presentation: ShippingSevenPagePresentation,
) {
  const { pdf, MX, CW } = ctx;
  const groups = buildShippingCommercialCategories(presentation.commercialEffects);
  const gap = 18;
  const width = (CW - gap) / 2;
  let y = ctx.y;
  for (let offset = 0; offset < groups.length; offset += 2) {
    let height = 42;
    for (const [column, group] of groups.slice(offset, offset + 2).entries()) {
      const fullWidth = group.title === "Other documented effects";
      const w = fullWidth ? CW : width;
      const x = MX + column * (width + gap);
      setStroke(pdf, POLAR);
      pdf.setLineWidth(.5);
      pdf.line(x, y, x + w, y);
      setText(pdf, NAVY);
      setRoboto(pdf, "bold");
      pdf.setFontSize(8);
      pdf.text(group.title.toUpperCase(), x, y + 12);
      setText(pdf, DUSK);
      setRoboto(pdf, "light");
      pdf.setFontSize(8);
      const text = group.lines.length ? group.lines.join("\n") : "Not established in available reporting.";
      const lines = pdf.splitTextToSize(sanitize(text), w);
      pdf.text(lines, x, y + 25, { lineHeightFactor: 1.2 });
      height = Math.max(height, 33 + lines.length * 9.6);
    }
    y += height + 8;
  }
  ctx.y = y;
}

function drawCompactBarChart(
  ctx: Ctx,
  title: string,
  rows: BarRow[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const { pdf } = ctx;
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(7.5);
  pdf.text(sanitize(title.toUpperCase()), x, y + 8);
  // Keep the explicit residual bucket visible even when its value is zero;
  // otherwise "all geography known" is indistinguishable from missing data.
  const visible = rows.filter((row) => row.value > 0 || row.label === "Unknown");
  if (visible.length === 0) {
    setText(pdf, DUSK);
    setRoboto(pdf, "light");
    pdf.setFontSize(6.8);
    pdf.text("No identified records", x, y + 28);
    return;
  }
  const max = Math.max(...visible.map((row) => row.value), 1);
  const labelW = Math.min(72, width * 0.38);
  const barW = width - labelW - 20;
  const rowH = Math.min(32, (height - 18) / visible.length);
  for (const [index, row] of visible.entries()) {
    const rowY = y + 19 + index * rowH;
    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(6.1);
    pdf.text(pdf.splitTextToSize(sanitize(row.label), labelW - 4).slice(0, 1), x, rowY + 8);
    setFill(pdf, WHITE);
    setStroke(pdf, POLAR);
    pdf.rect(x + labelW, rowY + 2, barW, 8, "S");
    const fillW = (row.value / max) * barW;
    setFill(pdf, row.label === "Unknown" ? POLAR : title.includes("Region") ? NAVY : ELECTRIC);
    if (fillW > 0) pdf.rect(x + labelW, rowY + 2, fillW, 8, "F");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.2);
    pdf.text(String(row.value), x + labelW + barW + 5, rowY + 9);
  }
}

function drawCommercialAndRegional(
  ctx: Ctx,
  publication: ReturnType<typeof finalizeShippingPublication>,
  presentation: ShippingSevenPagePresentation,
  visible: { commercial: boolean; regional: boolean },
) {
  const { pdf, MX, CW } = ctx;
  let y = ctx.TOP + 43;
  if (visible.commercial) {
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9);
    pdf.text("COMMERCIAL IMPACT ON SHIPPING", MX, y);
    y += 14;
    drawFitText(ctx, publication.prose.commercialImpactRead, MX, y, CW, 48, {
      color: DUSK,
      font: "light",
      maxSize: 8.8,
      minSize: 4.2,
      lineFactor: 1.2,
    });
    ctx.y = y + 57;
    drawCommercialConsequenceGrid(ctx, presentation);
    y = ctx.y + 8;
  }
  if (visible.regional) {
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.5);
    pdf.line(MX, y, MX + CW, y);
    // Keep both charts in the lower half of the page, beneath the sourced
    // commercial-effect read, rather than leaving a large uninformative void.
    const chartY = Math.max(y + 10, ctx.H / 2 + 10);
    const chartW = (CW - 14) / 2;
    drawCompactBarChart(ctx, "Incidents by Region", presentation.geography.regions.rows, MX, chartY, chartW, 190);
    drawCompactBarChart(ctx, "Records by Country", presentation.geography.countries.rows, MX + chartW + 14, chartY, chartW, 190);
  }
}

function reportBullets(text: string, max = 8): string[] {
  const normalized = sanitize(text ?? "").trim();
  if (!normalized) return [];
  const marked = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
  if (marked.length > 0) return marked.slice(0, max);
  return normalized
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

function drawAnalysisPage(
  ctx: Ctx,
  publication: ReturnType<typeof finalizeShippingPublication>,
  visible: { whatMatters: boolean; implications: boolean; watchNext: boolean },
) {
  const { pdf, MX, CW } = ctx;
  const top = ctx.TOP + 43;
  const title = (text: string, x: number, y: number, width: number) => {
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8.5);
    pdf.text(sanitize(text.toUpperCase()), x, y);
    setStroke(pdf, ELECTRIC);
    pdf.setLineWidth(0.9);
    pdf.line(x, y + 6, x + width, y + 6);
  };
  if (visible.whatMatters) {
    title("What Matters", MX, top, CW);
    drawFitText(ctx, publication.prose.whatMatters, MX, top + 13, CW, 114, {
      color: DUSK,
      font: "light",
      maxSize: 10,
      minSize: 3.8,
      lineFactor: 1.3,
      paragraphGap: 5,
    });
  }

  const lowerY = top + 145;
  const gap = 18;
  const colW = (CW - gap) / 2;
  if (visible.implications) title("Implications for Business", MX, lowerY, colW);
  if (visible.watchNext) title("Watch Next", MX + colW + gap, lowerY, colW);
  const implicationBullets = visible.implications
    ? reportBullets(publication.prose.implications, 8)
    : [];
  const watchBullets = visible.watchNext
    ? reportBullets(publication.prose.watchNext, 8)
    : [];
  const renderBulletColumn = (items: string[], x: number) => {
    if (items.length === 0) return;
    const text = items.map((item) => `- ${item}`).join("\n");
    drawFitText(ctx, text, x + 8, lowerY + 15, colW - 8, 220, {
      color: DUSK,
      font: "light",
      maxSize: 9,
      minSize: 3.8,
      lineFactor: 1.3,
      paragraphGap: 5,
    });
  };
  if (visible.implications) renderBulletColumn(implicationBullets, MX);
  if (visible.watchNext) renderBulletColumn(watchBullets, MX + colW + gap);
}

function drawPolestarPanel(
  ctx: Ctx,
  publication: ReturnType<typeof finalizeShippingPublication>,
) {
  const { pdf, MX, CW } = ctx;
  const y = ctx.TOP + 43;
  const h = 150;
  setFill(pdf, NAVY);
  pdf.rect(MX, y, CW, h, "F");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX, y, 5, h, "F");
  setText(pdf, WHITE);
  setRoboto(pdf, "bold");
  pdf.setFontSize(10);
  pdf.text("POLESTAR VIEW", MX + 14, y + 20);
  setText(pdf, POLAR);
  setRoboto(pdf, "light");
  pdf.setFontSize(6.7);
  pdf.text("CURRENT JUDGEMENT", MX + 14, y + 33);
  drawFitText(ctx, publication.prose.polestarView, MX + 14, y + 42, CW - 28, h - 52, {
    color: WHITE,
    font: "light",
    maxSize: 10,
    minSize: 3.5,
    lineFactor: 1.28,
    paragraphGap: 5,
  });
  ctx.y = y + h + 18;
}


function drawMonthlyIncidentRegister(ctx: Ctx, presentation: ShippingSevenPagePresentation) {
  const { pdf, MX, CW } = ctx;
  const rows = presentation.register.rows;
  if (rows.length === 0) return;

  const rowH = 20;
  const colDate = 35;
  const colLoc = 50;
  const colCountry = 50;
  const colCat = 50;
  const colConf = 40;

  const colIncident = (CW - colDate - colLoc - colCountry - colCat - colConf) * 0.55;
  const colOpRel = (CW - colDate - colLoc - colCountry - colCat - colConf) * 0.45;

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
    pdf.setFontSize(6);

    let x = MX + 4;
    pdf.text("DATE", x, ctx.y + 12); x += colDate;
    pdf.text("LOCATION", x, ctx.y + 12); x += colLoc;
    pdf.text("COUNTRY", x, ctx.y + 12); x += colCountry;
    pdf.text("CATEGORY", x, ctx.y + 12); x += colCat;
    pdf.text("INCIDENT", x, ctx.y + 12); x += colIncident;
    pdf.text("OPERATIONAL RELEVANCE", x, ctx.y + 12); x += colOpRel;
    pdf.text("CONFIDENCE", x, ctx.y + 12);
    ctx.y += rowH;
  };

  drawHeader();

  for (const r of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(7);

    const locLines = pdf.splitTextToSize(sanitize(r.physicalLocation || "—"), colLoc - 6);
    const ctryLines = pdf.splitTextToSize(sanitize(r.country || "—"), colCountry - 6);
    const catLines = pdf.splitTextToSize(sanitize(r.type || "—"), colCat - 6);
    const incLines = pdf.splitTextToSize(sanitize(r.title || "—"), colIncident - 6);
    const opLines = pdf.splitTextToSize(sanitize(r.summary || "—"), colOpRel - 6);

    const maxLines = Math.max(locLines.length, ctryLines.length, catLines.length, incLines.length, opLines.length);
    const rh = Math.max(rowH, maxLines * 10 + 8);

    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(7);
    }

    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.4 };

    let x = MX + 4;
    pdf.text(format(r.date, "dd MMM"), x, ctx.y + 12, textOpts); x += colDate;
    pdf.text(locLines, x, ctx.y + 12, textOpts); x += colLoc;
    pdf.text(ctryLines, x, ctx.y + 12, textOpts); x += colCountry;
    pdf.text(catLines, x, ctx.y + 12, textOpts); x += colCat;

    setText(pdf, NAVY);
    pdf.text(incLines, x, ctx.y + 12, textOpts); x += colIncident;

    setText(pdf, DUSK);
    pdf.text(opLines, x, ctx.y + 12, textOpts); x += colOpRel;
    pdf.text("High", x, ctx.y + 12, textOpts);

    ctx.y += rh;
  }
}


function drawRelatedRegistry(
  ctx: Ctx,
  presentation: ShippingSevenPagePresentation,
) {
  const { pdf, MX, CW } = ctx;
  setText(pdf, NAVY);
  setRoboto(pdf, "bold");
  pdf.setFontSize(9);
  const rows = presentation.register.rows;
  pdf.text("RELATED INCIDENTS", MX, ctx.y + 9);
  setText(pdf, DUSK);
  setRoboto(pdf, "light");
  pdf.setFontSize(6.2);
  pdf.text(
    presentation.register.countNote ??
      `Compact register: latest ${presentation.register.shownCount} prioritised developments.`,
    MX,
    ctx.y + 20,
  );
  let y = ctx.y + 29;
  const dateW = 57;
  const issueW = 112;
  const sevW = 55;
  const titleW = CW - dateW - issueW - sevW;
  const rowH = 27;
  setFill(pdf, NAVY);
  pdf.rect(MX, y, CW, 18, "F");
  setText(pdf, WHITE);
  setRoboto(pdf, "bold");
  pdf.setFontSize(6.2);
  pdf.text("DATE", MX + 5, y + 12);
  pdf.text("ISSUE", MX + dateW + 5, y + 12);
  pdf.text("TITLE", MX + dateW + issueW + 5, y + 12);
  pdf.text("SEVERITY", MX + CW - sevW + 5, y + 12);
  y += 18;
  for (const row of rows) {
    setFill(pdf, WHITE);
    setStroke(pdf, POLAR);
    pdf.rect(MX, y, CW, rowH, "FD");
    setText(pdf, DUSK);
    setRoboto(pdf, "regular");
    pdf.setFontSize(6.3);
    pdf.text(format(row.date, "dd MMM yyyy"), MX + 5, y + 12);
    pdf.text(pdf.splitTextToSize(sanitize(row.type), issueW - 9).slice(0, 2), MX + dateW + 5, y + 10, { lineHeightFactor: 1.1 });
    setText(pdf, NAVY);
    const titleLines = pdf.splitTextToSize(sanitize(row.title), titleW - 9);
    pdf.text(titleLines.slice(0, 2), MX + dateW + issueW + 5, y + 10, { lineHeightFactor: 1.1 });
    const severity = row.severityLabel || "Not assessed";
    setText(pdf, ELECTRIC);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.2);
    pdf.text(sanitize(severity.toUpperCase()), MX + CW - sevW + 5, y + 12);
    y += rowH;
  }
  if (rows.length === 0) {
    setText(pdf, DUSK);
    setRoboto(pdf, "light");
    pdf.setFontSize(7);
    pdf.text("No related incident was identified outside the detailed report surfaces.", MX + 5, y + 13);
    y += rowH;
  }
  ctx.y = y;
}

function drawShallowDisclaimerFooter9pt(ctx: Ctx) {
  const { pdf, MX, CW, H } = ctx;
  const disclaimerFontSize = 9;
  const disclaimerLineHeightFactor = 1.2;
  const disclaimerLineHeight =
    disclaimerFontSize * disclaimerLineHeightFactor;
  setRoboto(pdf, "light");
  pdf.setFontSize(disclaimerFontSize);
  const lines = pdf.splitTextToSize(sanitize(DISCLAIMER_TEXT), CW - 14);
  const h = Math.max(30, lines.length * disclaimerLineHeight + 12);
  const y = H - FOOTER_BAND_H - h - 5;
  setFill(pdf, POLAR);
  pdf.rect(MX, y, CW, h, "F");
  setText(pdf, DUSK);
  pdf.setFontSize(disclaimerFontSize);
  pdf.text(lines, MX + 7, y + 10, {
    lineHeightFactor: disclaimerLineHeightFactor,
  });
}

// Exporter ------------------------------------------------------------------

export async function exportShippingReportPdf(
  data: ShippingReportData,
  incidents: ShippingReportIncident[],
  filename: string,
  movement: MaritimeMovement[] = [],
  maritimeSecurityEvents: MaritimeSecurityEvent[] = [],
  incidentSummaries: Record<string, string> = {},
  aiProse?: TopicAiProse | null,
  hiddenSections?: string[],
  sectionOverrides?: TopicSectionOverrides | null,
): Promise<void> {
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try {
    headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd");
  } catch {
    /* keep */
  }

  // Resolve and validate the complete publication bundle before the cover or
  // any other PDF surface is painted.  Preview uses this exact finalizer.
  const publication = assertShippingPublication(
    finalizeShippingPublication({
      report: data,
      incidents,
      movement,
      maritimeSecurityEvents,
      incidentSummaries,
      aiProse,
      hiddenSections,
      sectionOverrides,
    }),
  );
  // The compact product has one renderer-neutral presentation contract. The
  // preview already consumes this finalizer-owned boundary; native PDF must
  // consume the exact same canonical timeline, matrix, charts, effects, and
  // bounded register rather than re-deriving rows from capped tables.
  const presentation = publication.sevenPage;
  const show = (key: string) => !publication.hiddenSections.has(key);
  const win = resolveReportWindow(data.topic, data.issueDate);

  const ctx = createCtx({ kind: resolvedTitle, issueDate: headerDate });
  // Embed Roboto on this pdf instance before drawing any text. Without this,
  // jsPDF silently falls back to Helvetica, which the brand spec forbids.
  await ensureRobotoLoaded(ctx.pdf);
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  try {
    const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
    coverImage = await prepareCoverImage(shippingCoverUrl, ctx.W, heroH);
  } catch (err) {
    console.warn(
      "[exportShippingReportPdf] cover image load failed, falling back to gradient hero",
      err,
    );
  }
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: "MONTHLY MARITIME SECURITY & OPERATIONAL RISK ASSESSMENT",
    // win.label is just the date range. The cover renderer expects the
    // full "REPORTING PERIOD: ..." string — every caller prepends its own
    // prefix so the label never reads twice.
    reportingPeriod: `REPORTING PERIOD: ${win.label.toUpperCase()}`,
    coverImage,
  });
  void cadence;

  // The Shipping Watch contract is an actual seven-page product:
  // cover, maritime situation, chokepoint watch, threat picture, commercial
  // and regional impact, analytical judgement, and Polestar view/registry.
  // Page-local renderers deliberately keep sections together and never create
  // an eighth page for long analyst prose.
  beginBodyPages(ctx);

  const writeKpi = (label: string, value: string, note: string, x: number, y: number) => {
    ctx.pdf.setFontSize(8);
    setRoboto(ctx.pdf, "bold");
    setText(ctx.pdf, DUSK);
    ctx.pdf.text(label.toUpperCase(), x, y);
    ctx.pdf.setFontSize(18);
    setText(ctx.pdf, NAVY);
    ctx.pdf.text(value, x, y + 20);
    ctx.pdf.setFontSize(8);
    setRoboto(ctx.pdf, "regular");
    setText(ctx.pdf, DUSK);
    ctx.pdf.text(note, x, y + 32);
  };

  // PAGE 1 — Monthly Executive Assessment
  startInteriorPage(ctx, "Monthly Executive Assessment");

  ensureSpace(ctx, 60);
  drawSectionHeading(ctx, "Indicators");
  const y = ctx.y;
  writeKpi("Vessel Security", publication.prose.vesselSecurityAssessment, publication.prose.vesselSecurityTrend, ctx.MX, y + 15);
  writeKpi("Piracy / Armed Robbery", publication.prose.piracyAssessment, publication.prose.piracyTrend, ctx.MX + 150, y + 15);
  writeKpi("Ports & Terminals", publication.prose.portsTerminalsAssessment, publication.prose.portsTerminalsTrend, ctx.MX + 300, y + 15);
  ctx.y += 60;

  ensureSpace(ctx, 60);
  writeKpi("Key Routes / Chokepoints", publication.prose.routesChokepointsAssessment, publication.prose.routesChokepointsTrend, ctx.MX, ctx.y + 15);
  writeKpi("Commercial Disruption", publication.prose.commercialDisruptionAssessment, publication.prose.commercialDisruptionTrend, ctx.MX + 150, ctx.y + 15);
  ctx.y += 60;

  drawSectionHeading(ctx, "Bottom Line Up Front");
  renderProse(ctx, publication.prose.executiveSummary);

  drawSectionHeading(ctx, "Key Judgements");
  renderProse(ctx, publication.prose.keyJudgements);


  // PAGE 2 — Regional Maritime Security Picture
  startInteriorPage(ctx, "Regional Maritime Security Picture");
  drawSectionHeading(ctx, "Regional Picture");
  renderProse(ctx, publication.prose.regionalCountryRead);
  drawSectionHeading(ctx, "Active Map");
  drawShippingRegionalMap(ctx, presentation);

  // PAGE 3 — Threat Trends
  startInteriorPage(ctx, "Threat Trends");
  drawSectionHeading(ctx, "Monthly Trends");
  if (publication.dataset.threatTrends && publication.dataset.threatTrends.length > 0) {
    for (const t of publication.dataset.threatTrends) {
      ensureSpace(ctx, 50);
      setRoboto(ctx.pdf, "bold");
      ctx.pdf.setFontSize(11);
      setText(ctx.pdf, NAVY);
      ctx.pdf.text(t.category, ctx.MX, ctx.y);
      ctx.y += 15;

      setRoboto(ctx.pdf, "regular");
      ctx.pdf.setFontSize(9);
      setText(ctx.pdf, DUSK);
      ctx.pdf.text(`Current month: ${t.currentMonth}`, ctx.MX, ctx.y);
      ctx.pdf.text(`Previous month: ${t.previousMonth !== null ? t.previousMonth : "—"}`, ctx.MX + 120, ctx.y);
      ctx.pdf.text(`3-month average: ${t.threeMonthAverage !== null ? t.threeMonthAverage : "—"}`, ctx.MX + 260, ctx.y);
      ctx.pdf.text(`Trend: ${t.trend !== null ? t.trend : "—"}`, ctx.MX + 400, ctx.y);
      ctx.y += 20;
    }
  } else {
    renderProse(ctx, "Trend data is unavailable for this reporting period.");
  }


  // PAGE 4 — Routes & Ports to Watch
  startInteriorPage(ctx, "Routes & Ports to Watch");
  drawSectionHeading(ctx, "Dynamic Routes and Ports");
  renderProse(ctx, publication.prose.routesAndPortsRead);

  // PAGE 5 — Commercial & Operational Impact
  startInteriorPage(ctx, "Commercial & Operational Impact");
  drawSectionHeading(ctx, "Commercial Signal");
  renderProse(ctx, publication.prose.commercialImpactRead);

  // PAGE 6 — Polestar View
  startInteriorPage(ctx, "Polestar View — Next 30 Days");
  drawSectionHeading(ctx, "Strategic Picture");
  renderProse(ctx, publication.prose.polestarView);
  drawSectionHeading(ctx, "Outlook — Next 30 Days");
  renderProse(ctx, publication.prose.polestarOutlookRead);
  drawSectionHeading(ctx, "Watch Indicators");
  renderProse(ctx, publication.prose.polestarWatchIndicators);
  drawSectionHeading(ctx, "Escalation Triggers");
  renderProse(ctx, publication.prose.polestarEscalationTriggers);

  // PAGE 7 — Monthly Incident Register
  startInteriorPage(ctx, "Monthly Incident Register");
  drawSectionHeading(ctx, "Incident Register");
  const rm = publication.dataset.registerMetrics;
  if (rm) {
    setRoboto(ctx.pdf, "bold");
    ctx.pdf.setFontSize(9);
    setText(ctx.pdf, NAVY);
    ctx.pdf.text(`TOTAL MATERIAL INCIDENTS THIS MONTH: ${rm.currentMonth}`, ctx.MX, ctx.y);
    if (rm.previousMonth !== null) {
      ctx.pdf.text(`PREVIOUS MONTH: ${rm.previousMonth}`, ctx.MX + 240, ctx.y);
    }
    if (rm.threeMonthAverage !== null) {
      ctx.pdf.text(`3-MONTH AVERAGE: ${rm.threeMonthAverage}`, ctx.MX + 360, ctx.y);
    }
    ctx.y += 20;
  }

  drawMonthlyIncidentRegister(ctx, presentation);
  drawShallowDisclaimerFooter9pt(ctx);

  drawFooters(ctx.pdf, undefined, undefined, true);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
