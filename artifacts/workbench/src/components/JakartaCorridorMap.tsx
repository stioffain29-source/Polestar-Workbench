import { useEffect, useMemo, useRef } from "react";
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
  JAKARTA_KEY_POINTS,
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

// Sea backdrop shown behind the basemap while tiles stream in.
const SEA = "#DCE6F0";

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

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
          opacity: 1,
        },
      ).addTo(map);

      // Markers + corridor overlay (offscreen canvas → data-URL <img>).
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

    const keyPointAreaIds = new Set(JAKARTA_KEY_POINTS.map((k) => k.corridorId));

    const drawMarker = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      level: JakartaExposureLevel,
      n: number,
    ) => {
      // Subtle exposure halo (the only shaded overlay, kept faint).
      const { r, g, b } = hexToRgb(EXPOSURE_ACCENT[level]);
      const grad = ctx.createRadialGradient(x, y, 2, x, y, 22);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.20)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // Marker disc.
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = EXPOSURE_ACCENT[level];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 8.9, 0, Math.PI * 2);
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = "rgba(11,11,61,0.18)";
      ctx.stroke();
      // Number.
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 10px 'Roboto Condensed', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), x, y + 0.5);
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

      // 1) Movement corridors — thin coloured lines with a faint white casing.
      for (const line of JAKARTA_CORRIDOR_LINES) {
        const level = levelFor.get(line.corridorId) ?? "not-assessed";
        const pts = line.path.map((c) => map.latLngToContainerPoint([c[0], c[1]]));
        const stroke = (width: number, colour: string) => {
          ctx.beginPath();
          pts.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.lineWidth = width;
          ctx.strokeStyle = colour;
          ctx.stroke();
        };
        stroke(3.6, "rgba(255,255,255,0.7)");
        stroke(2, EXPOSURE_ACCENT[level]);
      }

      // 2) Numbered markers for key sites.
      for (const kp of JAKARTA_KEY_POINTS) {
        const level = levelFor.get(kp.corridorId) ?? "not-assessed";
        const n = numberFor.get(kp.corridorId) ?? 0;
        const p = map.latLngToContainerPoint([kp.lat, kp.lon]);
        drawMarker(ctx, p.x, p.y, level, n);
      }

      // 3) Numbered discs for corridors that have no site marker (the pure
      //    movement routes), placed at the route's label anchor.
      for (const line of JAKARTA_CORRIDOR_LINES) {
        if (keyPointAreaIds.has(line.corridorId)) continue;
        const level = levelFor.get(line.corridorId) ?? "not-assessed";
        const n = numberFor.get(line.corridorId) ?? 0;
        const idx = Math.min(
          line.labelAt ?? Math.floor(line.path.length / 2),
          line.path.length - 1,
        );
        const anchor = line.path[idx];
        const p = map.latLngToContainerPoint([anchor[0], anchor[1]]);
        drawMarker(ctx, p.x, p.y, level, n);
      }

      img.src = canvas.toDataURL("image/png");
    };

    map.whenReady(draw);
    const t = window.setTimeout(draw, 80);
    map.on("resize moveend zoomend viewreset", draw);
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
                height: 470,
                position: "relative",
                background: SEA,
              }}
            />
          </div>

          {/* Small legend. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 14,
              marginTop: 12,
            }}
          >
            <span
              style={{
                fontFamily: "Roboto, sans-serif",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: NAVY,
              }}
            >
              Risk
            </span>
            {EXPOSURE_ORDER.map((lvl) => (
              <span key={lvl} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: EXPOSURE_ACCENT[lvl],
                  }}
                />
                <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
                  {EXPOSURE_LABEL[lvl]}
                </span>
              </span>
            ))}
            <span style={{ width: 1, height: 13, background: POLAR }} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: DUSK,
                  color: "#fff",
                  fontFamily: "'Roboto Condensed', Roboto, sans-serif",
                  fontWeight: 700,
                  fontSize: 9,
                }}
              >
                1
              </span>
              <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
                Keyed site / route
              </span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 0,
                  borderTop: `2px solid ${DUSK}`,
                }}
              />
              <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
                Movement corridor
              </span>
            </span>
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
        Markers and lines are coloured by operating exposure — each area's
        standing profile, raised where this period carried reporting; numbers
        key to the list. Routes are indicative; individual incidents are not
        plotted. Basemap © OpenStreetMap contributors © CARTO.
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
