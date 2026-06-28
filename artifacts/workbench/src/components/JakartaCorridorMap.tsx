import { useMemo } from "react";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import {
  JAKARTA_CORRIDOR_AREAS,
  buildJakartaCorridorStatuses,
  type JakartaCorridorStatus,
  type JakartaExposureIcon,
} from "@/lib/jakartaCorridors";

const NAVY = "#0b0a3d";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const NEUTRAL = "#CED3DB";

const SEV_COLOR: Record<string, string> = {
  extreme: "#A33232",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#1B6B7A",
};
const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};

// Schematic canvas geometry. The backdrop is drawn once into a data-URL <img>
// (so it clones into the PDF export DOM faithfully — html2canvas does NOT copy a
// live <canvas> bitmap on clone, but an <img> with a data URL it does), then the
// labelled area markers are absolutely-positioned HTML over it using the SAME
// percentage coordinates, so backdrop and markers stay aligned at any width.
const BACKDROP_W = 960;
const BACKDROP_H = 420;

function px(pct: number, total: number): number {
  return (pct / 100) * total;
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

// Draw a monochrome exposure glyph into a 24x24 logical box. Kept simple and
// recognisable; no inline SVG (html2canvas mangles SVG), no emojis.
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  icon: JakartaExposureIcon,
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
  }
}

function iconDataUrl(icon: JakartaExposureIcon, color: string, size = 22): string {
  if (typeof document === "undefined") return "";
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale((size * scale) / 24, (size * scale) / 24);
  drawGlyph(ctx, icon, color);
  return canvas.toDataURL("image/png");
}

// Build the static schematic backdrop: a clean light frame, a faint sea band to
// the north, and thin connector lines between the area nodes to read as movement
// corridors. Monochrome and subtle — it must look like a report graphic, not a
// tile-map screenshot.
function backdropDataUrl(): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = BACKDROP_W;
  canvas.height = BACKDROP_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Panel background.
  ctx.fillStyle = "#f7f8fa";
  ctx.fillRect(0, 0, BACKDROP_W, BACKDROP_H);

  // Faint "sea / coast" band to the north so the rough geography reads.
  const seaH = BACKDROP_H * 0.18;
  ctx.fillStyle = "#eef1f5";
  ctx.fillRect(0, 0, BACKDROP_W, seaH);
  ctx.strokeStyle = "#dfe3ea";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, seaH);
  for (let x = 0; x <= BACKDROP_W; x += 40) {
    ctx.lineTo(x, seaH + Math.sin(x / 55) * 4);
  }
  ctx.stroke();

  const pos = (id: string) => {
    const a = JAKARTA_CORRIDOR_AREAS.find((z) => z.id === id)!;
    return { x: px(a.pos.x, BACKDROP_W), y: px(a.pos.y, BACKDROP_H) };
  };
  const link = (aId: string, bId: string) => {
    const a = pos(aId);
    const b = pos(bId);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  // Corridor connectors (movement/access spine).
  ctx.strokeStyle = "#d4d9e1";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  link("airport-corridor", "central-government");
  link("central-government", "commercial-hotels");
  link("commercial-hotels", "cross-city-routes");
  link("central-government", "north-port");
  link("commuter-belt", "commercial-hotels");
  link("commuter-belt", "central-government");
  ctx.setLineDash([]);

  return canvas.toDataURL("image/png");
}

export interface JakartaCorridorMapProps {
  incidents: CountryFastFactsIncident[];
  /** Optional DOM id (kept for parity with CountryReportMap callers). */
  domId?: string;
}

/**
 * Jakarta corridor & access graphic — the Jakarta-only replacement for the
 * numbered incident-dot map. Renders a clean schematic of the six functional
 * corridor/access areas (each with a monochrome exposure icon and a this-week
 * status derived from the live Jakarta window), plus an area exposure table
 * (Area / Main exposure / Operational relevance / Action) that doubles as the
 * detail legend and as the fallback when the schematic cannot render cleanly.
 *
 * Everything is plain <img> (canvas-derived data URLs) + HTML <div> text, so it
 * rasterises identically on screen and in the DOM-rasterised PDF export.
 */
