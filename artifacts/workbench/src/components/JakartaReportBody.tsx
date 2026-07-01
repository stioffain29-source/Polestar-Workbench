import { type ReactNode } from "react";
import type { PngReportDataset } from "@/lib/pngReportDataset";
import type {
  JakartaTableRow,
  JakartaPriorityAreaRow,
  JakartaPortLogisticsRow,
  JakartaStaffMovementImpact,
  JakartaRoleAction,
  JakartaCrimeBusinessRow,
} from "@/lib/jakartaBrief";

// Jakarta-only TACTICAL OPERATING BRIEF body. A dedicated renderer so the Jakarta
// city report can carry its own 14-section tactical structure (ranked Priority
// Areas table, broken-out Staff Movement, a 4-column Port & Logistics table,
// role-based Recommended Actions, …) WITHOUT touching the shared
// PngCountryReportBody used by PNG / West Papua / Indonesia / every generic
// country. The small render primitives below are intentionally duplicated from
// PngCountryReportBody (brand consts, Section, Prose, EmptyNote, BulletList) so
// this component has zero blast radius on the shared renderer. All prose is
// count-free; brand spec exactly. Section order MUST stay in lockstep with the
// PDF (renderJakartaBrief) and the audit gate (auditJakartaPdf CANONICAL_SECTIONS).

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const ROBOTO = "Roboto, sans-serif";

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

