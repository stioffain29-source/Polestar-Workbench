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
  JAKARTA_GEO,
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

// Faint administrative outline of the five DKI cities, drawn (no fill) purely
// for geographic orientation under the corridors and key points.
const DKI_OUTLINE = "rgba(11,11,61,0.28)";
// Sea backdrop shown behind the basemap while tiles stream in.
const SEA = "#DCE6F0";

type LabelSide = "top" | "bottom" | "left" | "right";

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

// A key-site label: name + exposure pill, rendered as plain HTML so html2canvas
// rasterises it faithfully into the in-app PDF (a live <canvas>/SVG marker is
// dropped/mangled on clone — see CountryReportMap).
function buildPointLabel(name: string, level: JakartaExposureLevel): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "flex-start";
  wrap.style.gap = "3px";
  wrap.style.padding = "3px 7px 4px";
  wrap.style.background = "rgba(255,255,255,0.9)";
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
  nm.style.letterSpacing = "0.03em";

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

// A movement-corridor label: a short colour swatch + route name, on one line.
function buildCorridorLabel(name: string, level: JakartaExposureLevel): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "5px";
  wrap.style.padding = "2px 7px 3px";
  wrap.style.background = "rgba(255,255,255,0.9)";
  wrap.style.border = `1px solid ${POLAR}`;
  wrap.style.borderRadius = "3px";
  wrap.style.boxSizing = "border-box";
  wrap.style.whiteSpace = "nowrap";
  wrap.style.pointerEvents = "none";

  const swatch = document.createElement("div");
  swatch.style.width = "16px";
  swatch.style.height = "0";
  swatch.style.borderTop = `3px solid ${EXPOSURE_ACCENT[level]}`;
  swatch.style.borderRadius = "2px";

  const nm = document.createElement("div");
  nm.textContent = name;
  nm.style.fontFamily = "Roboto, sans-serif";
  nm.style.fontWeight = "700";
  nm.style.fontSize = "10px";
  nm.style.lineHeight = "1";
  nm.style.color = DUSK;
  nm.style.letterSpacing = "0.02em";

  wrap.appendChild(swatch);
  wrap.appendChild(nm);
  return wrap;
}

