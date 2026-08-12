import {
  makeSectionGate,
  applyFastFactOverrides,
  applyMarketPriceOverrides,
  applyGulfBulletOverrides,
  applyMarketOperatorOverrides,
  resolvePanelRead,
  PANEL_READ_GULF_HORMUZ,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { format, parseISO } from "date-fns";
import { TOPIC_LABELS, severityBadgeStyle } from "@/lib/topics";
import { resolveReportWindow } from "@/lib/reportWindow";
import { canonicalTopic, resolveReportTitle } from "@/lib/reportNaming";
import { pickRead } from "@/lib/pickRead";
import { DISCLAIMER_TEXT, SEV_COLOR, SEV_LABEL, sevKey } from "@/lib/pdfChrome";
import { topicCoverUrl } from "@/lib/coverImages";
import { computeTopicFastFacts, filterTopicReportIncidents, type TopicFastFactsIncident } from "@/lib/topicFastFacts";
import { selectRelatedIncidents } from "@/lib/relatedIncidents";
import {
  aiOr,
  resolveSimpleProse,
  stableDraftTopicReportProse,
  toDraftableIncidents,
  type TopicAiProse,
} from "@/lib/topicProseResolution";
import {
  resolveFuelEffectiveSections,
  validateFuelReportConsistency as validateFuelEffectiveText,
} from "@/lib/fuelReportConsistency";
import { validateFuelReportConsistency as validateFuelCanonicalText } from "@/lib/fuelCanonicalFacts";
import { classifyIncidentType } from "@/lib/incidentClassifier";
import { resolveIncidentSummary } from "@/lib/incidentSummary";
import {
  buildCargoSecurityRead,
  buildCargoWhatHappened,
  buildCargoSituation,
  buildLogisticsHubRead,
  buildCargoWhatMatters,
  buildCargoImplications,
  buildCargoWatchNext,
  buildCargoPolestarView,
  buildCargoCountryBreakdown,
  buildCargoPortBreakdown,
  type CargoCountryRow,
  type CargoPortRow,
} from "@/lib/cargoNarratives";
import type { ProducerBuyerActionRow } from "@/lib/fuelNarratives";
import {
  buildFuelWatchReportData,
  fuelMarketLatestDate,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "@/lib/fuelWatchReport";
import JetFuelTrajectoryChart from "@/components/JetFuelTrajectoryChart";
import { MarketPricesReportSection } from "@/components/MarketPrices";
import type { MarketPrice } from "@workspace/api-client-react";
import CargoTrendChart from "@/components/CargoTrendChart";
import CargoChoroplethStatic from "@/components/CargoChoroplethStatic";
import { buildCargoCountryIntensity } from "@/lib/cargoReportChoropleth";
import {
  buildCargoReportExtras,
  formatCargoUsd,
  cargoUsdNote,
  cargoCommodityNote,
} from "@/lib/cargoReportData";
import {
  buildCargoGroupedDataset,
  REPORT_CLUSTER_SECTION_KEYS,
  cargoClusterLocationLabel,
  cargoClusterDetailLine,
  cargoClusterSourceLabel,
  cargoClusterSeverityKey,
  type CargoGroupedDataset,
  type CargoGroupedSection,
} from "@/lib/cargoGroupedDataset";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

// Severity accent colours come from the shared SEV_COLOR ramp in pdfChrome
// (lowercase keys, Extreme = #A33232) so the on-screen Fast Facts accent
// matches the PDF exporter and every other risk surface exactly.

export interface ReportPreviewData {
  title?: string;
  topic?: string;
  issueDate?: string;
  author?: string | null;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  polestarView?: string | null; cargoSecurityRead?: string | null; logisticsHubRead?: string | null; regionalCountryRead?: string | null; fuelMarketRead?: string | null; fuelOperationalRead?: string | null; fuelRegionalHighlights?: string | null;
  watchNext?: string | null;
  /**
   * Raw jsonb from report.hardNumbers. Parsed by jetFuelTrajectory.ts.
   * Typed as unknown because the column can legitimately carry several
   * shapes (legacy KpiCard[] or the new FuelHardNumbers object).
   */
  hardNumbers?: unknown;
}

function toBullets(text?: string | null, max = 7): string[] {
  const s = (text ?? "").trim();
  if (!s) return [];
  const marked = s.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /^([-*•])\s+/.test(l))
    .map((l) => l.replace(/^([-*•])\s+/, "").trim())
    .filter(Boolean);
  let out: string[];
  if (marked.length > 0) out = marked;
  else out = s.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)
    .map((p) => p.length <= 220 ? p : (p.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? p.slice(0, 217) + "...").trim());
  return out.slice(0, max);
}

function BulletsSection({ title, text, max = 7, hidden }: { title: string; text?: string | null; max?: number; hidden?: boolean }) {
  if (hidden) return null;
  const items = toBullets(text, max);
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="list-disc pl-5 space-y-1.5" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
        {items.map((it, i) => (
          <li key={i} className="text-[14px] leading-[1.6] font-light">{it}</li>
        ))}
      </ul>
    </Section>
  );
}

