import { createContext, useContext } from "react";
import { format } from "date-fns";
import type {
  PngReportDataset,
  PngReportItem,
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

function SeverityChip({ item }: { item: PngReportItem }) {
  const color = SEV_COLOR[item.severity] ?? "#999";
  return (
    <span
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

function ItemCard({ item }: { item: PngReportItem }) {
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
        {[item.category, item.province ?? "Location not specified", dateLine(item)].join("  ·  ")}
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
}: {
  title: string;
  items: PngReportItem[];
  emptyFallback: string;
  hadFeatured: boolean;
  featuredNote: string;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <EmptyNote>{hadFeatured ? featuredNote : emptyFallback}</EmptyNote>
      ) : (
        <div>
          {items.map((it) => (
            <ItemCard key={it.id} item={it} />
          ))}
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
}: {
  title: string;
  strands: NonNullable<StructuredLocationBucket["strands"]>;
  augmentation: StructuredLocationAugmentation;
  hadFeatured: boolean;
  featuredNote: string;
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

      <StrandLabel>Standing Operating Risk</StrandLabel>
      <Prose text={augmentation.standingOperatingRisk} />
    </Section>
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
  return (
    <IncidentSummaryContext.Provider value={incidentSummaries}>
      {/* 1. Executive Summary */}
      <Section title="Executive Summary">
        <Prose text={d.executiveSummary} />
      </Section>

      {/* 2. Top 3 Incidents This Week */}
      <Section title="Top 3 Incidents This Week">
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

      {/* 3-N. Location buckets (config-driven) + catch-all. Buckets with a
          locationAugmentation (PNG NCD) render the strand layout + standing
          operating-risk block; the rest render the flat location list. */}
      {d.buckets.map((b) =>
        b.augmentation && b.strands ? (
          <StrandedLocationSection
            key={b.key}
            title={b.label}
            strands={b.strands}
            augmentation={b.augmentation}
            hadFeatured={b.hadFeatured}
            featuredNote={d.featuredAboveNote}
          />
        ) : (
          <LocationSection
            key={b.key}
            title={b.label}
            items={b.items}
            emptyFallback={d.emptyLocationFallback}
            hadFeatured={b.hadFeatured}
            featuredNote={d.featuredAboveNote}
          />
        ),
      )}
      <LocationSection
        title={d.otherBucketLabel}
        items={d.otherNational}
        emptyFallback={d.emptyLocationFallback}
        hadFeatured={d.otherNationalHadFeatured}
        featuredNote={d.featuredAboveNote}
      />

      {/* Business Impact */}
      <Section title="Business Impact">
        {d.businessImpact.length === 0 ? (
          <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
        ) : (
          <ul
            data-pdf-flow="true"
            style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: 0, paddingLeft: 18 }}
          >
            {d.businessImpact.map((line, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 8. Outlook — Next Week */}
      <Section title="Outlook — Next Week">
        <Prose text={d.outlook} />
      </Section>
    </IncidentSummaryContext.Provider>
  );
}
