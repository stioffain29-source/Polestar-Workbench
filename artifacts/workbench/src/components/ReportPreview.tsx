import { format, parseISO } from "date-fns";
import { TOPIC_LABELS } from "@/lib/topics";
import { resolveReportWindow } from "@/lib/reportWindow";
import { canonicalTopic, resolveReportTitle } from "@/lib/reportNaming";
import { DISCLAIMER_TEXT } from "@/lib/pdfChrome";
import { topicCoverUrl } from "@/lib/coverImages";
import { computeTopicFastFacts, filterTopicReportIncidents, type TopicFastFactsIncident } from "@/lib/topicFastFacts";
import {
  buildCargoSecurityRead,
  buildLogisticsHubRead,
  buildCargoWhatMatters,
  buildCargoImplications,
  buildCargoWatchNext,
  buildCargoPolestarView,
} from "@/lib/cargoNarratives";
import type { ProducerBuyerActionRow } from "@/lib/fuelNarratives";
import {
  buildFuelWatchReportData,
  fuelMarketLatestDate,
  toRenderableCard,
  FUEL_MISSING_REQUIRED_NOTE,
} from "@/lib/fuelWatchReport";
import JetFuelTrajectoryChart from "@/components/JetFuelTrajectoryChart";
import DataAsOfBanner from "@/components/DataAsOfBanner";
import { computeDataAsOf } from "@/lib/reportDataStatus";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

// Canonical severity palette — kept SEPARATE from brand colours.
// Brand (#0b0a3d / #465bff / #363636 / #e2e2e2) is reserved for chrome,
// headings and non-severity chart fills. #a33232 is reserved exclusively
// for the Fuel Watch fail-closed banner and must never appear here.
const SEV_COLOR: Record<string, string> = {
  Extreme: "#800000",
  High: "#C0392B",
  Moderate: "#E67E22",
  Low: "#6FB872",
  Insignificant: "#B8C2CC",
};

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
  polestarView?: string | null;
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

function BulletsSection({ title, text, max = 7 }: { title: string; text?: string | null; max?: number }) {
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-section mb-8">
      <h2
        className="uppercase pb-2 mb-4 tracking-wide"
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
function NarrativeSection({ title, text }: { title: string; text?: string | null }) {
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
        const accent = c.severity && SEV_COLOR[c.severity] ? SEV_COLOR[c.severity] : ELECTRIC;
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

function ProducerActionsTable({ rows }: { rows: ProducerBuyerActionRow[] }) {
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
}: {
  report: ReportPreviewData;
  incidents?: TopicFastFactsIncident[];
}) {
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
          implications: report.implications,
          polestarView: report.polestarView,
          watchNext: report.watchNext,
          hardNumbers: report.hardNumbers,
        },
        incidents,
      )
    : null;
  const periodLabel = report.topic && renderIssueDate
    ? resolveReportWindow(report.topic, renderIssueDate).label
    : "";
  const coverUrl = topicCoverUrl(report.topic);

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
        <DataAsOfBanner
          data={computeDataAsOf({
            topic: report.topic ?? "fuel",
            incidents,
            marketAsOf:
              report.topic === "fuel"
                ? fuelMarketLatestDate(report.hardNumbers)
                : null,
          })}
        />
        {report.executiveSummary && report.executiveSummary.trim() && (
          <Section title="Executive Summary">
            <Paragraphs text={report.executiveSummary} />
          </Section>
        )}

        {isFuel && fuelData ? (
          <>
            <Section title="Fast Facts">
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
                <FastFactsGrid cards={fuelData.marketData.fastFactsCards.map(toRenderableCard)} />
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

            <Section title="Jet Fuel Price Trajectory">
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
                    color: "#303030",
                  }}
                >
                  {fuelData.marketData.jetDataNote}
                </div>
              )}
            </Section>

            <NarrativeSection title="Market Read" text={fuelData.marketData.marketRead} />
            <NarrativeSection title="Situation" text={report.situation} />
            <NarrativeSection title="What Happened" text={report.whatHappened} />
            <NarrativeSection title="Operational Read" text={fuelData.incidentData.operationalRead} />
            <NarrativeSection title="Regional Highlights" text={fuelData.incidentData.regionalHighlights} />
            {fuelData.incidentData.producerBuyerActions.length > 0 && (
              <Section title="Producer and Buyer Actions">
                <ProducerActionsTable rows={fuelData.incidentData.producerBuyerActions} />
              </Section>
            )}
            <NarrativeSection title="What Matters" text={report.whatMatters} />
            <BulletsSection title="Implications for Business" text={fuelData.narrativeData.implications} />
            <BulletsSection title="Watch Next" text={fuelData.narrativeData.watchNext} max={8} />
            <NarrativeSection title="Polestar View" text={report.polestarView} />
          </>
        ) : (
          <>
            <Section title="Fast Facts">
              <FastFactsGrid cards={fastFacts} />
            </Section>

            {(() => {
              const isCargo = report.topic === "cargo_watch";
              const cargoWindow = isCargo && report.topic && report.issueDate
                ? filterTopicReportIncidents(incidents, report.topic, report.issueDate)
                : [];
              const pick = (editor: string | null | undefined, auto: string): string => {
                const t = (editor ?? "").trim();
                return t.length > 0 ? t : auto;
              };
              return (
                <>
                  {isCargo && (
                    <>
                      <NarrativeSection
                        title="Cargo Security Read"
                        text={buildCargoSecurityRead(cargoWindow)}
                      />
                      <NarrativeSection
                        title="Logistics Hub Read"
                        text={buildLogisticsHubRead(cargoWindow)}
                      />
                    </>
                  )}
                  <NarrativeSection title="Situation" text={report.situation} />
                  <NarrativeSection title="What Happened" text={report.whatHappened} />
                  <NarrativeSection
                    title="What Matters"
                    text={isCargo
                      ? pick(report.whatMatters, buildCargoWhatMatters(cargoWindow))
                      : report.whatMatters}
                  />
                  <BulletsSection
                    title="Implications for Business"
                    text={isCargo
                      ? pick(report.implications, buildCargoImplications(cargoWindow))
                      : report.implications}
                  />
                  <BulletsSection
                    title="Watch Next"
                    text={isCargo
                      ? pick(report.watchNext, buildCargoWatchNext(cargoWindow))
                      : report.watchNext}
                    max={8}
                  />
                  <NarrativeSection
                    title="Polestar View"
                    text={isCargo
                      ? pick(report.polestarView, buildCargoPolestarView(cargoWindow))
                      : report.polestarView}
                  />
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
