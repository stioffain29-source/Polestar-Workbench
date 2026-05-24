import { jsPDF } from "jspdf";
import { format } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

// Polestar core brand palette.
export const NAVY = "#0B0A3D";       // Midnight Blue
export const ELECTRIC = "#465BFF";   // Electric Blue
export const POLAR = "#E2E2E2";      // Polar Gray
export const DUSK = "#363636";       // Dusk Gray
export const WHITE = "#FFFFFF";
export const CARD_BG = "#FFFFFF";
export const PAGE_BG = "#FFFFFF";

// Risk palette — use only for severity/risk.
export const SEV_COLOR: Record<string, string> = {
  extreme: "#800000",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#B8C2CC",
};
export const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
export const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};
export function sevKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export const DISCLAIMER_TEXT =
  "Polestar Advisory Pte. Ltd. is an independent company registered in Singapore. " +
  "The information in this report is based on open sources and is assessed as accurate at the time of writing. " +
  "It is provided for general informational purposes only and does not constitute advice or a comprehensive " +
  "assessment of all risks. No reliance should be placed on this information for decision making without " +
  "further independent verification.";

export const SOURCE_NOTES_TEXT =
  "Based on records held in the Polestar Workbench at time of export. " +
  "Records without coordinates may appear in tables and counts but not maps. " +
  "Severity ratings follow the Polestar five-tier vocabulary: Insignificant, Low, Moderate, High, Extreme.";

export const POLESTAR_URL = "polestar-advisory.com";
export const POLESTAR_EMAIL = "info@polestar-advisory.com";

/** Replace non-WinAnsi typographic characters so jsPDF Helvetica renders cleanly. */
export function sanitize(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/\u2018|\u2019|\u02BC/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u2022/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
export function setFill(pdf: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setFillColor(r, g, b);
}
export function setStroke(pdf: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setDrawColor(r, g, b);
}
export function setText(pdf: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setTextColor(r, g, b);
}

/**
 * Draw the Polestar blue gradient (navy -> electric) into a rectangle.
 * Spec: linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%) — approximated
 * here as a smooth horizontal navy-left to electric-right interpolation,
 * which reads as the same brand band in print.
 */
export function drawBrandGradient(pdf: jsPDF, x: number, y: number, w: number, h: number) {
  const [r1, g1, b1] = hexToRgb(NAVY);
  const [r2, g2, b2] = hexToRgb(ELECTRIC);
  const steps = Math.max(40, Math.ceil(w));
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    pdf.setFillColor(r, g, b);
    // Slight overlap removes hairline gaps between strips.
    pdf.rect(x + i * stepW, y, stepW + 0.6, h, "F");
  }
}

export interface HeaderOpts {
  /** Report title shown right-aligned in the running page header. */
  kind: string;
  /** Formatted issue date (kept for footer-free callers that still want it elsewhere). */
  issueDate: string;
}

export interface Ctx {
  pdf: jsPDF;
  W: number;
  H: number;
  MX: number;
  TOP: number;
  BOTTOM: number;
  CW: number;
  y: number;
  header: HeaderOpts;
  /** Set to true while drawing a cover page so newPage() suppresses chrome. */
  suppressHeader?: boolean;
}

// Header/footer band geometry — applied identically on every body page.
export const HEADER_BAND_H = 46;
export const FOOTER_BAND_H = 28;

export function createCtx(header: HeaderOpts): Ctx {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const MX = 40;
  // TOP leaves clearance under the gradient header; BOTTOM clears the Polar footer.
  const TOP = HEADER_BAND_H + 22;
  const BOTTOM = FOOTER_BAND_H + 12;
  const ctx: Ctx = { pdf, W, H, MX, TOP, BOTTOM, CW: W - MX * 2, y: TOP, header };
  return ctx;
}

/**
 * Draw the full-width gradient page header. Logo left, report title right.
 * Flush to the top edge — no white margin above, left or right.
 */
