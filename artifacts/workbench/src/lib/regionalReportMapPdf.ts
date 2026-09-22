import type { Ctx } from "./pdfChrome";
import type { RegionalMapPoint } from "./regionalWeekly";
import { drawSectionHeading, ensureSpace, hasRealDom } from "./pdfChrome";

const REPORT_WIDTH_CSS = 760;
const HEADING_RESERVE = 54;
const LOAD_TIMEOUT_MS = 12_000;

function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForLeaflet(host: HTMLElement): Promise<void> {
  await bounded(
    new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const inspect = () => {
        const container = host.querySelector<HTMLElement>(".leaflet-container");
        const tiles = [...host.querySelectorAll<HTMLImageElement>("img.leaflet-tile")];
        const failed = tiles.find((tile) => tile.complete && tile.naturalWidth === 0);
        if (failed) {
          reject(new Error("Regional Hotspot Map could not load a CARTO Positron tile. Please retry the export."));
          return;
        }
        if (
          container &&
          container.offsetWidth > 0 &&
          container.offsetHeight > 0 &&
          tiles.length > 0 &&
          tiles.every((tile) => tile.complete && tile.naturalWidth > 0)
        ) {
          resolve();
          return;
        }
        if (Date.now() - started < LOAD_TIMEOUT_MS) {
          window.setTimeout(inspect, 50);
        }
      };
      inspect();
    }),
    "Regional Hotspot Map timed out waiting for CARTO Positron tiles.",
  );
}

/** Freeze only the staging map. html2canvas can lose transformed Leaflet tile
 * panes offscreen; decoded CORS tiles and HTML marker positions are authoritative. */
async function flattenMapForCapture(host: HTMLElement): Promise<void> {
  const map = host.querySelector<HTMLElement>("#regional-hotspot-map");
  if (!map) return;
  const rect = map.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rect.width * 2);
  canvas.height = Math.ceil(rect.height * 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Regional map capture requires a canvas.");
  context.scale(2, 2);
  context.fillStyle = "#fafafa";
  context.fillRect(0, 0, rect.width, rect.height);
  for (const tile of map.querySelectorAll<HTMLImageElement>("img.leaflet-tile")) {
    const tileRect = tile.getBoundingClientRect();
    context.drawImage(tile, tileRect.left - rect.left, tileRect.top - rect.top, tileRect.width, tileRect.height);
  }
  const drawNumber = (
    ctx: CanvasRenderingContext2D,
    node: HTMLElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    const style = getComputedStyle(node);
    const border = Number.parseFloat(style.borderTopWidth) || 0;
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, (Math.min(width, height) - border) / 2, 0, Math.PI * 2);
    ctx.fillStyle = style.backgroundColor;
    ctx.fill();
    if (border) {
      ctx.lineWidth = border;
      ctx.strokeStyle = style.borderTopColor;
      ctx.stroke();
    }
    ctx.fillStyle = style.color;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.textContent ?? "", x + width / 2, y + height / 2);
  };
  for (const marker of map.querySelectorAll<HTMLElement>("div[title]")) {
    const markerRect = marker.getBoundingClientRect();
    drawNumber(context, marker, markerRect.left - rect.left, markerRect.top - rect.top, markerRect.width, markerRect.height);
    marker.style.visibility = "hidden";
  }
  const bitmap = new Image();
  bitmap.src = canvas.toDataURL("image/png");
  bitmap.alt = "";
  bitmap.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:200;pointer-events:none";
  await bitmap.decode();
  map.querySelectorAll<HTMLElement>(".leaflet-map-pane").forEach((pane) => {
    pane.style.visibility = "hidden";
  });
  map.appendChild(bitmap);

  // Keep caption numerals centred too. Use images rather than standalone canvas
  // nodes: html2canvas may drop canvases inside map overlays.
  for (const badge of host.querySelectorAll<HTMLElement>("[data-regional-map-number]")) {
    const badgeRect = badge.getBoundingClientRect();
    const numberCanvas = document.createElement("canvas");
    numberCanvas.width = Math.ceil(badgeRect.width * 2);
    numberCanvas.height = Math.ceil(badgeRect.height * 2);
    const numberContext = numberCanvas.getContext("2d");
    if (!numberContext) throw new Error("Regional map numeral capture requires a canvas.");
    numberContext.scale(2, 2);
    drawNumber(numberContext, badge, 0, 0, badgeRect.width, badgeRect.height);
    const numberImage = new Image();
    numberImage.src = numberCanvas.toDataURL("image/png");
    numberImage.alt = badge.textContent ?? "";
    numberImage.style.cssText = `width:${badgeRect.width}px;height:${badgeRect.height}px;display:block`;
    await numberImage.decode();
    badge.replaceChildren(numberImage);
    badge.style.backgroundColor = "transparent";
  }
}

