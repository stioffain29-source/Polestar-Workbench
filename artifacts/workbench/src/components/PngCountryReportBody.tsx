import { createContext, useContext, type ReactNode } from "react";
import { format } from "date-fns";
import { upcomingSignalLine } from "../lib/upcomingSignals";
import type {
  PngReportDataset,
  PngReportItem,
} from "@/lib/pngReportDataset";
import type {
  JakartaTableRow,
  JakartaPriorityAreaRow,
  JakartaPortLogisticsRow,
  JakartaStaffMovementImpact,
  JakartaRoleAction,
  JakartaCrimeBusinessRow,
} from "@/lib/jakartaBrief";
import {
  buildCountryIncidentThemes,
  buildOperationalImpactBullets,
} from "@/lib/countryIncidentThemes";

// Per-incident AI analyst summaries, keyed by incident id, provided by the
// page. When an incident has an entry it replaces the deterministic
// category-impact line on the card; otherwise the card falls back to that
// deterministic line (the page also shows a visible "AI narrative unavailable"
// banner in that case). Threaded via context so the shared ItemCard reads it
// without prop-drilling through every section variant.
const IncidentSummaryContext = createContext<Record<string, string>>({});

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

// Where the analyst-placed incident map sits relative to the written brief. The
// "none" / "end" placements are handled by the page (the page renders the map at
// the top of the analytics block for "end" and omits it for "none"); the four
// inline placements below are injected by this component between sections.
export type CountryMapPlacement =
  | "none"
  | "after-bluf"
  | "after-top3"
  | "after-incident-details"
  | "before-outlook"
  | "before-polestar"
  | "end";

// Where the analyst-attached photo block sits. "none" omits it; "cover" places
// it on the cover page (handled by the page); the four inline placements below
// are injected here.
export type CountryPhotoPlacement =
  | "none"
  | "cover"
  | "after-bluf"
  | "after-top3"
  | "inside-incident-details"
  | "before-polestar";

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
          // keepTogether omits data-pdf-flow so the DOM-rasterise PDF can only
          // break this block at its section top — the whole paragraph moves to
          // the next page rather than splitting mid-paragraph (spec §5).
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
        // Keep lineHeight at 1 so flex align-items:center centres the actual
        // glyph line box. (Setting lineHeight equal to the chip height instead
        // centres the font em-box, which leaves the descender-less all-caps
        // label sitting visibly high.) Vertical padding stays symmetric (0) so
        // the centred line box is not pushed off-centre.
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
  // An item whose real incident date falls BEFORE the reporting window
  // (occurredOutOfWindow) needs BOTH full dates spelled out — spec §13 and the
  // matching QC check (countryReportQc.ts) require this so an old event is
  // never presented as if it happened this period. "dd MMM" (no year) is not
  // enough here since the incident could be weeks or months old.
  if (item.occurredOutOfWindow && item.incidentDate) {
    return `Occurred ${format(item.incidentDate, "dd MMM yyyy")} (outside this reporting window) · reported ${reported}`;
  }
  if (item.occurredEarlier && item.incidentDate) {
    return `Occurred ${format(item.incidentDate, "dd MMM")} · reported ${reported}`;
  }
  return `Reported ${reported}`;
}

function ItemCard({
  item,
  suppressEmptyLocation = false,
  compact = false,
}: {
  item: PngReportItem;
  suppressEmptyLocation?: boolean;
  // Compact cards (used beneath an Incident Details theme paragraph) show only
  // the title, severity chip and the meta line (category · place · date ·
  // source) — no business-impact body — so the theme paragraph is not repeated
  // per item. Honours "no slop": the item earns its own place + honest date
  // without padding.
  compact?: boolean;
}) {
  const color = SEV_COLOR[item.severity] ?? ELECTRIC;
  const summaries = useContext(IncidentSummaryContext);
  // AI per-incident analyst summary when available; otherwise the deterministic
  // category-impact line (a "AI narrative unavailable" banner labels this case
  // page-side). Never both — the recycled category line is hidden when the AI
  // summary is present.
  const bodyText = summaries[item.id]?.trim() || item.businessImpact;
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
        {[
          item.displayCategory,
          item.province ?? (suppressEmptyLocation ? "" : "Location not specified"),
          dateLine(item),
        ]
          .filter(Boolean)
          .join("  ·  ")}
        {item.source ? `  ·  ${item.source}` : ""}
      </div>
      {compact ? null : (
        <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, marginTop: 6, lineHeight: 1.5, textAlign: "left" }}>
          {bodyText}
        </div>
      )}
    </div>
  );
}

