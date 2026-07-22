import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import { ensureRobotoLoaded, setRoboto } from "./pdfFonts";
import {
  buildPageSlices,
  refineBreakCandidates,
  type KeepRange,
} from "./pdfPageBreaks";

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

  applyMapExportLayout(root, "country-report-map", 400);
  // The spot map (IncidentMap) renders its own attribution into the legend so
  // it is identical on screen and in the PDF, so the export must NOT append a
  // second one.
  applyMapExportLayout(root, "spot-report-map", undefined, false);
  applyMapExportLayout(root, "special-report-map", undefined, false);
  applySeverityBadgeExportLayout(root);
  applyCountryTableExportLayout(root);
  applyBarChartExportLayout(root);
}

function applyMapExportLayout(
  root: HTMLElement,
  mapId: string,
  height?: number,
  appendAttribution = true,
): void {
  const map = root.querySelector<HTMLElement>(`#${mapId}`);
  if (!map) return;

  if (height) map.style.height = `${height}px`;
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

  if (!appendAttribution) return;

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
  // Tagged chips (spot report) become pixel-perfect canvases so the label stays
  // centred — html2canvas renders CSS text low. Done first so the span path below
  // no longer sees them.
  root.querySelectorAll<HTMLElement>("[data-sev-chip]").forEach((node) => {
    const label = (node.dataset.sevLabel || node.textContent || "").trim();
    const color =
      node.dataset.sevColor || node.style.background || node.style.backgroundColor;
    if (!label || !color) return;
    const num = (v: string | undefined) =>
      v != null && v !== "" ? Number(v) : undefined;
    node.replaceWith(
      sidebarSeverityChipCanvas(label, color, {
        height: num(node.dataset.sevHeight),
        minWidth: num(node.dataset.sevMinWidth),
        padX: num(node.dataset.sevPadX),
      }),
    );
  });

  // Operational-map posture markers keep their numeral dead-centre on screen
  // (symmetric flex). html2canvas renders text a touch low, so re-add the small
  // bottom pad ONLY in the export clone so screen and PDF still agree.
  root.querySelectorAll<HTMLElement>("[data-map-numeral]").forEach((node) => {
    node.style.paddingBottom = "2px";
  });

  const labels = new Set(["EXTREME", "HIGH", "MODERATE", "LOW", "INSIGNIFICANT"]);
  root.querySelectorAll<HTMLElement>("span").forEach((node) => {
    const label = (node.textContent ?? "").trim().toUpperCase();
    if (!labels.has(label)) return;
    const bg = node.style.background || node.style.backgroundColor;
    if (!bg) return;

    node.style.display = "block";
    node.style.boxSizing = "border-box";
    node.style.width = "112px";
    node.style.height = "24px";
    node.style.minWidth = "112px";
    node.style.padding = "0";
    node.style.lineHeight = "24px";
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

function cellText(cell: Element | undefined): string {
  return (cell?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function severityChip(label: string, color: string, width = 92, height = 20): HTMLCanvasElement {
  const displayLabel = label.toUpperCase();
  const canvas = document.createElement("canvas");
  const scale = 3;
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = "block";
  canvas.style.margin = "0";

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(scale, scale);
  ctx.fillStyle = color || "#999999";
  ctx.fillRect(0, 0, width, height);

  let fontSize = displayLabel.length >= 8 ? 8.5 : 10;
  ctx.font = `700 ${fontSize}px Roboto, Arial, sans-serif`;
  while (ctx.measureText(displayLabel).width > width - 14 && fontSize > 7) {
    fontSize -= 0.5;
    ctx.font = `700 ${fontSize}px Roboto, Arial, sans-serif`;
  }
  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayLabel, width / 2, height / 2);

  return canvas;
}

// html2canvas renders CSS text baselines low, so a span-based severity chip ends
// up vertically off-centre in the exported PDF even with line-height centering.
// A real <canvas> (drawn by the browser, rasterised verbatim by html2canvas) is
// the only deterministic way to keep the label centred. Sized/styled to match the
// on-screen chip exactly (fontSize 10, letter-spacing 0.08em, padding 11px,
// height 20px, 2px radius) so preview and PDF agree.
function sidebarSeverityChipCanvas(
  label: string,
  color: string,
  opts: { height?: number; minWidth?: number; padX?: number } = {},
): HTMLCanvasElement {
  const text = label.toUpperCase();
  const fontPx = 10;
  const letterSpacingPx = 0.08 * fontPx;
  const padX = opts.padX ?? 11;
  const height = opts.height ?? 20;
  const radius = 2;
  const scale = 3;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d") as
    | (CanvasRenderingContext2D & { letterSpacing?: string })
    | null;

  let textW = text.length * 6.4;
  if (ctx) {
    ctx.font = `700 ${fontPx}px Roboto, Arial, sans-serif`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${letterSpacingPx}px`;
    textW = ctx.measureText(text).width;
  }
  let width = Math.round(textW + padX * 2);
  if (opts.minWidth) width = Math.max(width, opts.minWidth);

  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = "inline-block";
  canvas.style.verticalAlign = "middle";
  canvas.style.borderRadius = `${radius}px`;
  canvas.style.flex = "0 0 auto";

  if (!ctx) return canvas;
  ctx.scale(scale, scale);
  ctx.fillStyle = color || "#999999";
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(width, 0, width, height, radius);
  ctx.arcTo(width, height, 0, height, radius);
  ctx.arcTo(0, height, 0, 0, radius);
  ctx.arcTo(0, 0, width, 0, radius);
  ctx.closePath();
  ctx.fill();

  ctx.font = `700 ${fontPx}px Roboto, Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${letterSpacingPx}px`;
  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);

  return canvas;
}

function makeTableCell(text: string, options: {
  align?: "left" | "center" | "right";
  valign?: "top" | "center";
  bold?: boolean;
  color?: string;
  fontSize?: string;
  italic?: boolean;
  uppercase?: boolean;
} = {}): HTMLDivElement {
  const cell = document.createElement("div");
  cell.textContent = options.uppercase ? text.toUpperCase() : text;
  cell.style.display = "flex";
  cell.style.justifyContent = options.align === "center"
    ? "center"
    : options.align === "right"
      ? "flex-end"
      : "flex-start";
  cell.style.textAlign = options.align ?? "left";
  cell.style.alignItems = options.valign === "top" ? "flex-start" : "center";
  cell.style.boxSizing = "border-box";
  cell.style.padding = options.valign === "top" ? "10px 10px 0 10px" : "0 10px";
  cell.style.minHeight = "100%";
  cell.style.height = "100%";
  cell.style.fontFamily = "Roboto, Arial, sans-serif";
  cell.style.fontSize = options.fontSize ?? "12px";
  cell.style.fontWeight = options.bold ? "700" : "400";
  cell.style.fontStyle = options.italic ? "italic" : "normal";
  cell.style.color = options.color ?? DUSK;
  cell.style.lineHeight = "1.32";
  return cell;
}

function makeExportRow(columns: string, height: string, isHeader = false): HTMLDivElement {
  const row = document.createElement("div");
  row.dataset.pdfRow = "true";
  row.style.display = "grid";
  row.style.gridTemplateColumns = columns;
  row.style.alignItems = "center";
  row.style.minHeight = height;
  row.style.height = height;
  row.style.boxSizing = "border-box";
  if (isHeader) {
    row.style.background = NAVY;
    row.style.color = WHITE;
  } else {
    row.style.borderTop = `1px solid ${POLAR}`;
  }
  return row;
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
    if (!table) return;

    const parsedRows = rows.slice(1).map((row) => {
      const cells = Array.from(row.children);
      const severityCell = cells[expectedCells - 1] as HTMLElement | undefined;
      const severityNode = severityCell?.querySelector<HTMLElement>("span");
      return {
        cells,
        severityLabel: cellText(severityNode ?? severityCell),
        severityColor: severityNode?.style.background || severityNode?.style.backgroundColor || "",
      };
    });

    table.innerHTML = "";
    table.style.width = "100%";
    table.style.overflow = "hidden";
    table.style.background = WHITE;
    table.style.border = `1px solid ${POLAR}`;
    table.style.borderRadius = "2px";
    table.style.boxSizing = "border-box";

    if (isWatchlist) {
      const columns = "165px minmax(0, 1fr) 50px 50px 50px 200px";
      const header = makeExportRow(columns, "40px", true);
      ["Location", "Note", "7d", "30d", "90d", "Worst (90d)"].forEach((label) => {
        header.appendChild(makeTableCell(label, {
          align: "left",
          valign: "center",
          bold: true,
          color: WHITE,
          fontSize: "10px",
          uppercase: true,
        }));
      });
      table.appendChild(header);

      parsedRows.forEach((row) => {
        const out = makeExportRow(columns, "54px");
        out.appendChild(makeTableCell(cellText(row.cells[0]), { bold: true, color: NAVY, valign: "top" }));
        out.appendChild(makeTableCell(cellText(row.cells[1]), { fontSize: "11px", valign: "top" }));
        out.appendChild(makeTableCell(cellText(row.cells[2]), { align: "left", bold: true, valign: "top" }));
        out.appendChild(makeTableCell(cellText(row.cells[3]), { align: "left", bold: true, valign: "top" }));
        out.appendChild(makeTableCell(cellText(row.cells[4]), { align: "left", bold: true, valign: "top" }));
        const sevCell = makeTableCell("", { align: "left", valign: "top" });
        sevCell.style.padding = "10px 18px 0 18px";
        if (row.severityLabel && row.severityLabel.toLowerCase() !== "no records") {
          sevCell.appendChild(severityChip(row.severityLabel, row.severityColor, 110, 20));
        } else {
          sevCell.textContent = row.severityLabel || "No records";
          sevCell.style.fontStyle = "italic";
        }
        out.appendChild(sevCell);
        table.appendChild(out);
      });
      return;
    }

    const columns = "150px 120px minmax(0, 1fr) 150px";
    const header = makeExportRow(columns, "40px", true);
    ["Date", "Type", "Title", "Severity"].forEach((label, index) => {
      header.appendChild(makeTableCell(label, {
        align: index === 3 ? "center" : "left",
        bold: true,
        color: WHITE,
        fontSize: "10px",
        uppercase: true,
      }));
    });
    table.appendChild(header);

    parsedRows.forEach((row) => {
      const out = makeExportRow(columns, "58px");
      out.appendChild(makeTableCell(cellText(row.cells[0]), { fontSize: "11px" }));
      out.appendChild(makeTableCell(cellText(row.cells[1])));
      out.appendChild(makeTableCell(cellText(row.cells[2]), { bold: true, color: NAVY }));
      const sevCell = makeTableCell("", { align: "center" });
      sevCell.appendChild(severityChip(row.severityLabel, row.severityColor, 112, 20));
      out.appendChild(sevCell);
      table.appendChild(out);
    });
  });
}

function applyBarChartExportLayout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("h2").forEach((heading) => {
    const title = (heading.textContent ?? "").trim().toUpperCase();
    if (title !== "SEVERITY DISTRIBUTION" && title !== "INCIDENT BREAKDOWN BY TYPE") return;
    const section = heading.closest("section");
    const container = section?.querySelector<HTMLElement>(".space-y-1\\.5");
    if (!container) return;

    const sourceRows = Array.from(container.children) as HTMLElement[];
    const rows = sourceRows.map((row) => {
      const children = Array.from(row.children) as HTMLElement[];
      const track = children[1] as HTMLElement | undefined;
      const bar = track?.firstElementChild as HTMLElement | null;
      return {
        label: cellText(children[0]),
        count: cellText(children[2]),
        width: bar?.style.width || "0%",
        color: bar?.style.background || bar?.style.backgroundColor || ELECTRIC,
      };
    });
    if (rows.length === 0) return;

    container.innerHTML = "";
    container.style.display = "grid";
    container.style.rowGap = "6px";
    container.style.width = "100%";
    container.style.boxSizing = "border-box";

    const columns = title === "SEVERITY DISTRIBUTION"
      ? "150px minmax(0, 1fr) 44px"
      : "190px minmax(0, 1fr) 44px";

    rows.forEach((data) => {
      const row = document.createElement("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = columns;
      row.style.columnGap = "10px";
      row.style.alignItems = "center";
      row.style.minHeight = "22px";

      const label = makeTableCell(data.label, { fontSize: "12px" });
      label.style.padding = "0";
      row.appendChild(label);

      const track = document.createElement("div");
      track.style.height = "12px";
      track.style.background = POLAR;
      track.style.borderRadius = "2px";
      track.style.overflow = "hidden";
      const bar = document.createElement("div");
      bar.style.width = data.width;
      bar.style.height = "100%";
      bar.style.background = data.color;
      track.appendChild(bar);
      row.appendChild(track);

      const count = makeTableCell(data.count, {
        align: "right",
        bold: true,
        color: NAVY,
        fontSize: "12px",
      });
      count.style.padding = "0";
      row.appendChild(count);

      container.appendChild(row);
    });
  });
}

// Interior line-break candidates (relative to rootTop) inside an element: just
// inside the NEXT wrapped line's rect top, via Range rects grouped into line
// boxes. html2canvas systematically paints text a few pixels LOWER than the
// DOM line rects report (the same quirk that mis-centres chip text), so a cut
// at the mid-gap midpoint can still catch the dropped bottom of the previous
// line. Cutting at next.top + 1 instead means downward raster drift moves ink
// AWAY from the seam on both sides: the previous line's dropped ink stays
// above the cut (the full leading gap is its buffer) and the next line's ink —
// which starts a few px below its rect top and also drifts down — stays below
// it. Used to let a tall prose paragraph split across a page boundary instead
// of being pushed whole.
function interiorLineBreaks(el: HTMLElement, rootTop: number): number[] {
  const rects: Array<{ top: number; bottom: number }> = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.textContent && node.textContent.trim()) {
      range.selectNodeContents(node);
      const list = range.getClientRects();
      for (let i = 0; i < list.length; i++) {
        rects.push({
          top: list[i].top - rootTop,
          bottom: list[i].bottom - rootTop,
        });
      }
    }
    node = walker.nextNode();
  }
  if (rects.length < 2) return [];

  // Merge rects that vertically overlap into single line boxes — one wrapped
  // line may carry several text nodes (inline spans, links).
  rects.sort((a, b) => a.top - b.top);
  const lines: Array<{ top: number; bottom: number }> = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last && r.top < last.bottom - 1) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }

  const breaks: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    breaks.push(Math.round((lines[i - 1].bottom + lines[i].top) / 2));
  }
  return breaks;
}

// Measure the live DOM for legal break offsets (section / card / table / row
// tops, plus line-level tops inside opted-in `data-pdf-flow` prose), then hand
// the raw tops to the pure `refineBreakCandidates` for de-duping/filtering. The
// refinement + slicing geometry lives in `pdfPageBreaks.ts` so it is unit-tested
// without a DOM.
export function collectBreakCandidates(
  root: HTMLElement,
  pageCssHeight: number,
): { candidates: number[]; keepRanges: KeepRange[] } {
  const rootRect = root.getBoundingClientRect();
  const selectors = [
    "section",
    ".report-section",
    ".report-kpi",
    "table",
    "[data-pdf-row]",
    "[data-pdf-break-before]",
  ].join(",");
  const rawTops: number[] = [];

  root.querySelectorAll<HTMLElement>(selectors).forEach((node) => {
    rawTops.push(Math.round(node.getBoundingClientRect().top - rootRect.top));
  });

  // Line-level break points inside opted-in prose (data-pdf-flow): the
  // midpoints of the gaps between wrapped lines. Without these a paragraph
  // taller than the page remainder is shoved whole onto the next page, leaving
  // a half-empty page.
  //
  // ALSO make each flow element's own top a candidate — a page may always
  // break cleanly BEFORE a paragraph — EXCEPT when the element directly
  // follows a heading, so a section heading is never orphaned at the foot of a
  // page. Runs of short one-line paragraphs (e.g. a Spot Report's list-style
  // OPERATIONAL IMPACT lines) contribute no INTERIOR candidates at all, so
  // without their element tops the pager hits a candidate desert, breaks far
  // too early and leaves the page half empty.
  const HEADING_TAG = /^H[1-6]$/;
  root.querySelectorAll<HTMLElement>("[data-pdf-flow]").forEach((el) => {
    interiorLineBreaks(el, rootRect.top).forEach((top) => rawTops.push(top));
    const prev = el.previousElementSibling;
    if (prev && !HEADING_TAG.test(prev.tagName)) {
      rawTops.push(Math.round(el.getBoundingClientRect().top - rootRect.top));
    }
  });

  // Atomic keep-together blocks (data-pdf-keep) — e.g. the Jakarta operational
  // map + legend + operating-zone cards — must never be sliced across a page.
  const keepRanges: KeepRange[] = [];
  root.querySelectorAll<HTMLElement>("[data-pdf-keep]").forEach((node) => {
    const rect = node.getBoundingClientRect();
    keepRanges.push({
      top: Math.round(rect.top - rootRect.top),
      bottom: Math.round(rect.bottom - rootRect.top),
    });
  });

  // Keep-with-next headings (data-pdf-keep-with-next) — a section heading must
  // never be orphaned at the foot of a page, split from the block it introduces.
  // Add a short keep-together range spanning the heading plus the first ~56px of
  // the following block, so a cut that would land between the heading and its
  // body relocates BEFORE the heading (buildPageSlices pulls the page end back to
  // the range top), carrying the heading onto the next page with its content.
  root
    .querySelectorAll<HTMLElement>("[data-pdf-keep-with-next]")
    .forEach((node) => {
      const next = node.nextElementSibling as HTMLElement | null;
      if (!next) return;
      const nodeTop = Math.round(node.getBoundingClientRect().top - rootRect.top);
      const nextRect = next.getBoundingClientRect();
      const nextTop = Math.round(nextRect.top - rootRect.top);
      const nextBottom = Math.round(nextRect.bottom - rootRect.top);
      keepRanges.push({ top: nodeTop, bottom: Math.min(nextBottom, nextTop + 56) });
    });

  return {
    candidates: refineBreakCandidates(rawTops, root.scrollHeight, pageCssHeight),
    keepRanges,
  };
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
  // A report can pin its masthead label via data-masthead-label (e.g. Spot
  // Reports show "SPOT REPORT", since the title already appears in the body
  // title block). Other reports fall back to the h1 / filename.
  const mastheadLabel = element.dataset.mastheadLabel?.trim();
  if (mastheadLabel) return mastheadLabel.toUpperCase();
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

// html2canvas rasterises text a few pixels LOWER than the live DOM's Range
// rects report (its own baseline arithmetic), so a page cut computed as the
// midpoint of a DOM line gap can still land on glyph ink in the raster —
// slicing a line of prose across the page seam. The DOM-measured cut is
// therefore only a first approximation: after rasterising, snap each interior
// body cut to the MIDDLE of the widest fully-blank pixel-row band within
// ±SNAP_WINDOW_CSS_PX of the planned cut in the ACTUAL canvas. A blank raster
// row is glyph-safe by construction, whatever the drift. If no blank band
// exists in the window (cut inside an image / filled table), keep the
// original cut.
const SNAP_WINDOW_CSS_PX = 12;

function snapCutToBlankRasterRows(
  canvas: HTMLCanvasElement,
  canvasScale: number,
  cutCss: number,
  keepRanges: KeepRange[] = [],
): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return cutCss;
  const centre = Math.round(cutCss * canvasScale);
  const win = Math.round(SNAP_WINDOW_CSS_PX * canvasScale);
  const y0 = Math.max(0, centre - win);
  const y1 = Math.min(canvas.height - 1, centre + win);
  if (y1 <= y0) return cutCss;

  const data = ctx.getImageData(0, y0, canvas.width, y1 - y0 + 1).data;
  const rowIsBlank = (row: number): boolean => {
    const off = row * canvas.width * 4;
    for (let x = 0; x < canvas.width; x += 2) {
      const o = off + x * 4;
      // Ink = any noticeably non-white pixel (catches faint antialiased
      // glyph edges, rules, chart fills).
      if (data[o] < 245 || data[o + 1] < 245 || data[o + 2] < 245) return false;
    }
    return true;
  };

  // Collect maximal blank runs; pick the widest (tie → nearest the planned
  // cut) and cut at its midpoint for maximum clearance either side.
  let best: { start: number; end: number } | null = null;
  let runStart = -1;
  const rows = y1 - y0 + 1;
  for (let r = 0; r <= rows; r++) {
    const blank = r < rows && rowIsBlank(r);
    if (blank && runStart < 0) runStart = r;
    if (!blank && runStart >= 0) {
      const run = { start: runStart, end: r - 1 };
      runStart = -1;
      if (!best) {
        best = run;
      } else {
        const runLen = run.end - run.start;
        const bestLen = best.end - best.start;
        const runMid = y0 + (run.start + run.end) / 2;
        const bestMid = y0 + (best.start + best.end) / 2;
        if (
          runLen > bestLen ||
          (runLen === bestLen &&
            Math.abs(runMid - centre) < Math.abs(bestMid - centre))
        ) {
          best = run;
        }
      }
    }
  }
  if (!best) return cutCss;
  const snapped = (y0 + (best.start + best.end) / 2) / canvasScale;
  // Never drift into a keep-together block: the original cut was placed at or
  // outside every keepRange by buildPageSlices, so if the snap would land
  // strictly inside one (it can only cross blank padding rows, but keep the
  // invariant strict), fall back to the original cut.
  if (keepRanges.some((r) => snapped > r.top && snapped < r.bottom)) {
    return cutCss;
  }
  return snapped;
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
    const { candidates: breakCandidates, keepRanges } = collectBreakCandidates(
      clone,
      pageCssHeight,
    );
    const coverSlices = coverEnd > 0 ? [{ start: 0, end: coverEnd }] : [];
    const bodySlices = buildPageSlices(
      sourceHeight,
      pageCssHeight,
      breakCandidates,
      coverEnd,
      keepRanges,
    );
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

    // Snap each interior body cut to a blank raster row band (see
    // snapCutToBlankRasterRows) so the DOM→raster text drift can never slice
    // a line of prose across a page seam. Structural boundaries (document
    // start/end, cover break) are left untouched.
    for (let i = 0; i < bodySlices.length - 1; i++) {
      const snapped = snapCutToBlankRasterRows(
        canvas,
        canvasScale,
        bodySlices[i].end,
        keepRanges,
      );
      bodySlices[i] = { ...bodySlices[i], end: snapped };
      bodySlices[i + 1] = { ...bodySlices[i + 1], start: snapped };
    }

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
