import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import {
  buildJakartaCorridorStatuses,
  buildJakartaCityStatuses,
  type JakartaCorridorStatus,
  type JakartaCityStatus,
  type JakartaExposureLevel,
} from "@/lib/jakartaCorridors";
import {
  JAKARTA_GEO,
  JAKARTA_CITY_BBOX,
  type JakartaGeoFeature,
} from "@/lib/jakartaGeo";

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

// Context geography (surrounding regencies) — drawn as faint un-assessed land.
const CONTEXT_FILL = "#E6E9ED";
const CONTEXT_BORDER = "#C4CAD2";
const CITY_BORDER = "#FFFFFF";
// Sea backdrop shown behind the basemap while tiles stream in.
const SEA = "#DCE6F0";

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

// ---- Polygon geometry helpers ---------------------------------------------
// Shoelace area + area-weighted centroid of a [lon,lat] ring. Used to place
// each city's name label at its visual centre.
function ringSignedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function ringCentroid(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    const sum = ring.reduce<[number, number]>(
      (s, p) => [s[0] + p[0], s[1] + p[1]],
      [0, 0],
    );
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return [x / (6 * a), y / (6 * a)];
}

// Centroid of a feature's largest ring (its dominant landmass).
function featureCentroid(f: JakartaGeoFeature): [number, number] {
  let best = f.polys[0];
  let bestArea = -1;
  for (const ring of f.polys) {
    const ar = Math.abs(ringSignedArea(ring));
    if (ar > bestArea) {
      bestArea = ar;
      best = ring;
    }
  }
  return ringCentroid(best);
}

// A district name + exposure pill, rendered as plain HTML so html2canvas
// rasterises it faithfully into the in-app PDF (a live <canvas>/SVG marker is
// dropped/mangled on clone — see CountryReportMap).
function buildCityLabel(name: string, level: JakartaExposureLevel): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "center";
  wrap.style.gap = "3px";
  wrap.style.padding = "3px 7px 4px";
  wrap.style.background = "rgba(255,255,255,0.86)";
  wrap.style.border = `1px solid ${POLAR}`;
  wrap.style.borderRadius = "3px";
  wrap.style.boxSizing = "border-box";
  wrap.style.whiteSpace = "nowrap";
  wrap.style.pointerEvents = "none";

  const nm = document.createElement("div");
  nm.textContent = name.toUpperCase();
  nm.style.fontFamily = "'Roboto Condensed', Roboto, sans-serif";
  nm.style.fontWeight = "700";
  nm.style.fontSize = "11px";
  nm.style.lineHeight = "1";
  nm.style.color = NAVY;
  nm.style.letterSpacing = "0.04em";

  const chip = document.createElement("div");
  chip.textContent = EXPOSURE_LABEL[level].toUpperCase();
  chip.style.fontFamily = "Roboto, sans-serif";
  chip.style.fontWeight = "700";
  chip.style.fontSize = "9px";
  chip.style.lineHeight = "1";
  chip.style.letterSpacing = "0.05em";
  chip.style.padding = "2px 6px 3px";
  chip.style.borderRadius = "2px";
  chip.style.color = "#ffffff";
  chip.style.background = EXPOSURE_ACCENT[level];

  wrap.appendChild(nm);
  wrap.appendChild(chip);
  return wrap;
}

export interface JakartaCorridorMapProps {
  incidents: CountryFastFactsIncident[];
  /** Report issue date (YYYY-MM-DD) — drives the footer weekly date range. */
  issueDate?: string;
  /** Optional DOM id (kept for parity with CountryReportMap callers). */
  domId?: string;
}