/**
 * Captures the real, mounted Leaflet-backed regional map and its caption grid.
 * This intentionally does not use embedReactChartInPdf: that helper unmounts
 * React before effects run, while Leaflet is initialized from an effect.
 */
export async function drawRegionalReportMap(
  ctx: Ctx,
  points: RegionalMapPoint[],
  topic: string | undefined,
): Promise<boolean> {
  if (typeof window === "undefined" || !hasRealDom()) {
    drawSectionHeading(ctx, "Regional Hotspot Map");
    console.warn(
      "[drawRegionalReportMap] Map embedding requires a browser DOM. " +
        "Use the in-app Download PDF button or exportReportPdfBrowser.mjs.",
    );
    return false;
  }

  const [{ createElement }, { createRoot }, { flushSync }, { default: html2canvas }, mapModule] =
    await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("react-dom"),
      import("html2canvas"),
      import("@/components/RegionalHotspotMap"),
    ]);

  const host = document.createElement("div");
  host.setAttribute("data-regional-map-pdf-export", "");
  host.style.cssText = [
    `width:${REPORT_WIDTH_CSS}px`,
    "box-sizing:border-box",
    "background:#fff",
    "font-family:Roboto,sans-serif",
    "position:fixed",
    "left:-10000px",
    "top:0",
    "z-index:-1",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    flushSync(() => {
      root.render(createElement(mapModule.RegionalHotspotMap, { points, topic }));
    });

    if ("fonts" in document) {
      await bounded(document.fonts.ready, "Regional Hotspot Map timed out waiting for fonts.");
    }
    if (points.length > 0) {
      await waitForLeaflet(host);
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await flattenMapForCapture(host);

    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      width: REPORT_WIDTH_CSS,
      // Match the two-column desktop caption grid, not the mobile breakpoint.
      windowWidth: Math.max(REPORT_WIDTH_CSS, 1024),
    });
    if (!canvas.width || !canvas.height) {
      throw new Error("Regional Hotspot Map capture returned an empty canvas.");
    }

    const widthPt = ctx.CW;
    let imageWidth = widthPt;
    let imageHeight = canvas.height / canvas.width * imageWidth;
    const maxHeight = ctx.H - ctx.TOP - ctx.BOTTOM - HEADING_RESERVE - 8;
    if (imageHeight > maxHeight) {
      const scale = maxHeight / imageHeight;
      if (scale < 0.75) {
        throw new Error("Regional Hotspot Map cannot fit on one PDF page at a readable scale.");
      }
      imageWidth *= scale;
      imageHeight *= scale;
    }

    ensureSpace(ctx, HEADING_RESERVE + imageHeight + 8);
    drawSectionHeading(ctx, "Regional Hotspot Map");
    ctx.pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      ctx.MX + (widthPt - imageWidth) / 2,
      ctx.y,
      imageWidth,
      imageHeight,
      undefined,
      "FAST",
    );
    ctx.y += imageHeight + 8;
    return true;
  } finally {
    root.unmount();
    host.remove();
  }
}