// Anchor a label relative to a marker point given a preferred side.
function placeLabel(el: HTMLDivElement, x: number, y: number, side: LabelSide) {
  const gap = 11;
  switch (side) {
    case "left":
      el.style.left = `${x - gap}px`;
      el.style.top = `${y}px`;
      el.style.transform = "translate(-100%, -50%)";
      break;
    case "right":
      el.style.left = `${x + gap}px`;
      el.style.top = `${y}px`;
      el.style.transform = "translate(0, -50%)";
      break;
    case "top":
      el.style.left = `${x}px`;
      el.style.top = `${y - gap}px`;
      el.style.transform = "translate(-50%, -100%)";
      break;
    case "bottom":
    default:
      el.style.left = `${x}px`;
      el.style.top = `${y + gap}px`;
      el.style.transform = "translate(-50%, 0)";
      break;
  }
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
 * with the city's KEY OPERATING SITES drawn as markers and the main MOVEMENT
 * CORRIDORS drawn as route lines, each coloured by live operating exposure. A
 * faint administrative outline of the five DKI cities sits underneath purely
 * for orientation.
 *
 * PDF parity: the basemap is <img> tiles, the corridor lines + key-point
 * markers are an offscreen-canvas → data-URL <img>, and the labels are HTML
 * <div>s — every layer is something html2canvas rasterises faithfully, so the
 * on-screen preview and the DOM-rasterised in-app PDF stay identical (a live
 * <canvas> or Leaflet SVG vector layer would be dropped/mangled on clone).
 *
 * Exposure levels are honest: each corridor carries a standing profile that
 * live reporting can only RAISE, never invent. The supporting table below
 * repeats the corridor-level exposure plus a practical action.
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

  // corridor area id -> displayed exposure level.
  const levelFor = useMemo(() => {
    const m = new Map<string, JakartaExposureLevel>();
    for (const s of corridor.statuses) m.set(s.area.id, s.displayExposure);
    return m;
  }, [corridor]);

  // Re-render the overlay only when the displayed exposure set changes.
  const drawKey = useMemo(
    () =>
      corridor.statuses
        .map((s) => `${s.area.id}:${s.displayExposure}`)
        .join(","),
    [corridor],
  );

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);
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
          opacity: 0.95,
        },
      ).addTo(map);

      // Corridor + key-point overlay (offscreen canvas → data-URL <img>).
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

      // HTML label layer (site names + corridor names + exposure pills).
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
      [JAKARTA_VIEW_BBOX.minLat, JAKARTA_VIEW_BBOX.minLon],
      [JAKARTA_VIEW_BBOX.maxLat, JAKARTA_VIEW_BBOX.maxLon],
    );
    map.fitBounds(bounds, { padding: [10, 10] });

    const draw = () => {
      const el = mapElRef.current;
      const img = overlayImgRef.current;
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

      // 1) Faint DKI administrative outline (no fill) for orientation.
      ctx.lineWidth = 1;
      ctx.strokeStyle = DKI_OUTLINE;
      for (const f of JAKARTA_GEO) {
        if (f.role !== "city") continue;
        ctx.beginPath();
        for (const ring of f.polys) {
          ring.forEach((pt, idx) => {
            const p = map.latLngToContainerPoint([pt[1], pt[0]]);
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
        }
        ctx.stroke();
      }

      // 2) Movement corridors — white casing then a coloured core.
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
        stroke(7, "rgba(255,255,255,0.92)");
        stroke(4, EXPOSURE_ACCENT[level]);
      }

      // 3) Key sites — white halo + exposure-coloured dot.
      for (const kp of JAKARTA_KEY_POINTS) {
        const level = levelFor.get(kp.corridorId) ?? "not-assessed";
        const p = map.latLngToContainerPoint([kp.lat, kp.lon]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2);
        ctx.fillStyle = EXPOSURE_ACCENT[level];
        ctx.fill();
      }

      img.src = canvas.toDataURL("image/png");

      // Labels.
      labels.replaceChildren();
      for (const line of JAKARTA_CORRIDOR_LINES) {
        const level = levelFor.get(line.corridorId) ?? "not-assessed";
        const idx = Math.min(
          line.labelAt ?? Math.floor(line.path.length / 2),
          line.path.length - 1,
        );
        const anchor = line.path[idx];
        const p = map.latLngToContainerPoint([anchor[0], anchor[1]]);
        const label = buildCorridorLabel(line.label, level);
        label.style.left = `${p.x}px`;
        label.style.top = `${p.y}px`;
        label.style.transform = "translate(-50%, -50%)";
        labels.appendChild(label);
      }
      for (const kp of JAKARTA_KEY_POINTS) {
        const level = levelFor.get(kp.corridorId) ?? "not-assessed";
        const p = map.latLngToContainerPoint([kp.lat, kp.lon]);
        const label = buildPointLabel(kp.label, level);
        placeLabel(label, p.x, p.y, kp.labelSide ?? "right");
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
  }, [drawKey, levelFor]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayImgRef.current = null;
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
          Key operating sites and movement corridors across Greater Jakarta ·{" "}
          {rangeLabel}
        </div>
      </div>

      {/* Real Leaflet basemap with the corridor + key-point overlay. */}
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

      {/* Legend — exposure levels plus the two map symbols. */}
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
        <span style={{ width: 1, height: 16, background: POLAR }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: DUSK,
              border: "2px solid #ffffff",
              boxSizing: "border-box",
            }}
          />
          <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
            Key site
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 0,
              borderTop: `3px solid ${DUSK}`,
              borderRadius: 2,
            }}
          />
          <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
            Movement corridor
          </span>
        </span>
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
        Markers show key operating sites and lines show the main movement
        corridors, each coloured by operating exposure — its standing profile,
        raised where this period carried reporting. The basemap shows the real
        coastline and road network for context only. Routes are indicative and
        individual incidents are not plotted. Always confirm conditions locally
        before travelling. Basemap © OpenStreetMap contributors © CARTO.
        {corridor.unattributed > 0
          ? " Some records were retained in the assessment but not tied to a specific corridor."
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
