import { useEffect, useMemo, useState } from "react";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import {
  buildJakartaCorridorStatuses,
  type JakartaCorridorStatus,
  type JakartaExposureIcon,
  type JakartaExposureLevel,
} from "@/lib/jakartaCorridors";

const NAVY = "#0B0B3D";
const DUSK = "#303030";
const POLAR = "#E2E2E2";

// Operating-exposure tints for THIS graphic. Deliberately pale, distinct from
// the incident-severity ramp, and never the reserved A33232 (Extreme) or
// 1B6B7A (Insignificant) hexes.
const EXPOSURE_FILL: Record<JakartaExposureLevel, string> = {
  high: "#E2ADAD",
  elevated: "#EAC59B",
  monitored: "#EDDCA4",
  low: "#C9DBB0",
  "not-assessed": "#D8DADD",
};
const EXPOSURE_ACCENT: Record<JakartaExposureLevel, string> = {
  high: "#9A3B3B",
  elevated: "#B26A2B",
  monitored: "#8F7A2E",
  low: "#5C7B3F",
  "not-assessed": "#888E96",
};
const EXPOSURE_LABEL: Record<JakartaExposureLevel, string> = {
  high: "High",
  elevated: "Elevated",
  monitored: "Monitored",
  low: "Low",
  "not-assessed": "Not Assessed",
};
const EXPOSURE_ORDER: JakartaExposureLevel[] = [
  "high",
  "elevated",
  "monitored",
  "low",
  "not-assessed",
];

const SEA = "#DCE6F0";
const SEA_LABEL = "#7E93AC";
const DISTRICT_BORDER = "#FFFFFF";
const REGION_FILL = "#D8DADD";
const REGION_BORDER = "#C4CAD2";
const ROUTE = "#B6BEC9";
const ROUTE_DARK = "#98A1AD";
const BELT = "#6E8E4E";
const PANEL_BG = "#F3F5F8";

// ---- Single full-canvas graphic --------------------------------------------
// The entire figure (base map, exposure fills, boundaries, routes, icons,
// district exposure tags, legend and footer) is rendered into ONE high-DPI
// canvas and emitted as a single data-URL <img>. This guarantees the on-screen
// preview and the DOM-rasterised PDF are pixel-identical, and sidesteps
// html2canvas (which mangles inline SVG and will not copy a live <canvas>
// bitmap on clone, but copies an <img> data URL faithfully).
const LOGICAL_W = 1120;
const LOGICAL_H = 760;
// High render scale so the single rasterised <img> stays crisp after the
// report's html2canvas PDF/PNG capture re-samples it at report size.
const RENDER_SCALE = 4;

// Map panel (geography is expressed as 0..100 percentages inside this rect).
const PANEL = { x: 24, y: 84, w: 796, h: 604 };
// Legend column.
const LEGEND = { x: 836, y: 84, w: 260 };

type Pt = [number, number];
type GlyphKind = JakartaExposureIcon | "government";

