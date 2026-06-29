import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import {
  buildJakartaCorridorStatuses,
  type JakartaCorridorStatus,
  type JakartaExposureLevel,
} from "@/lib/jakartaCorridors";
import {
  JAKARTA_VIEW_BBOX,
  JAKARTA_CORRIDOR_LINES,
  JAKARTA_GEO,
  JAKARTA_MAP_LABELS,
} from "@/lib/jakartaGeo";

const NAVY = "#0B0B3D";
const DUSK = "#303030";
const POLAR = "#E2E2E2";

// Operating-exposure tints for THIS graphic. Deliberately distinct from the
// incident-severity ramp, and never the reserved A33232 (Extreme) or 1B6B7A
// (Insignificant) hexes.
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
const SEV_RANK: Record<JakartaExposureLevel, number> = {
  high: 4,
  elevated: 3,
  monitored: 2,
  low: 1,
  "not-assessed": 0,
};

// Pale Java Sea backdrop behind the custom illustration.
const SEA = "#D6E2F0";

// Warm near-white land + faint dashed administrative boundaries, matching the
// professional travel-risk reference (land reads as paper, the sea as a pale
// wash). Operating exposure is carried by the soft zones, never the land fill.
const LAND_FILL = "#F4F2EC";
const BOUNDARY = "#E4E0D6";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ---------------------------------------------------------------------------
// Monochrome line icons (government building, office tower, anchor, plane, a
// dashed commuter ring and a movement-route glyph). Drawn on a canvas so they
// can be baked into the map PNG AND surfaced as <img> in the legend / list —
// both html2canvas-safe, unlike inline SVG. Each draws centred on (x, y) with
// a roughly 16px footprint.
// ---------------------------------------------------------------------------
export type JakartaMapIcon =
  | "civic"
  | "tower"
  | "anchor"
  | "plane"
  | "ring"
  | "route";

function drawCivicIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x - 7.5, y - 3);
  ctx.lineTo(x, y - 8);
  ctx.lineTo(x + 7.5, y - 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 7.5, y - 3, 15, 1.6);
  for (const cx of [-6, -3, 0, 3, 6]) ctx.fillRect(x + cx - 0.55, y - 1, 1.1, 7);
  ctx.fillRect(x - 8, y + 6, 16, 1.9);
}

function drawTowerIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
) {
  ctx.fillStyle = c;
  ctx.fillRect(x - 6, y - 8, 5.6, 16);
  ctx.fillRect(x + 0.6, y - 4, 5.6, 12);
  ctx.fillStyle = "#ffffff";
  for (let r = 0; r < 4; r++) {
    ctx.fillRect(x - 4.7, y - 6.4 + r * 3.4, 1.3, 1.3);
    ctx.fillRect(x - 2.5, y - 6.4 + r * 3.4, 1.3, 1.3);
  }
  for (let r = 0; r < 3; r++) {
    ctx.fillRect(x + 1.9, y - 2.4 + r * 3.4, 1.3, 1.3);
    ctx.fillRect(x + 3.9, y - 2.4 + r * 3.4, 1.3, 1.3);
  }
}

function drawAnchorIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
) {
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y - 6, 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 1.5);
  ctx.lineTo(x + 4, y - 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + 2, 6, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();
}

function drawPlaneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(0, -8.5);
  ctx.quadraticCurveTo(1.7, -7, 1.7, -2.5);
  ctx.lineTo(8, 1.5);
  ctx.lineTo(8, 3.2);
  ctx.lineTo(1.7, 1);
  ctx.lineTo(1.7, 6);
  ctx.lineTo(3.5, 7.7);
  ctx.lineTo(3.5, 8.9);
  ctx.lineTo(0, 7.8);
  ctx.lineTo(-3.5, 8.9);
  ctx.lineTo(-3.5, 7.7);
  ctx.lineTo(-1.7, 6);
  ctx.lineTo(-1.7, 1);
  ctx.lineTo(-8, 3.2);
  ctx.lineTo(-8, 1.5);
  ctx.lineTo(-1.7, -2.5);
  ctx.quadraticCurveTo(-1.7, -7, 0, -8.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRingIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
) {
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([2.6, 2.4]);
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRouteIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
) {
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x - 7.5, y);
  ctx.lineTo(x + 7.5, y);
  ctx.stroke();
  for (const hx of [-1, 5]) {
    ctx.beginPath();
    ctx.moveTo(x + hx - 3, y - 3);
    ctx.lineTo(x + hx, y);
    ctx.lineTo(x + hx - 3, y + 3);
    ctx.stroke();
  }
}

function drawAreaIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: JakartaMapIcon,
  c: string,
) {
  if (kind === "civic") drawCivicIcon(ctx, x, y, c);
  else if (kind === "tower") drawTowerIcon(ctx, x, y, c);
  else if (kind === "anchor") drawAnchorIcon(ctx, x, y, c);
  else if (kind === "plane") drawPlaneIcon(ctx, x, y, c);
  else if (kind === "ring") drawRingIcon(ctx, x, y, c);
  else drawRouteIcon(ctx, x, y, c);
}

function iconDataUrl(kind: JakartaMapIcon, color: string, px = 24): string {
  const s = 3;
  const cv = document.createElement("canvas");
  cv.width = px * s;
  cv.height = px * s;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  ctx.scale(s, s);
  ctx.translate(px / 2, px / 2);
  drawAreaIcon(ctx, 0, 0, kind, color);
  return cv.toDataURL("image/png");
}

// Each functional area's icon for the legend, ranked list and map badge.
const AREA_ICON: Record<string, JakartaMapIcon> = {
  "central-government": "civic",
  "commercial-hotels": "tower",
  "airport-corridor": "plane",
  "north-port": "anchor",
  "commuter-belt": "ring",
  "cross-city-routes": "route",
};

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

export interface JakartaCorridorMapProps {
  incidents: CountryFastFactsIncident[];
  /** Report issue date (YYYY-MM-DD) — drives the footer weekly date range. */
  issueDate?: string;
  /** Optional DOM id (kept for parity with CountryReportMap callers). */
  domId?: string;
}

// ---------------------------------------------------------------------------
// Map composition — the fixed cartographic furniture drawn over the projected
// view: each functional area's icon badge + soft exposure zone, plus rotated
// corridor captions. Marker / label coordinates are [lat, lon].
// ---------------------------------------------------------------------------
interface JakartaMapArea {
  /** Matches a JAKARTA_CORRIDOR_AREAS id (drives exposure colour + number). */
  id: string;
  icon: JakartaMapIcon;
  /** Icon-badge anchor [lat, lon]. */
  marker: [number, number];
  /** Soft radial exposure zone radius in px (omitted = no zone). */
  zoneRadius?: number;
  /** Optional site label drawn beside the badge. */
  siteLabel?: string;
  siteLabelSide?: "top" | "bottom" | "left" | "right";
  /** Optional area caption (uppercase, in the area's exposure accent). */
  areaLabel?: { text: string; lat: number; lon: number };
}

const JAKARTA_MAP_AREAS: JakartaMapArea[] = [
  {
    id: "north-port",
    icon: "anchor",
    marker: [-6.108, 106.885],
    zoneRadius: 34,
    siteLabel: "Tanjung Priok Port",
    siteLabelSide: "top",
    areaLabel: {
      text: "NORTH JAKARTA PORT & LOGISTICS AREA",
      lat: -6.165,
      lon: 106.905,
    },
  },
  {
    id: "central-government",
    icon: "civic",
    marker: [-6.18, 106.815],
    zoneRadius: 30,
    areaLabel: {
      text: "CENTRAL JAKARTA GOVERNMENT DISTRICT",
      lat: -6.213,
      lon: 106.812,
    },
  },
  {
    id: "commercial-hotels",
    icon: "tower",
    marker: [-6.245, 106.732],
    zoneRadius: 34,
    areaLabel: {
      text: "MAIN COMMERCIAL & HOTEL AREAS",
      lat: -6.272,
      lon: 106.730,
    },
  },
  {
    id: "airport-corridor",
    icon: "plane",
    marker: [-6.1256, 106.6559],
    siteLabel: "Soekarno-Hatta International Airport",
    siteLabelSide: "right",
  },
  {
    id: "commuter-belt",
    icon: "ring",
    marker: [-6.33, 106.93],
  },
  {
    id: "cross-city-routes",
    icon: "route",
    marker: [-6.259, 106.92],
  },
];

