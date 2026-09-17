import {
  makeSectionGate,
  applyFastFactOverrides,
  applyMarketPriceOverrides,
  applyMarketOperatorOverrides,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { format, parseISO } from "date-fns";
import { TOPIC_LABELS, severityBadgeStyle } from "@/lib/topics";
import { resolveReportWindow } from "@/lib/reportWindow";
import { canonicalTopic, resolveReportTitle } from "@/lib/reportNaming";
import {
  buildRegionalDevelopments,
  buildApacWeeklyDevelopments,
  buildApacWeeklyBluf,
  buildRegionalBluf,
  buildRegionalDomainBriefs,
  buildRegionalOutlook,
  buildApacWeeklyOutlook,
  buildRegionalIntelligencePicture,
  buildRegionalBusinessRisk,
  buildRegionalTravelImplications,
  buildRegionalWatchlist,
  buildApacWeeklyWatchlist,
  buildRegionalGlanceItems,
  buildRegionalMapPoints,
  buildApacBusinessImplications,
  curateRegionalWeeklyIncidents,
  isRegionalWeeklyTopic,
  resolveRegionalNarrative,
  type RegionalDevelopment,
  type RegionalFutureEventInput,
} from "@/lib/regionalWeekly";
import { pickRead } from "@/lib/pickRead";
import { DISCLAIMER_TEXT, SEV_COLOR, SEV_LABEL, sevKey } from "@/lib/pdfChrome";
import { topicCoverUrl } from "@/lib/coverImages";
import { computeTopicFastFacts, filterTopicReportIncidents, type TopicFastFactsIncident } from "@/lib/topicFastFacts";
import { displayIncidentTitle } from "@/lib/incidentTitle";
import { selectRelatedIncidents } from "@/lib/relatedIncidents";
import {
  aiOr,
  resolveSimpleProse,
  stableDraftTopicReportProse,
  toDraftableIncidents,
  type TopicAiProse,
} from "@/lib/topicProseResolution";
import { classifyIncidentType } from "@/lib/incidentClassifier";
import { resolveIncidentSummary } from "@/lib/incidentSummary";
import {
  EnergyFlowPages,
  type EnergyReportSectionGate,
} from "@/components/EnergyFlowPages";
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
  finalizeFuelPublication,
  fuelMarketLatestDate,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "@/lib/fuelWatchReport";
import JetFuelTrajectoryChart from "@/components/JetFuelTrajectoryChart";
import FuelCoverageSummary from "@/components/FuelCoverageSummary";
import { MarketPricesReportSection } from "@/components/MarketPrices";
import type { MarketPrice } from "@workspace/api-client-react";
import EnergySituationVisual, { ENERGY_REPORT_MAP_HEIGHT } from "@/components/EnergySituationVisual";
import { buildCountryIntensity } from "@/components/CountryChoroplethMap";
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
import IncidentMap from "@/components/IncidentMap";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";
type ReportSectionGate = EnergyReportSectionGate;

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

function ApacDevelopmentCards({ developments }: { developments: RegionalDevelopment[] }) {
  return (
    <div className="space-y-4">
      {developments.map((development, index) => (
        <article
          key={`${development.country}-${development.title}-${index}`}
          className="border border-[#e2e2e2] border-l-[3px] border-l-[#465bff] bg-white p-4"
        >
          <h3
            className="uppercase tracking-wide text-[13px] font-bold mb-2"
            style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}
          >
            {development.country} | {development.title}
          </h3>
          <div className="space-y-2 text-[12px] leading-[1.55]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
            <p><strong>Category:</strong> {development.category} &nbsp; <strong>Current Severity:</strong> {development.severity}</p>
            <p><strong>WHAT CHANGED:</strong> {development.whatChanged}</p>
            <p><strong>OPERATIONAL IMPACT:</strong> {development.operationalImpact || development.operationalSignificance}</p>
            {development.polestarView && <p><strong>POLESTAR VIEW:</strong> {development.polestarView}</p>}
            {development.outlook7Days && <p><strong>OUTLOOK 7 DAYS:</strong> {development.outlook7Days}</p>}
          </div>
        </article>
      ))}
      {developments.length === 0 && (
        <p className="text-[12px] text-muted-foreground" style={{ fontFamily: "Roboto, sans-serif" }}>
          No qualifying developments were identified in the reporting period.
        </p>
      )}
    </div>
  );
}

