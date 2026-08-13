import html2canvas from "html2canvas";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { ensureSpace, drawSectionHeading, type Ctx } from "./pdfChrome";

/** Optional section heading kept together with the chart image (see below). */
export interface EmbedChartOptions {
  /**
   * When set, the heading is drawn as ONE keep-together unit with the chart
   * image: the page break (if any) happens BEFORE the heading, so a heading can
   * never orphan at the foot of a page with its chart pushed to the next one.
   */
  heading?: string;
}

// Vertical room a section heading consumes when it is kept together with the
// image below it: the heading text + divider (~30pt) plus the ~20pt gap
// drawSectionHeading inserts when it follows earlier content on the same page.
const HEADING_RESERVE = 54;

async function waitForFonts(): Promise<void> {
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }
}

function toNum(v: string | undefined, fallback: number): number {
  const n = v != null && v !== "" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Draw a pill / circle with a horizontally AND vertically centred label onto a
 * real <canvas>. html2canvas rasterises the canvas bitmap verbatim, so the label
 * placement is deterministic — unlike CSS text, which html2canvas draws low.
 * The canvas backing store is 3x for crispness but is displayed at its true
 * box size so surrounding layout (and preview==PDF parity) is preserved.
 */
function makeCentredLabelCanvas(opts: {
  text: string;
  w: number;
  h: number;
  bg: string;
  fg: string;
  fontPx: number;
  fontWeight: string;
  letterSpacingPx: number;
  radius: number;
  circle: boolean;
}): HTMLCanvasElement {
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(opts.w * scale));
  canvas.height = Math.max(1, Math.round(opts.h * scale));
  canvas.style.width = `${opts.w}px`;
  canvas.style.height = `${opts.h}px`;
  const ctx = canvas.getContext("2d") as
    | (CanvasRenderingContext2D & { letterSpacing?: string })
    | null;
  if (!ctx) return canvas;
  ctx.scale(scale, scale);

  ctx.fillStyle = opts.bg || "#999999";
  if (opts.circle) {
    ctx.beginPath();
    ctx.arc(opts.w / 2, opts.h / 2, Math.min(opts.w, opts.h) / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  } else {
    const r = Math.max(0, Math.min(opts.radius, opts.w / 2, opts.h / 2));
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(opts.w, 0, opts.w, opts.h, r);
    ctx.arcTo(opts.w, opts.h, 0, opts.h, r);
    ctx.arcTo(0, opts.h, 0, 0, r);
    ctx.arcTo(0, 0, opts.w, 0, r);
    ctx.closePath();
    ctx.fill();
  }

  ctx.font = `${opts.fontWeight} ${opts.fontPx}px Roboto, Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${opts.letterSpacingPx}px`;
  ctx.fillStyle = opts.fg || "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(opts.text, opts.w / 2, opts.h / 2);
  return canvas;
}

/**
 * Replace tagged severity/tag pills (`[data-raster-chip]`) and numbered stage
 * markers (`[data-raster-numeral]`) in the off-screen export host with real
 * canvases so their labels stay centred through html2canvas. Runs after the host
 * is in the DOM (so getBoundingClientRect reports the true box) and before
 * rasterisation. Scoped to the data attributes, so nothing else is touched.
 */
function rasteriseChipsToCanvas(host: HTMLElement): void {
  host.querySelectorAll<HTMLElement>("[data-raster-chip]").forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const cs = getComputedStyle(node);
    const raw = (node.dataset.chipLabel ?? node.textContent ?? "").trim();
    if (!raw) return;
    const canvas = makeCentredLabelCanvas({
      text: node.dataset.chipUpper === "1" ? raw.toUpperCase() : raw,
      w: rect.width,
      h: rect.height,
      bg: node.dataset.chipBg || cs.backgroundColor,
      fg: node.dataset.chipFg || cs.color,
      fontPx: toNum(node.dataset.chipFont, Number.parseFloat(cs.fontSize) || 10),
      fontWeight: node.dataset.chipWeight || cs.fontWeight || "700",
      letterSpacingPx: toNum(node.dataset.chipTracking, 0),
      radius: toNum(node.dataset.chipRadius, 2),
      circle: false,
    });
    canvas.style.display = "inline-block";
    canvas.style.verticalAlign = "middle";
    canvas.style.flex = "0 0 auto";
    canvas.style.marginTop = cs.marginTop;
    canvas.style.marginRight = cs.marginRight;
    canvas.style.marginBottom = cs.marginBottom;
    canvas.style.marginLeft = cs.marginLeft;
    node.replaceWith(canvas);
  });

  host.querySelectorAll<HTMLElement>("[data-raster-numeral]").forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const cs = getComputedStyle(node);
    const raw = (node.textContent ?? "").trim();
    if (!raw) return;
    const canvas = makeCentredLabelCanvas({
      text: raw,
      w: rect.width,
      h: rect.height,
      bg: node.dataset.numeralBg || cs.backgroundColor,
      fg: node.dataset.numeralFg || cs.color,
      fontPx: toNum(node.dataset.numeralFont, Number.parseFloat(cs.fontSize) || 10),
      fontWeight: node.dataset.numeralWeight || cs.fontWeight || "700",
      letterSpacingPx: 0,
      radius: 0,
      circle: true,
    });
    canvas.style.display = "inline-block";
    canvas.style.verticalAlign = "middle";
    canvas.style.flex = "0 0 auto";
    canvas.style.marginTop = cs.marginTop;
    canvas.style.marginRight = cs.marginRight;
    canvas.style.marginBottom = cs.marginBottom;
    canvas.style.marginLeft = cs.marginLeft;
    node.replaceWith(canvas);
  });
}