// Corridor band captions (rotated along each route).
const CORRIDOR_LABEL: Record<string, string> = {
  "airport-corridor": "AIRPORT CORRIDOR",
  "north-port": "LOGISTICS CORRIDOR",
  "cross-city-routes": "CROSS-CITY MOVEMENT ROUTES",
  "commuter-belt": "GREATER JAKARTA COMMUTER BELT",
};

// Each corridor carries its OWN identity colour (matching the reference) so the
// routes read apart at a glance. Operating exposure is shown by the soft zones,
// the badges and the ranked list — never by the corridor colour.
interface CorridorStyle {
  fill: string;
  accent: string;
  dashed?: boolean;
  thin?: boolean;
}
const CORRIDOR_STYLE: Record<string, CorridorStyle> = {
  "airport-corridor": { fill: "#C3AEDD", accent: "#8E74B5" },
  "north-port": { fill: "#E6B27E", accent: "#C0792F", dashed: true },
  "cross-city-routes": { fill: "#AFCF96", accent: "#6E9A52" },
  "commuter-belt": { fill: "#AFCF96", accent: "#6E9A52", dashed: true, thin: true },
};
const DEFAULT_CORRIDOR_STYLE: CorridorStyle = {
  fill: "#B9C2CC",
  accent: "#8A929C",
};

const legendHeadStyle: CSSProperties = {
  fontFamily: "Roboto, sans-serif",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: NAVY,
  marginBottom: 7,
};
const legendRowStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const legendTextStyle: CSSProperties = {
  fontFamily: "Roboto, sans-serif",
  fontSize: 11,
  color: DUSK,
};
const legendIconStyle: CSSProperties = {
  width: 16,
  height: 16,
  display: "block",
};

/**
 * Jakarta operational exposure map — a clean, client-grade figure in the style
 * of professional travel-risk mapping (Crisis24 / International SOS): a REAL
 * light Leaflet basemap (CartoDB light_nolabels — actual coastline, the Java
 * Sea and the road network) carrying ONLY small numbered markers for key sites
 * and thin lines for the main movement corridors, each coloured by operating
 * exposure. The map face is kept clean — no district blocks, no white boxes,
 * chips or pills. Every detail lives in the ranked list to the right; the
 * numbers tie the two together.
 *
 * PDF parity: the basemap is <img> tiles and the markers + corridor lines (with
 * their numbers baked in) are a single offscreen-canvas → data-URL <img> — both
 * are layers html2canvas rasterises faithfully, so the on-screen preview and the
 * DOM-rasterised in-app PDF stay identical (a live <canvas> or Leaflet SVG
 * vector layer would be dropped/mangled on clone).
 *
 * Exposure levels are honest: each area carries a standing profile that live
 * reporting can only RAISE, never invent.
 */