function geoX(gx: number): number {
  return PANEL.x + (gx / 100) * PANEL.w;
}
function geoY(gy: number): number {
  return PANEL.y + (gy / 100) * PANEL.h;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function setFont(
  ctx: CanvasRenderingContext2D,
  weight: number,
  size: number,
  condensed = false,
  italic = false,
): void {
  const fam = condensed ? "'Roboto Condensed'" : "Roboto";
  ctx.font = `${italic ? "italic " : ""}${weight} ${size}px ${fam}, sans-serif`;
}

// Draw a monochrome glyph into a 24x24 logical box. No inline SVG, no emoji.
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  icon: GlyphKind,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (icon) {
    case "crowd": {
      const head = (cx: number, cy: number, r: number) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      };
      const body = (cx: number, top: number, w: number, h: number) => {
        roundRectPath(ctx, cx - w / 2, top, w, h, 2);
        ctx.fill();
      };
      head(6, 8, 2.4);
      head(18, 8, 2.4);
      head(12, 6.2, 3);
      body(6, 11, 5.5, 8);
      body(18, 11, 5.5, 8);
      body(12, 10, 7, 9);
      break;
    }
    case "flood": {
      ctx.beginPath();
      ctx.arc(9, 11, 4, 0, Math.PI * 2);
      ctx.arc(14, 9, 5, 0, Math.PI * 2);
      ctx.arc(17.5, 12, 3.3, 0, Math.PI * 2);
      ctx.rect(9, 11, 8.5, 4);
      ctx.fill();
      ctx.lineWidth = 1.7;
      [8, 12, 16].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, 17);
        ctx.lineTo(x - 1.6, 21);
        ctx.stroke();
      });
      break;
    }
    case "road": {
      ctx.beginPath();
      ctx.moveTo(9, 4);
      ctx.lineTo(15, 4);
      ctx.lineTo(20, 20);
      ctx.lineTo(4, 20);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2.6, 2.6]);
      ctx.beginPath();
      ctx.moveTo(12, 5);
      ctx.lineTo(12, 19);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "plane": {
      ctx.save();
      ctx.translate(12, 12);
      ctx.rotate(-Math.PI / 4);
      roundRectPath(ctx, -1.4, -9.5, 2.8, 19, 1.4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-1.4, -1);
      ctx.lineTo(-8.5, 2.5);
      ctx.lineTo(-1.4, 4);
      ctx.closePath();
      ctx.moveTo(1.4, -1);
      ctx.lineTo(8.5, 2.5);
      ctx.lineTo(1.4, 4);
      ctx.closePath();
      ctx.moveTo(-1.4, -7.5);
      ctx.lineTo(-4, -9.5);
      ctx.lineTo(-1.4, -6);
      ctx.closePath();
      ctx.moveTo(1.4, -7.5);
      ctx.lineTo(4, -9.5);
      ctx.lineTo(1.4, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case "port": {
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(12, 5, 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 7.2);
      ctx.lineTo(12, 19);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8, 9.6);
      ctx.lineTo(16, 9.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12.5, 6.6, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5.6, 15.4);
      ctx.lineTo(6.8, 12.6);
      ctx.moveTo(18.4, 15.4);
      ctx.lineTo(17.2, 12.6);
      ctx.stroke();
      break;
    }
    case "building": {
      roundRectPath(ctx, 4.5, 4, 7.5, 16, 1);
      ctx.fill();
      roundRectPath(ctx, 13, 9, 6.5, 11, 1);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          ctx.fillRect(6 + c * 3, 6.5 + r * 3.3, 1.6, 1.6);
        }
      }
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          ctx.fillRect(14.3 + c * 2.7, 11 + r * 3.3, 1.5, 1.5);
        }
      }
      break;
    }
    case "government": {
      // Classical columned building: pediment + columns + base.
      ctx.beginPath();
      ctx.moveTo(12, 2.4);
      ctx.lineTo(21, 7.4);
      ctx.lineTo(3, 7.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(3, 7.6, 18, 2);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(4.6 + i * 4.1, 10, 2.2, 8.4);
      }
      ctx.fillRect(3, 18.6, 18, 2.4);
      break;
    }
  }
}

function drawIconAt(
  ctx: CanvasRenderingContext2D,
  kind: GlyphKind,
  cx: number,
  cy: number,
  boxSize: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx - boxSize / 2, cy - boxSize / 2);
  ctx.scale(boxSize / 24, boxSize / 24);
  drawGlyph(ctx, kind, color);
  ctx.restore();
}

function drawDistrictMarker(
  ctx: CanvasRenderingContext2D,
  kind: GlyphKind,
  cx: number,
  cy: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  drawIconAt(ctx, kind, cx, cy, 20, NAVY);
}

