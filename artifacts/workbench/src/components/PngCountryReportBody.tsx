import { createContext, useContext, type ReactNode } from "react";
import { format } from "date-fns";
import type {
  PngReportDataset,
  PngReportItem,
} from "@/lib/pngReportDataset";
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
  if (item.occurredEarlier && item.incidentDate) {
    return `Occurred ${format(item.incidentDate, "dd MMM")} · reported ${reported}`;
  }
  return `Reported ${reported}`;
}

function ItemCard({
  item,
  suppressEmptyLocation = false,
}: {
  item: PngReportItem;
  suppressEmptyLocation?: boolean;
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
          {item.title}
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
      <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, marginTop: 6, lineHeight: 1.5, textAlign: "left" }}>
        {bodyText}
      </div>
    </div>
  );
}

// Theme sub-heading used inside the Incident Details / Outlook sections.
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
}: {
  dataset: PngReportDataset;
  incidentSummaries?: Record<string, string>;
  mapPlacement?: CountryMapPlacement;
  mapNode?: ReactNode;
  photoPlacement?: CountryPhotoPlacement;
  photoNode?: ReactNode;
}) {
  const d = dataset;

  // Top 3 Developments — at most three tiles. The Incident Details themes below
  // analyse d.incidentDetailsItems: every window incident NOT promoted into the
  // Top 3 STORY CLUSTERS (so a syndicated re-run of a Top 3 story never reappears
  // here). Operational Impact still draws on the full window.
  const topThree = d.topThree.slice(0, 3);
  const incidentThemes = buildCountryIncidentThemes(d.incidentDetailsItems);
  // Cap the Operational Impact list (≤5) and the Outlook escalation indicators
  // (≤3) so the trimmed brief stays sharp.
  const operationalImpact = buildOperationalImpactBullets(d.windowItems).slice(0, 5);
  const escalationIndicators = d.escalationIndicators.slice(0, 3);

  // Inline injection helpers for the analyst-placed map / photo blocks.
  const mapAt = (slot: CountryMapPlacement) =>
    mapPlacement === slot && mapNode ? <div style={{ marginTop: 4 }}>{mapNode}</div> : null;
  const photoAt = (slot: CountryPhotoPlacement) =>
    photoPlacement === slot && photoNode ? <div style={{ marginTop: 4 }}>{photoNode}</div> : null;

  return (
    <IncidentSummaryContext.Provider value={incidentSummaries}>
      {/* 1. Bottom Line Up Front */}
      <Section title="Bottom Line Up Front">
        <Prose text={d.bluf} />
      </Section>
      {mapAt("after-bluf")}
      {photoAt("after-bluf")}

      {/* 2. Top 3 Developments — at most three tiles */}
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
      {mapAt("after-top3")}
      {photoAt("after-top3")}

      {/* 3. Incident Details — PRESENT, MEANINGFUL theme groups of the incidents
          not already shown as Top 3 developments. Each theme is ONE short,
          count-free analytical paragraph (no four-part sub-template). Trivial
          single low-severity themes are filtered upstream; absent themes are
          omitted rather than padded with "not reported" filler. */}
      <Section title="Incident Details">
        {incidentThemes.length === 0 ? (
          <EmptyNote>
            {d.windowItems.length === 0
              ? d.emptyLocationFallback
              : "No further incident reporting beyond the developments above this period."}
          </EmptyNote>
        ) : (
          incidentThemes.map((g) => (
            <div key={g.key} data-pdf-row="true" style={{ marginBottom: 12 }}>
              <StrandLabel>{g.heading}</StrandLabel>
              <Prose text={g.paragraph} />
            </div>
          ))
        )}
        {photoAt("inside-incident-details")}
      </Section>
      {mapAt("after-incident-details")}

      {/* 4. Current Situation — concise framing, two short paragraphs maximum. */}
      <Section title="Current Situation">
        <Prose text={d.executiveSummary} />
      </Section>

      {/* 5. Operational Impact — per-theme impact lines for the themes present
          this period. */}
      <Section title="Operational Impact">
        {operationalImpact.length === 0 ? (
          <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
        ) : (
          <BulletList items={operationalImpact} />
        )}
      </Section>

      {/* 6. Recommended Actions — grouped client priorities (Movement security,
          Site security, …), emitting only the groups this period's incident mix
          and watchlist support. The operating-risk theatres (Indonesia /
          Jakarta) keep their own flat priorities list unchanged. */}
      <Section title="Recommended Actions">
        {d.proseVariant === "operating-risk" ? (
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
      {mapAt("before-outlook")}

      {/* 7. Outlook: Next Seven Days — most-likely scenario + escalation
          indicators */}
      <Section title="Outlook: Next Seven Days">
        <Prose text={d.outlook} />
        {escalationIndicators.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <StrandLabel>Escalation Indicators</StrandLabel>
            <BulletList items={escalationIndicators} />
          </div>
        ) : null}
      </Section>
      {mapAt("before-polestar")}
      {photoAt("before-polestar")}

      {/* 8. Polestar View — closes the written brief */}
      <Section title="Polestar View">
        <Prose text={d.polestarView} />
      </Section>
    </IncidentSummaryContext.Provider>
  );
}
