import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";

// Standalone, no-auth PREVIEW of the private Data Centre Registry admin page.
// Sample placeholder data only — the real page is owner-gated CRUD (Sign in
// with Replit) writing to the isolated data_centre_facilities table. A facility
// is never an incident.

const INK = "#0B0B3D";
const ACCENT = "#4655FF";
const FORE = "#303030";
const BORDER = "#E2E2E2";
const MUTED = "#6B7280";
const PETROL = "#1B6B7A";
const RED = "#A33232";
const font = { fontFamily: "Roboto, system-ui, sans-serif" };

const FACILITIES = [
  { id: 1, name: "Cyberjaya DC1", operator: "Bridge Data Centres", city: "Cyberjaya", country: "Malaysia", status: "Operational", planningRisk: "No known issue", capacityMw: 120, linked: null, moved: null },
  { id: 2, name: "Sedenak Hub SDC2", operator: "YTL Data Center", city: "Johor", country: "Malaysia", status: "Under construction", planningRisk: "Grid connection constraint", capacityMw: 300, linked: 812, moved: null },
  { id: 3, name: "Nongsa Digital Park", operator: "Nongsa DP", city: "Batam", country: "Indonesia", status: "Operational", planningRisk: "No known issue", capacityMw: 80, linked: null, moved: null },
  { id: 4, name: "Bekasi East Campus", operator: "DCI Indonesia", city: "Bekasi", country: "Indonesia", status: "Planning refused", planningRisk: "Water availability", capacityMw: 90, linked: 799, moved: "Planning submitted" },
  { id: 5, name: "Loyang STT SGP", operator: "ST Telemedia", city: "Singapore", country: "Singapore", status: "Operational", planningRisk: "Power availability cap", capacityMw: 60, linked: null, moved: null },
  { id: 6, name: "Aerotropolis West", operator: "AirTrunk", city: "Sydney", country: "Australia", status: "Approved", planningRisk: "Community opposition", capacityMw: 250, linked: null, moved: "Proposed" },
];

const STATUSES = ["Unknown", "Proposed", "Planning submitted", "Approved", "Under construction", "Operational", "Delayed", "Suspended", "Planning refused", "Cancelled"];
const RISKS = ["Unknown", "No known issue", "Grid connection constraint", "Power availability cap", "Water availability", "Community opposition", "Environmental review", "Permit refused"];

export default function DataCentreRegistryAdmin() {
  return (
    <div style={{ background: "#F7F7FA", minHeight: "100vh", padding: 24, ...font }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ background: "#EEF0FF", border: `1px solid ${ACCENT}55`, color: INK, fontSize: 12, padding: "6px 12px", borderRadius: 3 }}>
          Preview · sample data · the live page is private owner-gated CRUD (Sign in with Replit)
        </div>

        {/* Header */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: MUTED }}>Registry</div>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: -0.5, margin: "4px 0 0" }}>Data Centre Registry</h1>
            <p style={{ fontSize: 13, color: MUTED, marginTop: 4, maxWidth: 820 }}>
              Analyst-maintained catalogue of tracked data-centre facilities. A facility is never an
              incident — it lives in its own registry and can never inflate an incident count.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 16px", background: ACCENT, color: "#fff", borderRadius: 3, fontSize: 13, fontWeight: 500 }}>
            <Plus size={16} /> Add Facility
          </div>
        </div>

        {/* Summary tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Tile label="Facilities Tracked" value={6} accent={ACCENT} />
          <Tile label="Countries" value={3} accent={FORE} />
          <Tile label="Operational" value={3} accent={PETROL} />
          <Tile label="Recent Status Movers" value={2} accent={RED} />
        </div>

        {/* Open form (New Facility) */}
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 3, padding: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: -0.3, marginBottom: 16 }}>New Facility</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Name *" value="Sedenak Hub SDC3" />
            <Field label="Operator" value="YTL Data Center" />
            <Field label="Country *" value="Malaysia" />
            <Field label="Region" value="Johor" />
            <Field label="City" value="Sedenak" />
            <Select label="Status" value="Under construction" options={STATUSES} />
            <Select label="Planning Risk" value="Grid connection constraint" options={RISKS} />
            <Field label="Latitude" value="1.5500" />
            <Field label="Longitude" value="103.5000" />
            <Field label="Capacity (MW)" value="300" />
            <Field label="IT Load (MW)" value="180" />
            <Field label="Linked Incident ID" value="" placeholder="optional" />
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <div style={{ height: 36, padding: "0 20px", background: ACCENT, color: "#fff", borderRadius: 3, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center" }}>Create Facility</div>
            <div style={{ height: 36, padding: "0 20px", border: `1px solid ${BORDER}`, borderRadius: 3, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", background: "#fff" }}>Cancel</div>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: 1 }}>Tracked Facilities</h2>
          </div>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                <th style={{ padding: "8px 16px", fontWeight: 500 }}>Facility</th>
                <th style={{ padding: "8px 16px", fontWeight: 500 }}>Country</th>
                <th style={{ padding: "8px 16px", fontWeight: 500 }}>Status</th>
                <th style={{ padding: "8px 16px", fontWeight: 500 }}>Planning Risk</th>
                <th style={{ padding: "8px 16px", fontWeight: 500 }}>Capacity</th>
                <th style={{ padding: "8px 16px", fontWeight: 500 }}>Linked</th>
                <th style={{ padding: "8px 16px", fontWeight: 500, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {FACILITIES.map((f) => (
                <tr key={f.id} style={{ borderBottom: `1px solid ${BORDER}99` }}>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ fontWeight: 600, color: FORE }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: MUTED }}>{f.operator} · {f.city}</div>
                  </td>
                  <td style={{ padding: "10px 16px", color: FORE }}>{f.country}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ color: FORE }}>{f.status}</span>
                    {f.moved && <div style={{ fontSize: 10, color: RED, textTransform: "uppercase", letterSpacing: 0.5 }}>moved from {f.moved}</div>}
                  </td>
                  <td style={{ padding: "10px 16px", color: FORE }}>{f.planningRisk}</td>
                  <td style={{ padding: "10px 16px", color: FORE }}>{f.capacityMw} MW</td>
                  <td style={{ padding: "10px 16px", color: FORE }}>{f.linked != null ? `#${f.linked}` : "—"}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, color: MUTED }}>
                      <ExternalLink size={16} /><Pencil size={16} /><Trash2 size={16} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderLeft: `3px solid ${accent}`, borderRadius: 3, padding: 16 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Field({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED, marginBottom: 4 }}>{label}</div>
      <div style={{ height: 36, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "0 10px", fontSize: 13, display: "flex", alignItems: "center", color: value ? FORE : "#9AA0AB", background: "#fff" }}>
        {value || placeholder}
      </div>
    </label>
  );
}
function Select({ label, value }: { label: string; value: string; options: string[] }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: MUTED, marginBottom: 4 }}>{label}</div>
      <div style={{ height: 36, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "0 10px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", color: FORE, background: "#fff" }}>
        {value}<span style={{ color: MUTED }}>▾</span>
      </div>
    </label>
  );
}