const baseCell: React.CSSProperties = {
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

const baseHeadCell: React.CSSProperties = {
  ...baseCell,
  background: NAVY,
  color: "#fff",
  fontWeight: 700,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

// The ranked Priority Areas table (Priority | Area | Driver | Business impact |
// Action). The ranking is data-driven; an area that carried live reporting this
// period is flagged in-cell ("(active this week)") so the row reads as live.
function PriorityTable({ rows }: { rows: JakartaPriorityAreaRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...baseHeadCell, width: "9%", textAlign: "center" }}>#</th>
          <th style={{ ...baseHeadCell, width: "23%" }}>Area</th>
          <th style={{ ...baseHeadCell, width: "17%" }}>Driver</th>
          <th style={{ ...baseHeadCell, width: "29%" }}>Business impact</th>
          <th style={{ ...baseHeadCell, width: "22%" }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...baseCell, fontWeight: 700, color: NAVY, textAlign: "center" }}>{r.priority}</td>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>
              {r.elevated ? `${r.area} (active this week)` : r.area}
            </td>
            <td style={baseCell}>{r.driver}</td>
            <td style={baseCell}>{r.businessImpact}</td>
            <td style={baseCell}>{r.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The 4-column Port and Logistics table (Area | Operational relevance | Possible
// impact | Required action).
function PortTable({ rows }: { rows: JakartaPortLogisticsRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...baseHeadCell, width: "22%" }}>Area</th>
          <th style={{ ...baseHeadCell, width: "24%" }}>Operational relevance</th>
          <th style={{ ...baseHeadCell, width: "27%" }}>Possible impact</th>
          <th style={{ ...baseHeadCell, width: "27%" }}>Required action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>{r.area}</td>
            <td style={baseCell}>{r.operationalRelevance}</td>
            <td style={baseCell}>{r.possibleImpact}</td>
            <td style={baseCell}>{r.requiredAction}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A standing exposure table (Area | Why it matters | Action). A real semantic
// <table> so the DOM-rasterise PDF treats it as one break candidate.
function OpsTable({ rows }: { rows: JakartaTableRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...baseHeadCell, width: "24%" }}>Area</th>
          <th style={{ ...baseHeadCell, width: "42%" }}>Why it matters</th>
          <th style={{ ...baseHeadCell, width: "34%" }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>{r.area}</td>
            <td style={baseCell}>{r.why}</td>
            <td style={baseCell}>{r.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The standing Crime business-impact table (Crime pattern | Business impact |
// Precaution). Durable analyst guidance, not this period's findings.
function CrimeTable({ rows }: { rows: JakartaCrimeBusinessRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...baseHeadCell, width: "26%" }}>Crime pattern</th>
          <th style={{ ...baseHeadCell, width: "42%" }}>Business impact</th>
          <th style={{ ...baseHeadCell, width: "32%" }}>Precaution</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>{r.pattern}</td>
            <td style={baseCell}>{r.businessImpact}</td>
            <td style={baseCell}>{r.precaution}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Movement-type label order for the Staff Movement Impact section (spec §5).
const STAFF_MOVEMENT_FIELDS: Array<{ label: string; key: keyof JakartaStaffMovementImpact }> = [
  { label: "Office access", key: "officeAccess" },
  { label: "Hotel to office movement", key: "hotelToOffice" },
  { label: "Airport transfer", key: "airportTransfer" },
  { label: "Client meeting movement", key: "clientMeeting" },
  { label: "Staff commute", key: "staffCommute" },
  { label: "Driver route planning", key: "driverRoute" },
  { label: "After hours movement", key: "afterHours" },
];

// A labelled prose block, reused by Staff Movement and role-based Recommended
// Actions: a bold ELECTRIC label, then the named-location guidance beneath it.
function LabelledBlock({ label, text }: { label: string; text: string }) {
  return (
    <div data-pdf-row="true" style={{ marginBottom: 12 }}>
      <div
        style={{
          fontFamily: ROBOTO,
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: ELECTRIC,
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <p style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: 0 }}>{text}</p>
    </div>
  );
}

// The Jakarta tactical operating brief body. Renders the canonical 14-section
// Jakarta order; the page appends its analytics block and the Disclaimer below.
// The corridor map is injected at §14 via mapNode (the page no longer renders it
// at the end of the analytics block for Jakarta).
export default function JakartaReportBody({
  dataset,
  mapNode = null,
}: {
  dataset: PngReportDataset;
  mapNode?: ReactNode;
}) {
  const d = dataset;
  const escalationIndicators = d.escalationIndicators;
  // The tactical sections always have content (standing tables + raise-not-invent
  // live leads); fall back defensively to an empty note if the field is somehow
  // absent (e.g. a stale cached dataset).
  const tactical = d.jakartaTacticalBrief;

  return (
    <>
      {/* 1. Bottom Line Up Front */}
      <Section title="Bottom Line Up Front">
        <Prose text={d.bluf} />
      </Section>

      {/* 2. Tactical Operating Picture */}
      <Section title="Tactical Operating Picture">
        <Prose text={d.executiveSummary} />
      </Section>

      {/* 3. Crime Trends and Business Impact — dedicated crime section */}
      <Section title="Crime Trends and Business Impact">
        {tactical ? (
          <>
            <Prose text={tactical.crimeTrends.reportedThisPeriod} />
            <Prose text={tactical.crimeTrends.standingPattern} />
            <Prose text={tactical.crimeTrends.trendRead} />
            <CrimeTable rows={tactical.crimeTrends.businessImpact} />
          </>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
        )}
      </Section>

      {/* 4. Priority Areas This Week — ranked, data-driven table */}
      <Section title="Priority Areas This Week">
        {tactical ? <PriorityTable rows={tactical.priorityAreas} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>

      {/* 5. Staff Movement Impact — broken out by movement type */}
      <Section title="Staff Movement Impact">
        {tactical ? (
          <div>
            {STAFF_MOVEMENT_FIELDS.map((f) => (
              <LabelledBlock key={f.key} label={f.label} text={tactical.staffMovement[f.key]} />
            ))}
          </div>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
        )}
      </Section>

      {/* 5. Airport Transfer Impact */}
      <Section title="Airport Transfer Impact">
        {tactical ? <Prose text={tactical.airportTransfer} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>

      {/* 6. Port and Logistics Impact — 4-column table + port actions */}
      <Section title="Port and Logistics Impact">
        {tactical ? (
          <>
            <Prose text={tactical.portLogistics.intro} />
            <PortTable rows={tactical.portLogistics.rows} />
            <StrandLabel>Port Actions</StrandLabel>
            <BulletList items={tactical.portLogistics.actions} />
          </>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
        )}
      </Section>

      {/* 7. Office, Hotel and Meeting Venue Exposure (intro + standing table) */}
      <Section title="Office, Hotel and Meeting Venue Exposure">
        {tactical ? (
          <>
            <Prose text={tactical.officeHotelVenue.intro} />
            <OpsTable rows={tactical.officeHotelVenue.rows} />
          </>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
        )}
      </Section>

      {/* 8. Route and Timing Guidance */}
      <Section title="Route and Timing Guidance">
        {tactical ? <BulletList items={tactical.routeTiming} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>

      {/* 9. Escalation Triggers — a decision tool */}
      <Section title="Escalation Triggers">
        {escalationIndicators.length === 0 ? (
          <EmptyNote>No specific escalation triggers flagged this period.</EmptyNote>
        ) : (
          <BulletList items={escalationIndicators} />
        )}
      </Section>

      {/* 10. Recommended Actions — role based */}
      <Section title="Recommended Actions">
        {tactical && tactical.roleActions.length > 0 ? (
          <div>
            {tactical.roleActions.map((a: JakartaRoleAction, i) => (
              <LabelledBlock key={i} label={a.role} text={a.guidance} />
            ))}
          </div>
        ) : (
          <EmptyNote>Not populated.</EmptyNote>
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

      {/* 13. Operational Map */}
      <Section title="Operational Map">
        {mapNode ? <div style={{ marginBottom: 12 }}>{mapNode}</div> : null}
        {tactical ? <Prose text={tactical.areaSummary} /> : <EmptyNote>Not populated.</EmptyNote>}
      </Section>
    </>
  );
}
