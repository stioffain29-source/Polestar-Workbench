import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import type { JakartaExposureLevel } from "@/lib/jakartaCorridors";
import {
  buildJakartaPostureModel,
  JAKARTA_POSTURE_CORRIDORS,
  POSTURE_EXPOSURE_ACCENT,
  POSTURE_EXPOSURE_FILL,
  POSTURE_EXPOSURE_LABEL,
  POSTURE_EXPOSURE_ORDER,
} from "@/lib/jakartaOperatingPosture";
import { JAKARTA_MAP_OPS_BBOX } from "@/lib/jakartaMapModel";

const NAVY = "#0b0a3d";
const DUSK = "#363636";
// Electric Blue (brand) for the route corridors.
const MOVEMENT_COLOR = "#465bff";

// All four required route corridors are drawn (task: Airport, Port, CBD
// business, North Jakarta access), kept quiet as thin dashed lines.
const DRAWN_CORRIDOR_IDS = new Set([
  "airport",
  "port",
  "cbd-business",
  "north-access",
]);

// Three short overall-posture actions, rendered as compact cards.
const OVERALL_POSTURE: { step: string; text: string }[] = [
  { step: "Verify", text: "Proceed with local verification." },
  {
    step: "Buffer",
    text: "Build buffer time into CBD, port and airport transfers.",
  },
  {
    step: "Fallback",
    text: "Hold fallback routes for Central Jakarta and North Jakarta.",
  },
];

// Soft blob fill opacity per exposure tier — gentle washes so the map stays
// quiet, with the hierarchy still legible (High strongest, Not assessed
// faintest).
const BLOB_ALPHA: Record<JakartaExposureLevel, number> = {
  high: 0.26,
  elevated: 0.22,
  monitored: 0.18,
  low: 0.15,
  "not-assessed": 0.1,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const FULL_MONTHS = [
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

// Reporting-period label — the same 7-day window as the live Jakarta report
// (end = issue date), rendered COMPACTLY ("24 – 30 June 2026" when the window
// sits in one month). All-UTC math so an evening-UTC issue date never rolls a
// day for eastern viewers.
function periodLabel(issueDate?: string): string {
  if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return "This reporting period";
  }
  const end = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return "This reporting period";
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - 6);

  const sd = start.getUTCDate();
  const ed = end.getUTCDate();
  const sm = start.getUTCMonth();
  const em = end.getUTCMonth();
  const sy = start.getUTCFullYear();
  const ey = end.getUTCFullYear();

  if (sm === em && sy === ey) {
    return `${sd} – ${ed} ${FULL_MONTHS[em]} ${ey}`;
  }
  const startStr =
    sy === ey ? `${sd} ${FULL_MONTHS[sm]}` : `${sd} ${FULL_MONTHS[sm]} ${sy}`;
  return `${startStr} – ${ed} ${FULL_MONTHS[em]} ${ey}`;
}

