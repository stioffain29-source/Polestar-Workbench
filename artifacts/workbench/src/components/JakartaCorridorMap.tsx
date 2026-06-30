import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import {
  buildJakartaCorridorStatuses,
  type JakartaExposureLevel,
} from "@/lib/jakartaCorridors";
import {
  JAKARTA_VIEW_BBOX,
  JAKARTA_CORRIDOR_LINES,
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

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
// Map composition — the cartographic furniture drawn over the REAL basemap: a
// soft exposure zone + small numbered marker per key site, plus a subtle area
// caption. Marker / label coordinates are [lat, lon].
// ---------------------------------------------------------------------------
interface JakartaMapArea {
  /** Matches a JAKARTA_CORRIDOR_AREAS id (drives exposure colour + number). */
  id: string;
  /** Numbered-marker anchor [lat, lon]. */
  marker: [number, number];
  /** Soft elliptical exposure zone (px radii + rotation) shaped to the area's
   *  district footprint, so the zone reads as a real operating area rather than
   *  a generic circle. Omitted = no zone. */
  zone?: { rx: number; ry: number; rotateDeg?: number };
  /** Optional site label drawn beside the marker. */
  siteLabel?: string;
  siteLabelSide?: "top" | "bottom" | "left" | "right";
  /** Optional area caption (uppercase, neutral slate, placed near the zone). */
  areaLabel?: { text: string; lat: number; lon: number };
}

const JAKARTA_MAP_AREAS: JakartaMapArea[] = [
  {
    id: "north-port",
    marker: [-6.108, 106.885],
    // Coastal port strip — a wide, shallow E–W ellipse along the waterfront.
    zone: { rx: 90, ry: 42, rotateDeg: -8 },
    areaLabel: {
      text: "NORTH JAKARTA PORT & LOGISTICS",
      lat: -6.145,
      lon: 106.93,
    },
  },
  {
    id: "central-government",
    marker: [-6.18, 106.815],
    // Government core — a distinctly N–S oblong over the central district.
    zone: { rx: 50, ry: 76, rotateDeg: 0 },
    areaLabel: {
      text: "CENTRAL GOVERNMENT DISTRICT",
      lat: -6.214,
      lon: 106.808,
    },
  },
  {
    id: "commercial-hotels",
    marker: [-6.245, 106.79],
    // Commercial & hotel core — a tilted oblong over the southern CBD axis.
    zone: { rx: 52, ry: 72, rotateDeg: 16 },
    areaLabel: {
      text: "COMMERCIAL & HOTEL CORE",
      lat: -6.276,
      lon: 106.79,
    },
  },
  {
    id: "airport-corridor",
    marker: [-6.1256, 106.6559],
  },
  {
    id: "commuter-belt",
    marker: [-6.33, 106.93],
  },
  {
    id: "cross-city-routes",
    marker: [-6.259, 106.92],
  },
];

// Corridor captions sit horizontally in open map space in a neutral slate, so
// the routes read without competing with the exposure zones. The airport
// corridor caption rides rotated along its band.
interface CorridorCaption {
  text: string;
  lat: number;
  lon: number;
  color: string;
  rotate?: boolean;
}
const CORRIDOR_CAPTION: Record<string, CorridorCaption> = {
  "airport-corridor": {
    text: "AIRPORT CORRIDOR",
    lat: -6.151,
    lon: 106.726,
    color: "#6B7280",
    rotate: true,
  },
  "cross-city-routes": {
    text: "CROSS-CITY MOVEMENT ROUTES",
    lat: -6.249,
    lon: 106.9,
    color: "#6B7280",
  },
  "commuter-belt": {
    text: "GREATER JAKARTA COMMUTER BELT",
    lat: -6.353,
    lon: 106.84,
    color: "#7C8AA0",
  },
};

// Each corridor carries a subtle identity style so the movement axes read apart
// at a glance. Operating exposure is shown by the soft zones and the ranked
// panel — never by the corridor colour.
interface CorridorStyle {
  fill: string;
  accent: string;
  dashed?: boolean;
  thin?: boolean;
}
const CORRIDOR_STYLE: Record<string, CorridorStyle> = {
  "airport-corridor": { fill: "#A78FC9", accent: "#7E5EAE" },
  "north-port": { fill: "#DCA56F", accent: "#B5701F", dashed: true },
  "cross-city-routes": { fill: "#9BBE83", accent: "#5E8A45" },
  "commuter-belt": { fill: "#8FB2DA", accent: "#4E76A6", dashed: true },
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

// How many ranked exposures the side panel shows (and how many numbered markers
// the map carries). Kept tight so the figure stays uncrowded and client-ready.
const TOP_N = 4;

/**
 * Jakarta operational exposure map — a clean, client-grade figure in the style
 * of professional travel-risk mapping (Crisis24 / International SOS): a REAL
 * light Leaflet basemap (CartoDB Positron — actual coastline, the Java Sea, the
 * road network and place labels) carrying translucent operating-exposure zones,
 * subtle movement corridors and small numbered markers for the key sites, with
 * a compact ranked panel beside it. The numbers tie the map and the panel
 * together.
 *
 * PDF parity: the basemap is crossOrigin <img> tiles and every overlay (zones,
 * corridor bands, numbered markers, captions) is a single offscreen-canvas →
 * data-URL <img> layered over the tiles — both are layers html2canvas
 * rasterises faithfully, so the on-screen preview and the DOM-rasterised
 * in-app PDF stay identical (a live <canvas> or Leaflet SVG vector layer would
 * be dropped/mangled on clone).
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
  // rank number is what the map markers and the right-hand panel both display.
  const ranked = useMemo(
    () =>
      corridor.statuses
        // Cross-city movement is shown as a corridor band on the map, not as a
        // ranked site/area, so it is dropped from the numbered exposure list.
        .filter((s) => s.area.id !== "cross-city-routes")
        .map((status, i) => ({ status, i }))
        .sort(
          (a, b) =>
            SEV_RANK[b.status.displayExposure] -
              SEV_RANK[a.status.displayExposure] ||
            // At the same tier, an area that actually carried reporting this
            // period ranks above a quiet "standing profile" area.
            Number(b.status.elevated) - Number(a.status.elevated) ||
            a.i - b.i,
        )
        .map((x, idx) => ({ status: x.status, number: idx + 1 })),
    [corridor],
  );

  // Only the top-N exposures are shown — on the map (numbered markers) and in
  // the side panel — so the figure stays clean.
  const top = useMemo(() => ranked.slice(0, TOP_N), [ranked]);

  const numberFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of top) m.set(r.status.area.id, r.number);
    return m;
  }, [top]);

  const levelFor = useMemo(() => {
    const m = new Map<string, JakartaExposureLevel>();
    for (const r of ranked) m.set(r.status.area.id, r.status.displayExposure);
    return m;
  }, [ranked]);

  // Re-render the overlay only when the displayed exposure / numbering changes.
  const drawKey = useMemo(
    () =>
      ranked
        .map(
          (r, i) =>
            `${r.status.area.id}:${i < TOP_N ? r.number : "-"}:${r.status.displayExposure}`,
        )
        .join(","),
    [ranked],
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
        // Fit the view box EXACTLY (no integer-zoom snapping, which would round
        // down and float the content inside empty land).
        zoomSnap: 0,
        zoomAnimation: false,
        markerZoomAnimation: false,
      });
      mapRef.current = map;

      // Real light basemap — CartoDB Voyager (a light Carto style with a clearly
      // readable road network, coastline, the Java Sea and place labels, less
      // washed-out than Positron) at full opacity. The translucent exposure zones
      // still dominate. crossOrigin so html2canvas can rasterise into the PDF.
      L.tileLayer(
        // Force @2x (retina) tiles always. The figure sits at a FRACTIONAL zoom
        // (zoomSnap 0) so Leaflet stretches integer-zoom tiles; serving 2x-density
        // tiles keeps the basemap crisp instead of pixelated at that scale.
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        {
          attribution: "&copy; OpenStreetMap &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
          opacity: 1,
        },
      ).addTo(map);

      // Overlay (offscreen canvas → data-URL <img>) drawn above the tiles.
      const overlay = document.createElement("img");
      overlay.alt = "";
      overlay.style.position = "absolute";
      overlay.style.left = "0";
      overlay.style.top = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "450";
      mapElRef.current.appendChild(overlay);
      overlayImgRef.current = overlay;
    }

    const map = mapRef.current;
    map.invalidateSize();
    const bounds = L.latLngBounds(
      [JAKARTA_VIEW_BBOX.minLat, JAKARTA_VIEW_BBOX.minLon],
      [JAKARTA_VIEW_BBOX.maxLat, JAKARTA_VIEW_BBOX.maxLon],
    );
    map.fitBounds(bounds, { padding: [6, 6] });

    const topIds = new Set(top.map((r) => r.status.area.id));

    // Soft elliptical exposure footprint over a district (feathered, no hard
    // edge). The fill is a radial gradient drawn in a y-scaled frame so the
    // falloff is truly elliptical; a thin uniform outline keeps the zone
    // legible against the basemap without reading as a hard ring.
    const drawZone = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      level: JakartaExposureLevel,
      rx: number,
      ry: number,
      rotateDeg: number,
    ) => {
      const { r, g, b } = hexToRgb(EXPOSURE_FILL[level]);
      const { r: ar, g: ag, b: ab } = hexToRgb(EXPOSURE_ACCENT[level]);
      const rot = (rotateDeg * Math.PI) / 180;
      // Feathered fill (scaled frame → elliptical falloff).
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(1, ry / rx);
      const grad = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.46)`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},0.22)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
      // Thin, uniform outline.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.82, ry * 0.82, 0, 0, Math.PI * 2);
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.42)`;
      ctx.stroke();
      ctx.restore();
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
        if (pts.length < 3) {
          pts.forEach((p, i) =>
            i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
          );
          return;
        }
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
      };
      const outer = style.thin ? 3.6 : 5;
      const inner = style.thin ? 1.4 : 1.9;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      trace();
      ctx.lineWidth = outer;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`;
      ctx.stroke();
      trace();
      ctx.lineWidth = inner;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.98)`;
      if (style.dashed) ctx.setLineDash(style.thin ? [6, 6] : [12, 8]);
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
      const s = 7;
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

    // Small refined numbered marker: a coloured disc with a white ring and a
    // centred white number. No icon glyph, no large badge.
    const drawMarker = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      accent: string,
      n: number,
    ) => {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 11px 'Roboto Condensed', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), x, y + 0.4);
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

      // 1) Soft elliptical exposure zones over the key districts.
      for (const a of JAKARTA_MAP_AREAS) {
        if (!a.zone) continue;
        const level = levelFor.get(a.id) ?? "not-assessed";
        const p = proj(a.marker[0], a.marker[1]);
        drawZone(ctx, p.x, p.y, level, a.zone.rx, a.zone.ry, a.zone.rotateDeg ?? 0);
      }

      // 2) Movement corridor bands + outward arrowheads on the cross-city axis.
      for (const line of JAKARTA_CORRIDOR_LINES) {
        const style = CORRIDOR_STYLE[line.corridorId] ?? DEFAULT_CORRIDOR_STYLE;
        const pts = line.path.map((c) => proj(c[0], c[1]));
        drawBand(ctx, pts, style);
        if (line.corridorId === "cross-city-routes") {
          drawArrow(ctx, pts[1], pts[0], style.accent);
          drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1], style.accent);
        }
      }

      // 3) Area + corridor captions — FEWER but CLEARER per the brief: one
      //    consistent style (Roboto Condensed, larger than before, white-halo,
      //    NO background block) in a neutral slate. Only the three exposure zones
      //    and the airport / cross-city / commuter corridors are named; the port
      //    corridor is covered by the North Jakarta zone label, so it has none.
      const CAPTION_FONT = "700 11px 'Roboto Condensed', Roboto, sans-serif";
      const CAPTION_COLOR = "#33343F";
      const CAPTION_SPACING = "0.04em";
      for (const a of JAKARTA_MAP_AREAS) {
        if (!a.areaLabel) continue;
        const p = proj(a.areaLabel.lat, a.areaLabel.lon);
        blockLabel(ctx, a.areaLabel.text, p.x, p.y, 18, 13, {
          font: CAPTION_FONT,
          color: CAPTION_COLOR,
          spacing: CAPTION_SPACING,
        });
      }
      const NAMED_CORRIDORS = new Set([
        "airport-corridor",
        "cross-city-routes",
        "commuter-belt",
      ]);
      for (const line of JAKARTA_CORRIDOR_LINES) {
        if (!NAMED_CORRIDORS.has(line.corridorId)) continue;
        const cap = CORRIDOR_CAPTION[line.corridorId];
        if (!cap) continue;
        const at = proj(cap.lat, cap.lon);
        if (cap.rotate) {
          const pts = line.path.map((c) => proj(c[0], c[1]));
          const mid = Math.min(
            line.labelAt ?? Math.floor(pts.length / 2),
            pts.length - 1,
          );
          const aPt = pts[Math.max(0, mid - 1)];
          const bPt = pts[Math.min(pts.length - 1, mid + 1)];
          let ang = Math.atan2(bPt.y - aPt.y, bPt.x - aPt.x);
          if (ang > Math.PI / 2) ang -= Math.PI;
          if (ang < -Math.PI / 2) ang += Math.PI;
          label(ctx, cap.text, at.x, at.y, {
            font: CAPTION_FONT,
            color: CAPTION_COLOR,
            spacing: CAPTION_SPACING,
            rotate: ang,
          });
        } else {
          blockLabel(ctx, cap.text, at.x, at.y, 22, 13, {
            font: CAPTION_FONT,
            color: CAPTION_COLOR,
            spacing: CAPTION_SPACING,
          });
        }
      }

      // 4) Numbered markers — only for the top-N ranked areas, so the map never
      //    crowds. Each number ties its marker to the ranked panel on the right.
      for (const a of JAKARTA_MAP_AREAS) {
        if (!topIds.has(a.id)) continue;
        const level = levelFor.get(a.id) ?? "not-assessed";
        const n = numberFor.get(a.id) ?? 0;
        const p = proj(a.marker[0], a.marker[1]);
        drawMarker(ctx, p.x, p.y, EXPOSURE_ACCENT[level], n);
        if (a.siteLabel) {
          const off = 17;
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
          blockLabel(ctx, a.siteLabel, tx, ty, 16, 12, {
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
    // Tiles arrive asynchronously — redraw once they have loaded so the baked
    // overlay sits over a fully-painted basemap.
    const t2 = window.setTimeout(draw, 700);
    map.on("resize moveend zoomend viewreset", draw);
    // Redraw once webfonts settle so the baked PNG uses Roboto Condensed, not a
    // fallback (the in-app PDF rasterises this <img>, so parity depends on it).
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => draw());
    }
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      map.off("resize moveend zoomend viewreset", draw);
    };
  }, [drawKey, numberFor, levelFor, top]);

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
          Operating exposure by area and movement corridor across Greater
          Jakarta · {rangeLabel}
        </div>
      </div>

      {/* Map (~65%) on the left, ranked panel (~35%) on the right. */}
      <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
        <div style={{ flex: "65 1 0", minWidth: 0 }}>
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
                height: 440,
                position: "relative",
                background: "#EAEAEA",
              }}
            />
          </div>

          {/* Compact legend under the map. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 20px",
              marginTop: 10,
              padding: "9px 13px",
              border: `1px solid ${POLAR}`,
              borderRadius: 2,
              background: "#ffffff",
            }}
          >
            <div style={legendHeadStyle}>Exposure</div>
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

        {/* Ranked top-N panel. */}
        <div style={{ flex: "35 1 0", minWidth: 0 }}>
          <RankedPanel ranked={top} />
        </div>
      </div>

      {/* One short caption below. */}
      <div
        style={{
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          color: DUSK,
          lineHeight: 1.55,
          marginTop: 12,
        }}
      >
        This map shows operating exposure by area and route, based on open
        source reporting and local media. It does not plot individual incidents.
      </div>
    </div>
  );
}

