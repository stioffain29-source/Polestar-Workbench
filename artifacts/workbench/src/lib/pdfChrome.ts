import { jsPDF } from "jspdf";
import { format } from "date-fns";

export const NAVY = "#0B0B3D";
export const ELECTRIC = "#4655FF";
export const POLAR = "#E2E2E2";
export const DUSK = "#303030";
export const WHITE = "#FFFFFF";
export const CARD_BG = "#FFFFFF";
export const PAGE_BG = "#FFFFFF";

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

export function setFill(pdf: jsPDF, hex: string) {
  pdf.setFillColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
}
export function setStroke(pdf: jsPDF, hex: string) {
  pdf.setDrawColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
}
export function setText(pdf: jsPDF, hex: string) {
  pdf.setTextColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
}

export interface HeaderOpts {
  /** e.g. "FUEL · WEEKLY BRIEFING" or "PAPUA NEW GUINEA · COUNTRY REPORT" */
  kind: string;
  /** YYYY-MM-DD or formatted date */
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
}

export function createCtx(header: HeaderOpts): Ctx {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const MX = 48;
  const TOP = 70;
  const BOTTOM = 58;
  const ctx: Ctx = { pdf, W, H, MX, TOP, BOTTOM, CW: W - MX * 2, y: TOP, header };
  drawRunningHeader(ctx);
  return ctx;
}

export function drawRunningHeader(ctx: Ctx) {
  const { pdf, W, MX, header } = ctx;
  setText(pdf, NAVY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(sanitize("POLESTAR ADVISORY"), MX, 26);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  setText(pdf, DUSK);
  pdf.text(sanitize(`Issue date: ${header.issueDate}`), W - MX, 26, { align: "right" });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  setText(pdf, ELECTRIC);
  pdf.text(sanitize(header.kind.toUpperCase()), MX, 40);

  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.5);
  pdf.line(MX, 48, W - MX, 48);
}

export function newPage(ctx: Ctx) {
  ctx.pdf.addPage();
  ctx.y = ctx.TOP;
  drawRunningHeader(ctx);
}

export function ensureSpace(ctx: Ctx, h: number) {
  if (ctx.y + h > ctx.H - ctx.BOTTOM) newPage(ctx);
}

export function drawSectionHeading(ctx: Ctx, title: string) {
  ensureSpace(ctx, 34);
  const { pdf, MX, CW } = ctx;
  setText(pdf, NAVY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(sanitize(title.toUpperCase()), MX, ctx.y);
  ctx.y += 6;
  setStroke(pdf, ELECTRIC);
  pdf.setLineWidth(0.7);
  pdf.line(MX, ctx.y, MX + CW, ctx.y);
  ctx.y += 14;
}

export function renderProse(ctx: Ctx, body: string) {
  const { pdf, MX, CW } = ctx;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  setText(pdf, DUSK);
  const lineH = 13;
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
  const cardH = 64;
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
    pdf.text(sanitize(c.label.toUpperCase()), x + 10, yy + 16);

    // Value
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    const valueLines: string[] = pdf.splitTextToSize(sanitize(c.value), cardW - 20);
    const baseY = yy + 36;
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

export function drawFooters(pdf: jsPDF, reportDate: string) {
  const pageCount = pdf.getNumberOfPages();
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.5);
    pdf.line(48, H - 38, W - 48, H - 38);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    setText(pdf, DUSK);
    pdf.text(
      sanitize(`Polestar Advisory \u00B7 Confidential \u00B7 ${reportDate} \u00B7 Page ${p} of ${pageCount}`),
      W / 2,
      H - 22,
      { align: "center" },
    );
  }
}

export function todayLabel(): string {
  return format(new Date(), "dd MMM yyyy");
}
