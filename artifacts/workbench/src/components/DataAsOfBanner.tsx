import { format } from "date-fns";
import type { DataAsOf } from "@/lib/reportDataStatus";

const NAVY = "#0b0a3d";
const DUSK = "#363636";
const POLAR = "#e2e2e2";

function fmt(d: Date | null): string {
  return d ? format(d, "d MMM yyyy") : "no records";
}

/**
 * "Data as of" provenance strip. Rendered at the top of every report body
 * (inside `.print-report`) so it appears identically on screen and in the
 * rasterised PDF. States the ingestion mode, the newest event date, and
 * the last database write for this topic so a reader can immediately judge
 * how current the report is. Brand only: Polar Gray field, Navy labels,
 * Dusk values, Roboto, no shadow/gradient.
 */
export default function DataAsOfBanner({ data }: { data: DataAsOf }) {
  const items: [string, string][] = [
    ["Data status", data.modeLabel],
    ["Latest record", fmt(data.latestRecord)],
    ["Last updated", fmt(data.lastUpdated)],
  ];
  return (
    <div
      className="uppercase"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 28px",
        border: `1px solid ${POLAR}`,
        background: "#f5f5f7",
        padding: "8px 14px",
        marginBottom: 22,
        fontFamily: "Roboto, sans-serif",
        fontSize: 10,
        letterSpacing: "0.12em",
      }}
    >
      {items.map(([label, value]) => (
        <div key={label} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ color: NAVY, fontWeight: 700 }}>{label}:</span>
          <span style={{ color: DUSK, fontWeight: 400 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