// Theme sub-heading used inside the Incident Details / Outlook sections.
function StrandLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      // Keep-with-next: the DOM-rasterise paginator must never break directly
      // after this label — a strand heading orphaned at the bottom of a page
      // with its body on the next is a layout defect (owner-flagged).
      data-pdf-keep-with-next="true"
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

// One grouped Recommended Actions block: an ELECTRIC sub-heading over a
// count-free bullet list of that group's actions.
function ActionGroup({ heading, actions }: { heading: string; actions: string[] }) {
  return (
    <div data-pdf-row="true" style={{ marginBottom: 10 }}>
      <StrandLabel>{heading}</StrandLabel>
      <BulletList items={actions} />
    </div>
  );
}

// --- Jakarta tactical evidence primitives ---------------------------------
// These render the Jakarta city report's tactical tables (ranked Priority Areas,
// broken-out Staff Movement, 4-column Port & Logistics, standing Venue/Crime
// exposure, role-based actions). They are folded INSIDE the canonical sections
// below when d.jakartaTacticalBrief is present; every other theatre leaves them
// unrendered, so its output is byte-identical. Count-free; brand spec exactly.

// Subtle navy-tinted zebra shading for the tactical evidence tables' odd rows —
// brand-spec parity with the approved report chrome (navy header + alternating
// row shading), applied only to these count-free tables.
const ROW_TINT = "#f4f5fa";

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
          <tr key={i} style={{ background: i % 2 === 1 ? ROW_TINT : "#fff" }}>
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
          <tr key={i} style={{ background: i % 2 === 1 ? ROW_TINT : "#fff" }}>
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
          <tr key={i} style={{ background: i % 2 === 1 ? ROW_TINT : "#fff" }}>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>{r.area}</td>
            <td style={baseCell}>{r.why}</td>
            <td style={baseCell}>{r.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The standing Crime exposure table, keyed to named operating contexts
// (Operating context | Crime exposure | Precaution) — durable analyst guidance
// that links Jakarta's crime picture to staff movement, hotels and client
// meetings, airport transfers, port access and logistics routes. Not this
// period's findings.
function CrimeTable({ rows }: { rows: JakartaCrimeBusinessRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...baseHeadCell, width: "28%" }}>Operating context</th>
          <th style={{ ...baseHeadCell, width: "40%" }}>Crime exposure</th>
          <th style={{ ...baseHeadCell, width: "32%" }}>Precaution</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? ROW_TINT : "#fff" }}>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>{r.context}</td>
            <td style={baseCell}>{r.exposure}</td>
            <td style={baseCell}>{r.precaution}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Movement-type label order for the Staff Movement Impact block.
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

