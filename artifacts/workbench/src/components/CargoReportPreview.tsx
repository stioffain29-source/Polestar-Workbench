import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import { resolveReportTitle } from "@/lib/reportNaming";
import { makeSectionGate } from "@/lib/topicSectionOverrides";
import { resolveReportWindow } from "@/lib/reportWindow";
import { pickRead } from "@/lib/pickRead";
import { validateCargoReport } from "@/lib/cargoReportValidation";
import { topicCoverUrl } from "@/lib/coverImages";
import { DISCLAIMER_TEXT } from "@/lib/pdfChrome";
import {
  resolveSimpleProse,
  type TopicAiProse,
} from "@/lib/topicProseResolution";
import type { TopicFastFactsIncident, TopicFastFactCard } from "@/lib/topicFastFacts";
import {
  buildCargoPatternModel,
  type CargoPatternModelInput,
  type CargoAppendixRow,
} from "@/lib/cargoPatternModel";
import { sevChipColors } from "@/lib/cargoGraphicsTheme";
import CargoChoroplethStatic from "@/components/CargoChoroplethStatic";
import CargoTrendChart from "@/components/CargoTrendChart";
import CargoSupplyChainExposure from "@/components/CargoSupplyChainExposure";
import CargoPatternDashboard from "@/components/CargoPatternDashboard";
import CargoActivityMatrix from "@/components/CargoActivityMatrix";
import type { ReportPreviewData } from "@/components/ReportPreview";

// Cargo Watch pattern-report preview. Renders exactly the sections
// exportTopicReportPdf's cargo branch draws, in the same order, from the SAME
// model (buildCargoPatternModel), so the editor preview and the exported PDF
// can never disagree (user preference: preview == PDF for every rebuilt
// exporter). Everything reconciles because the model derives every surface from
// one deduplicated set of unique incidents.

const NAVY = "#0b0a3d";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const EXTREME_RED = "#A33232";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

function toBullets(text: string, max = 8): string[] {
  return text
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <section className="mb-8" style={{ breakInside: "avoid" }}>
      <h2
        className="uppercase"
        data-pdf-keep-with-next
        style={{
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: "0.06em",
          color: NAVY,
          borderBottom: `2px solid ${NAVY}`,
          paddingBottom: 6,
          marginBottom: 12,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\r?\n\r?\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return null;
  return (
    <>
      {paras.map((p, i) => (
        <p
          key={i}
          data-pdf-flow
          className="mb-3"
          style={{
            fontFamily: "Roboto, sans-serif",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: DUSK,
            margin: "0 0 10px",
          }}
        >
          {p}
        </p>
      ))}
    </>
  );
}

function Bullets({ text, max = 8 }: { text: string; max?: number }) {
  const items = toBullets(text, max);
  if (items.length === 0) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((b, i) => (
        <li
          key={i}
          data-pdf-flow
          style={{
            fontFamily: "Roboto, sans-serif",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: DUSK,
            marginBottom: 6,
          }}
        >
          {b}
        </li>
      ))}
    </ul>
  );
}

