import { jsPDF } from "jspdf";
import { format } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import { setRoboto, ensureRobotoLoaded } from "./pdfFonts";
export { setRoboto, ensureRobotoLoaded } from "./pdfFonts";

// Polestar core brand palette.
export const NAVY = "#0b0a3d";       // Midnight Blue
export const ELECTRIC = "#465bff";   // Electric Blue
export const POLAR = "#e2e2e2";      // Polar Gray
export const DUSK = "#363636";       // Dusk Gray
export const WHITE = "#FFFFFF";
export const CARD_BG = "#FFFFFF";
export const PAGE_BG = "#FFFFFF";

// Risk palette — use only for severity/risk. Severity colours are
// intentionally separate from the Polestar brand palette so the five
// tiers stay distinguishable on charts and chips.
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
  setRoboto(pdf, "bold");
  pdf.setFontSize(10);
  pdf.text(sanitize(header.kind.toUpperCase()), W - 18, HEADER_BAND_H / 2 + 4, { align: "right" });
  // Reset fill/text color to body defaults so any prose drawn immediately
  // after a page break does not inherit the white header color.
  setText(pdf, DUSK);
  setFill(pdf, NAVY);
  setRoboto(pdf, "regular");
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
  setRoboto(pdf, "bold");
  pdf.setFontSize(12);
  pdf.text(sanitize(title.toUpperCase()), MX, ctx.y);
  ctx.y += 6;
  // Thin blue divider line under the heading.
  setStroke(pdf, ELECTRIC);
  pdf.setLineWidth(0.6);
  pdf.line(MX, ctx.y, MX + CW, ctx.y);
  ctx.y += 14;
}

/**
 * Atomic "section heading + body" renderer. Measures the heading PLUS
 * the first paragraph of the body together; if they will not fit on
 * the current page, pushes the whole section to a fresh page before
 * drawing the heading. This is the orphan-protection contract for
 * Fuel Watch — used so a heading like "POLESTAR VIEW" can never sit
 * alone at the foot of a page while its body lands on the next one.
 */
export function drawSectionWithProse(ctx: Ctx, title: string, body: string) {
  const { pdf, CW } = ctx;
  setRoboto(pdf, "regular");
  pdf.setFontSize(10);
  const lineH = 14;
  const paragraphs = sanitize(body).split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    drawSectionHeading(ctx, title);
    return;
  }
  const firstParaLines: string[] = pdf.splitTextToSize(paragraphs[0], CW);
  // Heading block ≈ 6 (text) + 14 (gap to body) + small lead-in.
  // The body block we want to keep together = first paragraph lines.
  const headingBlockH = 6 + 14 + 8;
  const firstParaH = firstParaLines.length * lineH + 6;
  // Match the lead-in spacing drawSectionHeading adds when it is not
  // at the top of the page (10pt). Conservative: always include it.
  const need = headingBlockH + firstParaH + 10;
  if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);
  drawSectionHeading(ctx, title);
  renderProse(ctx, body);
}

export function renderProse(ctx: Ctx, body: string) {
  const { pdf, MX, CW } = ctx;
  setRoboto(pdf, "regular");
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
  /** Optional as-of date rendered as a small caption beneath the note. */
  asOf?: string;
  /** Optional source attribution rendered as a small caption. */
  source?: string;
}

export function drawFastFactsKpiCards(ctx: Ctx, cards: KpiCardData[]) {
  if (cards.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const cols = 3;
  const gap = 10;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const cardH = 82;
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
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text(sanitize(c.label.toUpperCase()), x + PAD_L, yy + 16);

    // Value
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(15);
    const valueLines: string[] = pdf.splitTextToSize(sanitize(c.value), cardW - PAD_L - 10);
    const baseY = yy + 36;
    pdf.text(valueLines.slice(0, 2), x + PAD_L, baseY);

    // Bottom-anchored caption block. Three optional lines, bottom up,
    // each on its own row so the jet card reads:
    //   "As of 15 May 2026"
    //   "US Gulf Coast kerosene-type · EIA / FRED"
    //   "+2.5% 7d"
    // (with the value above). Asof/source are no longer merged into
    // one cramped subline.
    let captionY = yy + cardH - 10;
    if (c.asOf) {
      setText(pdf, DUSK);
      setRoboto(pdf, "regular");
      pdf.setFontSize(6.5);
      const asOfLines: string[] = pdf.splitTextToSize(sanitize(`As of ${c.asOf}`), cardW - PAD_L - 10);
      pdf.text(asOfLines.slice(0, 1), x + PAD_L, captionY);
      captionY -= 9;
    }
    if (c.source) {
      setText(pdf, DUSK);
      setRoboto(pdf, "regular");
      pdf.setFontSize(6.5);
      const srcLines: string[] = pdf.splitTextToSize(sanitize(c.source), cardW - PAD_L - 10);
      pdf.text(srcLines.slice(0, 1), x + PAD_L, captionY);
      captionY -= 9;
    }
    if (c.note) {
      setText(pdf, DUSK);
      setRoboto(pdf, "regular");
      pdf.setFontSize(7);
      const noteLines: string[] = pdf.splitTextToSize(sanitize(c.note), cardW - PAD_L - 10);
      pdf.text(noteLines.slice(0, 2), x + PAD_L, captionY);
    }
  }
  ctx.y += totalH + 18;
}

