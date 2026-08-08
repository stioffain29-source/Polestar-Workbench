import { createContext, useContext, type ReactNode } from "react";
import { format } from "date-fns";
import { upcomingSignalLine } from "../lib/upcomingSignals";
import type {
  PngReportDataset,
  PngReportItem,
} from "@/lib/pngReportDataset";
import type { JakartaOperatingPictureRow } from "@/lib/jakartaBrief";
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

// --- Jakarta weekly brief primitives ---------------------------------------
// Jakarta is deliberately a compact city weekly. Its only table is the live
// operating picture; quiet corridors are represented by a single honest note,
// never by standing rows that make the report look busier than the evidence.

const ROW_TINT = "#f4f5fa";

const baseCell: React.CSSProperties = {
  fontFamily: ROBOTO,
  fontSize: 12,
  lineHeight: 1.45,
  color: DUSK,
  padding: "7px 8px",
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
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

function OperatingPictureTable({ rows }: { rows: JakartaOperatingPictureRow[] }) {
  if (rows.length === 0) return null;
  return (
    <table
      data-pdf-keep="true"
      style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4 }}
    >
      <thead>
        <tr>
          <th style={{ ...baseHeadCell, width: "22%" }}>Area</th>
          <th style={{ ...baseHeadCell, width: "17%" }}>Driver</th>
          <th style={{ ...baseHeadCell, width: "34%" }}>Impact</th>
          <th style={{ ...baseHeadCell, width: "27%" }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.area}-${row.driver}`} style={{ background: i % 2 === 1 ? ROW_TINT : "#fff" }}>
            <td style={{ ...baseCell, fontWeight: 600, color: NAVY }}>{row.area}</td>
            <td style={baseCell}>{row.driver}</td>
            <td style={baseCell}>{row.impact}</td>
            <td style={baseCell}>{row.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WatchLine({ label, text }: { label: string; text: string }) {
  return (
    <p
      data-pdf-flow="true"
      style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.5, color: DUSK, margin: "0 0 8px 0" }}
    >
      <strong style={{ color: NAVY }}>{label}:</strong> {text}
    </p>
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
  // Cap the generic Operational Impact list (≤5) and Outlook escalation
  // indicators (≤3). Jakarta returns below with its approved compact layout.
  const operationalImpact =
    d.operationalImpactOverride ?? buildOperationalImpactBullets(d.windowItems).slice(0, 5);
  const tactical = d.jakartaTacticalBrief;
  const escalationIndicators = d.escalationIndicators.slice(0, 3);

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

  // Jakarta follows the approved city-weekly structure rather than the generic
  // multi-section country brief. This early return keeps the on-screen preview
  // and its DOM-rasterised PDF on the exact same compact content model.
  if (tactical) {
    const { operatingPicture, crimeEscalationWatch, recommendedActions } = tactical;
    return (
      <IncidentSummaryContext.Provider value={incidentSummaries}>
        {show("bottom-line") && (
          <Section title="Bottom Line Up Front"><Prose text={d.bluf} /></Section>
        )}
        {mapAt("after-bluf")}
        {photoAt("after-bluf")}

        {show("top-3") && (
          <Section title="Top 3 Developments">
            {topThree.length === 0 ? (
              <EmptyNote>{d.emptyLocationFallback}</EmptyNote>
            ) : (
              <div>{topThree.map((it) => <ItemCard key={it.id} item={it} suppressEmptyLocation />)}</div>
            )}
          </Section>
        )}
        {mapAt("after-top3")}
        {photoAt("after-top3")}

        {show("operational-impact") && (
          <Section title="Operating Picture This Week">
            {operatingPicture.rows.length > 0 ? (
              <OperatingPictureTable rows={operatingPicture.rows} />
            ) : (
              <EmptyNote>{operatingPicture.emptyNote}</EmptyNote>
            )}
          </Section>
        )}
        {mapAt("after-incident-details")}
        {photoAt("inside-incident-details")}

        {show("current-situation") && (
          <Section title="Crime & Escalation Watch">
            <WatchLine label="Crime" text={crimeEscalationWatch.crime} />
            <WatchLine label="Escalation triggers" text={crimeEscalationWatch.escalationTriggers} />
          </Section>
        )}
        {mapAt("before-outlook")}

        {show("recommended-actions") && (
          <Section title="Recommended Actions">
            {recommendedActions.length > 0 ? (
              <BulletList items={recommendedActions} />
            ) : (
              <EmptyNote>{d.businessImpactEmptyNote}</EmptyNote>
            )}
          </Section>
        )}
        {mapAt("before-polestar")}
        {photoAt("before-polestar")}
      </IncidentSummaryContext.Provider>
    );
  }

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
          (incidentThemes.length > 0 || d.windowItems.length > 0))) && (
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
            {photoAt("inside-incident-details")}
          </>
        )}
      </Section>
      )}
      {mapAt("after-incident-details")}

      {/* 5. Operational Impact — generic country brief only. */}
      {show("operational-impact") && operationalImpact.length > 0 && (
      <Section title="Operational Impact">
        <BulletList items={operationalImpact} />
      </Section>
      )}

      {/* 6. Recommended Actions — generic country brief only. */}
      {show("recommended-actions") &&
        (d.proseVariant === "operating-risk"
          ? d.businessImpact.length > 0
          : d.recommendedActions.length > 0) && (
      <Section title="Recommended Actions">
        {d.proseVariant === "operating-risk" ? (
          <BulletList items={d.businessImpact} />
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
