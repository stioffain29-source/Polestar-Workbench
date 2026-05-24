import { jsPDF } from "jspdf";
import { format } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

// Polestar core brand palette.
export const NAVY = "#0B0B3D";       // Midnight Blue
export const ELECTRIC = "#4655FF";   // Electric Blue
export const POLAR = "#e2e2e2";      // Polar Gray
export const DUSK = "#303030";       // Dusk Gray
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
 * Spec: linear-gradient(-130deg, #0B0B3D 0%, #4655FF 100%) — approximated
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
  // Reserve enough vertical room for the heading itself plus a couple of
  // lines of body so we never leave an orphan heading at the page foot.
  ensureSpace(ctx, 64);
  // Breathing room above the heading when it follows other content on the
  // same page — prevents the previous section colliding with this one.
  if (ctx.y > ctx.TOP + 4) ctx.y += 10;
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

    // Vertical accent strip on the left of the card (no horizontal top bar).
    const STRIP_W = 4;
    setFill(pdf, accent);
    pdf.rect(x, yy, STRIP_W, cardH, "F");
    const PAD_L = STRIP_W + 10;

    // Label
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text(sanitize(c.label.toUpperCase()), x + PAD_L, yy + 16);

    // Value
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    const valueLines: string[] = pdf.splitTextToSize(sanitize(c.value), cardW - PAD_L - 10);
    const baseY = yy + 36;
    pdf.text(valueLines.slice(0, 2), x + PAD_L, baseY);

    // Note
    if (c.note) {
      setText(pdf, DUSK);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const noteLines: string[] = pdf.splitTextToSize(sanitize(c.note), cardW - PAD_L - 10);
      pdf.text(noteLines.slice(0, 2), x + PAD_L, yy + cardH - 10);
    }
  }
  ctx.y += totalH + 18;
}

export function drawDisclaimer(ctx: Ctx) {
  // Make sure the Disclaimer has room for the heading plus the body block
  // before drawing; otherwise push it to a fresh page.
  const need = 36 + 14 * 6;
  if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);
  else ctx.y += 8;
  drawSectionHeading(ctx, "Disclaimer");
  renderProse(ctx, DISCLAIMER_TEXT);
}

export function drawSourceNotes(ctx: Ctx, extra?: string) {
  // Same guard: keep the heading and the source notes block together so the
  // notes never collide with the previous section's table or italic note.
  const need = 36 + 14 * 6 + (extra ? 14 * 4 : 0);
  if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);
  else ctx.y += 14;
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
 * Standard Polestar cover layout. Used by every report builder.
 *
 *   1. Top gradient band (full width) — Polestar logo on the left.
 *   2. Hero image (full width, cropped cover-fit) — fills the middle.
 *      If no image is supplied, the band is filled with the brand gradient
 *      so the page remains seamless.
 *   3. Bottom gradient title block (full width) — white title, subtitle,
 *      reporting period and website (no shadows, no overlap with the image).
 *
 * The page is flush to all edges — no white margins anywhere.
 */
export interface CoverOpts {
  /** Main report title (rendered large, white, uppercase). */
  title: string;
  /** Subtitle line under the title (e.g. "POLESTAR INSIGHTS"). */
  subtitle: string;
  /** Reporting-period line (e.g. "REPORTING PERIOD: 1 MAY 2026 - 7 MAY 2026"). */
  reportingPeriod: string;
  /**
   * Optional cover image. Pass a pre-cropped JPEG/PNG data URL sized to fit
   * the hero slot; the helper `prepareCoverImage(url, w, h)` handles the
   * crop. When omitted, the hero slot is filled with the brand gradient.
   */
  coverImage?: { dataUrl: string; format: "JPEG" | "PNG" };
}

/** Cover-band geometries (points). Kept here so previews can mirror them. */
export const COVER_TOP_BAND_H = 70;
export const COVER_BOTTOM_BLOCK_H = 240;

