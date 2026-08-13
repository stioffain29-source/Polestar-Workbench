// Pattern dashboard graphic for the Cargo Watch pattern report.
//
// Renders up to four dominant operational patterns as cards. Each card is a
// taxonomy category from the pattern model, carrying its incident count, share,
// highest severity, primary geography, the control it stresses and a
// forward-looking watch line. Shared by preview and PDF (rasterised).

import type { CargoPatternCard } from "@/lib/cargoPatternModel";
import { G } from "@/lib/cargoGraphicsTheme";
import {
  GraphicFrame,
  ShareBar,
  SevChip,
  TagChip,
} from "./CargoGraphicPrimitives";

export interface CargoPatternDashboardProps {
  patterns: CargoPatternCard[];
}

export default function CargoPatternDashboard({
  patterns,
}: CargoPatternDashboardProps) {
  if (patterns.length === 0) {
    return (
      <GraphicFrame
        title="Operational Patterns"
        subtitle="Leading incident types within the broader supply chain exposure."
      >
        <div style={{ fontSize: 11, color: G.muted }}>
          No single category rose to a distinct operational pattern this period.
          The supply-chain view above shows where the limited reporting sits.
        </div>
      </GraphicFrame>
    );
  }

  return (
    <GraphicFrame
      title="Operational Patterns"
      subtitle="Leading incident types within the broader supply chain exposure."
      footnote="Share is each pattern's percentage of the period's unique incidents."
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        {patterns.map((p) => (
          <div
            key={p.id}
            style={{
              width: patterns.length === 1 ? "100%" : "48.5%",
              boxSizing: "border-box",
              background: G.panelAlt,
              border: `1px solid ${G.line}`,
              borderRadius: 4,
              padding: "10px 12px",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: G.navy,
                  paddingRight: 8,
                }}
              >
                {p.name}
              </div>
              <SevChip severityKey={p.highestSeverityKey} small />
            </div>

            <div style={{ fontSize: 10.5, color: G.dusk, marginTop: 6 }}>
              {p.count} {p.count === 1 ? "incident" : "incidents"} · {p.sharePct}
              % of total
              {p.primaryGeography ? ` · Primary country: ${p.primaryGeography}` : ""}
            </div>
            <div style={{ marginTop: 5 }}>
              <ShareBar pct={p.sharePct} />
            </div>

            <div style={{ fontSize: 10, color: G.dusk, marginTop: 8 }}>
              <span style={{ color: G.muted }}>Concern: </span>
              {p.operationalConcern}
            </div>

            {p.controlAffected.length > 0 &&
            p.controlAffected.some((c) => c !== "In-transit custody") ? (
              <div style={{ marginTop: 8 }}>
                {p.controlAffected.map((c) => (
                  <TagChip key={c}>{c}</TagChip>
                ))}
              </div>
            ) : null}

            <div style={{ fontSize: 10, color: G.muted, marginTop: 6 }}>
              <span style={{ fontWeight: 600 }}>Watch: </span>
              {p.watchNext}
            </div>
          </div>
        ))}
      </div>
    </GraphicFrame>
  );
}