function Paragraphs({ text }: { text?: string | null }) {
  if (!text) return null;
  const parts = text.split(/\n+/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p
          key={i}
          className="text-[14px] leading-[1.7] mb-3 font-light"
          style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
        >
          {p}
        </p>
      ))}
    </>
  );
}

function Section({ title, children, hidden }: { title: string; children: React.ReactNode; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="report-section mb-8">
      <h2
        className="uppercase pb-2 mb-4 tracking-wide"
        data-pdf-keep-with-next="true"
        style={{
          color: NAVY,
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 18,
          borderBottom: `2px solid ${ELECTRIC}`,
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

// Render the section only when its source field is populated — no
// placeholder text per brand spec.
function NarrativeSection({ title, text, hidden }: { title: string; text?: string | null; hidden?: boolean }) {
  if (hidden) return null;
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  return (
    <Section title={title}>
      <Paragraphs text={trimmed} />
    </Section>
  );
}

interface KpiPreviewCard {
  label: string;
  value: string;
  note?: string;
  severity?: string;
  asOf?: string;
  source?: string;
}

function FastFactsGrid({ cards }: { cards: KpiPreviewCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const sevK = c.severity ? sevKey(c.severity) : "";
        const accent = sevK && SEV_COLOR[sevK] ? SEV_COLOR[sevK] : ELECTRIC;
        return (
          <div
            key={i}
            className="bg-white border rounded-sm relative"
            style={{ borderColor: POLAR, paddingLeft: 14, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}
          >
            {/* Vertical accent strip on the left edge — no horizontal top bar. */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: accent }} />
            <div
              className="uppercase tracking-widest"
              style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 9, color: DUSK }}
            >
              {c.label}
            </div>
            <div
              style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 20, color: NAVY, marginTop: 4, lineHeight: 1.1 }}
            >
              {c.value}
            </div>
            {c.note && (
              <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, color: DUSK, marginTop: 6 }}>
                {c.note}
              </div>
            )}
            {c.source && (
              <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 9, color: DUSK, marginTop: 4, opacity: 0.85 }}>
                {c.source}
              </div>
            )}
            {c.asOf && (
              <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 9, color: DUSK, marginTop: 2, opacity: 0.85 }}>
                As of {c.asOf}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Exported for the rendered-markup parity test (fuelProducerActionsRender):
