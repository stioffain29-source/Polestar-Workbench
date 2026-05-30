import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import { ensureRobotoLoaded, setRoboto } from "./pdfFonts";

const MIN_PAGE_FILL = 0.45;
const PAGE_BREAK_GUARD_PX = 24;
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const POLAR = "#e2e2e2";
const DUSK = "#363636";
const WHITE = "#ffffff";
const HEADER_BAND_H = 42;
const FOOTER_BAND_H = 30;
const BODY_TOP_PAD = 14;
const BODY_BOTTOM_PAD = 12;
const EXPORT_REPORT_WIDTH_PX = 960;

async function waitForFontsAndImages(element: HTMLElement): Promise<void> {
  if ("fonts" in document) {
    await document.fonts.ready;
  }

  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(images.map(async (img) => {
    if (img.complete && img.naturalWidth > 0) return;
    try {
      await img.decode();
    } catch {
      await new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    }
  }));
}

function cloneForExport(element: HTMLElement): HTMLElement {
  const source = element.matches(".print-report")
    ? element
    : element.querySelector<HTMLElement>(".print-report") ?? element;
  const clone = source.cloneNode(true) as HTMLElement;
  const width = EXPORT_REPORT_WIDTH_PX;

  clone.querySelectorAll<HTMLElement>(".no-print, .pdf-preview-footer").forEach((node) => {
    node.style.display = "none";
  });

  clone.style.position = "absolute";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.width = `${width}px`;
  clone.style.maxWidth = `${width}px`;
  clone.style.background = "#ffffff";
  clone.style.boxSizing = "border-box";
  clone.style.transform = "none";
  clone.style.overflow = "visible";
  applyExportOnlyLayout(clone);

  return clone;
}

function addExportStyle(root: HTMLElement, css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  root.prepend(style);
}

function applyExportOnlyLayout(root: HTMLElement): void {
  addExportStyle(root, `
    .pdf-cover-page {
      aspect-ratio: 210 / 297 !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
    }
    .pdf-cover-page > div:nth-child(2) {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      aspect-ratio: auto !important;
    }
    .pdf-cover-page img {
      object-fit: cover !important;
    }
  `);

  applyCountryMapExportLayout(root);
  applySeverityBadgeExportLayout(root);
  applyCountryTableExportLayout(root);
  applyBarChartExportLayout(root);
}

function applyCountryMapExportLayout(root: HTMLElement): void {
  const map = root.querySelector<HTMLElement>("#country-report-map");
  if (!map) return;

  map.style.height = "400px";
  map.style.overflow = "hidden";
  map.style.position = "relative";
  map.querySelectorAll<HTMLElement>(".leaflet-control-attribution").forEach((node) => {
    node.style.display = "none";
  });
  map.querySelectorAll<HTMLElement>(".leaflet-control-zoom").forEach((node) => {
    node.style.marginLeft = "14px";
    node.style.marginTop = "14px";
    node.style.border = `1px solid ${POLAR}`;
    node.style.boxShadow = "none";
  });
  map.querySelectorAll<HTMLElement>(".leaflet-control-zoom a").forEach((node) => {
    node.style.width = "30px";
    node.style.height = "30px";
    node.style.lineHeight = "28px";
    node.style.font = "700 20px/28px Roboto, sans-serif";
    node.style.color = NAVY;
    node.style.textAlign = "center";
  });

  const legend = map.nextElementSibling as HTMLElement | null;
  if (!legend) return;
  legend.style.display = "flex";
  legend.style.flexWrap = "wrap";
  legend.style.alignItems = "center";
  legend.style.justifyContent = "space-between";
  legend.style.columnGap = "16px";
  legend.style.rowGap = "8px";
  legend.style.lineHeight = "1";

  Array.from(legend.children).forEach((child) => {
    const el = child as HTMLElement;
    el.style.display = "inline-flex";
    el.style.alignItems = "center";
    el.style.gap = "6px";
    el.style.lineHeight = "1";
  });

  const attribution = document.createElement("div");
  attribution.textContent = "Leaflet | (c) OpenStreetMap (c) CARTO";
  attribution.style.fontFamily = "Roboto, sans-serif";
  attribution.style.fontSize = "10px";
  attribution.style.color = DUSK;
  attribution.style.whiteSpace = "nowrap";
  attribution.style.marginLeft = "auto";
  legend.appendChild(attribution);
}