function polyPath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = geoX(p[0]);
    const y = geoY(p[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string): void {
  polyPath(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokePoly(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  stroke: string,
  width: number,
): void {
  polyPath(ctx, pts);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
): void {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const s = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - s * Math.cos(ang - Math.PI / 6),
    to.y - s * Math.sin(ang - Math.PI / 6),
  );
  ctx.lineTo(
    to.x - s * Math.cos(ang + Math.PI / 6),
    to.y - s * Math.sin(ang + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  ctrl?: Pt,
): void {
  const a = { x: geoX(from[0]), y: geoY(from[1]) };
  const b = { x: geoX(to[0]), y: geoY(to[1]) };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ROUTE;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  let src = a;
  if (ctrl) {
    const c = { x: geoX(ctrl[0]), y: geoY(ctrl[1]) };
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    src = c;
  } else {
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  drawArrowHead(ctx, src, b, ROUTE_DARK);
}

function centredLabel(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  gx: number,
  gy: number,
  size: number,
  color: string,
  weight: number,
): void {
  setFont(ctx, weight, size, true);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const gap = size * 1.05;
  const x = geoX(gx);
  let y = geoY(gy) - ((lines.length - 1) * gap) / 2;
  for (const ln of lines) {
    ctx.fillText(ln, x, y);
    y += gap;
  }
  ctx.textAlign = "left";
}

// Exposure chip — a small accent pill with white level text, placed inside a
// district under its name so the level reads without decoding the fill alone.
function drawExposureChip(
  ctx: CanvasRenderingContext2D,
  level: JakartaExposureLevel,
  cx: number,
  cy: number,
): void {
  const label = EXPOSURE_LABEL[level].toUpperCase();
  setFont(ctx, 700, 9, true);
  const w = ctx.measureText(label).width + 14;
  const h = 16;
  const x = cx - w / 2;
  const y = cy - h / 2;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = EXPOSURE_ACCENT[level];
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, y + h / 2 + 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// District name + exposure chip stacked inside a district polygon.
function drawDistrictTag(
  ctx: CanvasRenderingContext2D,
  nameLines: string[],
  level: JakartaExposureLevel,
  gx: number,
  gyName: number,
  gyChip: number,
): void {
  const size = nameLines.length > 1 ? 13 : 14.5;
  centredLabel(ctx, nameLines, gx, gyName, size, NAVY, 700);
  drawExposureChip(ctx, level, geoX(gx), geoY(gyChip));
}

// ---- Geometry --------------------------------------------------------------
const DKI = {
  north: [
    [28, 13],
    [72, 13],
    [70, 26],
    [30, 26],
  ] as Pt[],
  west: [
    [24, 26],
    [46, 26],
    [44, 56],
    [26, 55],
  ] as Pt[],
  central: [
    [46, 26],
    [58, 26],
    [57, 52],
    [46, 52],
  ] as Pt[],
  east: [
    [58, 26],
    [76, 26],
    [75, 53],
    [58, 52],
  ] as Pt[],
  south: [
    [30, 52],
    [62, 52],
    [58, 73],
    [34, 73],
  ] as Pt[],
};
const REGENCY_TANGERANG: Pt[] = [
  [0, 13],
  [24, 13],
  [24, 55],
  [16, 73],
  [0, 73],
];
const REGENCY_BEKASI: Pt[] = [
  [76, 13],
  [100, 13],
  [100, 73],
  [84, 73],
  [78, 48],
  [76, 28],
];
const REGENCY_BOGOR: Pt[] = [
  [0, 73],
  [100, 73],
  [100, 100],
  [0, 100],
];
const AIRPORT_SHAPE: Pt[] = [
  [3, 15.5],
  [15, 15.5],
  [14, 25],
  [2, 24],
];
const BELT_RING: Pt[] = [
  [3, 15],
  [97, 15],
  [97, 70],
  [90, 97],
  [10, 97],
  [3, 70],
];

// ---- Date range ------------------------------------------------------------
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function weeklyRangeLabel(issueDate?: string): string {
  if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return "This reporting period";
  }
  const end = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return "This reporting period";
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const sd = start.getUTCDate();
  const ed = end.getUTCDate();
  const sm = start.getUTCMonth();
  const em = end.getUTCMonth();
  const sy = start.getUTCFullYear();
  const ey = end.getUTCFullYear();
  if (sy === ey && sm === em) {
    return `${sd} to ${ed} ${MONTHS[em]} ${ey}`;
  }
  if (sy === ey) {
    return `${sd} ${MONTHS[sm]} to ${ed} ${MONTHS[em]} ${ey}`;
  }
  return `${sd} ${MONTHS[sm]} ${sy} to ${ed} ${MONTHS[em]} ${ey}`;
}

// ---- Main render -----------------------------------------------------------
function renderExposureMap(
  statuses: JakartaCorridorStatus[],
  rangeLabel: string,
): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = LOGICAL_W * RENDER_SCALE;
  canvas.height = LOGICAL_H * RENDER_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  const byId = (id: string) => statuses.find((s) => s.area.id === id);
  const levelOf = (id: string): JakartaExposureLevel =>
    byId(id)?.displayExposure ?? "monitored";
  const WEST_LEVEL: JakartaExposureLevel = "monitored";
  const EAST_LEVEL: JakartaExposureLevel = "low";

  // White page.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Title + subtitle.
  setFont(ctx, 700, 29, true);
  ctx.fillStyle = NAVY;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("JAKARTA – OPERATIONAL EXPOSURE MAP", 24, 40);
  setFont(ctx, 400, 13);
  ctx.fillStyle = DUSK;
  ctx.fillText(
    "Areas and routes where movement, access, logistics or business activity could be disrupted this week.",
    24,
    62,
  );

  // Panel.
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);

  // Sea band + coastline.
  ctx.save();
  ctx.beginPath();
  ctx.rect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.clip();
  ctx.fillStyle = SEA;
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, geoY(13) - PANEL.y);
  ctx.restore();

  // Regencies (context geography).
  fillPoly(ctx, REGENCY_BOGOR, REGION_FILL);
  fillPoly(ctx, REGENCY_TANGERANG, REGION_FILL);
  fillPoly(ctx, REGENCY_BEKASI, REGION_FILL);
  strokePoly(ctx, REGENCY_TANGERANG, REGION_BORDER, 1.3);
  strokePoly(ctx, REGENCY_BEKASI, REGION_BORDER, 1.3);
  strokePoly(ctx, REGENCY_BOGOR, REGION_BORDER, 1.3);

  // Airport landmass.
  fillPoly(ctx, AIRPORT_SHAPE, REGION_FILL);
  strokePoly(ctx, AIRPORT_SHAPE, REGION_BORDER, 1.3);

  // DKI district fills.
  fillPoly(ctx, DKI.north, EXPOSURE_FILL[levelOf("north-port")]);
  fillPoly(ctx, DKI.west, EXPOSURE_FILL[WEST_LEVEL]);
  fillPoly(ctx, DKI.central, EXPOSURE_FILL[levelOf("central-government")]);
  fillPoly(ctx, DKI.east, EXPOSURE_FILL[EAST_LEVEL]);
  fillPoly(ctx, DKI.south, EXPOSURE_FILL[levelOf("commercial-hotels")]);
  // District boundaries.
  for (const p of Object.values(DKI)) strokePoly(ctx, p, DISTRICT_BORDER, 2);

  // Commuter belt ring (dashed).
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = BELT;
  ctx.lineJoin = "round";
  polyPath(ctx, BELT_RING);
  ctx.stroke();
  ctx.restore();

  // Route bands.
  drawRoute(ctx, [9, 20], [45, 39], [26, 33]); // airport corridor
  drawRoute(ctx, [50, 39], [50, 22]); // spine to port
  drawRoute(ctx, [52, 43], [71, 49], [62, 44]); // cross-city east
  drawRoute(ctx, [49, 45], [46, 61]); // cross-city to south

  // District markers (icons).
  drawDistrictMarker(ctx, "port", geoX(60), geoY(20));
  drawDistrictMarker(ctx, "government", geoX(51), geoY(33));
  drawDistrictMarker(ctx, "building", geoX(46), geoY(57));
  drawDistrictMarker(ctx, "plane", geoX(8), geoY(20));

  // Sea label.
  setFont(ctx, 400, 12, false, true);
  ctx.fillStyle = SEA_LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Java Sea", geoX(50), geoY(6));
  ctx.textAlign = "left";

  // District name + exposure chip, set inside each district. The supporting
  // table below carries the "why it matters" and "action" detail, so the map
  // stays a glanceable choropleth rather than repeating the table in callouts.
  drawDistrictTag(ctx, ["NORTH JAKARTA"], levelOf("north-port"), 41, 18, 23);
  drawDistrictTag(ctx, ["WEST JAKARTA"], WEST_LEVEL, 34, 38, 43);
  drawDistrictTag(
    ctx,
    ["CENTRAL", "JAKARTA"],
    levelOf("central-government"),
    50,
    40,
    47.5,
  );
  drawDistrictTag(ctx, ["EAST JAKARTA"], EAST_LEVEL, 67, 38, 43);
  drawDistrictTag(
    ctx,
    ["SOUTH JAKARTA"],
    levelOf("commercial-hotels"),
    46,
    66,
    71,
  );

  // Regency context labels (not assessed).
  centredLabel(ctx, ["TANGERANG", "REGENCY"], 9, 34, 10.5, "#8A9099", 600);
  centredLabel(ctx, ["BEKASI", "REGENCY"], 91, 34, 10.5, "#8A9099", 600);
  centredLabel(ctx, ["BOGOR REGENCY"], 50, 90, 10.5, "#8A9099", 600);

  // Legend.
  drawLegend(ctx);

  // Footer.
  drawFooter(ctx, rangeLabel);

  return canvas.toDataURL("image/png");
}

function legendHeader(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
): number {
  const H = 22;
  // Light header band — keeps the sidebar airy rather than a heavy navy block.
  ctx.fillStyle = "#EEF1F5";
  ctx.fillRect(LEGEND.x, y, LEGEND.w, H);
  ctx.fillStyle = NAVY;
  ctx.fillRect(LEGEND.x, y, 3, H);
  ctx.fillStyle = "#D5DBE3";
  ctx.fillRect(LEGEND.x, y + H - 1, LEGEND.w, 1);
  setFont(ctx, 700, 11.5, true);
  ctx.fillStyle = NAVY;
  ctx.textBaseline = "middle";
  ctx.fillText(text, LEGEND.x + 12, y + H / 2 + 0.5);
  return y + H;
}

function drawLegend(ctx: CanvasRenderingContext2D): void {
  const x = LEGEND.x;
  let y = legendHeader(ctx, "EXPOSURE LEVEL", LEGEND.y) + 10;
  for (const level of EXPOSURE_ORDER) {
    ctx.fillStyle = EXPOSURE_FILL[level];
    ctx.fillRect(x + 6, y, 22, 14);
    ctx.strokeStyle = EXPOSURE_ACCENT[level];
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 6.5, y + 0.5, 21, 13);
    setFont(ctx, 400, 12);
    ctx.fillStyle = DUSK;
    ctx.textBaseline = "middle";
    ctx.fillText(EXPOSURE_LABEL[level], x + 36, y + 8);
    y += 24;
  }

  y = legendHeader(ctx, "MAP KEY", y + 12) + 10;
  const keyRow = (draw: () => void, label: string) => {
    draw();
    setFont(ctx, 400, 12);
    ctx.fillStyle = DUSK;
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 36, y + 8);
    y += 24;
  };
  keyRow(() => drawIconAt(ctx, "government", x + 16, y + 8, 17, NAVY), "Government district");
  keyRow(() => drawIconAt(ctx, "building", x + 16, y + 8, 17, NAVY), "Commercial / business area");
  keyRow(() => drawIconAt(ctx, "plane", x + 16, y + 8, 17, NAVY), "Airport");
  keyRow(() => drawIconAt(ctx, "port", x + 16, y + 8, 17, NAVY), "Port / logistics");
  keyRow(() => {
    ctx.strokeStyle = ROUTE;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 8);
    ctx.lineTo(x + 24, y + 8);
    ctx.stroke();
    drawArrowHead(ctx, { x: x + 6, y: y + 8 }, { x: x + 27, y: y + 8 }, ROUTE_DARK);
  }, "Key movement route");
  keyRow(() => {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = BELT;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 8);
    ctx.lineTo(x + 28, y + 8);
    ctx.stroke();
    ctx.restore();
  }, "Commuter belt");

  // Notes are carried by the caption beneath the figure, keeping the sidebar
  // airy; the map key above already explains every symbol.
}