function FastFactsGrid({ cards }: { cards: TopicFastFactCard[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
      }}
    >
      {cards.map((c, i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${POLAR}`,
            borderLeft: `4px solid ${c.severity ? sevChipColors(c.severity).bg : "#465bff"}`,
            borderRadius: 3,
            padding: "10px 12px",
            background: "#fff",
          }}
        >
          <div
            className="uppercase"
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 700,
              fontSize: 9.5,
              letterSpacing: "0.1em",
              color: DUSK,
              opacity: 0.75,
              marginBottom: 4,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 700,
              fontSize: 18,
              lineHeight: 1.1,
              color: NAVY,
            }}
          >
            {c.value}
          </div>
          {c.note && (
            <div
              style={{
                fontFamily: "Roboto, sans-serif",
                fontSize: 10,
                color: DUSK,
                opacity: 0.7,
                marginTop: 4,
              }}
            >
              {c.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GraphicCaption({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <p
      data-pdf-flow
      style={{
        fontFamily: "Roboto, sans-serif",
        fontSize: 11.5,
        lineHeight: 1.6,
        color: DUSK,
        fontStyle: "italic",
        margin: "8px 0 0",
      }}
    >
      {text}
    </p>
  );
}

// Date rendered as "dd MMM yyyy" to match the PDF's cargoDateStr exactly
// (preview == PDF parity). Blank/invalid dates degrade to the ISO date slice.
function cargoDateStr(iso: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "dd MMM yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

// "Country — location" line for a card / annex row. Blank segments dropped; no
// fabricated placeholder text (mirrors the PDF's cargoPlaceLine).
function placeLine(r: CargoAppendixRow): string {
  const c = (r.country || "").trim();
  const l = (r.location || "").trim();
  if (c && l && l.toLowerCase() !== c.toLowerCase()) return `${c} — ${l}`;
  return c || l;
}

// Curated "Key Incidents" — up to MAX_SELECTED_INCIDENTS compact cards that best
// illustrate the period's main operational patterns (NOT the most recent).
// Mirrors the PDF's drawSelectedIncidents section, same order and fields: date +
// severity, location · type, summary, operational relevance and (only where the
// source carries an explicit signal) a resolved status. Confidence is
// deliberately omitted from the cards — it stays in the register and CSV.
const SELECTED_INCIDENTS_SUBTITLE =
  "Incidents that best illustrate the main operational patterns identified during the reporting period.";

function SelectedIncidents({
  rows,
  subtitle = SELECTED_INCIDENTS_SUBTITLE,
}: {
  rows: CargoAppendixRow[];
  subtitle?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, margin: 0 }}>
        No cargo-crime incidents were recorded this period.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {subtitle && (
        <p
          style={{
            fontFamily: "Roboto, sans-serif",
            fontSize: 11.5,
            fontStyle: "italic",
            lineHeight: 1.5,
            color: DUSK,
            margin: "0 0 2px",
          }}
        >
          {subtitle}
        </p>
      )}
      {rows.map((r) => {
        const chip = sevChipColors(r.severityKey);
        const meta = [placeLine(r), r.category].filter(Boolean).join("  ·  ");
        return (
          <div
            key={r.id}
            style={{
              border: `1px solid ${POLAR}`,
              padding: "10px 12px",
              breakInside: "avoid",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontWeight: 700,
                  fontSize: 12,
                  color: NAVY,
                }}
              >
                {cargoDateStr(r.date)}
              </span>
              <span
                style={{
                  display: "inline-block",
                  fontFamily: "Roboto, sans-serif",
                  fontWeight: 700,
                  fontSize: 9,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: chip.fg,
                  background: chip.bg,
                  borderRadius: 3,
                  padding: "2px 6px",
                  lineHeight: 1,
                }}
              >
                SEVERITY: {r.severityLabel}
              </span>
            </div>
            {meta && (
              <div
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontWeight: 500,
                  fontSize: 11,
                  color: DUSK,
                  marginTop: 4,
                }}
              >
                {meta}
              </div>
            )}
            <p
              style={{
                fontFamily: "Roboto, sans-serif",
                fontSize: 11.5,
                lineHeight: 1.45,
                color: NAVY,
                margin: "4px 0 0",
              }}
            >
              {r.summary}
            </p>
            {r.operationalRelevance && (
              <p
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: DUSK,
                  margin: "4px 0 0",
                }}
              >
                <span style={{ fontWeight: 700 }}>Operational relevance:</span>{" "}
                {r.operationalRelevance}
              </p>
            )}
            {r.clientStatus && (
              <p
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: DUSK,
                  margin: "2px 0 0",
                }}
              >
                <span style={{ fontWeight: 700 }}>Status:</span> {r.clientStatus}
              </p>
            )}
            {r.source && (
              <p
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: DUSK,
                  margin: "4px 0 0",
                }}
              >
                <span style={{ fontWeight: 700 }}>Source:</span> {r.source}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Full deduplicated incident register — the optional annex, rendered only when
// the author opts in. Same readable table as the PDF's drawFullAnnex.
function FullAnnexTable({ rows }: { rows: CargoAppendixRow[] }) {
  if (rows.length === 0) {
    return (
      <p style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, margin: 0 }}>
        No incidents were recorded this period.
      </p>
    );
  }
  const th: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#fff",
    background: NAVY,
    padding: "6px 8px",
    textAlign: "left",
    verticalAlign: "top",
  };
  const td: React.CSSProperties = {
    fontFamily: "Roboto, sans-serif",
    fontSize: 11,
    lineHeight: 1.4,
    color: DUSK,
    padding: "6px 8px",
    borderBottom: `1px solid ${POLAR}`,
    verticalAlign: "top",
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "9%" }} />
        <col style={{ width: "16%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "39%" }} />
        <col style={{ width: "10%" }} />
        <col style={{ width: "8%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={th}>Date</th>
          <th style={th}>Location</th>
          <th style={th}>Category</th>
          <th style={th}>Incident Summary</th>
          <th style={th}>Severity</th>
          <th style={th}>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const chip = sevChipColors(r.severityKey);
          return (
            <tr key={r.id} style={{ breakInside: "avoid" }}>
              <td style={td}>{cargoDateStr(r.date)}</td>
              <td style={td}>{placeLine(r)}</td>
              <td style={td}>{r.category}</td>
              <td style={td}>{r.summary}</td>
              <td style={td}>
                <span
                  style={{
                    display: "inline-block",
                    fontFamily: "Roboto, sans-serif",
                    fontWeight: 700,
                    fontSize: 9,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: chip.fg,
                    background: chip.bg,
                    borderRadius: 3,
                    padding: "2px 6px",
                    lineHeight: 1,
                  }}
                >
                  {r.severityLabel}
                </span>
              </td>
              <td style={td}>{r.confidenceLabel}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function CargoReportPreview({
  report,
  incidents = [],
  aiProse,
  includeFullAnnex = false,
  hiddenSections,
}: {
  report: ReportPreviewData;
  incidents?: TopicFastFactsIncident[];
  incidentSummaries?: Record<string, string>;
  aiProse?: TopicAiProse | null;
  /** Mirror of the PDF option: when true, append the full incident register as
   *  an annex after Polestar View. Off by default. */
  includeFullAnnex?: boolean;
  hiddenSections?: string[];
}) {
  const show = makeSectionGate(hiddenSections);
  const topic = report.topic ?? "cargo_watch";
  const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
  const resolvedTitle = resolveReportTitle(topic, report.title);
  const periodLabel = resolveReportWindow(topic, issueDate).label;
  const coverUrl = topicCoverUrl(topic);

  const model = useMemo(
    () =>
      buildCargoPatternModel(
        incidents.map(
          (i): CargoPatternModelInput => ({
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
          }),
        ),
        { issueDate },
      ),
    [incidents, issueDate],
  );

  // Executive Summary is a deterministic, analytical paragraph built from the
  // cargo model (spec TASK A): dominant supply-chain stage, leading patterns,
  // principal geography, overall severity and the main operational implication.
  // An owner override wins; the AI narrative layer is deliberately NOT consulted
  // here so the summary always honours the strict format rules (word count,
  // banned phrases). The assessment sections below stay editable via pickRead.
  const execText = resolveSimpleProse(
    report.executiveSummary,
    null,
    model.executiveSummary,
  );

  const a = model.assessment;
  const situationText = pickRead(report.situation, a.situation);
  const whatMattersText = pickRead(report.whatMatters, a.whatMatters.join("\n"));
  const implicationsText = pickRead(
    report.implications,
    a.implications.join("\n"),
  );
  const watchNextText = pickRead(report.watchNext, a.watchNext.join("\n"));
  const polestarViewText = pickRead(report.polestarView, a.polestarView);

  // HARD validation gate (spec pt7). Runs the ten checks over the SAME model +
  // resolved section text this preview renders (and the PDF exporter throws on),
  // so preview == PDF: a failing report shows a blocking panel here and cannot
  // be exported. A clean report passes by construction and renders normally.
  const validationIssues = useMemo(
    () =>
      validateCargoReport(
        model,
        {
          situation: report.situation,
          whatMatters: report.whatMatters,
          implications: report.implications,
          watchNext: report.watchNext,
          polestarView: report.polestarView,
        },
        issueDate,
      ),
    [
      model,
      report.situation,
      report.whatMatters,
      report.implications,
      report.watchNext,
      report.polestarView,
      issueDate,
    ],
  );

  if (validationIssues.length > 0) {
    return (
      <div
        className="print-report bg-white"
        style={{ color: NAVY, fontFamily: "Roboto, sans-serif", padding: 40 }}
        data-cargo-validation-blocked="true"
      >
        <div
          style={{
            border: `2px solid ${EXTREME_RED}`,
            padding: 24,
          }}
        >
          <div
            style={{
              fontFamily: "'Roboto Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 20,
              color: EXTREME_RED,
              marginBottom: 8,
            }}
          >
            Cargo Watch report blocked
          </div>
          <p style={{ fontSize: 13, color: DUSK, marginBottom: 16 }}>
            This report failed {validationIssues.length} validation{" "}
            {validationIssues.length === 1 ? "check" : "checks"} and cannot be
            previewed or exported until resolved. Correct the items below in the
            editor.
          </p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {validationIssues.map((issue) => (
              <li key={issue.code} style={{ marginBottom: 10 }}>
                <span style={{ fontWeight: 700, color: NAVY }}>
                  {issue.label}
                </span>
                <div style={{ fontSize: 12, color: DUSK }}>{issue.message}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
      <div className="pdf-cover-page">
        {/* 1. Top gradient band — logo left. */}
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

        {/* 2. Hero band — cover photo when registered, otherwise gradient. */}
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

        {/* 3. Bottom gradient title block. */}
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
        {/* PAGE 1 — Executive Summary + Fast Facts */}
        {execText.trim() && (
          <Section hidden={!show("executive-summary")} title="Executive Summary">
            <Paragraphs text={execText} />
          </Section>
        )}

        <Section hidden={!show("fast-facts")} title="Fast Facts">
          <FastFactsGrid cards={model.fastFacts} />
        </Section>

        {/* PAGE 2 — Geographic distribution. Map title reflects the theft-only
            predicate (spec pt3). */}
        {model.intensity.size > 0 && (
          <Section hidden={!show("map")} title={model.mapTitle}>
            <CargoChoroplethStatic intensity={model.intensity} title={model.mapTitle} />
            <GraphicCaption text={model.mapCaption} />
          </Section>
        )}

        {/* PAGE 3 — Weekly trend AND activity table COMBINED into one section so
            the report answers "how did the week move?" once, not across two
            near-duplicate pages (spec pt6). */}
        {(model.extras.trend.length >= 2 || model.activity.total > 0) && (
          <Section hidden={!show("weekly-trend")} title="Weekly Trend and Activity">
            {model.extras.trend.length >= 2 && (
              <>
                <CargoTrendChart data={model.extras.trend} />
                <GraphicCaption text={model.trendCaption} />
              </>
            )}
            {model.activity.total > 0 && (
              <div className="mt-6" style={{ breakInside: "avoid" }}>
                <CargoActivityMatrix activity={model.activity} />
              </div>
            )}
          </Section>
        )}

        {/* PAGE 4 — Supply-chain exposure + pattern dashboard. Each visual
            answers a different analytical question (spec pt6). */}
        {model.totalUnique > 0 && (
          <div className="mb-8" style={{ breakInside: "avoid" }}>
            <CargoSupplyChainExposure stages={model.stages} total={model.totalUnique} />
          </div>
        )}

        {model.totalUnique > 0 && (
          <div className="mb-8" style={{ breakInside: "avoid" }}>
            <CargoPatternDashboard patterns={model.patterns} />
          </div>
        )}

        {/* Enforcement outcomes — arrests, seizures and recoveries shown in their
            OWN panel and EXCLUDED from every operational total above (spec pt1). */}
        {model.enforcement.total > 0 && (
          <Section hidden={!show("enforcement")} title="Enforcement Activity">
            <p
              className="text-[12px] leading-[1.6] mb-3"
              style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
            >
              {model.enforcement.statement}
            </p>
            <SelectedIncidents rows={model.enforcement.rows} subtitle={null} />
          </Section>
        )}

        {/* Operational assessment */}
        {situationText.trim() && (
          <Section hidden={!show("situation")} title="Situation">
            <Paragraphs text={situationText} />
          </Section>
        )}
        {whatMattersText.trim() && (
          <Section hidden={!show("what-matters")} title="What Matters">
            <Bullets text={whatMattersText} max={3} />
          </Section>
        )}
        {implicationsText.trim() && (
          <Section hidden={!show("implications")} title="Implications">
            <Bullets text={implicationsText} max={3} />
          </Section>
        )}
        {watchNextText.trim() && (
          <Section hidden={!show("watch-next")} title="Watch Next">
            <Bullets text={watchNextText} max={4} />
          </Section>
        )}
        {/* Curated "Key Incidents" — up to MAX_SELECTED_INCIDENTS cards, before
            Polestar View. The full register lives in the Workbench + CSV. */}
        <Section hidden={!show("key-incidents")} title="Key Incidents">
          <SelectedIncidents rows={model.selected} />
        </Section>

        {polestarViewText.trim() && (
          <Section hidden={!show("polestar-view")} title="Polestar View">
            <Paragraphs text={polestarViewText} />
          </Section>
        )}

        {/* Optional full incident annex — off by default, after Polestar View. */}
        {includeFullAnnex && (
          <Section hidden={!show("incident-annex")} title="Incident Annex">
            <FullAnnexTable rows={model.appendix} />
          </Section>
        )}

        <Section title="Disclaimer">
          <p
            className="text-[12px] leading-[1.7]"
            style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
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
