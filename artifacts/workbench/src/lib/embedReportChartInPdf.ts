import html2canvas from "html2canvas";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { ensureSpace, type Ctx } from "./pdfChrome";

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
 */
export async function embedReactChartInPdf(
  ctx: Ctx,
  element: ReactElement,
): Promise<void> {
  // Charts rasterise to a PNG image (no embedded text), so a headless run —
  // e.g. the font-audit exporter, which has no DOM — can safely skip them. Guard
  // here before renderElementToHtml touches `document`; embedChartMarkupInPdf
  // carries the same guard for the markup entry point.
  if (typeof document === "undefined") {
    console.warn(
      "[embedReportChartInPdf] Chart embedding requires a browser DOM. " +
        "Use the in-app Download PDF button or exportReportPdfBrowser.mjs.",
    );
    return;
  }
  const html = renderElementToHtml(element);
  await embedChartMarkupInPdf(ctx, html);
}

/**
 * Rasterise pre-rendered chart markup into the PDF body at the current cursor.
 */
export async function embedChartMarkupInPdf(
  ctx: Ctx,
  html: string,
): Promise<void> {
  if (typeof document === "undefined") {
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
    const imgH = (canvas.height / canvas.width) * widthPt;
    ensureSpace(ctx, imgH + 8);
    ctx.pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      ctx.MX,
      ctx.y,
      widthPt,
      imgH,
    );
    ctx.y += imgH + 8;
  } finally {
    document.body.removeChild(host);
  }
}