function drawFooter(ctx: CanvasRenderingContext2D, rangeLabel: string): void {
  const x = 24;

  // Hairline divider tying the footer to the figure above.
  ctx.strokeStyle = "#D5DBE3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 701);
  ctx.lineTo(LEGEND.x + LEGEND.w, 701);
  ctx.stroke();

  // Report period — primary footer line. No in-map Polestar mark: the figure
  // already sits inside a branded Polestar report.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 700, 14, true);
  ctx.fillStyle = NAVY;
  ctx.fillText(`JAKARTA REPORT   •   ${rangeLabel.toUpperCase()}`, x, 723);

  // Sources — secondary line.
  setFont(ctx, 400, 11, false, true);
  ctx.fillStyle = DUSK;
  ctx.fillText(
    "Sources: open source reporting, local media and field monitoring this period.",
    x,
    741,
  );
}

// ---- Component -------------------------------------------------------------
export interface JakartaCorridorMapProps {
  incidents: CountryFastFactsIncident[];
  /** Report issue date (YYYY-MM-DD) — drives the footer weekly date range. */
  issueDate?: string;
  /** Optional DOM id (kept for parity with CountryReportMap callers). */
  domId?: string;
}

/**
 * Jakarta operational exposure map — a single report graphic rendered into one
 * high-DPI canvas and emitted as an <img> data URL. It shows the recognisable
 * Greater-Jakarta geography (Java Sea, the five DKI districts, surrounding
 * regencies, the airport landmass and the commuter belt), shades each profiled
 * area by an operating-exposure level, draws the main movement routes, and
 * carries an in-district exposure tag per district, a legend (exposure level /
 * map key), a sources line and the weekly date range.
 *
 * Exposure levels are honest: each area carries a standing profile that live
 * reporting can only RAISE, never invent. The supporting table below repeats
 * the levels plus a practical action, and doubles as the accessible text and
 * the fallback when the canvas cannot render.
 */