function applySeverityBadgeExportLayout(root: HTMLElement): void {
  const labels = new Set(["EXTREME", "HIGH", "MODERATE", "LOW", "INSIGNIFICANT"]);
  root.querySelectorAll<HTMLElement>("span").forEach((node) => {
    const label = (node.textContent ?? "").trim().toUpperCase();
    if (!labels.has(label)) return;
    const bg = node.style.background || node.style.backgroundColor;
    if (!bg) return;

    node.style.display = "inline-flex";
    node.style.alignItems = "center";
    node.style.justifyContent = "center";
    node.style.boxSizing = "border-box";
    node.style.height = "24px";
    node.style.minWidth = "104px";
    node.style.padding = "0 12px";
    node.style.lineHeight = "1";
    node.style.textAlign = "center";
    node.style.verticalAlign = "middle";
    node.style.whiteSpace = "nowrap";

    const parent = node.parentElement;
    if (parent) {
      parent.style.overflow = "visible";
      parent.style.display = "flex";
      parent.style.alignItems = "center";
      parent.style.justifyContent = "center";
      parent.style.height = "100%";
      parent.style.boxSizing = "border-box";
    }
  });
}

function applyCountryTableExportLayout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("h2").forEach((heading) => {
    const title = (heading.textContent ?? "").trim().toUpperCase();
    if (title !== "LOCATION WATCHLIST" && title !== "RELATED INCIDENTS") return;

    const section = heading.closest("section");
    if (!section) return;

    const isWatchlist = title === "LOCATION WATCHLIST";
    const isRelated = title === "RELATED INCIDENTS";
    const expectedCells = isWatchlist ? 6 : 4;
    const rows = Array.from(section.querySelectorAll<HTMLElement>(".grid"))
      .filter((row) => row.children.length === expectedCells);
    if (rows.length === 0) return;

    const table = rows[0].parentElement;
    if (table) {
      table.style.width = "100%";
      table.style.overflow = "visible";
      table.style.borderCollapse = "collapse";
    }

    const bodyRowMinHeight = isWatchlist ? "54px" : "58px";

    rows.forEach((row, rowIndex) => {
      row.style.display = "grid";
      row.style.alignItems = "center";
      row.style.minHeight = rowIndex === 0 ? "40px" : bodyRowMinHeight;
      row.style.overflow = "visible";
      if (isWatchlist) {
        row.style.gridTemplateColumns = "170px minmax(0, 1fr) 54px 54px 54px 170px";
      } else if (isRelated) {
        row.style.gridTemplateColumns = "160px 130px minmax(0, 1fr) 150px";
      }

      const cells = Array.from(row.children) as HTMLElement[];
      cells.forEach((cell, cellIndex) => {
        const isHeader = rowIndex === 0;
        const isNumericCell = isWatchlist && cellIndex >= 2 && cellIndex <= 4;
        const isBadgeCell = (isWatchlist && cellIndex === 5) || (isRelated && cellIndex === 3);
        const isLeftCell = !isNumericCell && !isBadgeCell;

        cell.style.display = "flex";
        cell.style.alignItems = "center";
        cell.style.boxSizing = "border-box";
        cell.style.minHeight = row.style.minHeight;
        cell.style.height = "100%";
        cell.style.padding = isHeader ? "0 12px" : "10px 12px";
        cell.style.lineHeight = isHeader ? "1" : "1.35";
        cell.style.overflow = "visible";

        if (isBadgeCell || isNumericCell) {
          cell.style.justifyContent = "center";
          cell.style.textAlign = "center";
        } else if (isLeftCell) {
          cell.style.justifyContent = "flex-start";
          cell.style.textAlign = "left";
        }

        Array.from(cell.children).forEach((child) => {
          const el = child as HTMLElement;
          el.style.alignSelf = "center";
          if (isBadgeCell) {
            el.style.marginLeft = "auto";
            el.style.marginRight = "auto";
          }
        });
      });
    });
  });
}

