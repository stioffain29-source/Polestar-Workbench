import { format } from "date-fns";
import type { ReliefWebReport } from "@workspace/api-client-react";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import CountryReportMap from "@/components/CountryReportMap";
import SituationalContextSection from "@/components/SituationalContextSection";
import {
  buildMaritimeSecuritySummary,
  maritimeTypeColor,
  MARITIME_SECURITY_SOURCE_LABEL,
} from "@/lib/maritimeSecurity";

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
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
type MaritimeSummary = ReturnType<typeof buildMaritimeSecuritySummary>;

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

function Prose({ text }: { text: string }) {
  if (!text) return <EmptyNote>Not populated.</EmptyNote>;
  return (
    <div>
      {text.split(/\n+/).map((p, i) => (
        <p
          key={i}
          data-pdf-flow="true"
          style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: "0 0 10px 0" }}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK, fontStyle: "italic" }}>{children}</div>;
}

// The shared analytics block that sits BELOW the written brief for every country
// report (structured and generic). Map always leads, followed by the severity
// and incident-type charts, then the standalone Situational Context and Maritime
// Security reference layers. No counts in prose; charts carry their own tallies.
export default function CountryReportVisuals({
  windowIncidents,
  countryName,
  severityCounts,
  severityTotal,
  typeChartData,
  typeChartMax,
  situationalReports,
  maritimeSummary,
  activeIncidentCount,
  activeBasisLabel,
}: {
  windowIncidents: CountryFastFactsIncident[];
  countryName: string;
  severityCounts: Record<SeverityKey, number>;
  severityTotal: number;
  typeChartData: { label: string; n: number }[];
  typeChartMax: number;
  situationalReports: ReliefWebReport[] | undefined | null;
  maritimeSummary: MaritimeSummary;
  activeIncidentCount: number;
  activeBasisLabel: string;
}) {
  return (
    <>
      {/* Map leads the visuals for every country. */}
      <Section title="Map">
        <div>
          <CountryReportMap
            incidents={windowIncidents}
            domId="country-report-map"
            countryName={countryName}
          />
        </div>
        <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, fontStyle: "italic", marginTop: 6 }}>
          Where coordinates are available, the map plots incidents from the active reporting window (
          {activeIncidentCount} record{activeIncidentCount === 1 ? "" : "s"} in the {activeBasisLabel} window). If
          coordinates are unavailable, the map shows country operating context only.
        </div>
      </Section>

      {/* Severity Distribution */}
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

      {/* Maritime Security (ICC CCS / IMB standalone layer — never an incident,
          never added to any count). Hidden entirely when the coastal state has
          no reported activity in the current year. */}
      {maritimeSummary.total > 0 && (
        <Section title="Maritime Security">
          <Prose text={maritimeSummary.read} />
          <div className="flex flex-wrap gap-2" style={{ margin: "10px 0 12px" }}>
            {maritimeSummary.byType.map((t) => (
              <span
                key={t.type}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: ROBOTO,
                  fontSize: 11,
                  fontWeight: 600,
                  color: DUSK,
                  border: `1px solid ${POLAR}`,
                  borderRadius: 2,
                  padding: "3px 8px",
                  background: "#fff",
                }}
              >
                <span style={{ width: 10, height: 10, background: t.color, borderRadius: 2, display: "inline-block" }} />
                {t.type}: {t.count}
              </span>
            ))}
          </div>
          <div style={{ border: `1px solid ${POLAR}`, borderRadius: 2, overflow: "hidden", background: "#fff" }}>
            <div
              className="grid"
              style={{
                gridTemplateColumns: "120px 150px minmax(0, 1fr) 160px",
                background: NAVY,
                color: "#fff",
                fontFamily: ROBOTO,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              <div className="p-2.5">Date</div>
              <div className="p-2.5">Type</div>
              <div className="p-2.5">Location</div>
              <div className="p-2.5">Coastal State</div>
            </div>
            {maritimeSummary.rows.map((r) => (
              <div
                key={r.id}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "120px 150px minmax(0, 1fr) 160px",
                  borderTop: `1px solid ${POLAR}`,
                  fontFamily: ROBOTO,
                  fontSize: 12,
                  color: DUSK,
                }}
              >
                <div className="p-2.5" style={{ fontFamily: ROBOTO, fontSize: 11 }}>
                  {r.date ? format(r.date, "dd MMM yyyy") : "—"}
                </div>
                <div className="p-2.5" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      background: maritimeTypeColor(r.type),
                      borderRadius: 2,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  {r.type}
                </div>
                <div className="p-2.5" style={{ fontWeight: 500, color: NAVY }}>
                  {r.location ?? "—"}
                </div>
                <div className="p-2.5">{r.country ?? "—"}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: ROBOTO, fontSize: 10, color: DUSK, opacity: 0.7, marginTop: 6 }}>
            Source: {MARITIME_SECURITY_SOURCE_LABEL}. Standalone reference layer — not an incident and not included in
            any incident total.
          </div>
        </Section>
      )}
    </>
  );
}
