import { createContext, useContext } from "react";
import { format } from "date-fns";
import type {
  KeyDevelopmentGroup,
  LocationWatchlistEntry,
  PngReportDataset,
  PngReportItem,
  ReportingConfidence,
  StructuredLocationAugmentation,
  StructuredLocationBucket,
} from "@/lib/pngReportDataset";

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

// Count-free transparency note shown when a location section is capped to the
// most serious few incidents — tells the reader this is a curated selection, not
// the full incident list, without ever stating a number (house rule: no counts).
const LOCATION_TRIM_NOTE =
  "Showing the most significant incidents only; additional lower-priority reporting this period informs the wider assessment.";

function MoreNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, fontStyle: "italic", marginTop: 4 }}>
      {children}
    </div>
  );
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

function LocationSection({
  title,
  items,
  emptyFallback,
  hadFeatured,
  featuredNote,
  truncated = false,
  suppressEmptyLocation = false,
}: {
  title: string;
  items: PngReportItem[];
  emptyFallback: string;
  hadFeatured: boolean;
  featuredNote: string;
  truncated?: boolean;
  suppressEmptyLocation?: boolean;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <EmptyNote>{hadFeatured ? featuredNote : emptyFallback}</EmptyNote>
      ) : (
        <div>
          {items.map((it) => (
            <ItemCard key={it.id} item={it} suppressEmptyLocation={suppressEmptyLocation} />
          ))}
          {truncated ? <MoreNote>{LOCATION_TRIM_NOTE}</MoreNote> : null}
        </div>
      )}
    </Section>
  );
}

// Strand sub-heading inside an augmented location section.
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

// Emphasised caveat shown when a location had no confirmed incidents this
// period — gives the required "absence of reporting is not absence of crime"
// wording visible weight rather than a faint footnote.
function CaveatNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: ROBOTO,
        fontSize: 13,
        lineHeight: 1.55,
        color: DUSK,
        background: "#f4f5f7",
        borderLeft: `3px solid ${ELECTRIC}`,
        padding: "10px 12px",
        borderRadius: 2,
      }}
    >
      {children}
    </div>
  );
}

// Augmented location section (PNG Port Moresby / NCD): the bucket's incidents
// are split into Confirmed Incidents / Police Activity & Arrests / Crime Trend
// Indicators, followed by an always-present Standing Operating Risk paragraph so
// the section is never blank. When there are no confirmed incidents this period
// the EXACT sparse-reporting caveat is shown instead of the bare fallback.
function StrandedLocationSection({
  title,
  strands,
  augmentation,
  hadFeatured,
  featuredNote,
  truncated = false,
}: {
  title: string;
  strands: NonNullable<StructuredLocationBucket["strands"]>;
  augmentation: StructuredLocationAugmentation;
  hadFeatured: boolean;
  featuredNote: string;
  truncated?: boolean;
}) {
  return (
    <Section title={title}>
      <StrandLabel>Confirmed Incidents</StrandLabel>
      {strands.confirmed.length > 0 ? (
        <div>
          {strands.confirmed.map((it) => (
            <ItemCard key={it.id} item={it} />
          ))}
        </div>
      ) : hadFeatured ? (
        <EmptyNote>{featuredNote}</EmptyNote>
      ) : (
        <CaveatNote>{augmentation.sparseCaveat}</CaveatNote>
      )}

      <StrandLabel>Police Activity &amp; Arrests</StrandLabel>
      {strands.police.length > 0 ? (
        <div>
          {strands.police.map((it) => (
            <ItemCard key={it.id} item={it} />
          ))}
        </div>
      ) : (
        <EmptyNote>
          No police operations or arrests were separately reported for the district this period.
        </EmptyNote>
      )}

      <StrandLabel>Crime Trend Indicators</StrandLabel>
      {strands.trend.length > 0 ? (
        <div>
          {strands.trend.map((it) => (
            <ItemCard key={it.id} item={it} />
          ))}
        </div>
      ) : (
        <EmptyNote>No additional crime-trend signals were reported this period.</EmptyNote>
      )}

      {truncated ? <MoreNote>{LOCATION_TRIM_NOTE}</MoreNote> : null}

      <StrandLabel>Standing Operating Risk</StrandLabel>
      <Prose text={augmentation.standingOperatingRisk} />
    </Section>
  );
}

