// Incident timeline graphic for the Cargo Watch pattern report.
//
// Plots each unique incident on one of five category lanes, positioned by date
// across the reporting window. Markers are coloured by severity. One marker per
// unique incident, so the marker count reconciles with the period total.
// Shared by preview and PDF (rasterised).

import type { CargoTimeline } from "@/lib/cargoPatternModel";
import { G, SEV_LABEL, sevColor, shortDate } from "@/lib/cargoGraphicsTheme";
import { GraphicFrame } from "./CargoGraphicPrimitives";

export interface CargoIncidentTimelineProps {
  timeline: CargoTimeline;
}

const LABEL_W = 150;
const TRACK_H = 24;
const MARKER = 9;

function msOf(iso: string): number {
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

const LEGEND_ORDER = ["extreme", "high", "moderate", "low", "insignificant"];

export default function CargoIncidentTimeline({
  timeline,
}: CargoIncidentTimelineProps) {
  if (timeline.total === 0 || !timeline.start || !timeline.end) {
    return (
      <GraphicFrame
        title="Incident Timeline"
        subtitle="Reported cargo incidents by category over the period."
      >
        <div style={{ fontSize: 11, color: G.muted }}>
          No incidents to plot this period.
        </div>
      </GraphicFrame>
    );
  }

  const startMs = msOf(timeline.start);
  const endMs = msOf(timeline.end);
  const span = Math.max(1, endMs - startMs);
  const leftPct = (iso: string) =>
    endMs === startMs ? 50 : ((msOf(iso) - startMs) / span) * 100;

  // Only surface tiers that actually appear, so the legend never implies an
  // absent severity.
  const present = new Set<string>();
  for (const lane of timeline.lanes) {
    for (const m of lane.markers) present.add(m.severityKey);
  }
  const legend = LEGEND_ORDER.filter((k) => present.has(k));

  return (
    <GraphicFrame
      title="Incident Timeline"
      subtitle={`Reported cargo incidents by category, ${shortDate(
        timeline.start,
      )} to ${shortDate(timeline.end)}.`}
    >
      <div>
        {timeline.lanes.map((lane, li) => (
          <div
            key={lane.key}
            style={{
              display: "flex",
              alignItems: "center",
              borderTop: li === 0 ? `1px solid ${G.line}` : "none",
              borderBottom: `1px solid ${G.line}`,
            }}
          >
            <div
              style={{
                width: LABEL_W,
                flex: "0 0 auto",
                fontSize: 10.5,
                color: G.navy,
                fontWeight: 600,
                paddingRight: 8,
                boxSizing: "border-box",
              }}
            >
              {lane.label}
              <span style={{ color: G.muted, fontWeight: 400 }}>
                {" "}
                ({lane.markers.length})
              </span>
            </div>
            <div
              style={{
                position: "relative",
                flex: 1,
                height: TRACK_H,
                background: li % 2 === 0 ? G.panel : G.panelAlt,
              }}
            >
              {lane.markers.map((m) => (
                <div
                  key={m.id}
                  title={`${m.category}${
                    m.shortLocation ? ` — ${m.shortLocation}` : ""
                  } (${shortDate(m.date)})`}
                  style={{
                    position: "absolute",
                    left: `${leftPct(m.date)}%`,
                    top: (TRACK_H - MARKER) / 2,
                    marginLeft: -(MARKER / 2),
                    width: MARKER,
                    height: MARKER,
                    background: sevColor(m.severityKey),
                    border: "1px solid #FFFFFF",
                    borderRadius: 1,
                  }}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Date axis aligned under the track */}
        <div style={{ display: "flex", marginTop: 5 }}>
          <div style={{ width: LABEL_W, flex: "0 0 auto" }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9.5,
              color: G.muted,
            }}
          >
            <span>{shortDate(timeline.start)}</span>
            <span>{shortDate(timeline.end)}</span>
          </div>
        </div>

        {/* Severity legend */}
        {legend.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 8,
            }}
          >
            {legend.map((k) => (
              <span
                key={k}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  marginRight: 12,
                  fontSize: 9.5,
                  color: G.dusk,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 9,
                    height: 9,
                    background: sevColor(k),
                    borderRadius: 1,
                    marginRight: 4,
                  }}
                />
                {SEV_LABEL[k] ?? k}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </GraphicFrame>
  );
}
