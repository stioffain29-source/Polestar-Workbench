// Red Sea Directional Flow panel — TWO vertical grouped-bar charts (Bab
// el-Mandeb south gate + Suez Canal north gate) plotting inbound vs outbound
// vessels by heading over live AIS samples.
//
// One shared component renders on BOTH the Shipping monitor and the Shipping
// Watch report preview (so screen == preview by construction); the headless PDF
// draws the equivalent rectangles from the SAME series builder
// (lib/maritimeDirectionalFlow.ts). Charts are HTML/div bars — never recharts
// SVG — because the report PDF rasterises the DOM via html2canvas, which mangles
// inline SVG charts.
//
// Brand: flat solid fills only (no gradient / shadow / glow). Inbound = Electric
// Blue, Outbound = Midnight. RED IS DELIBERATELY UNUSED — direction is context,
// never a severity, and the subdued red is reserved for the Extreme tier.

import {
  type GatewayFlowSeries,
  DIRECTIONAL_FLOW_TITLE,
  DIRECTIONAL_FLOW_CAPTION,
  DIRECTIONAL_FLOW_DISCLAIMER,
  INBOUND_LABEL,
  OUTBOUND_LABEL,
  gatewayEmptyState,
  sharedFlowMax,
  hasAnyFlow,
} from "@/lib/maritimeDirectionalFlow";
import { NAVY, ELECTRIC, DUSK, POLAR } from "@/lib/spotReport";

const INBOUND_COLOR = ELECTRIC;
const OUTBOUND_COLOR = NAVY;
const PLOT_H = 110; // px height of the bar plot area
const LABEL_RESERVE = 14; // px reserved at the top for the value label
const BAR_W = 14; // px width of one bar
const FONT = "Roboto, sans-serif";

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 11, height: 11, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: DUSK, fontFamily: FONT }}>{label}</span>
    </span>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const usable = PLOT_H - LABEL_RESERVE;
  const h = value > 0 ? Math.max(2, (value / max) * usable) : 0;
  return (
    <div
      style={{
        position: "relative",
        width: BAR_W,
        height: PLOT_H,
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: -4,
          right: -4,
          bottom: h + 2,
          textAlign: "center",
          fontSize: 9,
          lineHeight: "10px",
          fontWeight: 700,
          color: NAVY,
          fontFamily: FONT,
        }}
      >
        {value}
      </span>
      <div style={{ width: "100%", height: h, background: color }} />
    </div>
  );
}

function GatewayChart({ series, max }: { series: GatewayFlowSeries; max: number }) {
  return (
    <div style={{ border: `1px solid ${POLAR}`, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: NAVY }}>
          {series.theatre}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: DUSK }}>
          {series.gate}
        </div>
      </div>

      {series.hasData ? (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, overflowX: "auto" }}>
            {series.points.map((p) => (
              <div key={p.iso} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, borderBottom: `1px solid ${POLAR}`, paddingBottom: 0 }}>
                  <Bar value={p.inbound} max={max} color={INBOUND_COLOR} />
                  <Bar value={p.outbound} max={max} color={OUTBOUND_COLOR} />
                </div>
                <div style={{ fontFamily: FONT, fontSize: 9, color: DUSK, textAlign: "center", maxWidth: 64, lineHeight: "11px" }}>
                  {p.label}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 10, color: DUSK, marginTop: 8 }}>
            {series.totalInbound} inbound &middot; {series.totalOutbound} outbound observations across{" "}
            {series.points.length} AIS {series.points.length === 1 ? "sample" : "samples"}
          </div>
        </>
      ) : (
        <p style={{ fontFamily: FONT, fontSize: 12, fontStyle: "italic", color: DUSK, lineHeight: 1.5, margin: 0 }}>
          {gatewayEmptyState(series.gate)}
        </p>
      )}
    </div>
  );
}

/**
 * Render the two Red Sea gateway charts side by side. Data is fetched by the
 * parent and passed in as already-built series, so this component is pure
 * presentation and identical on the monitor and in the report.
 */
export default function RedSeaDirectionalFlowPanel({
  gateways,
}: {
  gateways: GatewayFlowSeries[];
}) {
  const max = sharedFlowMax(gateways);
  const anyFlow = hasAnyFlow(gateways);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: NAVY }}>
          {DIRECTIONAL_FLOW_TITLE}
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <Swatch color={INBOUND_COLOR} label={INBOUND_LABEL} />
          <Swatch color={OUTBOUND_COLOR} label={OUTBOUND_LABEL} />
        </div>
      </div>
      <p style={{ fontFamily: FONT, fontSize: 12, color: DUSK, lineHeight: 1.5, margin: "0 0 10px 0" }}>
        {DIRECTIONAL_FLOW_CAPTION}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {gateways.map((g) => (
          <GatewayChart key={g.theatre} series={g} max={max} />
        ))}
      </div>

      {anyFlow && (
        <p style={{ fontFamily: FONT, fontSize: 11, color: DUSK, fontStyle: "italic", lineHeight: 1.5, margin: "10px 0 0 0" }}>
          {DIRECTIONAL_FLOW_DISCLAIMER}
        </p>
      )}
    </div>
  );
}
