import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, LabelList,
} from "recharts";
import { ExternalLink, Server, MapPin } from "lucide-react";

// Standalone, no-auth PREVIEW of the private Data Centres topic monitor.
// Sample placeholder data only — the real page reads live incidents + the
// analyst facility registry behind Replit-Auth. Leaflet maps are represented
// by static panels here (the sandbox has no leaflet).

const INK = "#0B0B3D";
const ACCENT = "#4655FF";
const FORE = "#303030";
const BORDER = "#E2E2E2";
const MUTED = "#6B7280";
const PETROL = "#1B6B7A";
const RED = "#A33232";

const RATING_COLORS: Record<string, string> = {
  extreme: "#800000",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#1B6B7A",
};
const SEVERITY_LABELS: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};
const STATUS_COLOR: Record<string, string> = {
  Operational: PETROL, "Under construction": ACCENT, Approved: ACCENT,
  Proposed: FORE, "Planning refused": RED, Suspended: RED, Cancelled: RED,
};
function statusColor(s: string): string { return STATUS_COLOR[s] ?? "#8A94A6"; }
function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const FILL = 0.78;
const SW = 1.5;

const INCIDENTS = [
  { id: 1, date: "28 Jun 2026", country: "Singapore", headline: "Cooling failure forces hyperscale data centre offline in Jurong", severity: "high" },
  { id: 2, date: "20 Jun 2026", country: "Malaysia", headline: "Johor data centre build paused over grid-connection delay", severity: "moderate" },
  { id: 3, date: "12 Jun 2026", country: "Australia", headline: "Residents mount community opposition to Western Sydney data centre", severity: "low" },
  { id: 4, date: "30 May 2026", country: "Indonesia", headline: "Council refuses planning for Bekasi data centre over water use", severity: "moderate" },
  { id: 5, date: "18 May 2026", country: "Ireland", headline: "Dublin data centre moratorium extended amid grid strain", severity: "moderate" },
  { id: 6, date: "02 May 2026", country: "United States", headline: "Power outage disrupts Virginia colocation facility", severity: "high" },
];

const FACILITIES = [
  { id: 1, name: "Cyberjaya DC1", operator: "Bridge Data Centres", city: "Cyberjaya", country: "Malaysia", status: "Operational", planningRisk: "No known issue", lat: 2.92, lng: 101.65 },
  { id: 2, name: "Sedenak Hub SDC2", operator: "YTL Data Center", city: "Johor", country: "Malaysia", status: "Under construction", planningRisk: "Grid connection constraint", lat: 1.55, lng: 103.5 },
  { id: 3, name: "Nongsa Digital Park", operator: "Nongsa DP", city: "Batam", country: "Indonesia", status: "Operational", planningRisk: "No known issue", lat: 1.18, lng: 104.1 },
  { id: 4, name: "Bekasi East Campus", operator: "DCI Indonesia", city: "Bekasi", country: "Indonesia", status: "Planning refused", planningRisk: "Water availability", lat: -6.24, lng: 107.0 },
  { id: 5, name: "Loyang STT SGP", operator: "ST Telemedia", city: "Singapore", country: "Singapore", status: "Operational", planningRisk: "Power availability cap", lat: 1.37, lng: 103.98 },
  { id: 6, name: "Aerotropolis West", operator: "AirTrunk", city: "Sydney", country: "Australia", status: "Approved", planningRisk: "Community opposition", lat: -33.88, lng: 150.75 },
];

const facByStatus = [
  { label: "Operational", value: 3 },
  { label: "Under construction", value: 1 },
  { label: "Approved", value: 1 },
  { label: "Planning refused", value: 1 },
];
const facByRisk = [
  { label: "Grid connection constraint", value: 1 },
  { label: "Water availability", value: 1 },
  { label: "Power availability cap", value: 1 },
  { label: "Community opposition", value: 1 },
];
const bySeverity = ["insignificant", "low", "moderate", "high", "extreme"].map((s) => ({
  severity: s, label: SEVERITY_LABELS[s],
  count: INCIDENTS.filter((i) => i.severity === s).length,
}));
const byCountry = [
  { country: "Singapore", count: 1 }, { country: "Malaysia", count: 1 },
  { country: "Australia", count: 1 }, { country: "Indonesia", count: 1 },
  { country: "Ireland", count: 1 }, { country: "United States", count: 1 },
];