// Disclaimer is the only closing block. It tries hard to fit on the
// current page; only when it cannot does it start a new page. That
// avoids leaving a near-empty final page with just a five-line legal.
const DISCLAIMER_BLOCK_H = 24 + 12 * 5;

export function drawDisclaimer(ctx: Ctx) {
  if (ctx.y + DISCLAIMER_BLOCK_H > ctx.H - ctx.BOTTOM) {
    newPage(ctx);
  } else {
    ctx.y += 8;
  }
  drawSectionHeading(ctx, "Disclaimer");
  renderProse(ctx, DISCLAIMER_TEXT);
}

/**
 * @deprecated Source Notes / Data Notes are internal workbench notes
 * and must not appear on client-facing reports. Kept as a no-op so
 * older call sites compile while we remove them.
 */
export function drawSourceNotes(_ctx: Ctx, _extra?: string) {
  void _ctx; void _extra;
}

// --- Bullets ---------------------------------------------------------------
// Implications for Business and Watch Next are rendered as compact
// bullet lists, never long paragraphs. The parser accepts either:
//   - Lines beginning with "- " (or "•") -> one bullet per line
//   - Otherwise: paragraphs separated by blank lines -> one bullet
//     per paragraph (first sentence kept, rest truncated for length)
// Lists are capped at `maxBullets` so the section stays scannable.

export function parseBullets(text: string, maxBullets = 7): string[] {
  const s = sanitize(text ?? "").trim();
  if (!s) return [];
  // Explicit bullet markers win.
  const marked = s
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter((ln) => /^([-*•])\s+/.test(ln))
    .map((ln) => ln.replace(/^([-*•])\s+/, "").trim())
    .filter(Boolean);
  let bullets: string[];
  if (marked.length > 0) {
    bullets = marked;
  } else {
    // Fall back to paragraph splitting; keep paragraphs short by
    // taking the first sentence only when they run long.
    bullets = s
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((p) => {
        if (p.length <= 220) return p;
        const m = p.match(/^(.+?[.!?])(\s|$)/);
        return (m ? m[1] : p.slice(0, 217) + "...").trim();
      });
  }
  return bullets.slice(0, maxBullets);
}

export function drawBulletSection(
  ctx: Ctx,
  title: string,
  text: string,
  maxBullets = 7,
) {
  const bullets = parseBullets(text, maxBullets);
  if (bullets.length === 0) return;
  const { pdf, MX, CW } = ctx;
  setRoboto(pdf, "regular");
  pdf.setFontSize(10);
  const lineH = 13;
  const bulletIndent = 12;
  const gapBetween = 4;
  // Pre-measure to keep heading + first bullet together.
  const firstLines: string[] = pdf.splitTextToSize(bullets[0], CW - bulletIndent);
  const headingBlockH = 6 + 14 + 8;
  const firstParaH = firstLines.length * lineH + gapBetween;
  const need = headingBlockH + firstParaH + 10;
  if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);
  drawSectionHeading(ctx, title);
  setRoboto(pdf, "regular");
  setText(pdf, DUSK);
  pdf.setFontSize(10);
  for (const b of bullets) {
    const lines: string[] = pdf.splitTextToSize(b, CW - bulletIndent);
    const blockH = lines.length * lineH + gapBetween;
    // Keep a bullet together with its first line; otherwise page break first.
    if (ctx.y + blockH > ctx.H - ctx.BOTTOM) newPage(ctx);
    // Marker
    pdf.text("\u2022", MX, ctx.y + 10);
    // Body lines
    for (let i = 0; i < lines.length; i++) {
      pdf.text(lines[i], MX + bulletIndent, ctx.y + 10);
      ctx.y += lineH;
    }
    ctx.y += gapBetween;
  }
  ctx.y += 4;
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
    setRoboto(pdf, "regular");
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
  setRoboto(pdf, "bold");
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
  setRoboto(pdf, "bold");
  pdf.setFontSize(12);
  pdf.text(sanitize(opts.subtitle.toUpperCase()), padL, ty + 6, { charSpace: 1.6 });

  // Reporting period.
  setRoboto(pdf, "regular");
  pdf.setFontSize(11);
  pdf.text(sanitize(opts.reportingPeriod.toUpperCase()), padL, ty + 28, { charSpace: 1.2 });

  // Website at bottom left, flush above the bottom edge.
  setRoboto(pdf, "bold");
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
  // Load via fetch -> blob -> object URL rather than setting `crossOrigin`
  // on an <img>. Under the Replit dev proxy the crossOrigin handshake can
  // reject same-origin asset loads, which then silently tainted every PDF
  // cover and forced the gradient fallback. Object URLs are always same-
  // origin and never taint the canvas, so toDataURL is safe afterwards.
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`prepareCoverImage: fetch ${res.status} for ${src}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`prepareCoverImage: decode failed for ${src}`));
      i.src = blobUrl;
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
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function todayLabel(): string {
  return format(new Date(), "dd MMM yyyy");
}
