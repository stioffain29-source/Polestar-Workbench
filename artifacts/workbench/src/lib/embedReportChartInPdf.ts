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
    const canvas = await html2canvas(host, {
      scale: 2,
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
      canvas.toDataURL("image/png"),
      "PNG",
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