// The shared country-brief body. Renders the SAME section order for every
// theatre (PNG, West Papua, Indonesia, Jakarta and all generic countries):
// Bottom Line Up Front; Top 3 Developments; Incident Details (one short
// paragraph per meaningful theme); Current Situation; Operational Impact;
// Recommended Actions; Outlook; Polestar View. The page appends its analytics
// block and the Disclaimer below. The analyst-placed map and photo blocks are
// injected at the chosen inline placements.
export default function PngCountryReportBody({
  dataset,
  incidentSummaries = {},
  mapPlacement = "end",
  mapNode = null,
  photoPlacement = "none",
  photoNode = null,
  hiddenSections = [],
}: {
  dataset: PngReportDataset;
  incidentSummaries?: Record<string, string>;
  mapPlacement?: CountryMapPlacement;
  mapNode?: ReactNode;
  photoPlacement?: CountryPhotoPlacement;
  photoNode?: ReactNode;
  // Canonical section keys the analyst has hidden. A hidden section drops from
  // BOTH the on-screen preview and the DOM-rasterised PDF (same component, so
  // they can never disagree). See countrySectionOverrides.ts for the key list.
  hiddenSections?: string[];
}) {
  const d = dataset;
  const hidden = new Set(hiddenSections);
  const show = (key: string): boolean => !hidden.has(key);

  // Top 3 Developments — at most three tiles. The Incident Details themes below
  // analyse d.incidentDetailsItems: every window incident NOT promoted into the
  // Top 3 STORY CLUSTERS (so a syndicated re-run of a Top 3 story never reappears
  // here). Operational Impact still draws on the full window.
  const topThree = d.topThree.slice(0, 3);
  const incidentThemes = d.incidentThemesOverride ?? buildCountryIncidentThemes(d.incidentDetailsItems);
  // Cap the Operational Impact list (≤5) and the Outlook escalation indicators
  // (≤3) so the trimmed brief stays sharp.
  const operationalImpact =
    d.operationalImpactOverride ?? buildOperationalImpactBullets(d.windowItems).slice(0, 5);
  // Jakarta's tactical brief carries its own evidence tables (crime, priority
  // areas, staff movement, port, venue, role actions) that are folded INSIDE the
  // canonical sections below. Keep the Jakarta indicators compact: route,
  // congestion and flood advice is consolidated elsewhere in the brief.
  const tactical = d.jakartaTacticalBrief;
  const escalationIndicators = tactical
    ? d.escalationIndicators.slice(0, 3)
    : d.escalationIndicators.slice(0, 3);

  // Inline injection helpers for the analyst-placed map / photo blocks.
  const mapAt = (slot: CountryMapPlacement) =>
    // §25: the map card must not split across pages — keep the map container and
    // its location cards together (break-inside: avoid), matching the no-split
    // card pattern used elsewhere in the report body.
    mapPlacement === slot && mapNode ? (
      <div data-map-card="true" style={{ marginTop: 4, breakInside: "avoid" }}>
        {mapNode}
      </div>
    ) : null;
  const photoAt = (slot: CountryPhotoPlacement) =>
    photoPlacement === slot && photoNode ? <div style={{ marginTop: 4 }}>{photoNode}</div> : null;

  return (
    <IncidentSummaryContext.Provider value={incidentSummaries}>
      {/* 1. Bottom Line Up Front */}
      {show("bottom-line") && (
        <Section title="Bottom Line Up Front">
          <Prose text={d.bluf} />
        </Section>
      )}
      {mapAt("after-bluf")}
      {photoAt("after-bluf")}

      {/* 2. Top 3 Developments — at most three tiles */}
      {show("top-3") && (
        <Section title="Top 3 Developments">
          {topThree.length === 0 ? (
            <EmptyNote>{d.emptyLocationFallback}</EmptyNote>
          ) : (
            <div>
              {topThree.map((it) => (
                <ItemCard key={it.id} item={it} suppressEmptyLocation />
              ))}
            </div>
          )}
        </Section>
      )}
      {mapAt("after-top3")}
      {photoAt("after-top3")}

      {/* 3. Current Situation — the single prose narrative of the period.
          Uniform across every country brief (owner ruling, 28 Jul 2026): the
          framing paragraphs lead, followed by the themed analytical paragraphs
          that used to sit under a separate "Incident Details" heading. There is
          deliberately NO per-incident card list anywhere in this section — the
          report reads as analysis, not a feed. The empty note stays
          no-fabrication-safe: it only claims "no further reporting" when there
          truly are no leftover incidents; when leftover incidents existed but
          all fell below the meaningfulness gate it says so honestly instead.
          The legacy override keys keep working: "current-situation" hides the
          framing prose, "incident-details" hides the themed paragraphs. */}
      {((show("current-situation") && d.executiveSummary.trim() !== "") ||
        (show("incident-details") &&
          (incidentThemes.length > 0 || Boolean(tactical) || d.windowItems.length > 0))) && (
      <Section title="Current Situation">
        {show("current-situation") && d.executiveSummary.trim() !== "" && (
          <Prose text={d.executiveSummary} />
        )}
        {show("incident-details") && (
          <>
            {incidentThemes.length === 0 ? (
              d.windowItems.length > 0 ? (
                <EmptyNote>
                  {d.incidentDetailsItems.length === 0
                    ? "No further incident reporting beyond the developments above this period."
                    : "Remaining reporting this period was limited to isolated, lower-severity incidents that did not warrant separate detail."}
                </EmptyNote>
              ) : null
            ) : (
              incidentThemes.map((g) => (
                <div key={g.key} style={{ marginBottom: 12 }}>
                  <StrandLabel>{g.heading}</StrandLabel>
                  <Prose text={g.paragraph} />
                </div>
              ))
            )}
            {tactical ? (
              <>
                <StrandLabel>Crime Trends and Business Impact</StrandLabel>
                <Prose text={tactical.crimeTrends.reportedThisPeriod} />
                <Prose text={tactical.crimeTrends.standingPattern} />
                <Prose text={tactical.crimeTrends.trendRead} />
                <div data-pdf-keep="true">
                  <CrimeTable rows={tactical.crimeTrends.businessImpact} />
                </div>
                <StrandLabel>Priority Areas This Week</StrandLabel>
                <div data-pdf-keep="true">
                  <PriorityTable rows={tactical.priorityAreas} />
                </div>
              </>
            ) : null}
            {photoAt("inside-incident-details")}
          </>
        )}
      </Section>
      )}
      {mapAt("after-incident-details")}

      {/* 5. Operational Impact — per-theme impact lines for the themes present
          this period. §27: omitted entirely (not filler) when the engine has no
          event-linked impact to state and no tactical brief supplies one. */}
      {show("operational-impact") && (operationalImpact.length > 0 || Boolean(tactical)) && (
      <Section title="Operational Impact">
        {operationalImpact.length === 0 ? (
          <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
        ) : (
          <BulletList items={operationalImpact} />
        )}
        {tactical ? (
          <>
            <StrandLabel>Staff Movement Impact</StrandLabel>
            {STAFF_MOVEMENT_FIELDS.filter((f) =>
              Boolean(tactical.staffMovement[f.key]),
            ).map((f) => (
              <LabelledBlock key={f.key} label={f.label} text={tactical.staffMovement[f.key]} />
            ))}
            <StrandLabel>Airport Transfer Impact</StrandLabel>
            <Prose text={tactical.airportTransfer} />
            <StrandLabel>Port and Logistics Impact</StrandLabel>
            <Prose text={tactical.portLogistics.intro} />
            <div data-pdf-keep="true">
              <PortTable rows={tactical.portLogistics.rows} />
            </div>
            <StrandLabel>Port Actions</StrandLabel>
            <BulletList items={tactical.portLogistics.actions} />
            <StrandLabel>Office, Hotel and Meeting Venue Exposure</StrandLabel>
            <Prose text={tactical.officeHotelVenue.intro} />
            <div data-pdf-keep="true">
              <OpsTable rows={tactical.officeHotelVenue.rows} />
            </div>
          </>
        ) : null}
      </Section>
      )}

      {/* 6. Recommended Actions — grouped client priorities (Movement security,
          Site security, …), emitting only the groups this period's incident mix
          and watchlist support. The operating-risk theatres (Indonesia /
          Jakarta) keep their own flat priorities list unchanged. */}
      {show("recommended-actions") &&
        (Boolean(tactical) ||
          (d.proseVariant === "operating-risk"
            ? d.businessImpact.length > 0
            : d.recommendedActions.length > 0)) && (
      <Section title="Recommended Actions">
        {tactical ? (
          <>
            {tactical.roleActions.length > 0 ? (
              tactical.roleActions.map((a: JakartaRoleAction, i) => (
                <LabelledBlock key={i} label={a.role} text={a.guidance} />
              ))
            ) : (
              <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
            )}
            <StrandLabel>Route and Timing Guidance</StrandLabel>
            <BulletList items={tactical.routeTiming} />
          </>
        ) : d.proseVariant === "operating-risk" ? (
          d.businessImpact.length === 0 ? (
            <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
          ) : (
            <BulletList items={d.businessImpact} />
          )
        ) : d.recommendedActions.length === 0 ? (
          <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
        ) : (
          d.recommendedActions.map((g) => (
            <ActionGroup key={g.key} heading={g.heading} actions={g.actions} />
          ))
        )}
      </Section>
      )}
      {mapAt("before-outlook")}

      {/* 7. Outlook: Next Seven Days — most-likely scenario + escalation
          indicators. §27: omitted when the engine has no outlook prose. */}
      {show("outlook") && d.outlook.trim() !== "" && (
      <Section title="Outlook: Next Seven Days">
        <Prose text={d.outlook} />
        {escalationIndicators.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <StrandLabel>Escalation Indicators</StrandLabel>
            <BulletList items={escalationIndicators} />
          </div>
        ) : null}
        {(d.upcomingSignals ?? []).length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <StrandLabel>Reported Upcoming Activity</StrandLabel>
            <BulletList items={(d.upcomingSignals ?? []).map(upcomingSignalLine)} />
            <p
              style={{
                fontFamily: ROBOTO,
                fontSize: 11,
                lineHeight: 1.5,
                color: DUSK,
                margin: "4px 0 0 0",
              }}
            >
              Forward-looking signals drawn from reporting that announces
              scheduled or planned activity. Dates shown are announcement dates,
              not confirmed event dates.
            </p>
          </div>
        ) : null}
      </Section>
      )}
      {mapAt("before-polestar")}
      {photoAt("before-polestar")}

      {/* 8. Polestar View — closes the written brief. §27: omitted when the
          engine has no assessed judgement to add. */}
      {show("polestar-view") && d.polestarView.trim() !== "" && (
        <Section title="Polestar View">
          <Prose text={d.polestarView} keepTogether={d.keepPolestarTogether} />
        </Section>
      )}
    </IncidentSummaryContext.Provider>
  );
}