function RankedPanel({
  ranked,
}: {
  ranked: {
    status: import("@/lib/jakartaCorridors").JakartaCorridorStatus;
    number: number;
  }[];
}) {
  return (
    <div
      style={{
        border: `1px solid ${POLAR}`,
        borderRadius: 2,
        overflow: "hidden",
        background: "#ffffff",
        boxSizing: "border-box",
        height: "100%",
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
        Top exposures this period
      </div>
      {ranked.map(({ status: s, number }, i) => {
        const accent = EXPOSURE_ACCENT[s.displayExposure];
        return (
          <div
            key={s.area.id}
            style={{
              display: "flex",
              gap: 10,
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
                width: 19,
                height: 19,
                borderRadius: "50%",
                background: accent,
                color: "#ffffff",
                fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                fontWeight: 700,
                fontSize: 11,
                marginTop: 1,
              }}
            >
              {number}
            </span>
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
                  fontSize: 11,
                  color: DUSK,
                  lineHeight: 1.35,
                  marginTop: 5,
                }}
              >
                {s.relevanceShort}
              </div>
              <div
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 11,
                  color: "#555a63",
                  lineHeight: 1.35,
                  marginTop: 3,
                }}
              >
                <span style={{ fontWeight: 700, color: NAVY }}>Action: </span>
                {s.actionShort}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
