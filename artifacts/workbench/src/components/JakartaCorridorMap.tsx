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
  buildJakartaMapModel,
  JAKARTA_MAP_CATEGORIES,
  JAKARTA_MAP_CATEGORY_META,
  JAKARTA_MAP_CORRIDORS,
  JAKARTA_MAP_OPS_BBOX,
  JAKARTA_OPERATING_ZONES,
  type JakartaMapCategoryMeta,
  type JakartaMarkerShape,
} from "@/lib/jakartaMapModel";

const NAVY = "#0B0B3D";
const DUSK = "#303030";
const POLAR = "#E2E2E2";

// Operating-exposure tints for the right-hand panel badges. Deliberately
// distinct from the incident-severity ramp, and never the reserved A33232
// (Extreme) or 1B6B7A (Insignificant) hexes.
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

// Stable 32-bit FNV-1a hash — drives the deterministic collision offset so a
// re-render never reshuffles overlapping markers.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

// Neutral slate for the movement-corridor lines and their labels — operating
// exposure is shown by the panel badges, never by corridor colour.
const CORRIDOR_COLOR = "#64748B";
const CORRIDOR_LABEL_COLOR = "#475569";
// Hollow navy ring marks a named operating zone (distinct from filled incident
// markers).
const ZONE_RING = NAVY;

export interface JakartaCorridorMapProps {
  incidents: CountryFastFactsIncident[];
  /** Report issue date (YYYY-MM-DD) — drives the figure's weekly date range. */
  issueDate?: string;
  /** Optional DOM id (kept for parity with CountryReportMap callers). */
  domId?: string;
}

/**
 * Jakarta operational map — a clean, client-grade tactical figure: a REAL light
 * Leaflet basemap (CartoDB Positron) framed to Jakarta proper plus the airport
 * approach and port strip, carrying:
 *
 *   • categorised per-incident markers (five operational lanes), placed ONLY
 *     where a record carries explicit coordinates or matches a named Jakarta
 *     gazetteer location — "no named location, no operational claim";
 *   • named operating-zone label points (hollow navy rings);
 *   • the airport, port and business movement corridors as route lines;
 *   • a full legend and an operating-zone guidance panel with live exposure.
 *
 * Records that cannot be honestly placed (or whose type is outside the legend)
 * are NOT plotted — they are surfaced in the "not mapped" note below the figure.
 *
 * PDF parity: the basemap is crossOrigin <img> tiles and every overlay (corridor
 * lines, zone labels, incident markers) is a single offscreen-canvas → data-URL
 * <img> layered over the tiles — both are layers html2canvas rasterises
 * faithfully, so the on-screen preview and the DOM-rasterised in-app PDF stay
 * identical (a live <canvas> or Leaflet SVG layer would be dropped on clone).
 */