export default function JakartaCorridorMap({
  incidents,
  issueDate,
  domId,
}: JakartaCorridorMapProps) {
  const { statuses, unattributed } = useMemo(
    () => buildJakartaCorridorStatuses(incidents),
    [incidents],
  );
  const rangeLabel = useMemo(() => weeklyRangeLabel(issueDate), [issueDate]);
  const renderKey = useMemo(
    () =>
      `${rangeLabel}|${statuses.map((s) => `${s.area.id}:${s.displayExposure}`).join(",")}`,
    [rangeLabel, statuses],
  );

  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (typeof document === "undefined") return;
      try {
        if (document.fonts?.ready) await document.fonts.ready;
      } catch {
        // Fonts API unavailable — fall through and draw with whatever is loaded.
      }
      if (cancelled) return;
      const url = renderExposureMap(statuses, rangeLabel);
      if (!cancelled) setDataUrl(url);
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  const anyElevated = statuses.some((s) => s.elevated);

  return (
    <div>
      <div
        id={domId}
        style={{
          width: "100%",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#ffffff",
          boxSizing: "border-box",
          overflow: "hidden",
          minHeight: dataUrl ? undefined : 320,
        }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Jakarta operational exposure map"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        ) : (
          <div
            style={{
              fontFamily: "Roboto, sans-serif",
              fontSize: 12,
              color: DUSK,
              padding: 16,
            }}
          >
            Preparing the Jakarta exposure map…
          </div>
        )}
      </div>

      <div
        style={{
          fontFamily: "Roboto, sans-serif",
          fontSize: 10.5,
          color: DUSK,
          marginTop: 8,
          fontStyle: "italic",
        }}
      >
        Operational exposure by area and route — not a live incident map; it
        does not plot individual incident locations and boundaries are
        indicative. Levels combine each area's standing profile with this
        period's reporting; the regencies are shown as context and not assessed.
        Always confirm conditions locally before travelling.
        {unattributed > 0
          ? " Some records were retained in the assessment but not tied to a specific area."
          : ""}
      </div>

      <ExposureTable statuses={statuses} anyElevated={anyElevated} />
    </div>
  );
}

