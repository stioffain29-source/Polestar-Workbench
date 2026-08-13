import html2canvas from "html2canvas";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { ensureSpace, drawSectionHeading, setRoboto, setText, type Ctx } from "./pdfChrome";

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
): Promise<boolean> {
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
    return false;
  }
  const html = renderElementToHtml(element);
  return embedChartMarkupInPdf(ctx, html, options);
}

/**
 * html2canvas often rasterises inline <svg> as blank/white when the host is
 * off-screen. Swap each SVG for a browser-drawn <canvas> (bitmap) before
 * capture so Cargo Watch choropleth / trend charts survive into the PDF.
 */
async function rasterizeSvgsToCanvas(host: HTMLElement): Promise<void> {
  const svgs = Array.from(host.querySelectorAll("svg"));
  for (const svg of svgs) {
    const vb = svg.viewBox.baseVal;
    const attrW = parseFloat(svg.getAttribute("width") ?? "");
    const attrH = parseFloat(svg.getAttribute("height") ?? "");
    const rect = svg.getBoundingClientRect();
    const w = vb.width > 0 ? vb.width : (Number.isFinite(attrW) && attrW > 0 ? attrW : rect.width) || 640;
    const h = vb.height > 0 ? vb.height : (Number.isFinite(attrH) && attrH > 0 ? attrH : rect.height) || 240;
    if (w < 1 || h < 1) continue;

    const xml = new XMLSerializer().serializeToString(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterize failed"));
      img.src = url;
    });

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.display = "block";
    canvas.style.margin = svg.style.margin || "0 auto";
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    svg.replaceWith(canvas);
  }
}

/** True when a rasterised capture is effectively blank (failed SVG/layout). */
function canvasIsMostlyBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width < 2 || canvas.height < 2) return true;
  const probes = [
    [0, 0],
    [Math.floor(canvas.width * 0.35), Math.floor(canvas.height * 0.35)],
    [Math.floor(canvas.width * 0.65), Math.floor(canvas.height * 0.65)],
    [Math.max(0, canvas.width - 64), Math.max(0, canvas.height - 64)],
  ];
  let nonWhite = 0;
  let total = 0;
  for (const [sx, sy] of probes) {
    const w = Math.min(64, canvas.width - sx);
    const h = Math.min(64, canvas.height - sy);
    if (w < 1 || h < 1) continue;
    const sample = ctx.getImageData(sx, sy, w, h).data;
    for (let i = 0; i < sample.length; i += 4) {
      total++;
      if (sample[i] < 248 || sample[i + 1] < 248 || sample[i + 2] < 248) nonWhite++;
    }
  }
  return total === 0 || nonWhite / total < 0.008;
}

/**
 * Rasterise pre-rendered chart markup into the PDF body at the current cursor.
 * Returns false when capture failed (blank raster) so callers can draw a fallback.
 */
export async function embedChartMarkupInPdf(
  ctx: Ctx,
  html: string,
  options: EmbedChartOptions = {},
): Promise<boolean> {
  if (typeof document === "undefined") {
    if (options.heading) drawSectionHeading(ctx, options.heading);
    console.warn(
      "[embedReportChartInPdf] Chart embedding requires a browser DOM. " +
        "Use the in-app Download PDF button or exportReportPdfBrowser.mjs.",
    );
    return false;
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
    // html2canvas draws CSS text baselines LOW (see html2canvas-text-clamp
    // note): when the last element in the host is a text line (e.g. the jet
    // fuel chart's "N observations from X to Y" caption), its glyphs render
    // below the layout box and the canvas slices them mid-line. Bottom
    // padding gives the low-drawn final line room inside the capture; the
    // measured canvas height includes it, so pagination stays correct.
    "padding-bottom:14px",
  ].join(";");
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    await waitForFonts();
    // Force layout so percentage-width SVGs resolve before capture.
    void host.offsetHeight;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    // html2canvas draws CSS text baselines low, so the cargo pattern graphics'
    // severity/tag pills and numbered stage markers would sit low in the exported
    // PDF. Swap each tagged chip/numeral for a browser-drawn <canvas>
    // (textBaseline:"middle") BEFORE rasterising so the labels are genuinely
    // centred. Sized to each element's measured box, so preview==PDF holds.
    rasteriseChipsToCanvas(host);
    // SVG paths/colours often capture as blank white when the host is off-screen;
    // pre-rasterise to bitmap so Cargo Watch map/trend charts render in PDF.
    try {
      await rasterizeSvgsToCanvas(host);
    } catch (err) {
      console.warn("[embedReportChartInPdf] SVG pre-rasterize failed", err);
    }
    const canvas = await html2canvas(host, {
      scale: 1.5,
      backgroundColor: "#ffffff",
      logging: false,
      width: widthPt,
      windowWidth: widthPt,
    });

    if (canvasIsMostlyBlank(canvas)) {
      console.warn(
        "[embedReportChartInPdf] Chart rasterised blank — check SVG/layout in the export host.",
      );
      if (options.heading) {
        ensureSpace(ctx, HEADING_RESERVE + 30);
        drawSectionHeading(ctx, options.heading);
      }
      setText(ctx.pdf, "#363636");
      setRoboto(ctx.pdf, "italic");
      ctx.pdf.setFontSize(9);
      ctx.pdf.text(
        "Chart could not be rendered in this export. Re-download from the in-app preview.",
        ctx.MX,
        ctx.y + 10,
      );
      setRoboto(ctx.pdf, "regular");
      ctx.y += 22;
      return false;
    }

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
    return true;
  } finally {
    document.body.removeChild(host);
  }
}
