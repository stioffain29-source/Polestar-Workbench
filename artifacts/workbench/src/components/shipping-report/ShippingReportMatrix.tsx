import { format } from "date-fns";
import type { ShippingSevenPageMatrixRow } from "@/lib/shippingSevenPagePresentation";

const columns = "1.3fr .8fr .45fr 1.15fr .65fr";
export function ShippingReportMatrix({ rows }: { rows: ShippingSevenPageMatrixRow[] }) {
  return <div style={{ color: "#363636", fontFamily: "Roboto, sans-serif" }}>
    <div style={{ display: "grid", gridTemplateColumns: columns, gap: 12, borderBottom: "2px solid #0b0a3d", padding: "10px 0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
      {["Chokepoint name", "Risk level", "Incidents", "Movement", "Latest incident"].map(label => <div key={label}>{label}</div>)}
    </div>
    {rows.map(row => <div key={row.key} style={{ borderBottom: "1px solid #e2e2e2", padding: "18px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: columns, gap: 12, alignItems: "start", fontSize: 12, lineHeight: 1.45 }}>
        <strong style={{ color: "#0b0a3d", textTransform: "uppercase" }}>{row.key}</strong>
        <span style={{ color: row.risk.pending ? "#363636" : "#465bff", fontWeight: 500 }}>{row.risk.pending ? "Pending" : row.risk.label}</span>
        <strong style={{ color: "#0b0a3d" }}>{row.incidents}</strong>
        <div>{row.movement
          ? <><span>{row.movement.totalVessels == null ? "Sample size unavailable" : `${row.movement.totalVessels} vessels tracked`}</span><div style={{ fontSize: 10, marginTop: 3 }}>{format(new Date(row.movement.dataAsOf), "dd MMM yyyy")}</div></>
          : <span style={{ fontWeight: 300 }}>No AIS sample</span>}</div>
        <span>{row.latestIncident ? format(row.latestIncident.date, "dd MMM") : "—"}</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, fontWeight: 300 }}>
        <strong style={{ fontWeight: 500 }}>Operational impact: </strong>{row.operationalRead}
      </div>
    </div>)}
    <p style={{ fontSize: 10, lineHeight: 1.5, marginTop: 14 }}>Movement figures are dated AIS samples, not total traffic. Missing samples are not zero vessels.</p>
  </div>;
}