function ExposureTable({
  statuses,
  anyElevated,
}: {
  statuses: JakartaCorridorStatus[];
  anyElevated: boolean;
}) {
  const columns = "minmax(0, 1.1fr) 150px minmax(0, 1.4fr) minmax(0, 1.4fr)";
  const cell: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 11.5,
    color: DUSK,
    padding: "8px 10px",
    boxSizing: "border-box",
    lineHeight: 1.32,
  };
  return (
    <div
      style={{
        marginTop: 14,
        border: `1px solid ${POLAR}`,
        borderRadius: 2,
        overflow: "hidden",
        background: "#ffffff",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns,
          background: NAVY,
          color: "#ffffff",
        }}
      >
        {["Area", "Exposure level", "Why it matters", "Action"].map((h) => (
          <div
            key={h}
            style={{
              ...cell,
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {h}
          </div>
        ))}
      </div>
      {statuses.map((s) => {
        const accent = EXPOSURE_ACCENT[s.displayExposure];
        return (
          <div
            key={s.area.id}
            style={{
              display: "grid",
              gridTemplateColumns: columns,
              borderTop: `1px solid ${POLAR}`,
              alignItems: "stretch",
            }}
          >
            <div style={{ ...cell }}>
              <div style={{ fontWeight: 700, color: NAVY }}>{s.area.name}</div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: "#6b7280" }}>
                {s.area.exposure}
              </div>
            </div>
            <div style={{ ...cell }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: accent,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 11,
                    height: 11,
                    borderRadius: 2,
                    background: EXPOSURE_FILL[s.displayExposure],
                    border: `1px solid ${accent}`,
                  }}
                />
                {EXPOSURE_LABEL[s.displayExposure]}
              </span>
              <div style={{ marginTop: 3, fontSize: 9.5, color: "#7a828e" }}>
                {s.elevated ? "Raised by reporting this period" : "Standing profile"}
              </div>
            </div>
            <div style={{ ...cell }}>{s.area.relevance}</div>
            <div style={{ ...cell }}>{s.area.action}</div>
          </div>
        );
      })}
      <div
        style={{
          ...cell,
          borderTop: `1px solid ${POLAR}`,
          fontStyle: "italic",
          fontSize: 10,
          color: DUSK,
        }}
      >
        {anyElevated
          ? "Levels shown are the higher of each area's standing exposure profile and this period's reporting."
          : "No area carried fresh reporting this period; levels shown are each area's standing exposure profile."}
      </div>
    </div>
  );
}
