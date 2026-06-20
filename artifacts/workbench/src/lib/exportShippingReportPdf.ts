import { format, parseISO } from "date-fns";
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
import { LOCATION_NOT_IDENTIFIED as _LOCATION_NOT_IDENTIFIED } from "./shippingCountry";
import {
  buildShippingReportDataset,
  type ShippingReportIncident,
  type BarRow,
  type ChokepointRow,
  type EnrichedIncident,
  type VesselRow,
  type PiracyRow,
} from "./shippingReportDataset";
import type { MaritimeMovement } from "@workspace/api-client-react";
import {
  buildMaritimeIntelligence,
  MARITIME_RISK_COLOR,
  type MaritimeIntelligence,
} from "./maritimeIntelligence";

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

// Shipping report PDF. Section order (per final spec):
//   Cover -> Executive Summary -> Fast Facts ->
//   Chokepoint / Route Read (prose + chokepoint table) ->
//   Vessel Threat and Piracy Read (prose + vessel table + piracy table) ->
//   Commercial Impact on Shipping (prose + commercial table) ->
//   Regional and Country View (prose + region bar + country bar) ->
//   What Matters -> Implications for Business ->
//   Watch Next -> Polestar View ->
//   Related Incidents ->
//   Source Notes / Data Notes -> Disclaimer.
// Drops (vs. previous draft): Issue Type Breakdown, Daily Intelligence
// Summary, Incident Timeline, Severity Distribution, the standalone
// "Incidents by Country" heading. Everything in the body comes from
// shippingReportDataset so the preview and the PDF cannot drift.

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
}

export type { ShippingReportIncident };

// Chokepoint Watch -----------------------------------------------------------

function drawChokepointWatch(
  ctx: Ctx,
  rows: ChokepointRow[],
  windowLabel: string,
) {
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

  for (const row of rows) {
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
  if (heading) drawSubtitle(ctx, heading);
  if (rows.length === 0) {
    const { pdf, MX } = ctx;
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(opts.emptyMessage), MX, ctx.y + 10);
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }
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
  if (heading) drawSubtitle(ctx, heading);
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) {
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize(opts.emptyMessage ?? "No data reported this week."),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }
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