export default function JakartaCorridorMap({
  incidents,
  issueDate,
  domId,
}: JakartaCorridorMapProps) {
  const model = useMemo(() => buildJakartaMapModel(incidents), [incidents]);
  const corridor = useMemo(
    () => buildJakartaCorridorStatuses(incidents),
    [incidents],
  );
  const rangeLabel = useMemo(() => weeklyRangeLabel(issueDate), [issueDate]);

  // Live exposure per corridor area, used for the operating-zone panel badges.
  const statusByArea = useMemo(() => {
    const m = new Map<string, JakartaCorridorStatus>();
    for (const s of corridor.statuses) m.set(s.area.id, s);
    return m;
  }, [corridor]);

  // Operating zones with their live status, sorted worst-exposure first so the
  // panel leads with what matters; stable on declared order within a tier.
  const zoneRows = useMemo(() => {
    return JAKARTA_OPERATING_ZONES.map((zone, i) => {
      const st = statusByArea.get(zone.corridorAreaId) ?? null;
      const level: JakartaExposureLevel = st ? st.displayExposure : "not-assessed";
      const elevated = st ? st.elevated : false;
      return { zone, level, elevated, i };
    }).sort(
      (a, b) =>
        SEV_RANK[b.level] - SEV_RANK[a.level] ||
        Number(b.elevated) - Number(a.elevated) ||
        a.i - b.i,
    );
  }, [statusByArea]);

  // Redraw the overlay only when the plotted set or any zone level changes.
  const drawKey = useMemo(
    () =>
      [
        model.points.map((p) => `${p.id}:${p.category}`).join(","),
        JAKARTA_OPERATING_ZONES.map(
          (z) => `${z.id}:${statusByArea.get(z.corridorAreaId)?.displayExposure ?? "-"}`,
        ).join(","),
      ].join("|"),
    [model, statusByArea],
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
        zoomDelta: 0,
        zoomSnap: 0,
        zoomAnimation: false,
        markerZoomAnimation: false,
      });
      mapRef.current = map;

      // Clean light basemap — CartoDB Positron (coastline, the Java Sea, the
      // road network and place labels, washed back so the markers dominate).
      // @2x tiles keep it crisp at the fractional zoom; crossOrigin so
      // html2canvas can rasterise it into the in-app PDF.
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

    // Soft movement band along a projected polyline, neutral slate, with
    // outward arrowheads (movement, both directions).
    const drawCorridorLine = (
      ctx: CanvasRenderingContext2D,
      pts: { x: number; y: number }[],
    ) => {
      if (pts.length < 2) return;
      const { r, g, b } = hexToRgb(CORRIDOR_COLOR);
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
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      trace();
      ctx.lineWidth = 4.6;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.22)`;
      ctx.stroke();
      trace();
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
      ctx.setLineDash([10, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    };

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
        halo?: number;
      },
    ) => {
      ctx.save();
      ctx.font = opts.font;
      ctx.textAlign = opts.align ?? "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = opts.spacing ?? "0em";
      ctx.lineJoin = "round";
      ctx.lineWidth = opts.halo ?? 3.2;
      ctx.strokeStyle = "rgba(255,255,255,0.94)";
      ctx.strokeText(str, x, y);
      ctx.fillStyle = opts.color;
      ctx.fillText(str, x, y);
      ctx.restore();
    };

    // Filled category-marker shape (white ring), distinct per lane.
    const drawCategoryMarker = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      meta: JakartaMapCategoryMeta,
    ) => {
      const r = 6;
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineJoin = "round";
      ctx.beginPath();
      const shape: JakartaMarkerShape = meta.shape;
      if (shape === "circle") {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      } else if (shape === "square") {
        ctx.rect(x - r * 0.92, y - r * 0.92, r * 1.84, r * 1.84);
      } else if (shape === "diamond") {
        ctx.moveTo(x, y - r * 1.18);
        ctx.lineTo(x + r * 1.18, y);
        ctx.lineTo(x, y + r * 1.18);
        ctx.lineTo(x - r * 1.18, y);
        ctx.closePath();
      } else if (shape === "triangle") {
        ctx.moveTo(x, y - r * 1.22);
        ctx.lineTo(x + r * 1.12, y + r * 0.88);
        ctx.lineTo(x - r * 1.12, y + r * 0.88);
        ctx.closePath();
      } else {
        // pentagon
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const px = x + Math.cos(a) * r * 1.12;
          const py = y + Math.sin(a) * r * 1.12;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      ctx.fillStyle = meta.color;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();
    };

    // Hollow ring for a named operating zone.
    const drawZoneRing = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
    ) => {
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ZONE_RING;
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

      // 1) Movement corridors (lines + outward arrowheads + label).
      const CORR_FONT = "700 10.5px 'Roboto Condensed', Roboto, sans-serif";
      for (const c of JAKARTA_MAP_CORRIDORS) {
        const pts = c.path.map((p) => proj(p[0], p[1]));
        drawCorridorLine(ctx, pts);
        drawArrow(ctx, pts[1], pts[0], CORRIDOR_COLOR);
        drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1], CORRIDOR_COLOR);
        const at = pts[Math.min(c.labelAt ?? Math.floor(pts.length / 2), pts.length - 1)];
        label(ctx, c.label.toUpperCase(), at.x, at.y - 11, {
          font: CORR_FONT,
          color: CORRIDOR_LABEL_COLOR,
          spacing: "0.04em",
        });
      }

      // 2) Named operating-zone rings + labels.
      const ZONE_FONT = "700 10.5px 'Roboto Condensed', Roboto, sans-serif";
      for (const z of JAKARTA_OPERATING_ZONES) {
        const p = proj(z.lat, z.lon);
        drawZoneRing(ctx, p.x, p.y);
        const off = 9;
        const side = z.labelSide ?? "top";
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
          ty = p.y - off - 2;
        } else {
          ty = p.y + off + 2;
        }
        label(ctx, z.label, tx, ty, {
          font: ZONE_FONT,
          color: NAVY,
          align,
        });
      }

      // 3) Categorised incident markers, with a deterministic radial offset for
      //    co-located markers of the same category (no random jitter).
      const seen = new Map<string, number>();
      for (const pt of model.points) {
        const meta = JAKARTA_MAP_CATEGORY_META[pt.category];
        const base = proj(pt.lat, pt.lon);
        const key = `${Math.round(base.x / 5)}:${Math.round(base.y / 5)}:${pt.category}`;
        const k = seen.get(key) ?? 0;
        seen.set(key, k + 1);
        let x = base.x;
        let y = base.y;
        if (k > 0) {
          const ang = ((hashStr(pt.id) % 360) * Math.PI) / 180;
          const rad = Math.min(6 + (k - 1) * 4, 14);
          x += Math.cos(ang) * rad;
          y += Math.sin(ang) * rad;
        }
        drawCategoryMarker(ctx, x, y, meta);
      }

      img.src = canvas.toDataURL("image/png");
    };

    map.whenReady(draw);
    const t = window.setTimeout(draw, 80);
    const t2 = window.setTimeout(draw, 700);
    map.on("resize moveend zoomend viewreset", draw);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => draw());
    }
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      map.off("resize moveend zoomend viewreset", draw);
    };
  }, [drawKey, model, statusByArea]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayImgRef.current = null;
    };
  }, []);

  // If the reporting window loses every plottable location (e.g. the editor
  // switches to a report/window with no located incidents), the conditional map
  // DOM below unmounts. Tear the Leaflet instance down here so that a later
  // window which DOES resolve points rebuilds a fresh map on the remounted node
  // instead of reusing an instance still bound to the detached container.
  useEffect(() => {
    if (model.points.length > 0) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    overlayImgRef.current = null;
  }, [model]);

  // When nothing in the window resolves to a plottable location, the Leaflet
  // canvas would render empty. Show an explicit "map unavailable" panel in its
  // place instead — the legend and operating-zone cards still carry the standing
  // guidance, and no marker is ever invented (strict no-fabrication).
  const hasMappablePoints = model.points.length > 0;

  const notMappedParts: string[] = [];
  if (model.notMapped.insufficientLocation > 0) {
    notMappedParts.push(
      `insufficient location detail: ${model.notMapped.insufficientLocation}`,
    );
  }
  if (model.notMapped.typeNotMapped > 0) {
    notMappedParts.push(
      `incident type outside the legend: ${model.notMapped.typeNotMapped}`,
    );
  }

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
          Jakarta — Operational Map
        </div>
        <div
          style={{
            fontFamily: "Roboto, sans-serif",
            fontSize: 11.5,
            color: DUSK,
            marginTop: 2,
          }}
        >
          Reported incidents this period by type and location, with named
          operating zones and movement corridors · {rangeLabel}
        </div>
      </div>

      {/* Map (~65%) on the left, operating-zone panel (~35%) on the right. */}
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
            {hasMappablePoints ? (
              <div
                ref={mapElRef}
                style={{
                  width: "100%",
                  height: 440,
                  position: "relative",
                  background: "#EAEAEA",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: 440,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 24,
                  boxSizing: "border-box",
                  background: "#F6F6F6",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                    fontWeight: 700,
                    fontSize: 15,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    color: NAVY,
                    marginBottom: 6,
                  }}
                >
                  Operational map unavailable
                </div>
                <div
                  style={{
                    fontFamily: "Roboto, sans-serif",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: DUSK,
                    maxWidth: 420,
                  }}
                >
                  Insufficient location detail this period to plot incidents. The
                  operating-zone guidance and exposure legend below still apply.
                </div>
              </div>
            )}
          </div>

          {/* Legend: incident types, map references and operating exposure. */}
          <div
            style={{
              marginTop: 10,
              padding: "10px 13px",
              border: `1px solid ${POLAR}`,
              borderRadius: 2,
              background: "#ffffff",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px 18px",
              }}
            >
              <div style={legendHeadStyle}>Incident type</div>
              {JAKARTA_MAP_CATEGORIES.map((c) => (
                <span key={c.id} style={legendRowStyle}>
                  <MarkerSwatch meta={c} />
                  <span style={legendTextStyle}>{c.label}</span>
                </span>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px 18px",
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px solid ${POLAR}`,
              }}
            >
              <div style={legendHeadStyle}>Reference</div>
              <span style={legendRowStyle}>
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: "#ffffff",
                    border: `2px solid ${ZONE_RING}`,
                    boxSizing: "border-box",
                  }}
                />
                <span style={legendTextStyle}>Operating zone</span>
              </span>
              <span style={legendRowStyle}>
                <span
                  style={{
                    display: "inline-block",
                    width: 20,
                    height: 0,
                    borderTop: `2px dashed ${CORRIDOR_COLOR}`,
                  }}
                />
                <span style={legendTextStyle}>
                  Movement corridor (airport · port · business)
                </span>
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px 18px",
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px solid ${POLAR}`,
              }}
            >
              <div style={legendHeadStyle}>Operating exposure</div>
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
        </div>

        {/* Operating-zone guidance panel. */}
        <div style={{ flex: "35 1 0", minWidth: 0 }}>
          <ZonePanel rows={zoneRows} />
        </div>
      </div>

      {/* Mapping-rule caption + honest "not mapped" note. */}
      <div
        style={{
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          color: DUSK,
          lineHeight: 1.55,
          marginTop: 12,
        }}
      >
        Markers are placed only where a record carries explicit coordinates or
        matches a named Jakarta gazetteer location; no named location, no plotted
        marker.
        {notMappedParts.length > 0 ? (
          <>
            {" "}
            Not mapped this period — {notMappedParts.join("; ")}.
          </>
        ) : null}
      </div>
    </div>
  );
}

function MarkerSwatch({ meta }: { meta: JakartaMapCategoryMeta }) {
  const common: CSSProperties = {
    display: "inline-block",
    width: 12,
    height: 12,
    background: meta.color,
    border: "1.5px solid #ffffff",
    boxSizing: "border-box",
    boxShadow: `0 0 0 1px ${meta.color}`,
  };
  if (meta.shape === "circle") {
    return <span style={{ ...common, borderRadius: "50%" }} />;
  }
  if (meta.shape === "diamond") {
    return <span style={{ ...common, transform: "rotate(45deg)" }} />;
  }
  if (meta.shape === "triangle") {
    return (
      <span
        style={{
          display: "inline-block",
          width: 0,
          height: 0,
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderBottom: `12px solid ${meta.color}`,
        }}
      />
    );
  }
  if (meta.shape === "pentagon") {
    return (
      <span
        style={{
          ...common,
          clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
        }}
      />
    );
  }
  // square
  return <span style={{ ...common, borderRadius: 2 }} />;
}

function ZonePanel({
  rows,
}: {
  rows: {
    zone: (typeof JAKARTA_OPERATING_ZONES)[number];
    level: JakartaExposureLevel;
    elevated: boolean;
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
        Operating zones this period
      </div>
      {rows.map(({ zone, level, elevated }, i) => {
        const accent = EXPOSURE_ACCENT[level];
        return (
          <div
            key={zone.id}
            style={{
              padding: "10px 13px",
              borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                  fontWeight: 700,
                  fontSize: 13,
                  color: NAVY,
                  lineHeight: 1.2,
                  minWidth: 0,
                }}
              >
                {zone.panelTitle}
              </div>
              <span
                style={{
                  flex: "0 0 auto",
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
                {EXPOSURE_LABEL[level]}
              </span>
            </div>
            <div
              style={{
                fontFamily: "Roboto, sans-serif",
                fontSize: 9.5,
                color: "#7a828e",
                marginTop: 3,
              }}
            >
              {elevated ? "Raised this period" : "Standing profile"}
            </div>
            <div
              style={{
                fontFamily: "Roboto, sans-serif",
                fontSize: 11,
                color: DUSK,
                lineHeight: 1.4,
                marginTop: 5,
              }}
            >
              {zone.meaning}
            </div>
          </div>
        );
      })}
    </div>
  );
}