const legendHeadStyle: CSSProperties = {
  fontFamily: "Roboto, sans-serif",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: NAVY,
  marginRight: 2,
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

export interface JakartaCorridorMapProps {
  incidents: CountryFastFactsIncident[];
  issueDate?: string;
  domId?: string;
}

/**
 * The live Jakarta city report "Operational Map" (§13). A QUIET movement-posture
 * design:
 *
 *   • seven exposure-shaded operating zones (1–7, fixed order), each washed by
 *     its OWN live rating (High / Elevated / Monitored / Low / Not assessed) —
 *     1:1 with the numbered pins and the panel;
 *   • four Electric-Blue dashed route corridors (airport, port, CBD, north
 *     access), no arrowheads or labels;
 *   • small dark-diamond major-incident markers, only where a record resolves
 *     to a real Jakarta location + recognised type (no callout box);
 *   • seven small numbered pins at the zone centres, coloured by rating;
 *   • a right-hand "Movement posture this period" panel (zones 1–7, name,
 *     rating, and the zone's period reason + action);
 *   • a full-width "Overall posture" strip.
 *
 * Rendered on screen and in the in-app PDF (DOM-rasterised, so screen == PDF).
 * The headless jsPDF path renders the equivalent seven-zone posture table via
 * buildJakartaPostureZones in exportCountryReportPdf. PDF parity: crossOrigin
 * <img> tiles + a single offscreen-canvas → data-URL <img> overlay, both
 * html2canvas-safe.
 */
export default function JakartaCorridorMap({
  incidents,
  issueDate,
  domId,
}: JakartaCorridorMapProps) {
  const model = useMemo(() => buildJakartaPostureModel(incidents), [incidents]);
  const rangeLabel = useMemo(() => periodLabel(issueDate), [issueDate]);

  const drawKey = useMemo(
    () => model.zones.map((z) => `${z.number}:${z.rating}`).join(","),
    [model],
  );

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);

  // Tear the Leaflet instance down on unmount so switching reports never leaves
  // a detached map bound to a recycled container.
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

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
        zoomDelta: 0,
        zoomSnap: 0,
        zoomAnimation: false,
        markerZoomAnimation: false,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        {
          attribution: "&copy; OpenStreetMap &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
          opacity: 1,
        },
      ).addTo(map);

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
      [JAKARTA_MAP_OPS_BBOX.minLat, JAKARTA_MAP_OPS_BBOX.minLon],
      [JAKARTA_MAP_OPS_BBOX.maxLat, JAKARTA_MAP_OPS_BBOX.maxLon],
    );
    map.fitBounds(bounds, { padding: [6, 6] });

    type Pt = { x: number; y: number };
    const mid = (p: Pt, q: Pt): Pt => ({
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
    });

    // Smooth OPEN polyline through its points (quadratic via midpoints).
    const traceSmooth = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
      ctx.beginPath();
      if (pts.length < 3) {
        pts.forEach((p, i) =>
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
        );
        return;
      }
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const m = mid(pts[i], pts[i + 1]);
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    // Soft, organic tier-tinted operating area. Derives an ellipse from the
    // projected bounding box, then a gently wobbly closed curve around it
    // (seeded so it's stable across redraws). No gradient / shadow.
    const drawBlob = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      rating: JakartaExposureLevel,
      seed: number,
    ) => {
      const N = 28;
      const pts: Pt[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wob =
          1 +
          0.1 * Math.sin(a * 3 + seed) +
          0.06 * Math.cos(a * 5 + seed * 1.7) +
          0.04 * Math.sin(a * 7 + seed * 0.5);
        pts.push({
          x: cx + rx * wob * Math.cos(a),
          y: cy + ry * wob * Math.sin(a),
        });
      }
      ctx.save();
      ctx.beginPath();
      const m0 = mid(pts[N - 1], pts[0]);
      ctx.moveTo(m0.x, m0.y);
      for (let i = 0; i < N; i++) {
        const cur = pts[i];
        const nxt = pts[(i + 1) % N];
        const m = mid(cur, nxt);
        ctx.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
      }
      ctx.closePath();
      const fill = hexToRgb(POSTURE_EXPOSURE_FILL[rating]);
      ctx.fillStyle = `rgba(${fill.r},${fill.g},${fill.b},${BLOB_ALPHA[rating]})`;
      ctx.fill();
      const acc = hexToRgb(POSTURE_EXPOSURE_ACCENT[rating]);
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${acc.r},${acc.g},${acc.b},0.45)`;
      ctx.setLineDash(rating === "not-assessed" ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    };

    // A single Electric-Blue dashed route corridor with a soft halo — no
    // arrowhead, no label (quiet redesign).
    const drawCorridor = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
      if (pts.length < 2) return;
      const { r, g, b } = hexToRgb(MOVEMENT_COLOR);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      traceSmooth(ctx, pts);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.14)`;
      ctx.stroke();
      traceSmooth(ctx, pts);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = MOVEMENT_COLOR;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    };

    // Small numbered colour pin at the zone centre (fill = tier accent, white
    // ring + white number).
    const drawPin = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      rating: JakartaExposureLevel,
      num: number,
    ) => {
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 9.5, 0, Math.PI * 2);
      ctx.fillStyle = POSTURE_EXPOSURE_ACCENT[rating];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 11px 'Roboto Condensed', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), x, y + 0.5);
      ctx.restore();
    };

    // Small dark diamond for a major incident marker — a quiet point (no red
    // star, no callout box), used only where a record geocodes to a real
    // Jakarta location and a recognised operational type.
    const drawMarker = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
      ctx.save();
      ctx.setLineDash([]);
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      const s = 4.5;
      ctx.beginPath();
      ctx.rect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = DUSK;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();
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

      // 1) Seven exposure-shaded operating zones (weakest first so stronger
      // tiers sit on top), each derived from its OWN projected bounding box and
      // washed by that zone's live rating — 1:1 with the numbered pins + panel.
      const shadedZones = model.zones
        .map((z, i) => ({ zone: z, seed: (i + 1) * 12.9898 }))
        .sort(
          (a, b) =>
            POSTURE_EXPOSURE_ORDER.indexOf(b.zone.rating) -
            POSTURE_EXPOSURE_ORDER.indexOf(a.zone.rating),
        );
      for (const { zone, seed } of shadedZones) {
        const ring = zone.polygon.map((p) => proj(p[0], p[1]));
        const xs = ring.map((p) => p.x);
        const ys = ring.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const rx = Math.max((maxX - minX) / 2, 24);
        const ry = Math.max((maxY - minY) / 2, 22);
        drawBlob(ctx, cx, cy, rx, ry, zone.rating, seed);
      }

      // 2) Four route corridors (over the blobs), dashed, no arrows/labels.
      for (const c of JAKARTA_POSTURE_CORRIDORS) {
        if (!DRAWN_CORRIDOR_IDS.has(c.id)) continue;
        drawCorridor(
          ctx,
          c.path.map((p) => proj(p[0], p[1])),
        );
      }

      // 3) Major incident markers (small dark diamonds), drawn beneath the
      // numbered zone pins. Only resolvable + recognised records reach here.
      for (const m of model.markers) {
        const c = proj(m.lat, m.lon);
        drawMarker(ctx, c.x, c.y);
      }

      // 4) Seven numbered colour pins.
      for (const z of model.zones) {
        const c = proj(z.center[0], z.center[1]);
        drawPin(ctx, c.x, c.y, z.rating, z.number);
      }

      img.width = canvas.width;
      img.height = canvas.height;
      img.src = canvas.toDataURL("image/png");
    };

    const t = window.setTimeout(draw, 60);
    return () => window.clearTimeout(t);
  }, [drawKey, model]);

  return (
    <figure
      id={domId}
      style={{
        margin: 0,
        fontFamily: "Roboto, sans-serif",
        color: DUSK,
      }}
    >
      <figcaption style={{ marginBottom: 10 }}>
        <div
          style={{
            fontFamily: "'Roboto Condensed', Roboto, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: NAVY,
          }}
        >
          Jakarta city movement posture
        </div>
        <div style={{ fontSize: 12, color: DUSK, marginTop: 2 }}>
          Reporting period: {rangeLabel}
        </div>
      </figcaption>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,13fr) minmax(0,7fr)",
          gap: 14,
          alignItems: "stretch",
        }}
      >
        {/* Left: quiet map + legend */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            ref={mapElRef}
            style={{
              position: "relative",
              width: "100%",
              height: 380,
              border: `1px solid ${NAVY}`,
              background: "#f4f5f7",
              overflow: "hidden",
            }}
          />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              marginTop: 8,
            }}
          >
            <span style={legendHeadStyle}>Exposure</span>
            {POSTURE_EXPOSURE_ORDER.map((lvl) => (
              <span key={lvl} style={legendRowStyle}>
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    background: POSTURE_EXPOSURE_ACCENT[lvl],
                    border: `1px solid ${NAVY}`,
                  }}
                />
                <span style={legendTextStyle}>{POSTURE_EXPOSURE_LABEL[lvl]}</span>
              </span>
            ))}
            <span style={legendRowStyle}>
              <span
                style={{
                  display: "inline-block",
                  width: 13,
                  height: 13,
                  borderRadius: 7,
                  background: NAVY,
                  border: "1.5px solid #ffffff",
                  outline: `1px solid ${NAVY}`,
                  boxSizing: "border-box",
                }}
              />
              <span style={legendTextStyle}>Operating zone</span>
            </span>
            <span style={legendRowStyle}>
              <span
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 0,
                  borderTop: `2px dashed ${MOVEMENT_COLOR}`,
                }}
              />
              <span style={legendTextStyle}>Movement corridor</span>
            </span>
            <span style={legendRowStyle}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  background: DUSK,
                  transform: "rotate(45deg)",
                  border: "1px solid #ffffff",
                  outline: `1px solid ${DUSK}`,
                }}
              />
              <span style={legendTextStyle}>Major incident marker</span>
            </span>
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: DUSK,
              marginTop: 8,
              lineHeight: 1.4,
            }}
          >
            Map reflects assessed operating exposure for this reporting period.
            Incident points are shown only where location detail is sufficient
            and operationally useful.
          </div>
        </div>

        {/* Right: movement posture panel */}
        <div
          style={{
            border: `1px solid ${NAVY}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              background: NAVY,
              color: "#ffffff",
              fontFamily: "'Roboto Condensed', Roboto, sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "6px 10px",
            }}
          >
            Movement posture this period
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {model.zones.map((z, i) => (
              <div
                key={z.id}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "7px 10px",
                  borderTop: i === 0 ? "none" : `1px solid ${NAVY}22`,
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: POSTURE_EXPOSURE_ACCENT[z.rating],
                    color: "#ffffff",
                    fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 1,
                  }}
                >
                  {z.number}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: NAVY,
                      }}
                    >
                      {z.name}
                    </span>
                    <span
                      data-posture-rating-badge="true"
                      style={{
                        flex: "0 0 auto",
                        fontFamily: "Roboto, sans-serif",
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "#ffffff",
                        background: POSTURE_EXPOSURE_ACCENT[z.rating],
                        padding: "1px 5px",
                      }}
                    >
                      {POSTURE_EXPOSURE_LABEL[z.rating]}
                    </span>
                  </div>
                  <div
                    style={{ fontSize: 11, color: DUSK, marginTop: 2 }}
                  >
                    {z.reason}
                  </div>
                  <div
                    style={{ fontSize: 11, color: NAVY, marginTop: 1 }}
                  >
                    {z.action}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom: overall posture action cards */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontFamily: "'Roboto Condensed', Roboto, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: NAVY,
            marginBottom: 8,
          }}
        >
          Overall posture
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0,1fr))",
            gap: 12,
          }}
        >
          {OVERALL_POSTURE.map((card) => (
            <div
              key={card.step}
              style={{
                border: `1px solid ${NAVY}`,
                borderTop: `3px solid ${MOVEMENT_COLOR}`,
                padding: "10px 12px 12px",
                background: "#ffffff",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: MOVEMENT_COLOR,
                }}
              >
                {card.step}
              </span>
              <span
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  color: NAVY,
                  fontWeight: 500,
                }}
              >
                {card.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