function applyBarChartExportLayout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("h2").forEach((heading) => {
    const title = (heading.textContent ?? "").trim().toUpperCase();
    if (title !== "SEVERITY DISTRIBUTION" && title !== "INCIDENT BREAKDOWN BY TYPE") return;
    const section = heading.closest("section");
    const rows = section?.querySelectorAll<HTMLElement>(".space-y-1\\.5 > div");
    rows?.forEach((row) => {
      row.style.display = "grid";
      row.style.gridTemplateColumns = title === "SEVERITY DISTRIBUTION"
        ? "150px minmax(0, 1fr) 44px"
        : "190px minmax(0, 1fr) 44px";
      row.style.alignItems = "center";
      row.style.columnGap = "10px";
      row.style.minHeight = "22px";
      const children = Array.from(row.children) as HTMLElement[];
      children.forEach((child) => {
        child.style.alignSelf = "center";
      });
      if (children[1]) {
        children[1].style.height = "12px";
        children[1].style.overflow = "hidden";
      }
      if (children[2]) {
        children[2].style.textAlign = "right";
        children[2].style.lineHeight = "1";
      }
    });
  });
}

function collectBreakCandidates(root: HTMLElement, pageCssHeight: number): number[] {
  const rootRect = root.getBoundingClientRect();
  const selectors = [
    "section",
    ".report-section",
    ".report-kpi",
    "table",
    "[data-pdf-break-before]",
  ].join(",");
  const candidates = new Set<number>([0, root.scrollHeight]);

  root.querySelectorAll<HTMLElement>(selectors).forEach((node) => {
    const top = Math.round(node.getBoundingClientRect().top - rootRect.top);
    if (top > 0 && top < root.scrollHeight) candidates.add(top);
  });

  return Array.from(candidates)
    .filter((y) => y >= 0 && y <= root.scrollHeight)
    .sort((a, b) => a - b)
    .filter((y, index, all) => index === 0 || Math.abs(y - all[index - 1]) > PAGE_BREAK_GUARD_PX)
    .filter((y) => y === 0 || y === root.scrollHeight || y > pageCssHeight * 0.15);
}

function buildPageSlices(
  totalHeight: number,
  pageCssHeight: number,
  candidates: number[],
  initialStart = 0,
): Array<{ start: number; end: number }> {
  const pages: Array<{ start: number; end: number }> = [];
  let start = initialStart;

  while (start < totalHeight - 1) {
    const target = Math.min(start + pageCssHeight, totalHeight);
    let end = target;

    if (target < totalHeight) {
      const minUsefulBreak = start + pageCssHeight * MIN_PAGE_FILL;
      const useful = candidates.filter((y) =>
        y > start + PAGE_BREAK_GUARD_PX &&
        y <= target - PAGE_BREAK_GUARD_PX &&
        y >= minUsefulBreak
      );
      if (useful.length > 0) {
        end = useful[useful.length - 1];
      }
    }

    if (end <= start + PAGE_BREAK_GUARD_PX) {
      end = target;
    }

    pages.push({ start, end });
    start = end;
  }

  return pages;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function drawBrandGradient(pdf: jsPDF, x: number, y: number, w: number, h: number) {
  const a = hexToRgb(NAVY);
  const b = hexToRgb(ELECTRIC);
  const steps = 96;
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const blue = Math.round(a[2] + (b[2] - a[2]) * t);
    pdf.setFillColor(r, g, blue);
    pdf.rect(x + i * stepW, y, stepW + 0.6, h, "F");
  }
}

function reportTitleFrom(element: HTMLElement, filename: string): string {
  const heading = element.querySelector("h1")?.textContent?.trim();
  if (heading) return heading.toUpperCase();
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/^polestar-(country-)?report-/i, "")
    .replace(/-/g, " ")
    .toUpperCase();
}