/**
 * Jakarta operational exposure map — a REAL Leaflet basemap (CartoDB
 * light_nolabels tiles: actual coastline, the Java Sea and the road network)
 * with the five DKI Jakarta administrative cities shaded by operating exposure
 * as an overlay drawn over the map. Surrounding regencies are drawn as faint
 * un-assessed context land.
 *
 * PDF parity: the basemap is <img> tiles, the district choropleth is an
 * offscreen-canvas → data-URL <img>, and the labels are HTML <div>s — every
 * layer is something html2canvas rasterises faithfully, so the on-screen
 * preview and the DOM-rasterised in-app PDF stay identical (a live <canvas> or
 * Leaflet SVG vector layer would be dropped/mangled on clone).
 *
 * Exposure levels are honest: each city carries a standing profile that live
 * reporting can only RAISE, never invent. The supporting table below repeats
 * the corridor-level exposure plus a practical action.
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
  const cities = useMemo(
    () => buildJakartaCityStatuses(incidents),
    [incidents],
  );
  const rangeLabel = useMemo(() => weeklyRangeLabel(issueDate), [issueDate]);

  const cityLevel = useMemo(() => {
    const m = new Map<string, JakartaCityStatus>();
    for (const s of cities.statuses) m.set(s.city.id, s);
    return m;
  }, [cities]);

  // Re-render the overlay only when the displayed exposure set changes.
  const drawKey = useMemo(
    () => cities.statuses.map((s) => `${s.city.id}:${s.displayExposure}`).join(","),
    [cities],
  );

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polyImgRef = useRef<HTMLImageElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);

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
        "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
          opacity: 0.9,
        },
      ).addTo(map);

      // District-choropleth overlay (offscreen canvas → data-URL <img>).
      const polyImg = document.createElement("img");
      polyImg.alt = "";
      polyImg.style.position = "absolute";
      polyImg.style.left = "0";
      polyImg.style.top = "0";
      polyImg.style.width = "100%";
      polyImg.style.height = "100%";
      polyImg.style.pointerEvents = "none";
      polyImg.style.zIndex = "400";
      mapElRef.current.appendChild(polyImg);
      polyImgRef.current = polyImg;

      // HTML label layer (district name + exposure pill).
      const labels = document.createElement("div");
      labels.style.position = "absolute";
      labels.style.left = "0";
      labels.style.top = "0";
      labels.style.right = "0";
      labels.style.bottom = "0";
      labels.style.pointerEvents = "none";
      labels.style.zIndex = "500";
      mapElRef.current.appendChild(labels);
      labelLayerRef.current = labels;
    }

    const map = mapRef.current;
    const bounds = L.latLngBounds(
      [JAKARTA_CITY_BBOX.minLat, JAKARTA_CITY_BBOX.minLon],
      [JAKARTA_CITY_BBOX.maxLat, JAKARTA_CITY_BBOX.maxLon],
    );
    map.fitBounds(bounds, { padding: [12, 12] });

    const draw = () => {
      const el = mapElRef.current;
      const img = polyImgRef.current;
      const labels = labelLayerRef.current;
      if (!el || !img || !labels) return;
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

      const trace = (rings: number[][][]) => {
        ctx.beginPath();
        for (const ring of rings) {
          ring.forEach((pt, idx) => {
            const p = map.latLngToContainerPoint([pt[1], pt[0]]);
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
        }
      };

      // 1) Context regencies (faint un-assessed land), drawn first so the
      //    profiled cities sit cleanly on top.
      for (const f of JAKARTA_GEO) {
        if (f.role !== "context") continue;
        trace(f.polys);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = CONTEXT_FILL;
        ctx.fill("evenodd");
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = CONTEXT_BORDER;
        ctx.stroke();
      }

      // 2) The five DKI cities, shaded by displayed exposure.
      for (const f of JAKARTA_GEO) {
        if (f.role !== "city") continue;
        const st = cityLevel.get(f.id);
        const level: JakartaExposureLevel = st ? st.displayExposure : "not-assessed";
        trace(f.polys);
        ctx.globalAlpha = 0.74;
        ctx.fillStyle = EXPOSURE_FILL[level];
        ctx.fill("evenodd");
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = CITY_BORDER;
        ctx.stroke();
      }

      img.src = canvas.toDataURL("image/png");

      // City name + exposure labels at each city's centroid.
      labels.replaceChildren();
      for (const f of JAKARTA_GEO) {
        if (f.role !== "city") continue;
        const st = cityLevel.get(f.id);
        const level: JakartaExposureLevel = st ? st.displayExposure : "not-assessed";
        const [lon, lat] = featureCentroid(f);
        const p = map.latLngToContainerPoint([lat, lon]);
        const label = buildCityLabel(f.name, level);
        label.style.left = `${p.x}px`;
        label.style.top = `${p.y}px`;
        label.style.transform = "translate(-50%, -50%)";
        labels.appendChild(label);
      }
    };

    map.whenReady(draw);
    const t = window.setTimeout(draw, 80);
    map.on("resize moveend zoomend viewreset", draw);
    return () => {
      window.clearTimeout(t);
      map.off("resize moveend zoomend viewreset", draw);
    };
  }, [drawKey, cityLevel]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      polyImgRef.current = null;
      labelLayerRef.current = null;
    };
  }, []);

  const anyElevated = corridor.statuses.some((s) => s.elevated);

  return (
    <div>
      {/* Figure title (the map placement slot carries no outer heading). */}
      <div style={{ marginBottom: 8 }}>
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
          Movement, access and business-disruption exposure across the five DKI
          Jakarta cities · {rangeLabel}
        </div>
      </div>

      {/* Real Leaflet basemap with the district exposure overlay. */}
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
            height: 460,
            position: "relative",
            background: SEA,
          }}
        />
      </div>

      {/* Exposure-level legend. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 14,
          marginTop: 10,
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
          Exposure level
        </span>
        {EXPOSURE_ORDER.map((lvl) => (
          <span key={lvl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 13,
                height: 13,
                borderRadius: 2,
                background: EXPOSURE_FILL[lvl],
                border: `1px solid ${EXPOSURE_ACCENT[lvl]}`,
              }}
            />
            <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
              {EXPOSURE_LABEL[lvl]}
            </span>
          </span>
        ))}
      </div>

      {/* Caption / sources. */}
      <div
        style={{
          fontFamily: "Roboto, sans-serif",
          fontSize: 10.5,
          color: DUSK,
          marginTop: 8,
          fontStyle: "italic",
        }}
      >
        District shading shows operating exposure — each city's standing profile,
        raised where this period carried reporting; the surrounding regencies are
        shown as geographic context and not assessed. Boundaries are indicative
        and individual incidents are not plotted. Always confirm conditions
        locally before travelling. Basemap © OpenStreetMap contributors © CARTO.
        {cities.unattributed > 0
          ? " Some records were retained in the assessment but not tied to a specific city."
          : ""}
      </div>

      <ExposureTable statuses={corridor.statuses} anyElevated={anyElevated} />
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
