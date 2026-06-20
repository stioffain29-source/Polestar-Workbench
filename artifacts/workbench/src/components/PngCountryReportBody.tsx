import { format } from "date-fns";
import type {
  PngReportDataset,
  PngReportItem,
  StructuredLocationAugmentation,
  StructuredLocationBucket,
} from "@/lib/pngReportDataset";

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
  insignificant: "#B8C2CC",
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
        <p key={i} style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: "0 0 10px 0" }}>
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
        padding: "0 10px",
        minWidth: 72,
        height: 22,
        lineHeight: "22px",
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
  return (
    <div
      style={{
        border: `1px solid ${POLAR}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 2,
        background: "#fff",
        padding: "12px 14px",
        marginBottom: 10,
      }}
    >
      <div className="flex items-start justify-between" style={{ gap: 12 }}>
        <div style={{ fontFamily: ROBOTO, fontSize: 14, fontWeight: 600, color: NAVY, lineHeight: 1.3 }}>
          {item.title}
        </div>
        <SeverityChip item={item} />
      </div>
      <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 6, letterSpacing: "0.02em" }}>
        {[item.category, item.province ?? "Location not specified", dateLine(item)].join("  ·  ")}
        {item.source ? `  ·  ${item.source}` : ""}
      </div>
      <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, marginTop: 6, lineHeight: 1.5 }}>
        {item.businessImpact}
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

export default function PngCountryReportBody({ dataset }: { dataset: PngReportDataset }) {
  const d = dataset;
  return (
    <>
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
          <ul style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: 0, paddingLeft: 18 }}>
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

      {/* 9. Source Confidence & Reporting Gaps */}
      <Section title="Source Confidence & Reporting Gaps">
        <DiagnosticsBlock dataset={d} />
      </Section>
    </>
  );
}

function DiagnosticsBlock({ dataset }: { dataset: PngReportDataset }) {
  const { diagnostics: dg } = dataset;
  const Label = ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        fontFamily: ROBOTO,
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: NAVY,
        fontWeight: 700,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
  return (
    <div>
      <Prose
        text={
          dg.totalInWindow === 0
            ? "No fresh items were captured this period, so source confidence cannot be assessed from current reporting. The breakdown below reflects the standing 30- and 90-day coverage that underpins the brief."
            : `Reporting this period drew on ${dg.bySource.length} distinct ${
                dg.bySource.length === 1 ? "source" : "sources"
              }. ${
                dg.occurredEarlierCount > 0
                  ? `${dg.occurredEarlierCount} ${
                      dg.occurredEarlierCount === 1 ? "item was" : "items were"
                    } reported after the event occurred, so the incident date and the reporting date differ.`
                  : "Reporting and occurrence dates aligned across the captured items."
              } Treat single-source items as provisional until corroborated.`
        }
      />

      <div className="grid md:grid-cols-2 gap-6" style={{ marginTop: 12 }}>
        <div>
          <Label>Sources This Period</Label>
          {dg.bySource.length === 0 ? (
            <EmptyNote>No sources in the active window.</EmptyNote>
          ) : (
            <ul style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.6, color: DUSK, margin: 0, paddingLeft: 18 }}>
              {dg.bySource.map((s) => (
                <li key={s.source}>
                  {s.source} — {s.count}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Label>Confidence Distribution</Label>
          {dg.byConfidence.length === 0 ? (
            <EmptyNote>No confidence signal in the active window.</EmptyNote>
          ) : (
            <ul style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.6, color: DUSK, margin: 0, paddingLeft: 18 }}>
              {dg.byConfidence.map((c) => (
                <li key={c.confidence} style={{ textTransform: "capitalize" }}>
                  {c.confidence} — {c.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <Label>Reporting Gaps</Label>
        {dg.watchlistGaps.length === 0 ? (
          <EmptyNote>
            No curated watchlist locations are unreported this period
            {dataset.windowItems.length === 0 ? ", though the absence of any fresh reporting is itself a coverage gap" : ""}.
          </EmptyNote>
        ) : (
          <div style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.55, color: DUSK }}>
            No fresh reporting was captured this period for: {dg.watchlistGaps.join(", ")}. Treat these as
            coverage gaps rather than confirmation of quiet conditions.
          </div>
        )}
      </div>
    </div>
  );
}