function drawBodyHeader(pdf: jsPDF, title: string) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  drawBrandGradient(pdf, 0, 0, pageWidth, HEADER_BAND_H);
  try {
    pdf.addImage(polestarLogo, "PNG", 18, (HEADER_BAND_H - 22) / 2, 132, 22, undefined, "FAST");
  } catch { /* logo is decorative chrome; keep export working if decode fails */ }
  pdf.setTextColor(255, 255, 255);
  setRoboto(pdf, "bold");
  pdf.setFontSize(10);
  pdf.text(title, pageWidth - 18, HEADER_BAND_H / 2 + 4, { align: "right" });
}

function drawBodyFooter(pdf: jsPDF, pageNumber: number, pageCount: number) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const [r, g, b] = hexToRgb(POLAR);
  pdf.setFillColor(r, g, b);
  pdf.rect(0, pageHeight - FOOTER_BAND_H, pageWidth, FOOTER_BAND_H, "F");
  pdf.setTextColor(...hexToRgb(DUSK));
  setRoboto(pdf, "regular");
  pdf.setFontSize(8);
  const y = pageHeight - FOOTER_BAND_H / 2 + 3;
  pdf.text("polestar-advisory.com", 18, y);
  pdf.text("info@polestar-advisory.com", pageWidth / 2, y, { align: "center" });
  pdf.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 18, y, { align: "right" });
}

function coverBreakOffset(root: HTMLElement): number {
  const cover = root.querySelector<HTMLElement>(".pdf-cover-page");
  if (!cover) return 0;
  const rootRect = root.getBoundingClientRect();
  const coverRect = cover.getBoundingClientRect();
  return Math.round(coverRect.bottom - rootRect.top);
}

export async function exportElementToPdf(element: HTMLElement, filename: string): Promise<void> {
  const clone = cloneForExport(element);
  document.body.appendChild(clone);

  try {
    await waitForFontsAndImages(clone);

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    await ensureRobotoLoaded(pdf);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const sourceWidth = Math.ceil(clone.getBoundingClientRect().width || clone.scrollWidth);
    const sourceHeight = Math.ceil(clone.scrollHeight);
    const scaleToPdf = pageWidth / sourceWidth;
    const coverEnd = coverBreakOffset(clone);
    const bodyAvailableHeight = pageHeight - HEADER_BAND_H - BODY_TOP_PAD - FOOTER_BAND_H - BODY_BOTTOM_PAD;
    const pageCssHeight = bodyAvailableHeight / scaleToPdf;
    const breakCandidates = collectBreakCandidates(clone, pageCssHeight);
    const coverSlices = coverEnd > 0 ? [{ start: 0, end: coverEnd }] : [];
    const bodySlices = buildPageSlices(sourceHeight, pageCssHeight, breakCandidates, coverEnd);
    const title = reportTitleFrom(clone, filename);

    const canvas = await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: sourceWidth,
      windowHeight: sourceHeight,
    });

    const canvasScale = canvas.width / sourceWidth;
    const bodyPageCount = bodySlices.length;

    [...coverSlices, ...bodySlices].forEach((slice, index) => {
      if (index > 0) pdf.addPage();

      const isCover = coverSlices.length > 0 && index === 0;
      const sx = 0;
      const sy = Math.round(slice.start * canvasScale);
      const sw = canvas.width;
      const sh = Math.min(
        Math.round((slice.end - slice.start) * canvasScale),
        canvas.height - sy,
      );
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = sw;
      pageCanvas.height = sh;
      const ctx = pageCanvas.getContext("2d");
      if (!ctx) throw new Error("PDF export failed: canvas context unavailable.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      const imgData = pageCanvas.toDataURL("image/png");
      const imgHeight = ((slice.end - slice.start) * pageWidth) / sourceWidth;
      if (isCover) {
        pdf.addImage(imgData, "PNG", 0, 0, pageWidth, imgHeight, undefined, "FAST");
      } else {
        const bodyPageNumber = index - coverSlices.length + 1;
        drawBodyHeader(pdf, title);
        pdf.addImage(
          imgData,
          "PNG",
          0,
          HEADER_BAND_H + BODY_TOP_PAD,
          pageWidth,
          imgHeight,
          undefined,
          "FAST",
        );
        drawBodyFooter(pdf, bodyPageNumber, bodyPageCount);
      }
    });

    pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
  } finally {
    clone.remove();
  }
}

export function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";
}