export default function JakartaCorridorMap({ incidents, domId }: JakartaCorridorMapProps) {
  const { statuses, unattributed } = useMemo(
    () => buildJakartaCorridorStatuses(incidents),
    [incidents],
  );
  const backdrop = useMemo(() => backdropDataUrl(), []);
  const icons = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of JAKARTA_CORRIDOR_AREAS) map[a.id] = iconDataUrl(a.icon, NAVY);
    return map;
  }, []);

  const anyElevated = statuses.some((s) => s.elevated);

  return (
    <div>
      {/* ---- Schematic graphic ------------------------------------------ */}
      <div
        id={domId}
        style={{
          position: "relative",
          width: "100%",
          height: 420,
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#f7f8fa",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "fill",
              display: "block",
            }}
          />
        ) : null}

        {statuses.map((s) => (
          <AreaMarker key={s.area.id} status={s} iconUrl={icons[s.area.id]} />
        ))}
      </div>

      {/* ---- Caption ----------------------------------------------------- */}
      <div
        style={{
          fontFamily: "Roboto, sans-serif",
          fontSize: 10.5,
          color: DUSK,
          marginTop: 8,
          fontStyle: "italic",
        }}
      >
        Operating-exposure schematic: the six corridor and access areas that shape movement and
        business activity in Jakarta. A coloured marker is an area with reporting this period
        (shaded by the highest severity recorded there); a neutral marker is a monitored area with
        no reporting this period — a standing exposure profile, not an all-clear.
        {unattributed > 0
          ? " Some records were retained in the assessment but not tied to a specific area."
          : ""}
      </div>

      {/* ---- Area exposure table (built-in detail + fallback) ------------ */}
      <ExposureTable statuses={statuses} anyElevated={anyElevated} />
    </div>
  );
}

function statusColor(s: JakartaCorridorStatus): string {
  return s.elevated ? SEV_COLOR[s.worstKey] ?? "#999999" : NEUTRAL;
}

function AreaMarker({
  status,
  iconUrl,
}: {
  status: JakartaCorridorStatus;
  iconUrl: string;
}) {
  const color = statusColor(status);
  return (
    <div
      style={{
        position: "absolute",
        left: `${status.area.pos.x}%`,
        top: `${status.area.pos.y}%`,
        transform: "translate(-50%, -50%)",
        width: 138,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "#ffffff",
          border: `2.5px solid ${color}`,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" width={22} height={22} style={{ display: "block" }} />
        ) : null}
        <span
          style={{
            position: "absolute",
            top: -7,
            right: -7,
            width: 17,
            height: 17,
            borderRadius: "50%",
            background: color,
            color: status.elevated ? "#ffffff" : "#36404f",
            border: "1.5px solid #ffffff",
            boxSizing: "border-box",
            fontFamily: "Roboto, sans-serif",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "14px",
            textAlign: "center",
          }}
        >
          {status.number}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          fontWeight: 700,
          color: NAVY,
          lineHeight: 1.15,
          background: "rgba(255,255,255,0.82)",
          padding: "1px 4px",
          borderRadius: 2,
        }}
      >
        {status.area.shortName}
      </div>
      <div
        style={{
          marginTop: 2,
          fontFamily: "Roboto, sans-serif",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: status.elevated ? color : "#7a828e",
          textTransform: "uppercase",
        }}
      >
        {status.elevated
          ? `Elevated · ${SEV_LABEL[status.worstKey] ?? status.worstKey}`
          : "Monitored"}
      </div>
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
  const columns = "150px 150px minmax(0, 1fr) minmax(0, 1fr)";
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
        {["Area", "Main exposure", "Operational relevance", "Action"].map((h) => (
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
        const color = statusColor(s);
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
              <div style={{ fontWeight: 700, color: NAVY }}>
                {s.number}. {s.area.name}
              </div>
              <div
                style={{
                  marginTop: 3,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: s.elevated ? color : "#7a828e",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: color,
                  }}
                />
                {s.elevated
                  ? `Elevated · ${SEV_LABEL[s.worstKey] ?? s.worstKey}`
                  : "Monitored"}
              </div>
            </div>
            <div style={{ ...cell }}>{s.area.exposure}</div>
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
          ? "Areas marked Elevated carried open-source reporting this period; the rest hold to their standing exposure profile."
          : "No area carried fresh open-source reporting this period; all six hold to their standing exposure profile."}
      </div>
    </div>
  );
}