export default function JakartaCorridorMap({
  incidents,
  issueDate,
  domId,
}: JakartaCorridorMapProps) {
  const corridor = useMemo(
    () => buildJakartaCorridorStatuses(incidents),
    [incidents],
  );
  const rangeLabel = useMemo(() => weeklyRangeLabel(issueDate), [issueDate]);

  // Ranked by operating exposure (worst first), stable on original order. The
  // rank number is what the map markers and the right-hand list both display.
  const ranked = useMemo(
    () =>
      corridor.statuses
        .map((status, i) => ({ status, i }))
        .sort(
          (a, b) =>
            SEV_RANK[b.status.displayExposure] -
              SEV_RANK[a.status.displayExposure] || a.i - b.i,
        )
        .map((x, idx) => ({ status: x.status, number: idx + 1 })),
    [corridor],
  );

  const numberFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ranked) m.set(r.status.area.id, r.number);
    return m;
  }, [ranked]);

  const levelFor = useMemo(() => {
    const m = new Map<string, JakartaExposureLevel>();
    for (const r of ranked) m.set(r.status.area.id, r.status.displayExposure);
    return m;
  }, [ranked]);

  // Re-render the overlay only when the displayed exposure / numbering changes.
  const drawKey = useMemo(
    () =>
      ranked
        .map((r) => `${r.status.area.id}:${r.number}:${r.status.displayExposure}`)
        .join(","),
    [ranked],
  );

  // Monochrome key icons (baked once) for the map-key legend column.
  const legendIcons = useMemo(
    () => ({
      civic: iconDataUrl("civic", NAVY),
      tower: iconDataUrl("tower", NAVY),
      anchor: iconDataUrl("anchor", NAVY),
      plane: iconDataUrl("plane", NAVY),
    }),
    [],
  );

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!mapElRef.current) return;

    if (!mapRef.current) {
      const map = L.map(mapElRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        // A non-interactive report figure: lock the framing entirely.
        zoomDelta: 0,
      });
      mapRef.current = map;

      // No raster tile layer: the figure is a fully custom stylised
      // illustration drawn on the overlay canvas (sea, land, dashed regency
      // boundaries, soft zones, movement bands, labels and badges) so it
      // matches the report's house style rather than a generic web basemap.
      // Leaflet is used only for the lat/lng → pixel projection of the locked
      // view.

      // Custom illustration overlay (offscreen canvas → data-URL <img>).
      const overlay = document.createElement("img");
      overlay.alt = "";
      overlay.style.position = "absolute";
      overlay.style.left = "0";
      overlay.style.top = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "400";
      mapElRef.current.appendChild(overlay);
      overlayImgRef.current = overlay;
    }

    const map = mapRef.current;
    map.invalidateSize();
    const bounds = L.latLngBounds(
      [JAKARTA_VIEW_BBOX.minLat, JAKARTA_VIEW_BBOX.minLon],
      [JAKARTA_VIEW_BBOX.maxLat, JAKARTA_VIEW_BBOX.maxLon],
    );
    map.fitBounds(bounds, { padding: [10, 10] });

    // Soft radial exposure footprint under a site (feathered, no hard edge).
    const drawZone = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      level: JakartaExposureLevel,
      radius: number,
    ) => {
      const { r, g, b } = hexToRgb(EXPOSURE_FILL[level]);
      const grad = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.62)`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},0.32)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    };

    // Soft pastel movement band along a projected polyline, in the corridor's
    // own identity colour (solid, dashed, or thin-dotted).
    const drawBand = (
      ctx: CanvasRenderingContext2D,
      pts: { x: number; y: number }[],
      style: CorridorStyle,
    ) => {
      if (pts.length < 2) return;
      const { r, g, b } = hexToRgb(style.fill);
      const trace = () => {
        ctx.beginPath();
        pts.forEach((p, i) =>
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
        );
      };
      const outer = style.thin ? 7 : 15;
      const inner = style.thin ? 3.5 : 9;
      ctx.setLineDash([]);
      trace();
      ctx.lineWidth = outer;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.34)`;
      ctx.stroke();
      trace();
      ctx.lineWidth = inner;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.92)`;
      if (style.dashed) ctx.setLineDash(style.thin ? [3, 5] : [12, 9]);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Outward arrowhead at a segment end (from → to).
    const drawArrow = (
      ctx: CanvasRenderingContext2D,
      from: { x: number; y: number },
      to: { x: number; y: number },
      color: string,
    ) => {
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const s = 8;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(
        to.x - s * Math.cos(ang - Math.PI / 7),
        to.y - s * Math.sin(ang - Math.PI / 7),
      );
      ctx.lineTo(
        to.x - s * Math.cos(ang + Math.PI / 7),
        to.y - s * Math.sin(ang + Math.PI / 7),
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    // Single-line text with a soft white halo so labels stay legible.
    const label = (
      ctx: CanvasRenderingContext2D,
      str: string,
      x: number,
      y: number,
      opts: {
        font: string;
        color: string;
        align?: CanvasTextAlign;
        spacing?: string;
        rotate?: number;
        halo?: number;
      },
    ) => {
      ctx.save();
      ctx.font = opts.font;
      ctx.textAlign = opts.align ?? "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = opts.spacing ?? "0em";
      if (opts.rotate) {
        ctx.translate(x, y);
        ctx.rotate(opts.rotate);
        x = 0;
        y = 0;
      }
      ctx.lineJoin = "round";
      ctx.lineWidth = opts.halo ?? 3.2;
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.strokeText(str, x, y);
      ctx.fillStyle = opts.color;
      ctx.fillText(str, x, y);
      ctx.restore();
    };

    // Word-wrap helper for multi-line captions.
    const wrap = (str: string, max: number): string[] => {
      const words = str.split(" ");
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (t.length > max && cur) {
          lines.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) lines.push(cur);
      return lines;
    };

    // Multi-line halo label centred on (x, y).
    const blockLabel = (
      ctx: CanvasRenderingContext2D,
      str: string,
      x: number,
      y: number,
      max: number,
      lineH: number,
      opts: {
        font: string;
        color: string;
        spacing?: string;
        align?: CanvasTextAlign;
      },
    ) => {
      const lines = wrap(str, max);
      const startY = y - ((lines.length - 1) * lineH) / 2;
      lines.forEach((ln, i) =>
        label(ctx, ln, x, startY + i * lineH, {
          font: opts.font,
          color: opts.color,
          spacing: opts.spacing,
          align: opts.align,
        }),
      );
    };

    // White icon disc + small exposure-coloured number badge.
    const drawBadge = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      icon: JakartaMapIcon,
      accent: string,
      n: number,
    ) => {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(11,11,61,0.22)";
      ctx.stroke();
      drawAreaIcon(ctx, x, y, icon, NAVY);
      const bx = x + 10.5;
      const by = y - 10.5;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 9px 'Roboto Condensed', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), bx, by + 0.4);
    };

    const draw = () => {
      const el = mapElRef.current;
      const img = overlayImgRef.current;
      if (!el || !img) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;

      const scale = Math.min(window.devicePixelRatio || 1, 2) * 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const proj = (lat: number, lon: number) =>
        map.latLngToContainerPoint([lat, lon]);

      // 1) Sea backdrop + warm land polygons with faint dashed boundaries.
      ctx.fillStyle = SEA;
      ctx.fillRect(0, 0, w, h);
      const traceGeoRing = (ring: number[][]) => {
        ctx.beginPath();
        ring.forEach((c, i) => {
          const p = proj(c[1], c[0]);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
      };
      ctx.fillStyle = LAND_FILL;
      for (const f of JAKARTA_GEO)
        for (const ring of f.polys) {
          traceGeoRing(ring);
          ctx.fill();
        }
      ctx.strokeStyle = BOUNDARY;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      for (const f of JAKARTA_GEO)
        for (const ring of f.polys) {
          traceGeoRing(ring);
          ctx.stroke();
        }
      ctx.setLineDash([]);

      // 2) Soft exposure zones under the key sites.
      for (const a of JAKARTA_MAP_AREAS) {
        if (!a.zoneRadius) continue;
        const level = levelFor.get(a.id) ?? "not-assessed";
        const p = proj(a.marker[0], a.marker[1]);
        drawZone(ctx, p.x, p.y, level, a.zoneRadius);
      }

      // 3) Movement corridor bands + outward arrowheads, each in the
      //    corridor's own identity colour.
      for (const line of JAKARTA_CORRIDOR_LINES) {
        const style = CORRIDOR_STYLE[line.corridorId] ?? DEFAULT_CORRIDOR_STYLE;
        const pts = line.path.map((c) => proj(c[0], c[1]));
        drawBand(ctx, pts, style);
        drawArrow(ctx, pts[1], pts[0], style.accent);
        drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1], style.accent);
      }

      // 4) Rotated corridor captions along each band.
      for (const line of JAKARTA_CORRIDOR_LINES) {
        const text = CORRIDOR_LABEL[line.corridorId];
        if (!text) continue;
        const pts = line.path.map((c) => proj(c[0], c[1]));
        const idx = Math.min(
          line.labelAt ?? Math.floor(pts.length / 2),
          pts.length - 1,
        );
        const a = pts[Math.max(0, idx - 1)];
        const b = pts[Math.min(pts.length - 1, idx + 1)];
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        const anchor = pts[idx];
        label(ctx, text, anchor.x, anchor.y - 9, {
          font: "700 9px 'Roboto Condensed', Roboto, sans-serif",
          color: "#5C636E",
          spacing: "0.08em",
          rotate: ang,
        });
      }

      // 5) Region / sea / place labels.
      for (const lbl of JAKARTA_MAP_LABELS) {
        const p = proj(lbl.lat, lbl.lon);
        if (lbl.kind === "sea") {
          label(ctx, lbl.text, p.x, p.y, {
            font: "italic 12.5px Roboto, sans-serif",
            color: "#6E86A6",
            spacing: "0.16em",
          });
        } else if (lbl.kind === "region") {
          blockLabel(ctx, lbl.text, p.x, p.y, 10, 11, {
            font: "700 9px 'Roboto Condensed', Roboto, sans-serif",
            color: "#9AA0A8",
            spacing: "0.14em",
          });
        } else {
          label(ctx, lbl.text, p.x, p.y, {
            font: "11px Roboto, sans-serif",
            color: "#8A9099",
            spacing: "0.02em",
          });
        }
      }

      // 6) Area captions — neutral slate, like the reference (exposure is read
      //    from the zone colour and the ranked list, not the caption).
      for (const a of JAKARTA_MAP_AREAS) {
        if (!a.areaLabel) continue;
        const p = proj(a.areaLabel.lat, a.areaLabel.lon);
        blockLabel(ctx, a.areaLabel.text, p.x, p.y, 16, 11, {
          font: "700 9.5px 'Roboto Condensed', Roboto, sans-serif",
          color: "#55555F",
          spacing: "0.06em",
        });
      }

      // 7) Numbered icon badges + site labels on top.
      for (const a of JAKARTA_MAP_AREAS) {
        const level = levelFor.get(a.id) ?? "not-assessed";
        const n = numberFor.get(a.id) ?? 0;
        const p = proj(a.marker[0], a.marker[1]);
        drawBadge(ctx, p.x, p.y, a.icon, EXPOSURE_ACCENT[level], n);
        if (a.siteLabel) {
          const off = 20;
          const side = a.siteLabelSide ?? "top";
          let tx = p.x;
          let ty = p.y;
          let align: CanvasTextAlign = "center";
          if (side === "right") {
            tx = p.x + off;
            align = "left";
          } else if (side === "left") {
            tx = p.x - off;
            align = "right";
          } else if (side === "top") {
            ty = p.y - off;
          } else {
            ty = p.y + off;
          }
          blockLabel(ctx, a.siteLabel, tx, ty, 18, 12, {
            font: "700 10px Roboto, sans-serif",
            color: NAVY,
            align,
          });
        }
      }

      img.src = canvas.toDataURL("image/png");
    };

    map.whenReady(draw);
    const t = window.setTimeout(draw, 80);
    map.on("resize moveend zoomend viewreset", draw);
    // Redraw once webfonts settle so the baked PNG uses Roboto Condensed, not a
    // fallback (the in-app PDF rasterises this <img>, so parity depends on it).
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => draw());
    }
    return () => {
      window.clearTimeout(t);
      map.off("resize moveend zoomend viewreset", draw);
    };
  }, [drawKey, numberFor, levelFor]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayImgRef.current = null;
    };
  }, []);

  return (
    <div>
      {/* Figure title. */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontFamily: "'Roboto Condensed', Roboto, sans-serif",
            fontWeight: 700,
            fontSize: 19,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: NAVY,
          }}
        >
          Jakarta — Operational Exposure Map
        </div>
        <div
          style={{
            fontFamily: "Roboto, sans-serif",
            fontSize: 11.5,
            color: DUSK,
            marginTop: 2,
          }}
        >
          Key operating sites and movement corridors across Greater Jakarta ·{" "}
          {rangeLabel}
        </div>
      </div>

      {/* Clean map on the left, ranked detail list on the right. */}
      <div style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
        <div style={{ flex: "1.5 1 0", minWidth: 0 }}>
          <div
            id={domId}
            style={{
              width: "100%",
              border: `1px solid ${POLAR}`,
              borderRadius: 2,
              background: "#ffffff",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              ref={mapElRef}
              style={{
                width: "100%",
                height: 500,
                position: "relative",
                background: SEA,
              }}
            />
          </div>

          {/* Two-column legend: exposure ramp + map key. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 30,
              marginTop: 12,
              padding: "11px 14px",
              border: `1px solid ${POLAR}`,
              borderRadius: 2,
              background: "#ffffff",
            }}
          >
            <div>
              <div style={legendHeadStyle}>Exposure level</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 18px" }}>
                {EXPOSURE_ORDER.map((lvl) => (
                  <span key={lvl} style={legendRowStyle}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 15,
                        height: 10,
                        borderRadius: 2,
                        background: EXPOSURE_FILL[lvl],
                        border: `1px solid ${EXPOSURE_ACCENT[lvl]}`,
                      }}
                    />
                    <span style={legendTextStyle}>{EXPOSURE_LABEL[lvl]}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={legendHeadStyle}>Map key</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 18px" }}>
                <span style={legendRowStyle}>
                  <img src={legendIcons.civic} alt="" style={legendIconStyle} />
                  <span style={legendTextStyle}>Government district</span>
                </span>
                <span style={legendRowStyle}>
                  <img src={legendIcons.tower} alt="" style={legendIconStyle} />
                  <span style={legendTextStyle}>Commercial / hotel area</span>
                </span>
                <span style={legendRowStyle}>
                  <img src={legendIcons.anchor} alt="" style={legendIconStyle} />
                  <span style={legendTextStyle}>Port / logistics</span>
                </span>
                <span style={legendRowStyle}>
                  <img src={legendIcons.plane} alt="" style={legendIconStyle} />
                  <span style={legendTextStyle}>Airport</span>
                </span>
                <span style={legendRowStyle}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 18,
                      height: 4,
                      borderRadius: 2,
                      background: "#9AA6B5",
                    }}
                  />
                  <span style={legendTextStyle}>Movement corridor</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Ranked detail list. */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <RankedList ranked={ranked} />
        </div>
      </div>

      {/* One short caption below. */}
      <div
        style={{
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          color: DUSK,
          lineHeight: 1.55,
          marginTop: 14,
        }}
      >
        This map shows operating exposure by area and route, based on
        open-source reporting and local media. It does not plot individual
        incidents. Boundaries are indicative; always confirm conditions locally
        before travelling.
        {corridor.unattributed > 0
          ? " Some records were retained in the assessment but not tied to a specific area."
          : ""}
      </div>
    </div>
  );
}

function RankedList({
  ranked,
}: {
  ranked: { status: JakartaCorridorStatus; number: number }[];
}) {
  return (
    <div
      style={{
        border: `1px solid ${POLAR}`,
        borderRadius: 2,
        overflow: "hidden",
        background: "#ffffff",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: NAVY,
          color: "#ffffff",
          fontFamily: "'Roboto Condensed', Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 11.5,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "10px 13px",
        }}
      >
        Sites & corridors — ranked by exposure
      </div>
      {ranked.map(({ status: s, number }, i) => {
        const accent = EXPOSURE_ACCENT[s.displayExposure];
        return (
          <div
            key={s.area.id}
            style={{
              display: "flex",
              gap: 11,
              alignItems: "flex-start",
              padding: "11px 13px",
              borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: accent,
                color: "#ffffff",
                fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                fontWeight: 700,
                fontSize: 10,
                marginTop: 1,
              }}
            >
              {number}
            </span>
            <img
              src={iconDataUrl(AREA_ICON[s.area.id] ?? "route", accent)}
              alt=""
              style={{ flex: "0 0 auto", width: 18, height: 18, marginTop: 1 }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                  fontWeight: 700,
                  fontSize: 13.5,
                  color: NAVY,
                  lineHeight: 1.2,
                }}
              >
                {s.area.name}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <span
                  style={{
                    fontFamily: "Roboto, sans-serif",
                    fontWeight: 700,
                    fontSize: 9,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#ffffff",
                    background: accent,
                    borderRadius: 2,
                    padding: "2px 6px 3px",
                  }}
                >
                  {EXPOSURE_LABEL[s.displayExposure]}
                </span>
                <span
                  style={{
                    fontFamily: "Roboto, sans-serif",
                    fontSize: 9.5,
                    color: "#7a828e",
                  }}
                >
                  {s.elevated ? "Raised this period" : "Standing profile"}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 11.5,
                  color: DUSK,
                  lineHeight: 1.4,
                  marginTop: 6,
                }}
              >
                {s.area.relevance}
              </div>
              <div
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 11.5,
                  color: "#555a63",
                  lineHeight: 1.4,
                  marginTop: 5,
                }}
              >
                <span style={{ fontWeight: 700, color: NAVY }}>Action: </span>
                {s.area.action}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