function ApacThemes({ themes }: { themes: RegionalDevelopment[] }) {
  return (
    <div className="space-y-4">
      {themes.map((theme, index) => (
        <div key={index} className="border-l-[3px] border-l-[#465bff] bg-[#f7f8fb] p-4">
          <h3 className="uppercase tracking-wide text-[13px] font-bold mb-2" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
            {theme.country} | {theme.title}
          </h3>
          <div className="space-y-2 text-[12px] leading-[1.55]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
             <p><strong>What Changed:</strong> {theme.whatChanged}</p>
             <p><strong>Why It Matters:</strong> {theme.operationalImpact || theme.operationalSignificance}</p>
          </div>
        </div>
      ))}
      {themes.length === 0 && (
        <p className="text-[12px] text-muted-foreground" style={{ fontFamily: "Roboto, sans-serif" }}>
          No major regional themes were identified in the reporting period.
        </p>
      )}
    </div>
  );
}

function ApacBusinessImplications({ blocks }: { blocks: ReturnType<typeof buildApacBusinessImplications> }) {
  return (
    <div className="space-y-6">
      {blocks.map((block, i) => (
        <div key={i} className="border border-[#e2e2e2] bg-white p-4 shadow-sm">
           <h3 className="uppercase tracking-wide text-[13px] font-bold mb-2" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
             {block.heading}
           </h3>
           <p className="text-[12px] leading-[1.55] m-0" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
             {block.body}
           </p>
        </div>
      ))}
      {blocks.length === 0 && (
        <p className="text-[12px] text-muted-foreground" style={{ fontFamily: "Roboto, sans-serif" }}>
          No specific regional business implications were identified.
        </p>
      )}
    </div>
  );
}

function RegionalDevelopmentCards({ developments }: { developments: RegionalDevelopment[] }) {
  return (
    <div className="space-y-4">
      {developments.map((development, index) => (
        <article
          key={`${development.country}-${development.title}-${index}`}
          className="border border-[#e2e2e2] border-l-[3px] border-l-[#465bff] bg-white p-4"
        >
          <h3
            className="uppercase tracking-wide text-[13px] font-bold mb-2"
            style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}
          >
            {development.country} | {development.title}
          </h3>
          <div className="space-y-2 text-[12px] leading-[1.55]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
            <p><strong>Category:</strong> {development.category} &nbsp; <strong>Current Severity:</strong> {development.severity}</p>
            <p><strong>What Changed:</strong> {development.whatChanged}</p>
            <p><strong>Why It Matters:</strong> {development.operationalSignificance}</p>
            {development.whatToWatch && <p><strong>What To Watch:</strong> {development.whatToWatch}</p>}
          </div>
        </article>
      ))}
      {developments.length === 0 && (
        <p className="text-[12px] text-muted-foreground" style={{ fontFamily: "Roboto, sans-serif" }}>
          No qualifying developments were identified in the reporting period.
        </p>
      )}
    </div>
  );
}

function RegionalDomainBriefs({
  briefs,
}: {
  briefs: ReturnType<typeof buildRegionalDomainBriefs>;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-5">
      {briefs.map((brief) => (
        <div key={brief.domain} className="border-l-[3px] border-l-[#465bff] bg-[#f7f8fb] p-4">
          <h3 className="uppercase tracking-wide text-[11px] font-bold mb-2" style={{ color: NAVY }}>
            {brief.heading}
          </h3>
          <p className="text-[12px] leading-[1.55] m-0" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
            {brief.assessment}
          </p>
        </div>
      ))}
    </div>
  );
}