// A plain count-free bullet list (What Matters This Week, Priorities for Clients,
// Escalation Indicators). data-pdf-flow lets the DOM-rasterise PDF break it at
// the line level rather than pushing the whole block to a new page.
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

// One themed "Key Development" group: a theme sub-heading, the theme's incident
// tile cards, then a single deterministic "Business impact:" line. Used for the
// operating-risk theatres (the example's themed Key Developments layout).
function KeyDevelopmentGroupSection({
  group,
  suppressEmptyLocation = false,
}: {
  group: KeyDevelopmentGroup;
  suppressEmptyLocation?: boolean;
}) {
  return (
    <div data-pdf-row="true" style={{ marginBottom: 18 }}>
      <StrandLabel>{group.heading}</StrandLabel>
      {group.items.map((it) => (
        <ItemCard key={it.id} item={it} suppressEmptyLocation={suppressEmptyLocation} />
      ))}
      <div
        data-pdf-flow="true"
        style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.5, color: DUSK, marginTop: 4 }}
      >
        <span style={{ fontWeight: 700, color: NAVY }}>Business impact: </span>
        {group.businessImpact}
      </div>
    </div>
  );
}

// Location Watchlist — a branded three-column table (Location | Main concern |
// Recommended action). Plain text cells with content-box sizing and generous
// padding, no line-clamp, so html2canvas rasterises every line cleanly (clamped
// text renders shifted/clipped under html2canvas).
function LocationWatchlistTable({ entries }: { entries: LocationWatchlistEntry[] }) {
  if (entries.length === 0)
    return <EmptyNote>No location currently carries fresh or standing watch signals for this period.</EmptyNote>;
  const Cell = ({
    text,
    width,
    head,
    strong,
  }: {
    text: string;
    width: string;
    head?: boolean;
    strong?: boolean;
  }) => (
    <div
      style={{
        width,
        boxSizing: "border-box",
        padding: "8px 10px 10px 10px",
        fontFamily: ROBOTO,
        fontSize: head ? 11 : 13,
        fontWeight: head || strong ? 700 : 400,
        lineHeight: 1.45,
        color: head ? "#fff" : strong ? NAVY : DUSK,
        textTransform: head ? "uppercase" : "none",
        letterSpacing: head ? "0.05em" : "normal",
      }}
    >
      {text}
    </div>
  );
  return (
    <div data-pdf-flow="true" style={{ border: `1px solid ${POLAR}` }}>
      <div
        style={{
          display: "flex",
          background: NAVY,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <Cell text="Location" width="24%" head />
        <Cell text="Main concern" width="38%" head />
        <Cell text="Recommended action" width="38%" head />
      </div>
      {entries.map((e, i) => (
        <div key={i} style={{ display: "flex", borderTop: i === 0 ? "none" : `1px solid ${POLAR}` }}>
          <Cell text={e.location} width="24%" strong />
          <Cell text={e.why} width="38%" />
          <Cell text={e.action} width="38%" />
        </div>
      ))}
    </div>
  );
}

// Reporting-confidence pill. Neutral on-brand styling (POLAR fill, ELECTRIC
// border, NAVY text) — deliberately NOT a severity colour, so it is never
// confused with the five-tier risk ramp (and never touches the reserved
// Extreme/Insignificant hues).
function ConfidenceBadge({ level }: { level: ReportingConfidence["level"] }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: POLAR,
        border: `1px solid ${ELECTRIC}`,
        color: NAVY,
        fontFamily: ROBOTO,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        padding: "2px 10px",
        borderRadius: 2,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {level} confidence
    </span>
  );
}

export default function PngCountryReportBody({
  dataset,
  incidentSummaries = {},
}: {
  dataset: PngReportDataset;
  incidentSummaries?: Record<string, string>;
}) {
  const d = dataset;
  const operatingRisk = d.proseVariant === "operating-risk";
  return (
    <IncidentSummaryContext.Provider value={incidentSummaries}>
      {/* 1. Bottom Line Up Front */}
      <Section title="Bottom Line Up Front">
        <Prose text={d.bluf} />
      </Section>

      {/* 2. What Matters This Week — framing paragraph + dominant-theme bullets */}
      <Section title="What Matters This Week">
        <Prose text={d.executiveSummary} />
        {d.whatMattersBullets.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <BulletList items={d.whatMattersBullets} />
          </div>
        ) : null}
      </Section>

      {/* 3. Key Developments. Operating-risk theatres render themed groups
          (tile cards + "Business impact:" line). PNG / West Papua keep their
          Top-3 + location-bucket layout (with the NCD strand sections), so their
          bespoke per-district detail is preserved within Key Developments. */}
      {operatingRisk ? (
        <Section title="Key Developments">
          {d.keyDevelopments.length === 0 ? (
            <EmptyNote>{d.emptyLocationFallback}</EmptyNote>
          ) : (
            d.keyDevelopments.map((g) => (
              <KeyDevelopmentGroupSection key={g.key} group={g} suppressEmptyLocation />
            ))
          )}
        </Section>
      ) : (
        <>
          <Section title={d.topIncidentsHeading ?? "Key Developments"}>
            {d.topThree.length === 0 ? (
              <EmptyNote>{d.emptyLocationFallback}</EmptyNote>
            ) : (
              <div>
                {d.topThree.map((it) => (
                  <ItemCard key={it.id} item={it} />
                ))}
              </div>
            )}
          </Section>
          {d.buckets.map((b) =>
            b.augmentation && b.strands ? (
              <StrandedLocationSection
                key={b.key}
                title={b.label}
                strands={b.strands}
                augmentation={b.augmentation}
                hadFeatured={b.hadFeatured}
                featuredNote={d.featuredAboveNote}
                truncated={b.truncated}
              />
            ) : (
              <LocationSection
                key={b.key}
                title={b.label}
                items={b.items}
                emptyFallback={d.emptyLocationFallback}
                hadFeatured={b.hadFeatured}
                featuredNote={d.featuredAboveNote}
                truncated={b.truncated}
              />
            ),
          )}
          <LocationSection
            title={d.otherBucketLabel}
            items={d.otherNational}
            emptyFallback={d.emptyLocationFallback}
            hadFeatured={d.otherNationalHadFeatured}
            featuredNote={d.featuredAboveNote}
            truncated={d.otherNationalTruncated}
          />
        </>
      )}

      {/* 4. Location Watchlist */}
      <Section title="Location Watchlist">
        <LocationWatchlistTable entries={d.locationWatchlist} />
      </Section>

      {/* 5. Priorities for Clients This Week */}
      <Section title="Priorities for Clients This Week">
        {d.businessImpact.length === 0 ? (
          <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
        ) : (
          <BulletList items={d.businessImpact} />
        )}
      </Section>

      {/* 6. Outlook: Next Seven Days — most-likely scenario + escalation indicators */}
      <Section title="Outlook: Next Seven Days">
        <Prose text={d.outlook} />
        {d.escalationIndicators.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <StrandLabel>Escalation Indicators</StrandLabel>
            <BulletList items={d.escalationIndicators} />
          </div>
        ) : null}
      </Section>

      {/* 7. Polestar View */}
      <Section title="Polestar View">
        <Prose text={d.polestarView} />
      </Section>

      {/* Reporting Confidence — closes the written brief */}
      <Section title="Reporting Confidence">
        <div style={{ marginBottom: 8 }}>
          <ConfidenceBadge level={d.reportingConfidence.level} />
        </div>
        <Prose text={d.reportingConfidence.rationale} />
      </Section>
    </IncidentSummaryContext.Provider>
  );
}