const font = { fontFamily: "Roboto, system-ui, sans-serif" };

export default function DataCentresMonitor() {
  return (
    <div style={{ background: "#F7F7FA", minHeight: "100vh", padding: 24, ...font }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <PreviewBadge label="Preview · sample data · the live page is private (Sign in with Replit)" />

        {/* Header */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: MUTED }}>Topic Monitor</div>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: -0.5, margin: "4px 0 0" }}>Data Centres</h1>
            <p style={{ fontSize: 13, color: MUTED, marginTop: 4, maxWidth: 820 }}>
              Data-centre build-out, planning, power/water constraint and operational-risk monitor.
              The incident feed and the analyst facility registry are kept strictly separate — a
              tracked facility is never an incident.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 16px", border: `1px solid ${BORDER}`, borderRadius: 3, fontSize: 13, fontWeight: 500, background: "#fff" }}>
              <Server size={16} /> Manage Registry
            </div>
            <div style={{ display: "flex", border: `1px solid ${BORDER}`, borderRadius: 3, overflow: "hidden", fontSize: 12, background: "#fff" }}>
              {["30d", "90d", "1y", "2y"].map((r) => (
                <div key={r} style={{ padding: "8px 12px", background: r === "2y" ? INK : "#fff", color: r === "2y" ? "#fff" : FORE }}>{r}</div>
              ))}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <Kpi label="Incidents (Last 2 Years)" value={6} accent={ACCENT} />
          <Kpi label="Critical (Last 2 Years)" value={2} accent="#C0392B" />
          <Kpi label="Total Recorded" value={6} accent={INK} />
          <Kpi label="Countries Affected" value={6} accent={FORE} />
          <Kpi label="Facilities Tracked" value={6} accent={PETROL} />
        </div>

        {/* Registry summary */}
        <Section title="Facility Registry">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Fact label="Facilities Tracked" value="6" note="Across 4 countries." accent={ACCENT} />
            <Fact label="Operational" value="3" note="Facilities recorded as operational." accent={PETROL} />
            <Fact label="Planning-Risk Flags" value="4" note="Facilities carrying a known planning or build-out risk." accent="#E67E22" />
            <Fact label="Recent Status Movers" value="2" note="Facilities whose status recently changed." accent={RED} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <ChartCard title="Facilities by Status">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={facByStatus} margin={{ top: 16, left: 8, right: 16, bottom: 60 }}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: BORDER }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={80} />
                  <YAxis tickLine={false} axisLine={{ stroke: BORDER }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: INK, border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="value" fillOpacity={FILL} strokeWidth={SW}>
                    {facByStatus.map((d) => { const c = statusColor(d.label); return <Cell key={d.label} fill={c} stroke={darken(c)} />; })}
                    <LabelList dataKey="value" position="top" fontSize={12} fontWeight={700} fill={FORE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Facilities by Planning Risk">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={facByRisk} margin={{ top: 16, left: 8, right: 16, bottom: 60 }}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: BORDER }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={80} />
                  <YAxis tickLine={false} axisLine={{ stroke: BORDER }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: INK, border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="value" fill="#E67E22" stroke={darken("#E67E22")} strokeWidth={SW} fillOpacity={FILL}>
                    <LabelList dataKey="value" position="top" fontSize={12} fontWeight={700} fill={FORE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </Section>

        {/* Geography */}
        <Section title="Geography">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Panel header="Incident Density by Country (Last 2 Years)">
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {byCountry.map((c) => (
                  <div key={c.country} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 110, fontSize: 12, color: FORE }}>{c.country}</div>
                    <div style={{ flex: 1, height: 14, background: "#EEF0FF", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${c.count * 60}%`, maxWidth: "100%", height: "100%", background: ACCENT, opacity: FILL }} />
                    </div>
                    <div style={{ width: 20, textAlign: "right", fontSize: 12, fontWeight: 700, color: FORE }}>{c.count}</div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>World choropleth in the live app; simplified here.</div>
              </div>
            </Panel>
            <Panel header="Tracked Facilities Map">
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {FACILITIES.map((f) => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                    <MapPin size={14} style={{ color: statusColor(f.status) }} fill={statusColor(f.status)} />
                    <div style={{ flex: 1, color: FORE }}><strong>{f.name}</strong> · {f.city}, {f.country}</div>
                    <StatusPill status={f.status} />
                  </div>
                ))}
                <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Interactive Leaflet pin map in the live app.</div>
              </div>
            </Panel>
          </div>
        </Section>

        {/* Incident charts */}
        <Section title="Incident Charts">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ChartCard title="Severity Distribution">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySeverity} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: BORDER }} fontSize={11} />
                  <YAxis tickLine={false} axisLine={{ stroke: BORDER }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: INK, border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fillOpacity={FILL} strokeWidth={SW}>
                    {bySeverity.map((d) => { const c = RATING_COLORS[d.severity]; return <Cell key={d.severity} fill={c} stroke={darken(c)} />; })}
                    <LabelList dataKey="count" position="top" fontSize={13} fontWeight={700} fill={FORE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Top Countries by Incident Count">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCountry} margin={{ top: 16, left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: BORDER }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: BORDER }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: INK, border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill={ACCENT} stroke={darken(ACCENT)} strokeWidth={SW} fillOpacity={FILL}>
                    <LabelList dataKey="count" position="top" fontSize={12} fontWeight={700} fill={FORE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </Section>

        {/* Incident table */}
        <Section title="Incidents">
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 3, overflow: "hidden" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                  <th style={{ padding: "8px 16px", fontWeight: 500 }}>Date</th>
                  <th style={{ padding: "8px 16px", fontWeight: 500 }}>Country</th>
                  <th style={{ padding: "8px 16px", fontWeight: 500 }}>Headline</th>
                  <th style={{ padding: "8px 16px", fontWeight: 500 }}>Severity</th>
                  <th style={{ padding: "8px 16px", fontWeight: 500 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {INCIDENTS.map((i) => (
                  <tr key={i.id} style={{ borderBottom: `1px solid ${BORDER}99` }}>
                    <td style={{ padding: "10px 16px", color: MUTED, whiteSpace: "nowrap" }}>{i.date}</td>
                    <td style={{ padding: "10px 16px", color: FORE, whiteSpace: "nowrap" }}>{i.country}</td>
                    <td style={{ padding: "10px 16px", color: FORE }}>{i.headline}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ padding: "2px 8px", fontSize: 11, borderRadius: 3, background: RATING_COLORS[i.severity], color: "#fff" }}>
                        {SEVERITY_LABELS[i.severity]}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ color: ACCENT, display: "inline-flex", alignItems: "center", gap: 4 }}>Open <ExternalLink size={14} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}

function PreviewBadge({ label }: { label: string }) {
  return (
    <div style={{ background: "#EEF0FF", border: `1px solid ${ACCENT}55`, color: INK, fontSize: 12, padding: "6px 12px", borderRadius: 3 }}>{label}</div>
  );
}
function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderLeft: `3px solid ${accent}`, borderRadius: 3, padding: 16 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Fact({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderLeft: `3px solid ${accent}`, borderRadius: 3, padding: 16 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: INK, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{note}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ fontSize: 14, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 3, padding: 16 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED, marginBottom: 12 }}>{title}</div>
      <div style={{ height: 280 }}>{children}</div>
    </div>
  );
}
function Panel({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 3, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BORDER}`, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED }}>{header}</div>
      {children}
    </div>
  );
}
function StatusPill({ status }: { status: string }) {
  const c = statusColor(status);
  return <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: c, border: `1px solid ${c}`, borderRadius: 3, padding: "1px 6px" }}>{status}</span>;
}