// the app is owner-gated, so rendered verification runs through jest.
export function ProducerActionsTable({ rows }: { rows: ProducerBuyerActionRow[] }) {
  const th: React.CSSProperties = {
    background: NAVY,
    color: "#fff",
    fontFamily: "Roboto, sans-serif",
    fontWeight: 700,
    fontSize: 10,
    textAlign: "left",
    padding: "8px 10px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  const td: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 12,
    color: DUSK,
    padding: "10px",
    verticalAlign: "top",
    borderBottom: `1px solid ${POLAR}`,
    lineHeight: 1.45,
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${POLAR}` }}>
      <thead>
        <tr>
          <th style={{ ...th, width: "16%" }}>Actor</th>
          <th style={{ ...th, width: "18%" }}>Category</th>
          <th style={{ ...th, width: "36%" }}>Action</th>
          <th style={{ ...th, width: "30%" }}>Operational Read</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...td, color: NAVY, fontWeight: 700 }}>{r.actor}</td>
            <td style={td}>{r.category}</td>
            <td style={td}>
              {r.action}
              {r.date && (
                <div style={{ fontSize: 10, opacity: 0.75, marginTop: 3 }}>{r.date}</div>
              )}
            </td>
            <td style={td}>{r.operationalRead}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CargoPortTable({ rows }: { rows: CargoPortRow[] }) {
  const th: React.CSSProperties = {
    background: NAVY,
    color: "#fff",
    fontFamily: "Roboto, sans-serif",
    fontWeight: 700,
    fontSize: 10,
    textAlign: "left",
    padding: "8px 10px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  const td: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 12,
    color: DUSK,
    padding: "10px",
    verticalAlign: "top",
    borderBottom: `1px solid ${POLAR}`,
    lineHeight: 1.45,
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${POLAR}` }}>
      <thead>
        <tr>
          <th style={{ ...th, width: "22%" }}>Port</th>
          <th style={{ ...th, width: "28%" }}>Current Pattern</th>
          <th style={{ ...th, width: "16%" }}>Severity</th>
          <th style={{ ...th, width: "34%" }}>Operational Read</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...td, color: NAVY, fontWeight: 700 }}>
              {r.port}
              <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.75, marginTop: 3 }}>
                {r.country} · {r.count} record{r.count === 1 ? "" : "s"}
              </div>
            </td>
            <td style={td}>{r.pattern}</td>
            <td style={td}>
              <span
                style={{
                  ...severityBadgeStyle(r.severityKey),
                  display: "inline-block",
                  padding: "3px 8px",
                  borderRadius: 2,
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  WebkitPrintColorAdjust: "exact",
                  printColorAdjust: "exact",
                }}
              >
                {r.severityLabel}
              </span>
            </td>
            <td style={td}>{r.operationalRead}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CargoCountryTable({ rows }: { rows: CargoCountryRow[] }) {
  const th: React.CSSProperties = {
    background: NAVY,
    color: "#fff",
    fontFamily: "Roboto, sans-serif",
    fontWeight: 700,
    fontSize: 10,
    textAlign: "left",
    padding: "8px 10px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  const td: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 12,
    color: DUSK,
    padding: "10px",
    verticalAlign: "top",
    borderBottom: `1px solid ${POLAR}`,
    lineHeight: 1.45,
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${POLAR}` }}>
      <thead>
        <tr>
          <th style={{ ...th, width: "18%" }}>Region / Country</th>
          <th style={{ ...th, width: "30%" }}>Current Pattern</th>
          <th style={{ ...th, width: "16%" }}>Severity</th>
          <th style={{ ...th, width: "36%" }}>Operational Read</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...td, color: NAVY, fontWeight: 700 }}>
              {r.country}
              <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.75, marginTop: 3 }}>
                {r.count} record{r.count === 1 ? "" : "s"}
              </div>
            </td>
            <td style={td}>{r.pattern}</td>
            <td style={td}>
              <span
                style={{
                  ...severityBadgeStyle(r.severityKey),
                  display: "inline-block",
                  padding: "3px 8px",
                  borderRadius: 2,
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  WebkitPrintColorAdjust: "exact",
                  printColorAdjust: "exact",
                }}
              >
                {r.severityLabel}
              </span>
            </td>
            <td style={td}>{r.operationalRead}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Cargo Incident Clusters — the regrouped, clustered view. Renders the same
// partition tables + watch-item bullets, in the same order, that the PDF's
// drawCargoClusters draws (preview == PDF). Cargo report only.
function CargoClustersSection({ grouped }: { grouped: CargoGroupedDataset }) {
  const byKey = new Map(grouped.sections.map((s) => [s.key, s] as const));
  const tables = REPORT_CLUSTER_SECTION_KEYS.map((k) => byKey.get(k)).filter(
    (s): s is CargoGroupedSection => !!s && s.clusters.length > 0,
  );
  if (tables.length === 0 && grouped.watchItems.length === 0) return null;
  const th: React.CSSProperties = {
    background: NAVY,
    color: "#fff",
    fontFamily: "Roboto, sans-serif",
    fontWeight: 700,
    fontSize: 10,
    textAlign: "left",
    padding: "8px 10px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  const td: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 12,
    color: DUSK,
    padding: "10px",
    verticalAlign: "top",
    borderBottom: `1px solid ${POLAR}`,
    lineHeight: 1.45,
  };
  const fmtDate = (s: string): string => {
    try {
      return format(parseISO(s), "dd MMM yyyy");
    } catch {
      return s;
    }
  };
  return (
    <>
      {tables.length > 0 && (
        <Section title="Cargo Incident Clusters">
          {tables.map((section) => (
            <div key={section.key} style={{ marginBottom: 18 }}>
              <h3
                style={{
                  color: NAVY,
                  fontFamily: "Roboto, sans-serif",
                  fontWeight: 700,
                  fontSize: 14,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  marginBottom: 8,
                }}
              >
                {section.title}
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${POLAR}` }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: "14%" }}>Date</th>
                    <th style={{ ...th, width: "20%" }}>Category</th>
                    <th style={{ ...th, width: "53%" }}>Incident</th>
                    <th style={{ ...th, width: "13%" }}>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {section.clusters.map((c) => {
                    const sk = cargoClusterSeverityKey(c);
                    return (
                      <tr key={c.id}>
                        <td style={{ ...td, color: DUSK }}>{fmtDate(c.latestOccurredAt)}</td>
                        <td style={td}>{c.enrichment.category}</td>
                        <td style={{ ...td, color: NAVY }}>
                          {c.title}
                          <div style={{ fontSize: 11, color: DUSK, marginTop: 4, lineHeight: 1.4 }}>
                            {cargoClusterLocationLabel(c)} | Confidence: {c.enrichment.confidence} |
                            Status: {c.enrichment.status}
                          </div>
                          <div style={{ fontSize: 11, color: DUSK, marginTop: 2, lineHeight: 1.4 }}>
                            {cargoClusterDetailLine(c)}
                          </div>
                          <div style={{ fontSize: 10, fontStyle: "italic", opacity: 0.7, marginTop: 3 }}>
                            {cargoClusterSourceLabel(c)}
                          </div>
                        </td>
                        <td style={td}>
                          <span
                            style={{
                              ...severityBadgeStyle(sk),
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 2,
                              fontWeight: 700,
                              fontSize: 10,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                              WebkitPrintColorAdjust: "exact",
                              printColorAdjust: "exact",
                            }}
                          >
                            {SEV_LABEL[sk] ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </Section>
      )}
      <BulletsSection
        title="Recommended Watch Items"
        text={grouped.watchItems.map((w) => "- " + w).join("\n")}
        max={8}
      />
    </>
  );
}

function RelatedIncidentsTable({ rows, summaries }: { rows: TopicFastFactsIncident[]; summaries: Record<string, string> }) {
  const th: React.CSSProperties = {
    background: NAVY,
    color: "#fff",
    fontFamily: "Roboto, sans-serif",
    fontWeight: 700,
    fontSize: 10,
    textAlign: "left",
    padding: "8px 10px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  const td: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 12,
    color: DUSK,
    padding: "10px",
    verticalAlign: "top",
    borderBottom: `1px solid ${POLAR}`,
    lineHeight: 1.45,
  };
  const fmtDate = (s: string): string => {
    try { return format(parseISO(s), "dd MMM yyyy"); } catch { return s; }
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${POLAR}` }}>
      <thead>
        <tr>
          <th style={{ ...th, width: "16%" }}>Date</th>
          <th style={{ ...th, width: "20%" }}>Type</th>
          <th style={{ ...th, width: "48%" }}>Title</th>
          <th style={{ ...th, width: "16%" }}>Severity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const key = (r.severity ?? "").trim().toLowerCase();
          const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : "—";
          const src = (r.source ?? "").trim();
          return (
            <tr key={r.id ?? i}>
              <td style={{ ...td, color: DUSK }}>{fmtDate(r.occurredAt)}</td>
              <td style={td}>{classifyIncidentType(r)}</td>
              <td style={{ ...td, color: NAVY }}>
                {r.title}
                <div style={{ fontSize: 11, color: DUSK, marginTop: 4, lineHeight: 1.4 }}>
                  {resolveIncidentSummary(r, summaries)}
                </div>
                {src && (
                  <div style={{ fontSize: 10, fontStyle: "italic", opacity: 0.7, marginTop: 3 }}>
                    Source: {src}
                  </div>
                )}
              </td>
              <td style={td}>
                <span
                  style={{
                    ...severityBadgeStyle(key),
                    display: "inline-block",
                    padding: "3px 8px",
                    borderRadius: 2,
                    fontWeight: 700,
                    fontSize: 10,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                  }}
                >
                  {label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function computePreviewFastFacts(
  report: ReportPreviewData,
  incidents: TopicFastFactsIncident[],
): KpiPreviewCard[] {
  if (!report.topic || !report.issueDate) {
    return [
      { label: "Reporting Period", value: "—" },
    ];
  }
  const topicLabel = TOPIC_LABELS[report.topic] ?? report.topic;
  return computeTopicFastFacts({
    topic: report.topic,
    issueDate: report.issueDate,
    incidents,
    topicLabel,
  });
}

export default function ReportPreview({
  report,
  incidents = [],
  incidentSummaries = {},
  aiProse,
  marketPrices,
  hiddenSections,
  sectionOverrides,
}: {
  report: ReportPreviewData;
  incidents?: TopicFastFactsIncident[];
  incidentSummaries?: Record<string, string>;
  aiProse?: TopicAiProse | null;
  marketPrices?: MarketPrice[];
  hiddenSections?: string[];
  sectionOverrides?: TopicSectionOverrides | null;
}) {
  const show = makeSectionGate(hiddenSections);
  const ffOverrides = sectionOverrides?.fastFactOverrides;
  void canonicalTopic; void format; void parseISO;
  const resolvedTitle = report.topic
    ? resolveReportTitle(report.topic, report.title)
    : (report.title ?? "");
  const isFuel = report.topic === "fuel";
  // Fuel Watch is a MARKET product: its reporting-period END is the latest
  // market close the report carries, NOT the stored issue date. Deriving the
  // render date here keeps the cover date, period label, incident window and
  // chart anchored to the same market close (matches exportTopicReportPdf).
  // A fuel draft with no dated market data yet falls back to the issue date.
  const renderIssueDate =
    isFuel && report.issueDate
      ? (fuelMarketLatestDate(report.hardNumbers) ?? report.issueDate)
      : report.issueDate;
  const fastFacts = isFuel ? [] : computePreviewFastFacts(report, incidents);
  // Cargo Watch report extras — computed once from the in-scope window so the
  // Fast Facts, the trend chart and the narrative all read the SAME records.
  const isCargo = report.topic === "cargo_watch";
  const cargoWindow =
    isCargo && report.topic && report.issueDate
      ? filterTopicReportIncidents(incidents, report.topic, report.issueDate)
      : [];
  const cargoExtras = isCargo
    ? buildCargoReportExtras(
        cargoWindow.map((i) => ({
          title: i.title,
          summary: i.summary ?? null,
          source: i.source ?? null,
          location: i.location ?? null,
          country: i.country ?? null,
          occurredAt: i.occurredAt,
        })),
      )
    : null;
  const cargoCountry = isCargo ? buildCargoCountryBreakdown(cargoWindow) : null;
  // Country-intensity choropleth — same per-country counting the monitor uses,
  // over the report's in-scope window. Drives the static "Cargo Theft Map".
  const cargoIntensity = isCargo
    ? buildCargoCountryIntensity(
        cargoWindow.map((i) => ({
          title: i.title,
          summary: i.summary ?? null,
          source: i.source ?? null,
          location: i.location ?? null,
          country: i.country ?? null,
          occurredAt: i.occurredAt,
        })),
      )
    : null;
  const cargoPorts = isCargo ? buildCargoPortBreakdown(cargoWindow) : null;
  // Cargo Incident Clusters dataset — the regrouped/clustered view shared with
  // the PDF (exportTopicReportPdf rebuilds it from the identical windowed set).
  const cargoGrouped =
    isCargo && report.issueDate
      ? buildCargoGroupedDataset(
          cargoWindow.map((i) => ({
            id: i.id,
            topic: i.topic,
            title: i.title,
            summary: i.summary ?? null,
            source: i.source ?? null,
            sourceUrl: i.sourceUrl ?? null,
            location: i.location ?? null,
            country: i.country ?? null,
            severity: i.severity ?? null,
            occurredAt: i.occurredAt,
          })),
          { referenceDate: report.issueDate },
        )
      : null;
  // Related Incidents table — shared selection (selectRelatedIncidents) so the
  // preview lists the SAME rows, in the same order, as the PDF's
  // drawRelatedIncidents (parity guarantee). The window here matches the PDF's
  // windowIncidents exactly (filterTopicReportIncidents == the PDF filter).
  // Fuel has its own bespoke preview branch and is excluded.
  const relatedRows =
    !isFuel && report.topic && report.issueDate
      ? selectRelatedIncidents(
          isCargo
            ? cargoWindow
            : filterTopicReportIncidents(incidents, report.topic, report.issueDate),
          report.topic,
        )
      : [];
  if (cargoExtras) {
    fastFacts.push({
      label: "Est. Cargo Loss (USD)",
      value: formatCargoUsd(cargoExtras.usd),
      note: cargoUsdNote(cargoExtras.usd),
    });
    fastFacts.push({
      label: "Most Stolen Commodity",
      value: cargoExtras.commodity ?? "—",
      note: cargoCommodityNote(cargoExtras),
    });
  }
  // Canonical Fuel Watch payload. Preview, PDF and the editor debug
  // panel all consume this — no renderer parses hardNumbers on its own.
  const fuelData = isFuel && renderIssueDate
    ? buildFuelWatchReportData(
        {
          title: report.title,
          issueDate: renderIssueDate,
          executiveSummary: report.executiveSummary,
          situation: report.situation,
          whatHappened: report.whatHappened,
          whatMatters: report.whatMatters,
          implications: resolveSimpleProse(report.implications, aiProse?.implications, ""),
          polestarView: report.polestarView,
          watchNext: resolveSimpleProse(report.watchNext, aiProse?.watchNext, ""),
          hardNumbers: report.hardNumbers,
        },
        incidents,
      )
    : null;
  const periodLabel = report.topic && renderIssueDate
    ? resolveReportWindow(report.topic, renderIssueDate).label
    : "";
  const coverUrl = topicCoverUrl(report.topic);

  // Deterministic per-topic draft — the labelled fallback beneath the AI
  // narrative and any analyst edit. Built from the SAME windowed incident
  // set the PDF uses so the preview and the export agree.
  const proseDraft = stableDraftTopicReportProse({
    topic: report.topic ?? "",
    issueDate: report.issueDate ?? new Date().toISOString().slice(0, 10),
    incidents: toDraftableIncidents(
      report.topic && report.issueDate
        ? filterTopicReportIncidents(incidents, report.topic, report.issueDate)
        : incidents,
    ),
    // Fuel: the canonical-subset Gulf & Hormuz Chokepoint Watch from the same
    // payload rendered below. It cannot introduce records outside Fuel Watch's
    // qualifying incident set.
    fuelGulf: fuelData?.incidentData.gulfChokepointWatch ?? null,
  });
  // FINAL EFFECTIVE Fuel narrative (analyst edit -> AI -> canonical) from the
  // ONE shared resolver the PDF exporter and editor prefill also call, so all
  // three surfaces render byte-identical section text.
  const fuelEffective = fuelData
    ? resolveFuelEffectiveSections({
        report: {
          executiveSummary: report.executiveSummary,
          situation: report.situation,
          whatHappened: report.whatHappened,
          whatMatters: report.whatMatters,
          polestarView: report.polestarView,
          fuelMarketRead: report.fuelMarketRead,
          fuelOperationalRead: report.fuelOperationalRead,
          fuelRegionalHighlights: report.fuelRegionalHighlights,
        },
        aiProse,
        fuelData,
      })
    : null;
  const execText = fuelEffective
    ? (fuelEffective.executiveSummary ?? "")
    : resolveSimpleProse(
        report.executiveSummary,
        aiProse?.executiveSummary,
        proseDraft.executiveSummary,
      );

  // Fuel Watch HARD consistency gate — the SAME reconciliation the PDF
  // exporter throws on, surfaced here as a blocking panel so preview == PDF:
  // a contradictory payload can neither be previewed as clean nor exported.
  // Two layers, exactly as the exporter runs them: the strict canonical gate
  // over the canonical payload PLUS the resolved Gulf read override (canonical
  // text passes by construction), and the prose-tolerant gate over the FINAL
  // effective text (whichever tier wins).
  const resolvedFuelGulfRead = fuelData?.incidentData.gulfChokepointWatch
    ? resolvePanelRead(
        sectionOverrides,
        PANEL_READ_GULF_HORMUZ,
        fuelData.incidentData.gulfChokepointWatch.read,
      ).text
    : undefined;
  const fuelConsistencyErrors = fuelData
    ? validateFuelCanonicalText(fuelData.canonicalFacts, {
        ...fuelData.narrativeData.canonicalSections,
        gulfAndHormuzChokepointWatch: resolvedFuelGulfRead,
      })
    : [];
  const fuelEffectiveIssues =
    fuelData && fuelEffective
      ? validateFuelEffectiveText(fuelData.reportFacts, fuelEffective)
      : [];
  if (fuelConsistencyErrors.length > 0 || fuelEffectiveIssues.length > 0) {
    return (
      <div
        className="print-report bg-white"
        style={{ color: NAVY, fontFamily: "Roboto, sans-serif", padding: 40 }}
        data-fuel-validation-blocked="true"
      >
        <div style={{ border: "2px solid #A33232", padding: 24 }}>
          <div
            style={{
              fontFamily: "'Roboto Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 20,
              color: "#A33232",
              marginBottom: 12,
            }}
          >
            Fuel Watch consistency gate failed — export blocked
          </div>
          <p style={{ fontSize: 13, marginBottom: 16 }}>
            The rendered sections contradict the report's calculated facts.
            Fix the flagged sections and the report will render and export
            normally.
          </p>
          <ul className="list-disc pl-5 space-y-2" style={{ fontSize: 13 }}>
            {fuelConsistencyErrors.map((issue, i) => (
              <li key={i}>
                <span style={{ fontWeight: 700 }}>{issue.section}:</span>{" "}
                {issue.conflictingStatement} — canonical value{" "}
                {issue.canonicalValue} ({issue.sourceField})
              </li>
            ))}
            {fuelEffectiveIssues.map((issue, i) => (
              <li key={`eff-${i}`}>
                <span style={{ fontWeight: 700 }}>{issue.section}:</span>{" "}
                [{issue.code}] {issue.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
      <div className="pdf-cover-page">
      {/* 1. Top gradient band — full width, logo left, no margins. */}
      <div
        className="flex items-center"
        style={{
          background: BRAND_GRADIENT,
          color: "#fff",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          height: 64,
          paddingLeft: 24,
          paddingRight: 24,
        }}
      >
        <img
          src={polestarLogo}
          alt="Polestar Advisory"
          style={{ height: 26, width: "auto", maxWidth: 180, display: "block" }}
        />
      </div>

      {/* 2. Hero band — cover photo when registered for the topic, otherwise gradient. */}
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          background: BRAND_GRADIENT,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          overflow: "hidden",
        }}
      >
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
      </div>

      {/* 3. Bottom gradient title block — title, subtitle, period, website. */}
      <div
        style={{
          background: BRAND_GRADIENT,
          color: "#fff",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          paddingLeft: 32,
          paddingRight: 32,
          paddingTop: 40,
          paddingBottom: 28,
        }}
      >
        <h1
          className="mb-4"
          style={{
            fontFamily: "Roboto, sans-serif",
            fontWeight: 700,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "0",
            textTransform: "uppercase",
          }}
        >
          {resolvedTitle || "Untitled report"}
        </h1>
        <div
          className="uppercase"
          style={{
            fontFamily: "Roboto, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.22em",
            marginBottom: 6,
          }}
        >
          POLESTAR INSIGHTS
        </div>
        {periodLabel && (
          <div
            className="uppercase"
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 400,
              fontSize: 12,
              letterSpacing: "0.18em",
              color: "rgba(255,255,255,0.92)",
            }}
          >
            REPORTING PERIOD: {periodLabel.replace(/^reporting period:\s*/i, "").toUpperCase()}
          </div>
        )}
        <div
          className="uppercase"
          style={{
            fontFamily: "Roboto, sans-serif",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.18em",
            marginTop: 32,
          }}
        >
          polestar-advisory.com
        </div>
      </div>
      </div>

      <div className="px-10 py-10">
        {execText.trim() && (
          <Section hidden={!show("executive-summary")} title="Executive Summary">
            <Paragraphs text={execText} />
          </Section>
        )}

        {isFuel && fuelData ? (
          <>
            <Section hidden={!show("fast-facts")} title="Fast Facts">
              {/* Fast Facts is built from marketData only — never back-filled
                  from incident counts. When required data is missing we show
                  the fail-closed banner instead of pretending. */}
              {!fuelData.validation.hasRequiredFuelWatchData && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#a33232",
                    fontFamily: "Roboto, sans-serif",
                    padding: 12,
                    background: "#fdecec",
                    border: "1px solid #a33232",
                    marginBottom: fuelData.marketData.fastFactsCards.length > 0 ? 12 : 0,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{FUEL_MISSING_REQUIRED_NOTE}</div>
                  <div>Missing: {fuelData.validation.missingRequired.join(", ")}.</div>
                </div>
              )}
              {fuelData.marketData.fastFactsCards.length > 0 && (
                <FastFactsGrid cards={applyFastFactOverrides(fuelData.marketData.fastFactsCards.map(toRenderableCard), ffOverrides)} />
              )}
              {fuelData.validation.warnings.map((w, i) => (
                <p
                  key={i}
                  className={fuelData.marketData.fastFactsCards.length > 0 ? "mt-3" : ""}
                  style={{ fontSize: 11, color: DUSK, fontFamily: "Roboto, sans-serif" }}
                >
                  {w}
                </p>
              ))}
            </Section>

            <Section hidden={!show("jet-fuel-trajectory")} title="Jet Fuel Price Trajectory">
              <JetFuelTrajectoryChart
                data={fuelData.marketData.jetFuelTrajectory.length >= 2 ? fuelData.marketData.jetFuelTrajectory : null}
                benchmarkLabel={fuelData.marketData.jetFuelBenchmarkLabel}
              />
              {fuelData.marketData.jetDataNote && (
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "Roboto, sans-serif",
                    fontSize: 11,
                    color: "#363636",
                  }}
                >
                  {fuelData.marketData.jetDataNote}
                </div>
              )}
            </Section>

            <NarrativeSection hidden={!show("market-read")} title="Market Read" text={fuelEffective?.marketRead} />
            <NarrativeSection hidden={!show("situation")} title="Situation" text={fuelEffective?.situation} />
            <NarrativeSection hidden={!show("what-happened")} title="What Happened" text={fuelEffective?.whatHappened} />
            <NarrativeSection hidden={!show("operational-read")} title="Operational Read" text={fuelEffective?.operationalRead} />
            <NarrativeSection hidden={!show("regional-highlights")} title="Regional Highlights" text={fuelEffective?.regionalHighlights} />
            {fuelData.incidentData.gulfChokepointWatch && (() => {
              // Owner per-bullet overrides (rewrite/suppress; blank = auto),
              // applied identically in the PDF exporter so preview == PDF.
              const gulf = fuelData.incidentData.gulfChokepointWatch;
              const gbOverrides = sectionOverrides?.gulfBulletOverrides;
              const currentLines = applyGulfBulletOverrides(gulf.currentItemLines, gbOverrides);
              const standingLines = applyGulfBulletOverrides(gulf.standingItemLines, gbOverrides);
              return (
                <Section hidden={!show("gulf-hormuz")} title="Gulf and Hormuz Chokepoint Watch">
                  {/* Staleness-guarded override — same resolvePanelRead the PDF
                      exporter uses, so preview == PDF. */}
                  <Paragraphs text={resolvedFuelGulfRead ?? gulf.read} />
                  {currentLines.length > 0 && (
                    <ul
                      className="list-disc pl-5 space-y-1.5"
                      style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
                    >
                      {currentLines.map((line, i) => (
                        <li key={i} className="text-[14px] leading-[1.6] font-light">
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                  {gulf.standingNote && standingLines.length > 0 && (
                    <>
                      <div
                        className="text-[13px] leading-[1.5] font-medium mt-3 mb-1"
                        style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
                      >
                        {gulf.standingNote}
                      </div>
                      <ul
                        className="list-disc pl-5 space-y-1.5"
                        style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
                      >
                        {standingLines.map((line, i) => (
                          <li key={i} className="text-[14px] leading-[1.6] font-light">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Section>
              );
            })()}
            {(() => {
              // Owner per-row overrides (rewrite cells / suppress rows). The
              // section is omitted entirely when every row is suppressed.
              const producerRows = applyMarketOperatorOverrides(
                fuelData.incidentData.producerBuyerActions,
                sectionOverrides?.marketOperatorOverrides,
              );
              return producerRows.length > 0 ? (
                <Section hidden={!show("producer-buyer")} title="Market and Operator Responses">
                  <ProducerActionsTable rows={producerRows} />
                </Section>
              ) : null;
            })()}
            <NarrativeSection hidden={!show("what-matters")} title="What Matters" text={fuelEffective?.whatMatters} />
            <BulletsSection hidden={!show("implications")} title="Implications for Business" text={fuelData.narrativeData.implications} />
            <BulletsSection hidden={!show("watch-next")} title="Watch Next" text={fuelData.narrativeData.watchNext} max={8} />
            <NarrativeSection hidden={!show("polestar-view")} title="Polestar View" text={fuelEffective?.polestarView} />
          </>
        ) : (
          <>
            <Section hidden={!show("fast-facts")} title="Fast Facts">
              <FastFactsGrid cards={applyFastFactOverrides(fastFacts, ffOverrides)} />
            </Section>

            {(report.topic === "energy" || report.topic === "fertiliser") && (
              <Section hidden={!show("market-prices")} title="Market Prices">
                <MarketPricesReportSection rows={applyMarketPriceOverrides(marketPrices ?? [], sectionOverrides?.marketPriceOverrides)} />
              </Section>
            )}

            {isCargo && cargoIntensity && cargoIntensity.size > 0 && (
              <Section title="Cargo Theft Map">
                <CargoChoroplethStatic intensity={cargoIntensity} />
              </Section>
            )}

            {isCargo && cargoExtras && cargoExtras.trend.length >= 2 && (
              <Section title="Cargo Theft Trend">
                <CargoTrendChart data={cargoExtras.trend} />
              </Section>
            )}

            {(() => {
              return (
                <>
                  {isCargo && (
                    <>
                      <NarrativeSection
                        title="Cargo Security Read"
                        text={pickRead(report.cargoSecurityRead, buildCargoSecurityRead(cargoWindow))}
                      />
                      <NarrativeSection
                        title="Logistics Hub Read"
                        text={pickRead(report.logisticsHubRead, buildLogisticsHubRead(cargoWindow))}
                      />
                      {cargoCountry && cargoCountry.rows.length > 0 && (
                        <>
                          <Section title="Country Risk Breakdown">
                            <CargoCountryTable rows={cargoCountry.rows} />
                          </Section>
                          {pickRead(report.regionalCountryRead, cargoCountry.regionalRead) && (
                            <NarrativeSection
                              title="Regional Read"
                              text={pickRead(report.regionalCountryRead, cargoCountry.regionalRead)}
                            />
                          )}
                        </>
                      )}
                      {cargoPorts && (
                        <Section title="Named Port Breakdown">
                          {cargoPorts.rows.length > 0 ? (
                            <CargoPortTable rows={cargoPorts.rows} />
                          ) : (
                            <p style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, margin: 0 }}>
                              Not reported.
                            </p>
                          )}
                          <p style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, color: DUSK, opacity: 0.7, margin: "6px 0 0" }}>
                            {cargoPorts.coverageLabel}
                          </p>
                        </Section>
                      )}
                    </>
                  )}
                  <NarrativeSection
                    hidden={!show("situation")} title="Situation"
                    text={isCargo
                      ? pickRead(report.situation, aiOr(aiProse?.situation, buildCargoSituation(cargoWindow)))
                      : resolveSimpleProse(report.situation, aiProse?.situation, proseDraft.situation)}
                  />
                  <NarrativeSection
                    hidden={!show("what-happened")} title="What Happened"
                    text={isCargo
                      ? pickRead(report.whatHappened, aiOr(aiProse?.whatHappened, buildCargoWhatHappened(cargoWindow)))
                      : resolveSimpleProse(report.whatHappened, aiProse?.whatHappened, proseDraft.whatHappened)}
                  />
                  <NarrativeSection
                    hidden={!show("what-matters")} title="What Matters"
                    text={isCargo
                      ? pickRead(report.whatMatters, aiOr(aiProse?.whatMatters, buildCargoWhatMatters(cargoWindow)))
                      : resolveSimpleProse(report.whatMatters, aiProse?.whatMatters, proseDraft.whatMatters)}
                  />
                  <BulletsSection
                    hidden={!show("implications")} title="Implications for Business"
                    text={isCargo
                      ? pickRead(report.implications, aiOr(aiProse?.implications, buildCargoImplications(cargoWindow)))
                      : resolveSimpleProse(report.implications, aiProse?.implications, proseDraft.implications)}
                  />
                  <BulletsSection
                    hidden={!show("watch-next")} title="Watch Next"
                    text={isCargo
                      ? pickRead(report.watchNext, aiOr(aiProse?.watchNext, buildCargoWatchNext(cargoWindow)))
                      : resolveSimpleProse(report.watchNext, aiProse?.watchNext, proseDraft.watchNext)}
                    max={8}
                  />
                  <NarrativeSection
                    hidden={!show("polestar-view")} title="Polestar View"
                    text={isCargo
                      ? pickRead(report.polestarView, aiOr(aiProse?.polestarView, buildCargoPolestarView(cargoWindow)))
                      : resolveSimpleProse(report.polestarView, aiProse?.polestarView, proseDraft.polestarView)}
                  />
                  {isCargo && cargoGrouped && (
                    <CargoClustersSection grouped={cargoGrouped} />
                  )}
                  {relatedRows.length > 0 && (
                    <Section hidden={!show("related-incidents")} title="Related Incidents">
                      <RelatedIncidentsTable rows={relatedRows} summaries={incidentSummaries} />
                    </Section>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Full-bleed Polar Gray footer — website, email, page note */}
      <div className="px-10 pb-10">
        <Section title="Disclaimer">
          <Paragraphs text={DISCLAIMER_TEXT} />
        </Section>
      </div>

      <div
        className="pdf-preview-footer px-10 flex items-center justify-between"
        style={{
          background: POLAR,
          color: DUSK,
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          minHeight: 36,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
    </div>
  );
}