function ApacWatchlist({
  items,
}: {
  items: ReturnType<typeof buildApacWeeklyWatchlist>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground" style={{ fontFamily: "Roboto, sans-serif" }}>
        No qualifying watch items were identified in the reporting period.
      </p>
    );
  }
  return (
    <div className="relative border-l-2 border-[#465bff] ml-4 space-y-6">
      {items.map((item, index) => (
        <div key={`${item.date}-${item.location}-${index}`} className="relative pl-6">
          <div className="absolute w-3 h-3 bg-[#465bff] rounded-full -left-[7px] top-1 border-2 border-white" />
          <div className="border border-[#e2e2e2] bg-white p-3 shadow-sm">
            <div className="flex justify-between items-baseline mb-2">
              <span className="font-bold text-[13px] tracking-wide" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
                {item.date} — {item.location}
              </span>
            </div>
            <div className="space-y-1.5 text-[12px] leading-[1.55]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
              <p><strong>Trigger / Event:</strong> {item.trigger}</p>
              <p><strong>Why It Matters:</strong> {item.whyItMatters}</p>
              {item.currentSeverity && <p><strong>Current Severity:</strong> {item.currentSeverity}</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RegionalWatchlist({
  items,
}: {
  items: ReturnType<typeof buildRegionalWatchlist>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground" style={{ fontFamily: "Roboto, sans-serif" }}>
        No qualifying watch items were identified in the reporting period.
      </p>
    );
  }
  return (
    <div className="relative border-l-2 border-[#465bff] ml-4 space-y-6">
      {items.map((item, index) => (
        <div key={`${item.date}-${item.location}-${index}`} className="relative pl-6">
          <div className="absolute w-3 h-3 bg-[#465bff] rounded-full -left-[7px] top-1 border-2 border-white" />
          <div className="border border-[#e2e2e2] bg-white p-3 shadow-sm">
            <div className="flex justify-between items-baseline mb-2">
              <span className="font-bold text-[13px] tracking-wide" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
                {item.date} — {item.location}
              </span>
            </div>
            <div className="space-y-1.5 text-[12px] leading-[1.55]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
              <p><strong>Trigger / Event:</strong> {item.trigger}</p>
              <p><strong>Why It Matters:</strong> {item.whyItMatters}</p>
              <p><strong>What To Watch:</strong> {item.whatToWatch}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RegionalHotspotMap({
  points,
}: {
  points: ReturnType<typeof buildRegionalMapPoints>;
}) {
  if (points.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground italic" style={{ fontFamily: "Roboto, sans-serif" }}>
        No selected development has a verified plottable location.
      </p>
    );
  }
  return (
    <div className="border border-[#d2d6e1] bg-[#f7f8fb]">
      <IncidentMap
        points={points.map(p => ({
          lat: p.lat,
          lng: p.lng,
          title: p.title,
          label: p.label,
          severity: p.severity,
          primary: false
        }))}
        height={320}
        showLabels={true}
      />
    </div>
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

function FastFactsGrid({
  cards,
  compact = false,
}: {
  cards: KpiPreviewCard[];
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const sevK = c.severity ? sevKey(c.severity) : "";
        const accent = sevK && SEV_COLOR[sevK] ? SEV_COLOR[sevK] : ELECTRIC;
        return (
          <div
            key={i}
            className="bg-white border rounded-sm relative"
            style={{
              borderColor: POLAR,
              paddingLeft: 14,
              paddingRight: 12,
              paddingTop: compact ? 7 : 10,
              paddingBottom: compact ? 7 : 10,
            }}
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
              style={{
                fontFamily: "Roboto, sans-serif",
                fontWeight: 700,
                fontSize: compact ? 16 : 20,
                color: NAVY,
                marginTop: 4,
                lineHeight: 1.1,
              }}
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
                {displayIncidentTitle(r.title, r.displayTitle)}
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

export function EnergyReportPages({
  resolvedTitle,
  periodLabel,
  coverUrl,
  fastFacts,
  execText,
  situationText,
  whatHappenedText,
  whatMattersText,
  implicationsText,
  watchNextText,
  polestarViewText,
  energyIntensity,
  marketPrices,
  show,
  ffOverrides,
  sectionOverrides,
}: {
  resolvedTitle: string;
  periodLabel: string;
  coverUrl?: string;
  fastFacts: KpiPreviewCard[];
  execText: string;
  situationText: string;
  whatHappenedText: string;
  whatMattersText: string;
  implicationsText: string;
  watchNextText: string;
  polestarViewText: string;
  energyIntensity: Map<string, number>;
  marketPrices?: MarketPrice[];
  show: ReportSectionGate;
  ffOverrides?: TopicSectionOverrides["fastFactOverrides"];
  sectionOverrides?: TopicSectionOverrides | null;
}) {

  return (
    <div
      className="energy-report-pages"
      style={{
        background: "#e2e2e2",
        padding: "16px 0",
      }}
    >
      <style>{`
        .energy-report-page {
          width: 210mm;
          min-height: 297mm;
          height: 297mm;
          margin: 0 auto 2rem;
          padding: 15mm 20mm;
          box-sizing: border-box;
          background: #fff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          position: relative;
          overflow: visible;
          page-break-after: always;
          break-after: page;
        }
        .energy-report-cover-page {
          padding: 0;
          overflow: hidden;
        }
        @media print {
          .energy-report-pages {
            background: transparent !important;
            padding: 0 !important;
          }
          .energy-report-page {
            width: 100%;
            min-height: 297mm;
            height: auto;
            margin: 0;
            box-shadow: none;
          }
          .energy-report-cover-page {
            width: 100%;
            height: 297mm;
            min-height: 297mm;
          }
        }
      `}</style>

      {/* PAGE 1 — Existing cover. */}
      <div className="energy-report-page energy-report-cover-page" data-energy-page="1">
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

          {/* 2. Hero band — existing registered cover image/gradient. */}
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

          {/* 3. Existing bottom gradient title block. */}
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
      </div>

      {/* All post-cover sections are measured and paginated from their current
          content. The page labels below are a display concern, not a layout
          contract: Fast Facts through legal copy may naturally span any number
          of physical pages. */}
      <EnergyFlowPages
        fastFactsContent={
          <FastFactsGrid cards={applyFastFactOverrides(fastFacts, ffOverrides)} compact />
        }
        execText={execText}
        mapContent={<EnergySituationVisual intensity={energyIntensity} mapHeight={ENERGY_REPORT_MAP_HEIGHT} />}
        marketPrices={marketPrices}
        situationText={situationText}
        whatHappenedText={whatHappenedText}
        whatMattersText={whatMattersText}
        implicationsText={implicationsText}
        watchNextText={watchNextText}
        polestarViewText={polestarViewText}
        show={show}
        sectionOverrides={sectionOverrides}
      />
    </div>
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
  futureEvents = [],
}: {
  report: ReportPreviewData;
  incidents?: TopicFastFactsIncident[];
  incidentSummaries?: Record<string, string>;
  aiProse?: TopicAiProse | null;
  marketPrices?: MarketPrice[];
  hiddenSections?: string[];
  sectionOverrides?: TopicSectionOverrides | null;
  futureEvents?: RegionalFutureEventInput[];
}) {
  const show = makeSectionGate(hiddenSections);
  const ffOverrides = sectionOverrides?.fastFactOverrides;
  void canonicalTopic; void format; void parseISO;
  const resolvedTitle = report.topic
    ? resolveReportTitle(report.topic, report.title)
    : (report.title ?? "");
  const isFuel = report.topic === "fuel";
  const isRegionalWeekly = isRegionalWeeklyTopic(report.topic ?? "");
  const regionalTopic =
    report.topic === "apac_weekly" || report.topic === "middle_east_weekly"
      ? report.topic
      : null;
  const regionalCuratedIncidents = regionalTopic
    ? curateRegionalWeeklyIncidents(incidents, regionalTopic, report.issueDate ?? "")
    : [];
  const regionalDevelopments = isRegionalWeekly
    ? report.topic === "apac_weekly"
      ? buildApacWeeklyDevelopments(regionalCuratedIncidents, report.issueDate ?? undefined)
      : buildRegionalDevelopments(regionalCuratedIncidents, report.issueDate ?? undefined)
    : [];
  const regionalDomainBriefs = isRegionalWeekly
    ? buildRegionalDomainBriefs(regionalDevelopments, regionalTopic ?? undefined)
    : [];
  const regionalBluf = isRegionalWeekly
    ? report.topic === "apac_weekly"
      ? buildApacWeeklyBluf(regionalDevelopments)
      : buildRegionalBluf(regionalDevelopments)
    : "";
  const regionalOutlook = isRegionalWeekly
    ? report.topic === "apac_weekly"
      ? buildApacWeeklyOutlook(regionalDevelopments)
      : buildRegionalOutlook(regionalDevelopments)
    : "";
  const regionalTravelImplications = isRegionalWeekly ? buildRegionalTravelImplications(regionalDevelopments) : "";
  const regionalWatchlist = isRegionalWeekly ? buildRegionalWatchlist(regionalDevelopments) : [];
  const regionalGlanceItems = isRegionalWeekly ? buildRegionalGlanceItems(regionalDevelopments, regionalTopic ?? undefined) : [];
  const regionalMapPoints = isRegionalWeekly ? buildRegionalMapPoints(regionalCuratedIncidents, regionalTopic ?? undefined) : [];
  const apacGlanceMetrics = report.topic === "apac_weekly" ? [
    { label: "Material Developments", value: regionalDevelopments.length.toString() },
    { label: "Markets Affected", value: new Set(regionalDevelopments.map(d => d.country)).size.toString() },
    { label: "Operational Disruptions", value: regionalDevelopments.filter(d => d.category === "Operational Disruption").length.toString() },
    { label: "Regulatory Changes", value: regionalDevelopments.filter(d => d.category === "Regulatory").length.toString() },
    { label: "Forward Watch Items", value: regionalDevelopments.filter(d => d.whatToWatch || d.outlook7Days).length.toString() },
  ].filter(m => parseInt(m.value) > 0).slice(0, 5) : [];

  const apacThemes = report.topic === "apac_weekly" ? regionalDevelopments.slice(0, 6) : [];
  const apacImplications = report.topic === "apac_weekly" ? buildApacBusinessImplications(regionalDevelopments) : [];
  const apacWatchlist = report.topic === "apac_weekly" ? buildApacWeeklyWatchlist(regionalDevelopments, futureEvents, report.issueDate) : [];

  const isEnergy = report.topic === "energy";
  // Fuel Watch is a MARKET product: its reporting-period END is the latest
  // market close the report carries, NOT the stored issue date. Deriving the
  // render date here keeps the cover date, period label, incident window and
  // chart anchored to the same market close (matches exportTopicReportPdf).
  // A fuel draft with no dated market data yet falls back to the issue date.
  const renderIssueDate =
    isFuel && report.issueDate
      ? (fuelMarketLatestDate(report.hardNumbers) ?? report.issueDate)
      : report.issueDate;
  const fastFacts = isFuel || isRegionalWeekly ? [] : computePreviewFastFacts(report, incidents);
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
          title: displayIncidentTitle(i.title, i.displayTitle),
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
          title: displayIncidentTitle(i.title, i.displayTitle),
          summary: i.summary ?? null,
          source: i.source ?? null,
          location: i.location ?? null,
          country: i.country ?? null,
          occurredAt: i.occurredAt,
        })),
      )
    : null;
  const cargoPorts = isCargo ? buildCargoPortBreakdown(cargoWindow) : null;
  // Energy Situation reuses the existing topic-monitor world choropleth. The
  // intensity is the same in-window, topic-relevant country count used by the
  // monitor; no new location classification is introduced by the preview.
  const energyIntensity = (() => {
    if (!isEnergy || !report.issueDate) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const incident of filterTopicReportIncidents(incidents, "energy", report.issueDate)) {
      const country = (incident.country ?? "").trim();
      if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    return buildCountryIntensity(
      Array.from(counts.entries()).map(([country, count]) => ({ country, count })),
    );
  })();
  // Cargo Incident Clusters dataset — the regrouped/clustered view shared with
  // the PDF (exportTopicReportPdf rebuilds it from the identical windowed set).
  const cargoGrouped =
    isCargo && report.issueDate
      ? buildCargoGroupedDataset(
          cargoWindow.map((i) => ({
            id: i.id,
            topic: i.topic,
            title: i.title,
            displayTitle: i.displayTitle,
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
  // Fuel has its own canonical-family preview branch assembled below.
  const relatedRows =
    !isFuel && !isRegionalWeekly && report.topic && report.issueDate
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
  const fuelBundle = isFuel && renderIssueDate
    ? finalizeFuelPublication({
        report: {
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
        aiProse,
      })
    : null;
  const fuelData = fuelBundle?.reportData ?? null;
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
      isRegionalWeekly
        ? incidents
        : report.topic && report.issueDate
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
  const fuelEffective = fuelBundle?.effectiveSections ?? null;
  const execText = isRegionalWeekly
    ? regionalBluf
    : fuelEffective
    ? (fuelEffective.executiveSummary ?? "")
    : resolveSimpleProse(
        report.executiveSummary,
        aiProse?.executiveSummary,
        proseDraft.executiveSummary,
      );

  if (isEnergy) {
    return (
      <div
        className="print-report bg-white"
        style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}
      >
        <EnergyReportPages
          resolvedTitle={resolvedTitle}
          periodLabel={periodLabel}
          coverUrl={coverUrl}
          fastFacts={fastFacts}
          execText={execText}
          situationText={resolveSimpleProse(
            report.situation,
            aiProse?.situation,
            proseDraft.situation,
          )}
          whatHappenedText={resolveSimpleProse(
            report.whatHappened,
            aiProse?.whatHappened,
            proseDraft.whatHappened,
          )}
          whatMattersText={resolveSimpleProse(
            report.whatMatters,
            aiProse?.whatMatters,
            proseDraft.whatMatters,
          )}
          implicationsText={resolveSimpleProse(
            report.implications,
            aiProse?.implications,
            proseDraft.implications,
          )}
          watchNextText={resolveSimpleProse(
            report.watchNext,
            aiProse?.watchNext,
            proseDraft.watchNext,
          )}
          polestarViewText={resolveSimpleProse(
            report.polestarView,
            aiProse?.polestarView,
            proseDraft.polestarView,
          )}
          energyIntensity={energyIntensity}
          marketPrices={marketPrices}
          show={show}
          ffOverrides={ffOverrides}
          sectionOverrides={sectionOverrides}
        />
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

      {report.topic === "apac_weekly" ? (
        <div className="regional-weekly-body">
          {/* Page 2: Regional Outlook & Week at a Glance */}
          <div className="px-10 py-10">
            <Section hidden={!show("executive-summary")} title="Regional Outlook">
              <Paragraphs text={regionalBluf} />
            </Section>

            <div style={{ marginTop: 24, marginBottom: 32 }}>
              <RegionalHotspotMap points={regionalMapPoints} />
            </div>

            <Section hidden={!show("fast-facts")} title="Week at a Glance">
              <div className="grid grid-cols-2 gap-3 mt-2">
                {apacGlanceMetrics.map((item, i) => (
                  <div key={i} className="border border-[#e2e2e2] border-l-[3px] border-l-[#465bff] bg-white p-3 flex flex-col justify-center gap-1">
                    <span className="uppercase text-[10px] font-bold tracking-wide" style={{ color: NAVY }}>{item.label}</span>
                    <span className="text-[18px] font-bold leading-[1.1]" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* Page 3: What Changed This Week */}
          <div className="px-10 pb-10">
            <Section hidden={!show("situation")} title="What Changed This Week">
              <ApacThemes themes={apacThemes} />
            </Section>
          </div>

          {/* Page 4-5: Key Developments */}
          <div className="px-10 pb-10">
            <Section hidden={!show("what-happened")} title="Key Developments">
              <ApacDevelopmentCards developments={regionalDevelopments} />
            </Section>
          </div>

          {/* Page 6: Business Implications */}
          <div className="px-10 pb-10">
            <Section hidden={!show("implications")} title="Business Implications">
              <ApacBusinessImplications blocks={apacImplications} />
            </Section>
          </div>

          {/* Page 7: 7-Day Watch & Polestar Outlook */}
          <div className="px-10 pb-10">
            <Section hidden={!show("watch-next")} title="7 Day Watch">
              <ApacWatchlist items={apacWatchlist} />
            </Section>
            <div style={{ marginTop: 40 }}>
              <Section hidden={!show("polestar-view")} title="Polestar Outlook">
                <Paragraphs text={resolveRegionalNarrative(report.polestarView, aiProse?.polestarView, regionalOutlook)} />
              </Section>
            </div>
          </div>
        </div>
      ) : isRegionalWeekly ? (
        <div className="regional-weekly-body">
          {/* Page 2: Week at a Glance */}
          <div className="px-10 py-10 report-page" style={{ position: "relative" }}>
            <Section hidden={!show("executive-summary")} title="Week at a Glance">
              <h3 style={{ color: NAVY, fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 8, textTransform: "uppercase" }}>BLUF — Regional Outlook</h3>
              <Paragraphs text={regionalBluf} />
              <div style={{ marginTop: 24, marginBottom: 24 }}>
                <RegionalHotspotMap points={regionalMapPoints} />
              </div>
              <div className="grid grid-cols-1 gap-3 mt-6">
                {regionalGlanceItems.map((item, i) => (
                  <div key={i} className="border border-[#e2e2e2] border-l-[3px] border-l-[#465bff] bg-white p-3 flex items-center gap-4">
                    <span className="uppercase text-[11px] font-bold min-w-[150px]" style={{ color: NAVY }}>{item.category}</span>
                    <span className="text-[12px] leading-[1.45]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>{item.statement}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* Page 3: What Changed */}
          <div className="px-10 py-10 report-page" style={{ pageBreakBefore: "always", position: "relative" }}>
            <Section hidden={!show("situation")} title="What Changed">
              <RegionalDomainBriefs briefs={regionalDomainBriefs} />
            </Section>
          </div>

          {/* Page 4: Key Developments */}
          <div className="px-10 py-10 report-page" style={{ pageBreakBefore: "always", position: "relative" }}>
            <Section hidden={!show("what-happened")} title="Key Developments">
              <RegionalDevelopmentCards developments={regionalDevelopments} />
            </Section>
          </div>

          {/* Page 5: 7-Day Watch & Travel */}
          <div className="px-10 py-10 report-page" style={{ pageBreakBefore: "always", position: "relative" }}>
            <Section hidden={!show("watch-next")} title="7-Day Watchlist">
              <RegionalWatchlist items={regionalWatchlist} />
            </Section>
            <div style={{ marginTop: 40 }}>
              <Section hidden={!show("implications")} title="Travel & Personnel">
                <Paragraphs text={resolveRegionalNarrative(report.implications, aiProse?.implications, regionalTravelImplications)} />
              </Section>
            </div>
          </div>

          {/* Page 6: Polestar Outlook */}
          <div className="px-10 pt-10 report-page" style={{ pageBreakBefore: "always", position: "relative" }}>
            <Section hidden={!show("polestar-view")} title="Polestar Outlook">
              <Paragraphs text={resolveRegionalNarrative(report.polestarView, aiProse?.polestarView, regionalOutlook)} />
            </Section>
          </div>
        </div>
      ) : (
        <div className="px-10 py-10">
          {execText.trim() && (
            <Section
              hidden={!show("executive-summary")}
              title="Executive Summary"
            >
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
              {fuelBundle && (
                <div style={{ marginTop: 12 }}>
                  <FuelCoverageSummary canonicalFacts={fuelBundle.canonicalFacts} />
                </div>
              )}
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
            <NarrativeSection hidden={!show("implications")} title="Implications for Business" text={fuelEffective?.implications} />
            <NarrativeSection hidden={!show("polestar-view")} title="Polestar View" text={fuelEffective?.polestarView} />
            <NarrativeSection hidden={!show("watch-next")} title="Watch Next" text={fuelEffective?.watchNext} />
          </>
        ) : (
          <>
            {!isRegionalWeekly && (
              <Section hidden={!show("fast-facts")} title="Fast Facts">
                <FastFactsGrid cards={applyFastFactOverrides(fastFacts, ffOverrides)} />
              </Section>
            )}

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
      )}

      {/* Full-bleed Polar Gray footer — website, email, page note */}
      <div className="px-10 pb-10">
        <Section title="Disclaimer">
          <p
            className="leading-[1.7] mb-3 font-light"
            style={{ color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: "9pt" }}
          >
            {DISCLAIMER_TEXT}
          </p>
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