export function drawPageHeader(ctx: Ctx) {
  const { pdf, W, header } = ctx;
  drawBrandGradient(pdf, 0, 0, W, HEADER_BAND_H);
  try {
    // Logo height ~22, vertically centred in the band.
    pdf.addImage(polestarLogo, "PNG", 18, (HEADER_BAND_H - 22) / 2, 132, 22, undefined, "FAST");
  } catch { /* ignore */ }
  setText(pdf, WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(sanitize(header.kind.toUpperCase()), W - 18, HEADER_BAND_H / 2 + 4, { align: "right" });
}

/**
 * Start the first body page. Call this once after drawing a custom full-page
 * cover so the body always begins on its own page with chrome applied.
 */
export function beginBodyPages(ctx: Ctx) {
  ctx.pdf.addPage();
  ctx.y = ctx.TOP;
  drawPageHeader(ctx);
}

export function newPage(ctx: Ctx) {
  ctx.pdf.addPage();
  ctx.y = ctx.TOP;
  if (!ctx.suppressHeader) drawPageHeader(ctx);
}

export function ensureSpace(ctx: Ctx, h: number) {
  if (ctx.y + h > ctx.H - ctx.BOTTOM) newPage(ctx);
}

export function drawSectionHeading(ctx: Ctx, title: string) {
  ensureSpace(ctx, 36);
  const { pdf, MX, CW } = ctx;
  setText(pdf, NAVY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text(sanitize(title.toUpperCase()), MX, ctx.y);
  ctx.y += 6;
  // Thin blue divider line under the heading.
  setStroke(pdf, ELECTRIC);
  pdf.setLineWidth(0.6);
  pdf.line(MX, ctx.y, MX + CW, ctx.y);
  ctx.y += 14;
}

export function renderProse(ctx: Ctx, body: string) {
  const { pdf, MX, CW } = ctx;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  setText(pdf, DUSK);
  const lineH = 14;
  const paragraphs = sanitize(body).split(/\n+/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    const lines: string[] = pdf.splitTextToSize(p, CW);
    const paraH = lines.length * lineH + 6;
    const available = ctx.H - ctx.BOTTOM - ctx.y;
    const fitsOnNewPage = paraH <= ctx.H - ctx.TOP - ctx.BOTTOM;
    if (paraH > available && fitsOnNewPage) newPage(ctx);
    if (!fitsOnNewPage) {
      for (const ln of lines) {
        ensureSpace(ctx, lineH);
        pdf.text(ln, MX, ctx.y + 10);
        ctx.y += lineH;
      }
    } else {
      for (const ln of lines) {
        pdf.text(ln, MX, ctx.y + 10);
        ctx.y += lineH;
      }
    }
    ctx.y += 6;
  }
  ctx.y += 6;
}

export interface KpiCardData {
  label: string;
  value: string;
  note?: string;
  /** Severity key (lowercase) to colour the accent strip from SEV_COLOR. */
  severity?: string;
}

export function drawFastFactsKpiCards(ctx: Ctx, cards: KpiCardData[]) {
  if (cards.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const cols = 3;
  const gap = 10;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const cardH = 68;
  const rows = Math.ceil(cards.length / cols);
  const totalH = rows * cardH + (rows - 1) * gap;
  ensureSpace(ctx, totalH);

  for (let i = 0; i < cards.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = MX + col * (cardW + gap);
    const yy = ctx.y + row * (cardH + gap);
    const c = cards[i];
    const sevK = c.severity ? sevKey(c.severity) : "";
    const accent = sevK && SEV_COLOR[sevK] ? SEV_COLOR[sevK] : ELECTRIC;

    // Card body
    setFill(pdf, CARD_BG);
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.rect(x, yy, cardW, cardH, "FD");

    // Accent strip (top)
    setFill(pdf, accent);
    pdf.rect(x, yy, cardW, 3, "F");

    // Label
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text(sanitize(c.label.toUpperCase()), x + 10, yy + 18);

    // Value
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    const valueLines: string[] = pdf.splitTextToSize(sanitize(c.value), cardW - 20);
    const baseY = yy + 38;
    pdf.text(valueLines.slice(0, 2), x + 10, baseY);

    // Note
    if (c.note) {
      setText(pdf, DUSK);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const noteLines: string[] = pdf.splitTextToSize(sanitize(c.note), cardW - 20);
      pdf.text(noteLines.slice(0, 2), x + 10, yy + cardH - 10);
    }
  }
  ctx.y += totalH + 18;
}

export function drawDisclaimer(ctx: Ctx) {
  drawSectionHeading(ctx, "Disclaimer");
  renderProse(ctx, DISCLAIMER_TEXT);
}

export function drawSourceNotes(ctx: Ctx, extra?: string) {
  drawSectionHeading(ctx, "Source Notes / Data Notes");
  renderProse(ctx, extra ? `${SOURCE_NOTES_TEXT}\n\n${extra}` : SOURCE_NOTES_TEXT);
}

/**
 * Draw the standard footer on every body page (skips page 1, which is the
 * full-bleed cover). Polar Gray band, flush to the bottom edge.
 * Contents: website left, email centre, "Page X of Y" right. Nothing else.
 */
export function drawFooters(pdf: jsPDF, _reportDate?: string) {
  void _reportDate; // intentionally unused — date no longer in footer per brand spec
  const pageCount = pdf.getNumberOfPages();
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  // Body pages are 2..N; page 1 is the cover.
  for (let p = 2; p <= pageCount; p++) {
    pdf.setPage(p);
    setFill(pdf, POLAR);
    pdf.rect(0, H - FOOTER_BAND_H, W, FOOTER_BAND_H, "F");
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const ty = H - FOOTER_BAND_H / 2 + 3;
    pdf.text(sanitize(POLESTAR_URL), 18, ty);
    pdf.text(sanitize(POLESTAR_EMAIL), W / 2, ty, { align: "center" });
    pdf.text(sanitize(`Page ${p - 1} of ${pageCount - 1}`), W - 18, ty, { align: "right" });
  }
}

/**
 * Full-bleed Polestar cover. Used by every report builder.
 * - Top gradient band with the white logo
 * - Tall centred gradient hero with title + subtitle + reporting period
 * - Bottom gradient band with the website
 * The whole page is gradient — no white showing on any edge.
 */
export interface CoverOpts {
  /** Main report title (rendered large, white, uppercase). */
  title: string;
  /** Subtitle / report family (e.g. "Country Report", "Weekly Briefing"). */
  subtitle: string;
  /** Reporting-period line (e.g. "Reporting period: 1 May 2026 - 7 May 2026"). */
  reportingPeriod: string;
  /** Optional eyebrow line above the title (e.g. region or product family). */
  eyebrow?: string;
}
export function drawPolestarCover(ctx: Ctx, opts: CoverOpts) {
  const { pdf, W, H } = ctx;
  ctx.suppressHeader = true;
  // Full-page gradient (no white margins anywhere).
  drawBrandGradient(pdf, 0, 0, W, H);

  // Logo top-left (in the natural header position).
  try {
    pdf.addImage(polestarLogo, "PNG", 32, 32, 160, 26, undefined, "FAST");
  } catch { /* ignore */ }

  // Eyebrow
  setText(pdf, WHITE);
  const centreY = H * 0.55;
  if (opts.eyebrow) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(sanitize(opts.eyebrow.toUpperCase()), 40, centreY - 90, {
      charSpace: 1.6,
    });
  }

  // Title (very large, white, uppercase, may wrap to 3 lines)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(34);
  const titleLines: string[] = pdf.splitTextToSize(
    sanitize((opts.title || "Untitled report").toUpperCase()),
    W - 80,
  );
  let ty = centreY - 40;
  for (const ln of titleLines.slice(0, 3)) {
    pdf.text(ln, 40, ty);
    ty += 38;
  }

  // Subtitle
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(13);
  pdf.text(sanitize(opts.subtitle), 40, ty + 8);

  // Reporting period
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(sanitize(opts.reportingPeriod), 40, ty + 28);

  // Bottom: website (no other text per brand spec).
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(sanitize(POLESTAR_URL), 40, H - 36);

  ctx.suppressHeader = false;
}

export function todayLabel(): string {
  return format(new Date(), "dd MMM yyyy");
}
