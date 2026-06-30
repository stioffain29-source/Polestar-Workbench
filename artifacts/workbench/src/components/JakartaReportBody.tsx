import { type ReactNode } from "react";
import { format } from "date-fns";
import type { PngReportDataset, PngReportItem } from "@/lib/pngReportDataset";
import type { JakartaTableRow } from "@/lib/jakartaBrief";

// Jakarta-only TACTICAL OPERATING BRIEF body. A dedicated renderer so the Jakarta
// city report can carry its own 13-section structure (Movement & Access Impact,
// Business District / Port exposure tables, Route & Timing guidance, Escalation
// Indicators as their own section, …) WITHOUT touching the shared
// PngCountryReportBody used by PNG / West Papua / Indonesia / every generic
// country. The small render primitives below are intentionally duplicated from
// PngCountryReportBody (brand consts, Section, Prose, EmptyNote, SeverityChip,
// the flashpoint card, BulletList) so this component has zero blast radius on the
// shared renderer; the duplication mirrors the codebase's existing per-surface
// brand-const duplication. All prose is count-free; brand spec exactly.

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const ROBOTO = "Roboto, sans-serif";

const SEV_COLOR: Record<string, string> = {
  extreme: "#A33232",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#1B6B7A",
};

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

function Prose({ text, keepTogether }: { text: string; keepTogether?: boolean }) {
  if (!text) return <EmptyNote>Not populated.</EmptyNote>;
  return (
    <div>
      {text.split(/\n+/).map((p, i) => (
        <p
          key={i}
          {...(keepTogether ? {} : { "data-pdf-flow": "true" })}
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

// Severity pill. The data-sev-* attributes are read by the PDF exporter, which
// swaps the chip for a pixel-centred <canvas> at export time — keep them byte
// identical to the shared renderer's chip.
function SeverityChip({ item }: { item: PngReportItem }) {
  const color = SEV_COLOR[item.severity] ?? "#999";
  return (
    <span
      data-sev-chip="true"
      data-sev-label={item.severityLabel}
      data-sev-color={color}
      data-sev-height="22"
      data-sev-min-width="72"
      data-sev-pad-x="10"
      style={{
        background: color,
        color: "#fff",
        padding: "0 10px",
        minWidth: 72,
        height: 22,
        lineHeight: 1,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        borderRadius: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {item.severityLabel}
    </span>
  );
}

function dateLine(item: PngReportItem): string {
  const reported = format(item.reportedDate, "dd MMM yyyy");
  if (item.occurredEarlier && item.incidentDate) {
    return `Occurred ${format(item.incidentDate, "dd MMM")} · reported ${reported}`;
  }
  return `Reported ${reported}`;
}

// One "Key Flashpoint" card. Self-contained (no IncidentSummaryContext): the
// Jakarta brief renders the deterministic operational-impact line, never an AI
// per-incident summary.
function FlashpointCard({ item }: { item: PngReportItem }) {
  const color = SEV_COLOR[item.severity] ?? ELECTRIC;
  return (
    <div
      data-pdf-row="true"
      style={{
        border: `1px solid ${POLAR}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 2,
        background: "#fff",
        padding: "12px 14px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            fontFamily: ROBOTO,
            fontSize: 14,
            fontWeight: 600,
            color: NAVY,
            lineHeight: "22px",
          }}
        >
          {item.developmentTitle ?? item.title}
        </div>
        <div style={{ flexShrink: 0 }}>
          <SeverityChip item={item} />
        </div>
      </div>
      <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 6, letterSpacing: "0.02em", textAlign: "left" }}>
        {[item.displayCategory, dateLine(item)].filter(Boolean).join("  ·  ")}
        {item.source ? `  ·  ${item.source}` : ""}
      </div>
      <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, marginTop: 6, lineHeight: 1.5, textAlign: "left" }}>
        {item.businessImpact}
      </div>
    </div>
  );
}

// Theme sub-heading (ELECTRIC, used above the port-action list).
function StrandLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: ROBOTO,
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: ELECTRIC,
        fontWeight: 700,
        margin: "16px 0 8px 0",
      }}
    >
      {children}
    </div>
  );
}

// A plain count-free bullet list. data-pdf-flow lets the DOM-rasterise PDF break
// it at the line level rather than pushing the whole block to a new page.
function BulletList({ items }: { items: string[] }) {
  return (
    <ul
      data-pdf-flow="true"
      style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: 0, paddingLeft: 18 }}
    >
      {items.map((line, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          {line}
        </li>
      ))}
    </ul>
  );
}

// A standing exposure table (Area | Why it matters | Action). A real semantic
// <table> so the DOM-rasterise PDF treats it as one break candidate (it breaks
// BEFORE the table, never mid-header) — these tables are short, so atomic is
// correct. Flat colours only (no gradient/shadow/blur), brand palette exactly.
function OpsTable({ rows }: { rows: JakartaTableRow[] }) {
  const cell: React.CSSProperties = {
    fontFamily: ROBOTO,
    fontSize: 12,
    lineHeight: 1.5,
    color: DUSK,
    padding: "8px 10px",
    textAlign: "left",
    verticalAlign: "top",
    border: `1px solid ${POLAR}`,
    boxSizing: "border-box",
  };
  const headCell: React.CSSProperties = {
    ...cell,
    background: NAVY,
    color: "#fff",
    fontWeight: 700,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        marginTop: 4,
      }}
    >
      <thead>
        <tr>
          <th style={{ ...headCell, width: "24%" }}>Area</th>
          <th style={{ ...headCell, width: "42%" }}>Why it matters</th>
          <th style={{ ...headCell, width: "34%" }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...cell, fontWeight: 600, color: NAVY }}>{r.area}</td>
            <td style={cell}>{r.why}</td>
            <td style={cell}>{r.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The Jakarta tactical operating brief body. Renders the 13-section Jakarta-only
// order; the page appends its analytics block and the Disclaimer below. The
// corridor map is injected at §13 via mapNode (the page no longer renders it at
// the end of the analytics block for Jakarta).
export default function JakartaReportBody({
  dataset,
  mapNode = null,
}: {
  dataset: PngReportDataset;
  mapNode?: ReactNode;
}) {
  const d = dataset;
  const topThree = d.topThree.slice(0, 3);
  const escalationIndicators = d.escalationIndicators;
  // The tactical sections always have content (standing tables + raise-not-invent
  // live leads); fall back defensively to a standing-only brief if the field is
  // somehow absent (e.g. a stale cached dataset).
  const tactical = d.jakartaTacticalBrief;

  return (
    <>
      {/* 1. Bottom Line Up Front */}
      <Section title="Bottom Line Up Front">
        <Prose text={d.bluf} />
      </Section>

      {/* 2. Operating Picture */}
      <Section title="Operating Picture">
        <Prose text={d.executiveSummary} />
      </Section>

      {/* 3. Key Flashpoints This Week — at most three cards */}
      <Section title="Key Flashpoints This Week">
        {topThree.length === 0 ? (
          <EmptyNote>{d.emptyLocationFallback}</EmptyNote>
        ) : (
          <div>
            {topThree.map((it) => (
              <FlashpointCard key={it.id} item={it} />
            ))}
          </div>
        )}
      </Section>

      {/* 4. Movement and Access Impact */}
      <Section title="Movement and Access Impact">
        {tactical ? <BulletList items={tactical.movementAccess} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>

      {/* 5. Business District Exposure (intro + standing table) */}
      <Section title="Business District Exposure">
        {tactical ? (
          <>
            <Prose text={tactical.businessDistrict.intro} />
            <OpsTable rows={tactical.businessDistrict.rows} />
          </>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
        )}
      </Section>

      {/* 6. Port and Logistics Implications (intro + table + port actions) */}
      <Section title="Port and Logistics Implications">
        {tactical ? (
          <>
            <Prose text={tactical.portLogistics.intro} />
            <OpsTable rows={tactical.portLogistics.rows} />
            <StrandLabel>Port Actions</StrandLabel>
            <BulletList items={tactical.portLogistics.actions} />
          </>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
        )}
      </Section>

      {/* 7. Airport, Hotel and Office Implications */}
      <Section title="Airport, Hotel and Office Implications">
        {tactical ? <Prose text={tactical.airportHotelOffice} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>

      {/* 8. Route and Timing Guidance */}
      <Section title="Route and Timing Guidance">
        {tactical ? <BulletList items={tactical.routeTiming} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>

      {/* 9. Recommended Actions — Jakarta's flat operating-risk priorities list */}
      <Section title="Recommended Actions">
        {d.businessImpact.length === 0 ? (
          <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
        ) : (
          <BulletList items={d.businessImpact} />
        )}
      </Section>

      {/* 10. Escalation Indicators — its own section in the tactical layout */}
      <Section title="Escalation Indicators">
        {escalationIndicators.length === 0 ? (
          <EmptyNote>No specific escalation indicators flagged this period.</EmptyNote>
        ) : (
          <BulletList items={escalationIndicators} />
        )}
      </Section>

      {/* 11. Seven Day Outlook */}
      <Section title="Seven Day Outlook">
        <Prose text={d.outlook} />
      </Section>

      {/* 12. Polestar View — closes the written brief */}
      <Section title="Polestar View">
        <Prose text={d.polestarView} keepTogether={d.keepPolestarTogether} />
      </Section>

      {/* 13. Map and Area Summary */}
      <Section title="Map and Area Summary">
        {mapNode ? <div style={{ marginBottom: 12 }}>{mapNode}</div> : null}
        {tactical ? <Prose text={tactical.areaSummary} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>
    </>
  );
}