function drawRelatedIncidents(ctx: Ctx, rows: EnrichedIncident[]) {
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
    const rh = Math.max(
      rowH,
      Math.max(titleLines.length, issueLines.length) * 12 + 10,
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
    pdf.text(titleLines, MX + colDateW + colIssueW + 6, ctx.y + 14, textOpts);

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

// Maritime Intelligence (shared board) -------------------------------------
// Mirrors MaritimeIntelligenceReportSection in ShippingReportPreview.tsx —
// same sections, same order, same dataset, so preview == PDF.

const MARITIME_CONF_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

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

function drawMaritimeIntelligence(ctx: Ctx, board: MaritimeIntelligence) {
  const { pdf, MX } = ctx;
  const {
    bluf,
    risk,
    movementSnapshot,
    incidentSnapshot,
    chokepointCards,
    chokepointsAffected,
    confirmedIncidents,
    keyRiskIndicators,
    businessImpact,
    watchNext,
  } = board;

  drawSectionHeading(ctx, "Maritime Intelligence");

  // Executive summary — four KPI cards (Risk Level, Confirmed Incidents 7d,
  // Chokepoints Affected, Business Impact). Same four the board shows.
  const namedImpacts = businessImpact.filter((b) => b !== "No material impact");
  const execCards: KpiCardData[] = [
    { label: "Maritime Risk Level", value: `${risk.level} \u2014 ${risk.label}` },
    { label: "Confirmed Incidents 7d", value: String(incidentSnapshot.total) },
    { label: "Chokepoints Affected", value: `${chokepointsAffected} / ${chokepointCards.length}` },
    {
      label: "Business Impact",
      value: namedImpacts.length > 0 ? String(namedImpacts.length) : "\u2014",
    },
  ];
  drawFastFactsKpiCards(ctx, execCards);

  drawBlufBox(ctx, bluf);

  // Six chokepoint cards — rendered as compact stacked blocks (one per
  // chokepoint) so the PDF carries the SAME six chokepoints, in the same order,
  // as the on-screen board.
  drawSubtitle(ctx, "Chokepoint Cards");
  for (const card of chokepointCards) {
    ensureSpace(ctx, 20);
    setRoboto(pdf, "bold");
    pdf.setFontSize(10);
    setText(pdf, MARITIME_RISK_COLOR[card.risk.level]);
    pdf.text(
      sanitize(`${card.key} \u2014 L${card.risk.level} ${card.risk.label}`),
      MX,
      ctx.y + 9,
    );
    ctx.y += 13;
    const lines: string[] = [];
    lines.push(`Confirmed (7d): ${card.incidentCount}`);
    if (card.lastConfirmed) {
      let when = card.lastConfirmed.occurredAt;
      try {
        when = format(parseISO(card.lastConfirmed.occurredAt), "d MMM");
      } catch {
        /* keep raw */
      }
      lines.push(`Last incident: ${when} \u2014 ${card.lastConfirmed.title}`);
    } else {
      lines.push("Last incident: None in window");
    }
    if (card.movement) {
      const mv: string[] = [];
      if (card.movement.totalVessels != null) {
        mv.push(`${card.movement.totalVessels} vessels tracked`);
      } else {
        mv.push("Tracked");
      }
      if (card.movement.changeVs7DayBaseline) {
        mv.push(`${card.movement.changeVs7DayBaseline} vs 7-day baseline`);
      }
      lines.push(`Movement: ${mv.join(" \u00b7 ")}`);
    } else {
      lines.push("Movement: Movement data unavailable");
    }
    lines.push(`Business impact: ${card.businessImpact.join(", ")}`);
    lines.push(
      `Confidence: ${MARITIME_CONF_LABEL[card.confidence] ?? card.confidence}`,
    );
    drawMiniBullets(ctx, lines, lines.length);
  }

  // Confirmed maritime incidents — allowed categories only; movement/AIS never
  // appears here.
  drawSubtitle(ctx, "Confirmed Maritime Incidents");
  if (confirmedIncidents.length > 0) {
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
  } else {
    renderProse(
      ctx,
      "No confirmed maritime security incidents in the window.",
    );
  }

  // Maritime context — vessel movement (AIS). CONTEXT only.
  drawSubtitle(ctx, "Maritime Context \u2014 Vessel Movement (AIS)");
  if (movementSnapshot) {
    const items = movementSnapshot.theatres.map((t) => {
      const parts = [t.theatre];
      if (t.totalVessels != null) parts.push(`${t.totalVessels} vessels tracked`);
      if (t.changeVs7DayBaseline) {
        parts.push(`${t.changeVs7DayBaseline} vs 7-day baseline`);
      }
      return parts.join(" \u2014 ");
    });
    drawMiniBullets(ctx, items);
    renderProse(
      ctx,
      "Vessel movement is context only \u2014 it never counts as an incident and never raises the risk level on its own.",
    );
  } else {
    renderProse(
      ctx,
      "Movement data unavailable. Risk is assessed from confirmed incidents alone.",
    );
  }

  // Polestar View — Assessment / Business impact / Confidence / Watch next.
  drawSubtitle(ctx, "Polestar View");
  renderProse(ctx, risk.rationale);
  drawMiniBullets(ctx, keyRiskIndicators);
  renderProse(ctx, `Business impact: ${businessImpact.join("; ")}.`);
  renderProse(
    ctx,
    `Confidence: ${MARITIME_CONF_LABEL[risk.confidence] ?? risk.confidence}.`,
  );
  renderProse(ctx, "Watch next:");
  drawMiniBullets(ctx, watchNext);
}

// Exporter ------------------------------------------------------------------

export async function exportShippingReportPdf(
  data: ShippingReportData,
  incidents: ShippingReportIncident[],
  filename: string,
  movement: MaritimeMovement[] = [],
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

  const ctx = createCtx({ kind: resolvedTitle, issueDate: headerDate });
  // Embed Roboto on this pdf instance before drawing any text. Without this,
  // jsPDF silently falls back to Helvetica, which the brand spec forbids.
  await ensureRobotoLoaded(ctx.pdf);
  const win = resolveReportWindow(data.topic, data.issueDate);
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
    subtitle: "POLESTAR INSIGHTS",
    // win.label is just the date range. The cover renderer expects the
    // full "REPORTING PERIOD: ..." string — every caller prepends its own
    // prefix so the label never reads twice.
    reportingPeriod: `REPORTING PERIOD: ${win.label.toUpperCase()}`,
    coverImage,
  });
  void cadence;
  beginBodyPages(ctx);

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  // Maritime Intelligence — the one shared deterministic board, aligned to this
  // report's window so the PDF agrees with the live Shipping monitor. Drawn in
  // the SAME order ShippingReportPreview renders it (preview == PDF).
  const maritimeBoard = buildMaritimeIntelligence({
    incidents,
    movement,
    windowStart: win.start,
    windowEnd: win.end,
  });
  drawMaritimeIntelligence(ctx, maritimeBoard);

  const ds = buildShippingReportDataset(incidents, data.topic, data.issueDate);

  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, ds.fastFacts);

  // Chokepoint / Route Read — prose leads the chokepoint table.
  drawSectionWithProse(ctx, "Chokepoint / Route Read", ds.chokepointRouteRead);
  drawChokepointWatch(ctx, ds.chokepointRows, ds.thirtyDayShortLabel);

  // Vessel Threat and Piracy Read — prose leads both window tables.
  drawSectionWithProse(
    ctx,
    "Vessel Threat and Piracy Read",
    ds.vesselPiracyRead,
  );
  drawIncidentTable<VesselRow>(
    ctx,
    `Vessel Attacks (${ds.thirtyDayShortLabel})`,
    ds.vesselRows,
    {
      showActColumn: true,
      actFor: (r) => r.vesselType,
      emptyMessage: "No hostile vessel incidents reported this week.",
    },
  );
  drawIncidentTable<PiracyRow>(
    ctx,
    `Piracy and Armed Robbery (${ds.thirtyDayShortLabel})`,
    ds.piracyRows,
    {
      showActColumn: true,
      actFor: (r) => r.act,
      emptyMessage: "No piracy or armed-robbery reports this week.",
    },
  );

  // Commercial Impact on Shipping — prose leads the operational
  // commercial-pressure table; pure market commentary is filtered out
  // upstream in the dataset.
  drawSectionWithProse(
    ctx,
    "Commercial Impact on Shipping",
    ds.commercialImpactRead,
  );
  drawIncidentTable<EnrichedIncident>(ctx, null, ds.commercialRows, {
    showActColumn: true,
    actFor: (r) => r.issue,
    emptyMessage:
      "No port, freight, insurance or commercial-shipping disruption records in the weekly window.",
  });

  // Regional and Country View — prose leads the region and country bars.
  drawSectionWithProse(
    ctx,
    "Regional and Country View",
    ds.regionalCountryRead,
  );
  drawHorizontalBarChart(ctx, "Records by Region", ds.regionRows, {
    labelW: 160,
    emptyMessage: "No regional classifications reported this week.",
  });
  drawHorizontalBarChart(
    ctx,
    ds.countryRows.length >= 12
      ? "Records by Country (Top 12)"
      : "Records by Country",
    ds.countryRows,
    {
      labelW: 160,
      emptyMessage: "No identified incident countries reported this week.",
    },
  );

  // Editor-authored analyst sections. Editor text wins when supplied;
  // otherwise the dataset's auto-prose fills in so the report reads at
  // Fuel-Watch substance even before the analyst has written the form.
  // Editor text wins only when it carries substance. Short stub text
  // (legacy single-line entries, placeholders, " - " etc.) falls through
  // to the dataset's auto-prose so the report reads at Fuel-Watch
  // substance rather than printing a one-line section.
  const pickProse = (
    editor: string | null | undefined,
    auto: string,
  ): string => {
    const t = (editor ?? "").trim();
    if (t.length >= 240) return t;
    if (t.length === 0) return auto;
    // Treat a thin editor stub as a lead paragraph above the auto-prose
    // rather than discarding either side. This keeps any analyst note
    // visible while still delivering the full operational read below.
    return `${t}\n\n${auto}`;
  };
  drawSectionWithProse(
    ctx,
    "What Matters",
    pickProse(data.whatMatters, ds.autoWhatMatters),
  );
  drawBulletSection(
    ctx,
    "Implications for Business",
    pickProse(data.implications, ds.autoImplications),
  );
  drawBulletSection(
    ctx,
    "Watch Next",
    pickProse(data.watchNext, ds.autoWatchNext),
    8,
  );
  drawSectionWithProse(
    ctx,
    "Polestar View",
    pickProse(data.polestarView, ds.autoPolestarView),
  );

  drawRelatedIncidents(ctx, ds.relatedIncidents);

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
