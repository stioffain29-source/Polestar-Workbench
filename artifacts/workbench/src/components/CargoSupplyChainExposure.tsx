// Supply-chain exposure graphic for the Cargo Watch pattern report.
//
// Renders the six supply-chain stages as a connected vertical flow, one row per
// stage in fixed order, so the reader sees WHERE in the chain the period's
// exposure sits. Counts come straight from the pattern model (the deduped
// cluster primaries), so they reconcile with Fast Facts and every other
// surface. Shared by the on-screen preview and the PDF (rasterised).

import type { CargoStageSummary } from "@/lib/cargoPatternModel";
import { G } from "@/lib/cargoGraphicsTheme";
import { GraphicFrame, ShareBar, SevChip } from "./CargoGraphicPrimitives";

export interface CargoSupplyChainExposureProps {
  stages: CargoStageSummary[];
  total: number;
}

export default function CargoSupplyChainExposure({
  stages,
  total,
}: CargoSupplyChainExposureProps) {
  const last = stages.length - 1;
  return (
    <GraphicFrame
      title="Supply-Chain Exposure"
      subtitle="Where this period's cargo incidents fall across the movement chain."
      footnote="Share is each stage's percentage of the period's unique incidents."
    >
      <div>
        {stages.map((s, i) => {
          const active = s.count > 0;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "stretch" }}>
              {/* Left spine + node */}
              <div
                style={{
                  width: 26,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 2,
                    flex: 1,
                    background: i > 0 ? G.line : "transparent",
                  }}
                />
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: active ? G.navy : G.track,
                    color: active ? "#FFFFFF" : G.muted,
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: "18px",
                    textAlign: "center",
                    flex: "0 0 auto",
                  }}
                >
                  {i + 1}
                </div>
                <div
                  style={{
                    width: 2,
                    flex: 1,
                    background: i < last ? G.line : "transparent",
                  }}
                />
              </div>

              {/* Stage card */}
              <div
                style={{
                  flex: 1,
                  marginLeft: 10,
                  marginBottom: i < last ? 8 : 0,
                  background: active ? G.panelAlt : "#FBFBFD",
                  border: `1px solid ${G.line}`,
                  borderRadius: 4,
                  padding: "8px 10px",
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <div
                    style={{ fontSize: 12, fontWeight: 700, color: G.navy }}
                  >
                    {s.label}
                  </div>
                  <div style={{ fontSize: 10.5, color: G.dusk }}>
                    {s.count} {s.count === 1 ? "incident" : "incidents"}
                    {total > 0 ? ` · ${s.sharePct}%` : ""}
                  </div>
                </div>
                <div style={{ marginTop: 6 }}>
                  <ShareBar pct={s.sharePct} />
                </div>
                <div style={{ fontSize: 10, color: G.muted, marginTop: 6 }}>
                  {s.primaryConcern}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 6,
                  }}
                >
                  {active ? (
                    <SevChip severityKey={s.highestSeverityKey} small />
                  ) : (
                    <span style={{ fontSize: 10, color: G.muted }}>
                      No incidents this period
                    </span>
                  )}
                  {active ? (
                    <span style={{ fontSize: 10, color: G.dusk }}>
                      {s.mainCountry ?? "Not attributed"}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </GraphicFrame>
  );
}
