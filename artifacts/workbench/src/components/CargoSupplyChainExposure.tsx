// Supply-chain exposure graphic for the Cargo Watch pattern report.
//
// Renders the physical movement stages as a connected, numbered vertical flow
// (one row per stage in fixed order), so the reader sees WHERE in the chain the
// period's exposure sits. Stages with no incidents are retained in a muted style
// — confirming the stage was assessed, not omitted. The "unattributed" bucket is
// not a physical movement position, so it sits in its own full-width box BENEATH
// the flow. Enforcement outcomes are NOT a stage at all — they are partitioned
// out into a separate panel upstream (spec pt1) and never reach this graphic.
// Counts come straight from the pattern model (the deduped OPERATIONAL cluster
// primaries), so every share reconciles with Fast Facts and every other surface.
// Shared by the on-screen preview and the PDF (rasterised).

import type { CargoStageSummary } from "@/lib/cargoPatternModel";
import { G } from "@/lib/cargoGraphicsTheme";
import { GraphicFrame, ShareBar, SevChip } from "./CargoGraphicPrimitives";

export interface CargoSupplyChainExposureProps {
  stages: CargoStageSummary[];
  total: number;
}

const UNATTRIBUTED_TITLE = "Stage Not Determined";
const NO_INCIDENTS = "No incidents identified this period.";

export default function CargoSupplyChainExposure({
  stages,
  total,
}: CargoSupplyChainExposureProps) {
  // The "unattributed" bucket is not a physical movement position, so it is
  // lifted out of the numbered flow into its own box below.
  const physical = stages.filter((s) => s.key !== "unattributed");
  const unattributed = stages.find((s) => s.key === "unattributed") ?? null;
  const last = physical.length - 1;

  return (
    <GraphicFrame
      title="Supply-Chain Exposure"
      subtitle="Where this period's cargo incidents fall across the movement chain."
      footnote="Share is each stage's percentage of the period's unique incidents."
    >
      <div>
        {physical.map((s, i) => {
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
                  // Tagged so the PDF export swaps this numeral for a
                  // pixel-centred <canvas>; inline-flex centres it on screen.
                  data-raster-numeral=""
                  data-numeral-bg={active ? G.navy : G.track}
                  data-numeral-fg={active ? "#FFFFFF" : G.muted}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: active ? G.navy : G.track,
                    color: active ? "#FFFFFF" : G.muted,
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    boxSizing: "border-box",
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
                      {NO_INCIDENTS}
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

      {/* Unattributed — incidents that could not be placed at a specific movement
          position sit in their own full-width box beneath the numbered stages, so
          the chain stays a clean sequence. Shown only when it carries incidents. */}
      {unattributed && unattributed.count > 0 ? (
        <div
          style={{
            marginTop: 14,
            background: G.panelAlt,
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
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: G.navy,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {UNATTRIBUTED_TITLE}
            </div>
            <div style={{ fontSize: 10.5, color: G.dusk }}>
              {unattributed.count}{" "}
              {unattributed.count === 1 ? "incident" : "incidents"}
              {total > 0 ? ` · ${unattributed.sharePct}%` : ""}
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <ShareBar pct={unattributed.sharePct} />
          </div>
          <div style={{ fontSize: 10, color: G.muted, marginTop: 6 }}>
            {unattributed.primaryConcern}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 6,
            }}
          >
            <SevChip severityKey={unattributed.highestSeverityKey} small />
            <span style={{ fontSize: 10, color: G.dusk }}>
              {unattributed.mainCountry ?? "Not attributed"}
            </span>
          </div>
        </div>
      ) : null}
    </GraphicFrame>
  );
}