export function drawPolestarCover(ctx: Ctx, opts: CoverOpts) {
  const { pdf, W, H } = ctx;
  ctx.suppressHeader = true;

  const topH = COVER_TOP_BAND_H;
  const bottomH = COVER_BOTTOM_BLOCK_H;
  const heroY = topH;
  const heroH = H - topH - bottomH;

  // 1. Top gradient band (flush to top/left/right edges).
  drawBrandGradient(pdf, 0, 0, W, topH);
  try {
    // Logo vertically centred in the top band, flush-left with 24pt inset.
    const logoH = 26;
    pdf.addImage(polestarLogo, "PNG", 24, (topH - logoH) / 2, 156, logoH, undefined, "FAST");
  } catch { /* ignore */ }

  // 2. Hero image (or gradient fallback) — full width, no borders.
  if (opts.coverImage) {
    try {
      pdf.addImage(opts.coverImage.dataUrl, opts.coverImage.format, 0, heroY, W, heroH, undefined, "FAST");
    } catch {
      drawBrandGradient(pdf, 0, heroY, W, heroH);
    }
  } else {
    drawBrandGradient(pdf, 0, heroY, W, heroH);
  }

  // 3. Bottom gradient title block (flush to bottom/left/right edges).
  const bottomY = H - bottomH;
  drawBrandGradient(pdf, 0, bottomY, W, bottomH);

  const padL = 32;
  setText(pdf, WHITE);

  // Title — large, white, uppercase, up to 2 lines.
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(38);
  const titleLines: string[] = pdf.splitTextToSize(
    sanitize((opts.title || "Untitled report").toUpperCase()),
    W - padL * 2,
  );
  const visibleTitle = titleLines.slice(0, 2);
  const titleLineH = 42;
  let ty = bottomY + 70;
  for (const ln of visibleTitle) {
    pdf.text(ln, padL, ty);
    ty += titleLineH;
  }

  // Subtitle (e.g. POLESTAR INSIGHTS).
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text(sanitize(opts.subtitle.toUpperCase()), padL, ty + 6, { charSpace: 1.6 });

  // Reporting period.
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(sanitize(opts.reportingPeriod.toUpperCase()), padL, ty + 28, { charSpace: 1.2 });

  // Website at bottom left, flush above the bottom edge.
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(sanitize(POLESTAR_URL), padL, H - 24, { charSpace: 1.2 });

  ctx.suppressHeader = false;
}

/**
 * Load an image URL and return a cover-cropped data URL sized exactly to
 * `outW x outH` (in any consistent unit — points work fine because jsPDF
 * accepts the dataURL at the size we pass to `addImage`). The crop preserves
 * the source aspect ratio and centres the visible area, like CSS `object-fit:
 * cover`. Returns the dataURL and the format jsPDF should use.
 */
export async function prepareCoverImage(
  src: string,
  outW: number,
  outH: number,
): Promise<{ dataUrl: string; format: "JPEG" | "PNG" }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to load cover image"));
    i.src = src;
  });
  // Render at 2x for crisp print output.
  const scale = 2;
  const cw = Math.round(outW * scale);
  const ch = Math.round(outH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D context unavailable");
  // Cover-fit: scale source so it fully covers the slot, centre-crop overflow.
  const srcRatio = img.naturalWidth / img.naturalHeight;
  const dstRatio = cw / ch;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (srcRatio > dstRatio) {
    // Source is wider than slot — crop sides.
    sw = Math.round(img.naturalHeight * dstRatio);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else if (srcRatio < dstRatio) {
    // Source is taller than slot — crop top/bottom.
    sh = Math.round(img.naturalWidth / dstRatio);
    sy = Math.round((img.naturalHeight - sh) / 2);
  }
  g.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), format: "JPEG" };
}

export function todayLabel(): string {
  return format(new Date(), "dd MMM yyyy");
}