/** Render a React element to static HTML in the browser without react-dom/server. */
function renderElementToHtml(element: ReactElement): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(element);
    });
    return host.innerHTML;
  } finally {
    flushSync(() => {
      root.unmount();
    });
  }
}

/**
 * Rasterise a report chart React element and embed it in the active jsPDF
 * page. Uses the same component the on-screen preview renders, so chart
 * changes propagate to the PDF automatically — no hand-ported jsPDF replicas.
 *
 * Pass `{ heading }` to draw a section heading that stays with the chart across
 * page breaks (keep-together), rather than calling drawSectionHeading before
 * this — the latter orphans the heading whenever the chart is too tall for the
 * space left on the current page.
 */
export async function embedReactChartInPdf(
  ctx: Ctx,
  element: ReactElement,
  options: EmbedChartOptions = {},
): Promise<void> {
  // Charts rasterise to a PNG image (no embedded text), so a headless run —
  // e.g. the font-audit exporter, which has no DOM — can safely skip them. Guard
  // here before renderElementToHtml touches `document`; embedChartMarkupInPdf
  // carries the same guard for the markup entry point. The heading is still
  // drawn so headless exports keep their section structure.
  if (typeof document === "undefined") {
    if (options.heading) drawSectionHeading(ctx, options.heading);
    console.warn(
      "[embedReportChartInPdf] Chart embedding requires a browser DOM. " +
        "Use the in-app Download PDF button or exportReportPdfBrowser.mjs.",
    );
    return;
  }
  const html = renderElementToHtml(element);
  await embedChartMarkupInPdf(ctx, html, options);
}

/**
 * Rasterise pre-rendered chart markup into the PDF body at the current cursor.
 */
export async function embedChartMarkupInPdf(
  ctx: Ctx,
  html: string,
  options: EmbedChartOptions = {},
): Promise<void> {
  if (typeof document === "undefined") {
    if (options.heading) drawSectionHeading(ctx, options.heading);
    console.warn(
      "[embedReportChartInPdf] Chart embedding requires a browser DOM. " +
        "Use the in-app Download PDF button or exportReportPdfBrowser.mjs.",
    );
    return;
  }

  const widthPt = ctx.CW;
  const host = document.createElement("div");
  host.setAttribute("data-report-chart-export", "");
  host.style.cssText = [
    `width:${widthPt}px`,
    "box-sizing:border-box",
    "background:#fff",
    "font-family:Roboto,sans-serif",
    "position:fixed",
    "left:-10000px",
    "top:0",
    "z-index:-1",
    "pointer-events:none",
  ].join(";");
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    await waitForFonts();
    // html2canvas draws CSS text baselines low, so the cargo pattern graphics'
    // severity/tag pills and numbered stage markers would sit low in the exported
    // PDF. Swap each tagged chip/numeral for a browser-drawn <canvas>
    // (textBaseline:"middle") BEFORE rasterising so the labels are genuinely
    // centred. Sized to each element's measured box, so preview==PDF holds.
    rasteriseChipsToCanvas(host);
    const canvas = await html2canvas(host, {
      scale: 1.5,
      backgroundColor: "#ffffff",
      logging: false,
      width: widthPt,
      windowWidth: widthPt,
    });

    let imgW = widthPt;
    let imgH = (canvas.height / canvas.width) * widthPt;

    // Usable height of a single body page (fresh page, chrome applied).
    const pageContent = ctx.H - ctx.BOTTOM - ctx.TOP;
    const headingReserve = options.heading ? HEADING_RESERVE : 0;

    // If the image alone is taller than a page can hold alongside its heading,
    // scale it down proportionally so heading + image always fit together on
    // one page. Without this a very tall chart would be placed past the page
    // foot and spill a stray fragment onto the top of the next page.
    const maxImgH = pageContent - headingReserve - 8;
    if (maxImgH > 0 && imgH > maxImgH) {
      imgW = widthPt * (maxImgH / imgH);
      imgH = maxImgH;
    }

    // Bounded shrink-to-fit-remaining: if heading + image would otherwise break
    // to a fresh page — leaving the current page with a large blank tail — but
    // they CAN fit in the space left on THIS page at a still-legible scale,
    // shrink proportionally to pack them here instead. Without this a
    // medium-tall chart (e.g. the country choropleth ~458pt) orphans onto its
    // own page, blanking both the tail it left behind and the foot of its own
    // page. Bounded by MIN_FILL_SCALE so charts are never crushed into slivers;
    // above the floor it just avoids one page break. PDF-pagination only — the
    // unpaginated on-screen preview renders the same component unscaled, so
    // content and section order stay identical (preview==PDF parity preserved).
    const MIN_FILL_SCALE = 0.75;
    const remaining = ctx.H - ctx.BOTTOM - ctx.y;
    const needed = headingReserve + imgH + 8;
    if (needed > remaining) {
      const fitH = remaining - headingReserve - 8;
      if (fitH > 0 && fitH / imgH >= MIN_FILL_SCALE) {
        imgW = imgW * (fitH / imgH);
        imgH = fitH;
      }
    }

    // Reserve heading + image as ONE unit: the break (if needed) happens before
    // the heading, so the heading never orphans and the image never splits.
    ensureSpace(ctx, headingReserve + imgH + 8);
    if (options.heading) drawSectionHeading(ctx, options.heading);

    // Centre horizontally when the image was scaled narrower than the column.
    const drawX = ctx.MX + (widthPt - imgW) / 2;
    ctx.pdf.addImage(
      canvas.toDataURL("image/jpeg", 0.82),
      "JPEG",
      drawX,
      ctx.y,
      imgW,
      imgH,
    );
    ctx.y += imgH + 8;
  } finally {
    document.body.removeChild(host);
  }
}
