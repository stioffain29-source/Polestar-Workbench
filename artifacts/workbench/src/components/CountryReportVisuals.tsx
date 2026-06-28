import type { ReliefWebReport } from "@workspace/api-client-react";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import SituationalContextSection from "@/components/SituationalContextSection";

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const ROBOTO = "Roboto, sans-serif";
const CHART_TRACK = "#eef0f3";

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
const SEV_ORDER = ["extreme", "high", "moderate", "low", "insignificant"] as const;

type SeverityKey = (typeof SEV_ORDER)[number];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <h2
        style={{
          fontFamily: ROBOTO,
          fontWeight: 700,
          fontSize: 18,
          color: NAVY,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          borderBottom: `2px solid ${ELECTRIC}`,
          paddingBottom: 6,
          marginBottom: 14,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK, fontStyle: "italic" }}>{children}</div>;
}

// The shared analytics block that sits BELOW the written brief for every country
// report (structured and generic). The incident map is no longer rendered here —
// it is an analyst-placed block injected by the page at the chosen position. This
// block carries the severity and incident-type charts and the standalone
// Situational Context layer. Maritime Security has been removed from country
// reports (it remains on the topic reports). No counts in prose; charts carry
// their own tallies.
export default function CountryReportVisuals({
  countryName,
  severityCounts,
  severityTotal,
  showSeverityChart = true,
  typeChartData,
  typeChartMax,
  situationalReports,
}: {
  countryName: string;
  severityCounts: Record<SeverityKey, number>;
  severityTotal: number;
  // Whether the severity-distribution chart adds narrative value. When false the
  // chart is omitted entirely (a single, all-one-band window does not help
  // explain the risk picture — per the standard, charts must support the
  // narrative, not appear merely because the data exists). Defaults to true so
  // existing callers are unaffected.
  showSeverityChart?: boolean;
  typeChartData: { label: string; n: number }[];
  typeChartMax: number;
  situationalReports: ReliefWebReport[] | undefined | null;
}) {
  return (
    <>
      {/* Severity Distribution — shown only when it helps explain the risk
          picture (multiple bands present, or any High/Extreme record). */}
      {showSeverityChart && (
      <Section title="Severity Distribution">
        {severityTotal === 0 ? (
          <EmptyNote>No incidents in the active window to chart.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {SEV_ORDER.map((k) => {
              const n = severityCounts[k];
              const w = severityTotal === 0 ? 0 : (n / severityTotal) * 100;
              return (
                <div key={k} className="grid items-center" style={{ gridTemplateColumns: "140px 1fr 40px", gap: 8 }}>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>{SEV_LABEL[k]}</div>
                  <div style={{ background: CHART_TRACK, height: 18, borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: n === 0 ? "0%" : `${Math.max(w, 3)}%`,
                        height: "100%",
                        background: SEV_COLOR[k],
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <div style={{ fontFamily: ROBOTO, fontSize: 13, fontWeight: 700, color: NAVY, textAlign: "right" }}>
                    {n}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      )}

      {/* Incident Breakdown by Type */}
      <Section title="Incident Breakdown by Type">
        {typeChartData.length === 0 ? (
          <EmptyNote>No classifiable incident types in the active window.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {typeChartData.map((d) => {
              const w = typeChartMax === 0 ? 0 : (d.n / typeChartMax) * 100;
              return (
                <div
                  key={d.label}
                  className="grid items-center"
                  style={{ gridTemplateColumns: "180px 1fr 40px", gap: 8 }}
                >
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>{d.label}</div>
                  <div style={{ background: CHART_TRACK, height: 18, borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: d.n === 0 ? "0%" : `${Math.max(w, 3)}%`,
                        height: "100%",
                        background: ELECTRIC,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <div style={{ fontFamily: ROBOTO, fontSize: 13, fontWeight: 700, color: NAVY, textAlign: "right" }}>
                    {d.n}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Situational Context (UN OCHA ReliefWeb supporting layer — not counted) */}
      <SituationalContextSection reports={situationalReports} country={countryName} max={6} />
    </>
  );
}
