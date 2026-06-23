import html2canvas from "html2canvas";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ensureSpace, type Ctx } from "./pdfChrome";

async function waitForFonts(): Promise<void> {
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
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
  const html = renderToStaticMarkup(element);
  await embedChartMarkupInPdf(ctx, html);
}

/**
 * Rasterise pre-rendered chart markup (from renderToStaticMarkup) into the
 * PDF body at the current cursor.
 */
export async function embedChartMarkupInPdf(
  ctx: Ctx,
  html: string,
): Promise<void> {
  if (typeof document === "undefined") {
    await embedChartMarkupInPdfHeadless(ctx, html);
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

/** Headless Node fallback when no browser DOM is available. */
async function embedChartMarkupInPdfHeadless(
  ctx: Ctx,
  html: string,
): Promise<void> {
  try {
    const { chromium } = await import(/* @vite-ignore */ "playwright");
    const widthPx = Math.round(ctx.CW);
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: widthPx, height: 320 },
      });
      await page.setContent(
        `<!DOCTYPE html><html><head><style>
          html,body{margin:0;padding:0;background:#fff;width:${widthPx}px;
            font-family:Roboto,Arial,sans-serif;}
        </style></head><body>${html}</body></html>`,
        { waitUntil: "load" },
      );
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });
      const box = await page.locator("body > *").first().boundingBox();
      if (!box) return;
      const screenshot = await page.screenshot({
        type: "png",
        clip: {
          x: 0,
          y: 0,
          width: widthPx,
          height: Math.ceil(box.height),
        },
      });
      const dataUrl = `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`;
      const imgH = (box.height / widthPx) * ctx.CW;
      ensureSpace(ctx, imgH + 8);
      ctx.pdf.addImage(dataUrl, "PNG", ctx.MX, ctx.y, ctx.CW, imgH);
      ctx.y += imgH + 8;
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn(
      "[embedReportChartInPdf] Skipping chart in headless export — use the in-app Download PDF button or exportReportPdfBrowser.mjs for chart fidelity.",
      err,
    );
  }
}
