// Supply-chain exposure graphic for the Cargo Watch pattern report.
//
// Renders the FIVE physical movement stages as a connected, numbered vertical
// flow (one row per stage in fixed order), so the reader sees WHERE in the
// chain the period's exposure sits. Stages with no incidents are retained in a
// muted style — confirming the stage was assessed, not omitted. The
// cross-cutting/enforcement category is not a physical movement stage, so it
// sits in its own full-width box BENEATH the flow. Counts come straight from the
// pattern model (the deduped cluster primaries), so every share reconciles with
// Fast Facts and every other surface. Shared by the on-screen preview and the
// PDF (rasterised).

import type { CargoStageSummary } from "@/lib/cargoPatternModel";
import { G } from "@/lib/cargoGraphicsTheme";
import { GraphicFrame, ShareBar, SevChip } from "./CargoGraphicPrimitives";

export interface CargoSupplyChainExposureProps {
  stages: CargoStageSummary[];
  total: number;
}

const ENFORCEMENT_TITLE = "Cross-Cutting and Enforcement Activity";
const NO_INCIDENTS = "No incidents identified this period.";

export default function CargoSupplyChainExposure({
  stages,
  total,
}: CargoSupplyChainExposureProps) {
  // The enforcement category is cross-cutting, not a physical movement stage, so
  // it is lifted out of the numbered flow into its own box below.
  const physical = stages.filter((s) => s.key !== "enforcement");
  const enforcement = stages.find((s) => s.key === "enforcement") ?? null;
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

      {/* Cross-cutting / enforcement — spans the whole chain, so it sits in its
          own full-width box beneath the numbered physical stages. */}
      {enforcement ? (
        <div
          style={{
            marginTop: 14,
            background: enforcement.count > 0 ? G.panelAlt : "#FBFBFD",
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
              {ENFORCEMENT_TITLE}
            </div>
            <div style={{ fontSize: 10.5, color: G.dusk }}>
              {enforcement.count}{" "}
              {enforcement.count === 1 ? "incident" : "incidents"}
              {total > 0 ? ` · ${enforcement.sharePct}%` : ""}
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <ShareBar pct={enforcement.sharePct} />
          </div>
          <div style={{ fontSize: 10, color: G.muted, marginTop: 6 }}>
            {enforcement.primaryConcern}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 6,
            }}
          >
            {enforcement.count > 0 ? (
              <SevChip severityKey={enforcement.highestSeverityKey} small />
            ) : (
              <span style={{ fontSize: 10, color: G.muted }}>
                {NO_INCIDENTS}
              </span>
            )}
            {enforcement.count > 0 ? (
              <span style={{ fontSize: 10, color: G.dusk }}>
                {enforcement.mainCountry ?? "Not attributed"}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </GraphicFrame>
  );
}
