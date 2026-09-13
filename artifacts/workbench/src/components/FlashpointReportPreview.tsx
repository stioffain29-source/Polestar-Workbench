import { format } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import { resolveReportTitle } from "@/lib/reportNaming";
import {
  makeSectionGate,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { type TopicAiProse } from "@/lib/topicProseResolution";
import { TOPIC_COVER_URLS } from "@/lib/coverImages";
import {
  type FlashpointReportIncident,
  type KpiCard,
  type BarRow,
  type EnrichedIncident,
  type FlashpointRenderedModel,
  FLASHPOINT_SEV_LABEL,
} from "@/lib/flashpointReportDataset";
import {
  PROTEST_EMPTY_SENTENCE,
  PROTEST_FORECAST_HEADING,
  PROTEST_WATCHLIST_HEADING,
  protestScheduleActivity,
} from "@/lib/protestScheduleModel";
import {
  finalizeFlashpointPublication,
} from "@/lib/flashpointPublication";
import {
  isFinalReportIssueBlocking,
  type FinalReportEvidenceAuditIssue,
} from "@/lib/finalReportEvidenceAudit";
import { SEV_COLOR, parseBullets } from "@/lib/pdfChrome";
import type { ProtestEvent } from "@workspace/api-client-react";

// Flashpoint on-screen preview. Renders the same sections, in the same
// order, from the same dataset (buildFlashpointReportDataset) as
// exportFlashpointReportPdf so the editor preview and the export cannot
// disagree. Mirrors the visual language of ShippingReportPreview.

const DISCLAIMER_TEXT =
  "Polestar Advisory Pte. Ltd. is an independent company registered in Singapore. " +
  "The information in this report is based on open sources and is assessed as accurate at the time of writing. " +
  "It is provided for general informational purposes only and does not constitute advice or a comprehensive " +
  "assessment of all risks. No reliance should be placed on this information for decision making without " +
  "further independent verification.";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const f = 1 - amount;
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n * f)));
  return `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
}

function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

// Match exportFlashpointReportPdf: editor text replaces auto ONLY when it is
// a substantive custom write (>= 240 chars). Thin stubs use auto alone so
// What Matters never stacks two near-duplicate blocks.
export interface FlashpointPreviewReport {
  title?: string;
  topic?: string;
  issueDate?: string;
  author?: string | null;
  executiveSummary?: string | null;
  activismRead?: string | null;
  civilUnrestRead?: string | null;
  forecastRead?: string | null;
  regionalCountryRead?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
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

function toBullets(text?: string | null, max = 7): string[] {
  return parseBullets(text ?? "", max);
}

function Bullets({ text, max = 7 }: { text?: string | null; max?: number }) {
  const items = toBullets(text, max);
  if (items.length === 0) return null;
  return (
    <ul className="list-disc pl-5 space-y-1.5" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
      {items.map((it, i) => (
        <li key={i} className="text-[14px] leading-[1.6] font-light">{it}</li>
      ))}
    </ul>
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

function KpiGrid({ cards }: { cards: readonly KpiCard[] }) {
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
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: accent }} />
            <div className="uppercase tracking-widest" style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 9, color: DUSK }}>
              {c.label}
            </div>
            <div style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 20, color: NAVY, marginTop: 4, lineHeight: 1.15 }}>
              {c.value}
            </div>
            {c.note && (
              <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, color: DUSK, marginTop: 6 }}>
                {c.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeverityChip({ sevKey: k, label }: { sevKey: string; label: string }) {
  if (!k) return <span style={{ color: DUSK, fontSize: 11 }}>—</span>;
  const bg = SEV_COLOR[k] ?? "#999";
  return (
    <span
      className="uppercase inline-block text-center"
      style={{
        background: bg,
        color: "#fff",
        fontFamily: "Roboto, sans-serif",
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: "0.06em",
        padding: "3px 8px",
        minWidth: 64,
      }}
    >
      {label}
    </span>
  );
}

function IncidentTable({ rows, emptyMessage, rowLimit = 12 }: { rows: EnrichedIncident[]; emptyMessage: string; rowLimit?: number }) {
  if (rows.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13 }}>
        {emptyMessage}
      </p>
    );
  }
  const limited = rows.slice(0, rowLimit);
  const cols = "0.7fr 1.0fr 2.2fr 0.7fr";
  return (
    <div className="w-full border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: cols, background: NAVY, color: "#fff",
          fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 10,
          padding: "8px 10px", gap: 10,
        }}
      >
        <div>Date</div>
        <div>Issue</div>
        <div>Title</div>
        <div>Severity</div>
      </div>
      {limited.map((r, i) => (
        <div
          key={String(r.id)}
          className="grid"
          style={{
            gridTemplateColumns: cols, padding: "8px 10px", gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, alignItems: "start",
          }}
        >
          <div style={{ minWidth: 0 }}>{format(r.date, "dd MMM yyyy")}</div>
          <div style={{ minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>{r.issue}</div>
          <div style={{ color: NAVY, minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>{r.title}</div>
          <div>
            <SeverityChip
              sevKey={sevKey(r.severity)}
              label={FLASHPOINT_SEV_LABEL[sevKey(r.severity)] ?? r.severity}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProtestScheduleTable({
  rows,
}: {
  rows: readonly ProtestEvent[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="w-full overflow-x-auto border" style={{ borderColor: POLAR }}>
      <table className="min-w-[760px] w-full border-collapse" style={{ fontFamily: "Roboto, sans-serif", fontSize: 10 }}>
        <thead>
          <tr style={{ background: NAVY, color: "#FFFFFF" }}>
            {["Date", "Country", "Location", "Scheduled activity", "Assessment"].map((label) => (
              <th key={label} className="text-left px-2 py-2 whitespace-nowrap" style={{ fontWeight: 700, fontSize: 9 }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ borderTop: `1px solid ${POLAR}` }}>
              <td className="px-2 py-2 align-top whitespace-nowrap">{row.eventDate?.slice(0, 10) ?? "—"}</td>
              <td className="px-2 py-2 align-top">{row.country}</td>
              <td className="px-2 py-2 align-top">{row.venue ?? row.city ?? "—"}</td>
              <td className="px-2 py-2 align-top">{protestScheduleActivity(row)}</td>
              <td className="px-2 py-2 align-top">{row.disruptionPotential ?? row.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProtestScheduleView({
  model,
}: {
  model: FlashpointRenderedModel["protestSchedule"];
}) {
  return (
    <div data-testid="protest-schedule-view">
      {!model.searchCompleted && model.schedule.length === 0 && model.watchlist.length === 0 ? (
        <p style={{ fontStyle: "italic", color: DUSK, fontSize: 13 }}>Automated protest search has not completed.</p>
      ) : model.empty ? (
        <p style={{ fontStyle: "italic", color: DUSK, fontSize: 13 }}>{PROTEST_EMPTY_SENTENCE}</p>
      ) : (
        <>
          {!model.searchCompleted && <p style={{ fontStyle: "italic", color: DUSK, fontSize: 11, marginBottom: 8 }}>Automated protest search has not completed; displayed rows may be analyst-authored.</p>}
          <ProtestScheduleTable rows={model.schedule} />
        </>
      )}
      {model.watchlist.length > 0 && (
        <div className="mt-5">
          <h3 className="uppercase tracking-wide mb-3" style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{PROTEST_WATCHLIST_HEADING}</h3>
          <ProtestScheduleTable rows={model.watchlist} />
        </div>
      )}
      {model.searchCompleted && !model.empty && model.schedule.length === 0 && model.watchlist.length > 0 && (
        <p style={{ fontStyle: "italic", color: DUSK, fontSize: 13 }}>No confirmed or planned protest events are currently listed.</p>
      )}
    </div>
  );
}

function niceScale(rawMax: number): { max: number; step: number } {
  if (rawMax <= 1) return { max: 1, step: 1 };
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const norm = rawMax / pow10;
  let niceNorm: number;
  if (norm <= 1) niceNorm = 1;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  const max = niceNorm * pow10;
  const step = (niceNorm <= 2 ? niceNorm / 2 : niceNorm / 5) * pow10;
  return { max, step: Math.max(step, 1) };
}

function HorizontalBarChart({ rows, labelW = 160, emptyMessage }: { rows: BarRow[]; labelW?: number; emptyMessage?: string }) {
  if (rows.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13 }}>
        {emptyMessage ?? "No data reported this week."}
      </p>
    );
  }
  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const { max, step } = niceScale(rawMax);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3" style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: NAVY }}>
            <div style={{ width: labelW, flexShrink: 0, fontWeight: 700 }}>{r.label}</div>
            <div className="flex-1 relative" style={{ background: "#F3F4F8", height: 18 }}>
              {ticks.map((v) => (
                <div key={v} style={{ position: "absolute", left: `${(v / max) * 100}%`, top: 0, bottom: 0, width: 1, background: POLAR }} />
              ))}
              <div
                style={{
                  width: `${pct}%`, height: "100%",
                  background: rgba(r.color ?? ELECTRIC, 0.85),
                  border: `1px solid ${darken(r.color ?? ELECTRIC, 0.25)}`,
                  boxSizing: "border-box", position: "relative",
                }}
              />
            </div>
            <div style={{ width: 34, textAlign: "right", color: NAVY, fontWeight: 700 }}>{r.value}</div>
          </div>
        );
      })}
      <div className="flex items-center gap-3" style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, color: DUSK }}>
        <div style={{ width: labelW, flexShrink: 0 }} />
        <div className="flex-1 relative" style={{ height: 14, borderTop: `1px solid ${POLAR}` }}>
          {ticks.map((v) => (
            <span key={v} style={{ position: "absolute", left: `${(v / max) * 100}%`, top: 2, transform: "translateX(-50%)" }}>{v}</span>
          ))}
        </div>
        <div style={{ width: 34 }} />
      </div>
    </div>
  );
}

function FlashpointPublicationIssues({
  issues,
}: {
  issues: FinalReportEvidenceAuditIssue[];
}) {
  if (issues.length === 0) return null;

  const blockingIssues = issues.filter(isFinalReportIssueBlocking);
  return (
    <aside
      aria-label="Flashpoint publication validation"
      data-testid="flashpoint-publication-issues"
      className="mx-6 mb-5 rounded border p-4 text-sm"
      style={{
        borderColor: blockingIssues.length > 0 ? "#A33232" : "#D19A00",
        background: blockingIssues.length > 0 ? "#FFF7F7" : "#FFFBEB",
        color: NAVY,
      }}
    >
      <h2
        className="font-semibold"
        data-testid="flashpoint-publication-issues-heading"
      >
        {blockingIssues.length > 0
          ? "Flashpoint preview — PDF export is blocked until errors are resolved"
          : "Flashpoint preview — validation findings"}
      </h2>
      <p className="mt-1 leading-6">
        The complete report remains visible below. Resolve errors before
        exporting; warnings and informational findings do not block publication.
      </p>
      <ul className="mt-3 space-y-2">
        {issues.map((issue, index) => {
          const isError = isFinalReportIssueBlocking(issue);
          const level = issue.level;
          const accent =
            level === "ERROR" ? "#A33232" : level === "WARNING" ? "#B7791F" : "#465BFF";
          return (
            <li
              key={`${issue.code}-${issue.section}-${index}`}
              data-testid="flashpoint-publication-issue"
              data-level={level}
              className="border-l-2 pl-3 leading-6"
              style={{ borderColor: accent }}
            >
              <div>
                <strong>{issue.section}</strong>{" "}
                <span
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
                  style={{
                    background: isError ? "#FDE2E2" : level === "WARNING" ? "#FEF3C7" : "#E8EDFF",
                    color: accent,
                  }}
                >
                  {level}
                </span>{" "}
                <span>[{issue.code}]</span>
              </div>
              <div>{issue.message}</div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default function FlashpointReportPreview({
  report,
  incidents,
  aiProse,
  hiddenSections,
  sectionOverrides,
  renderedModel,
}: {
  report: FlashpointPreviewReport;
  incidents: FlashpointReportIncident[];
  aiProse?: TopicAiProse | null;
  hiddenSections?: string[];
  sectionOverrides?: TopicSectionOverrides | null;
  renderedModel?: FlashpointRenderedModel;
}) {
  const show = makeSectionGate(hiddenSections);
  const topic = report.topic ?? "flashpoint";
  const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
  const resolvedTitle = resolveReportTitle(topic, report.title);
  const coverUrl = TOPIC_COVER_URLS[topic];

  const bundle = useMemo(
    () => {
      if (renderedModel) {
        return finalizeFlashpointPublication({
          incidents,
          topic,
          issueDate,
          report,
          ai: aiProse,
          renderedModel,
        });
      }
      return finalizeFlashpointPublication({
        incidents,
        topic,
        issueDate,
        report,
        ai: aiProse,
      });
    },
    [incidents, topic, issueDate, report, aiProse, renderedModel],
  );
  const model = bundle.model;
  const ds = model.dataset;

  // Mirror the PDF: the Executive Summary renders the data-driven
  // ds.autoExecutiveSummary unless the analyst has written a genuine
  // (non-generic) override. Previously the preview used a thin one-liner
  // fallback that never matched the PDF — a preview==PDF violation.
  // Mirror exportFlashpointReportPdf exactly: any non-empty analyst edit wins,
  // otherwise AI-or-deterministic (no 240-char substantive threshold here —
  // the PDF applies none for the Executive Summary).
  const execText = model.prose.executiveSummary;

  return (
    <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
      <FlashpointPublicationIssues issues={bundle.auditIssues} />
      <div className="pdf-cover-page">
      <div
        className="flex items-center"
        style={{ background: BRAND_GRADIENT, color: "#fff", height: 64, paddingLeft: 24, paddingRight: 24 }}
      >
        <img src={polestarLogo} alt="Polestar Advisory" style={{ height: 26, width: "auto", maxWidth: 180, display: "block" }} />
      </div>

      {coverUrl && (
        <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", display: "block" }}>
          <img
            src={coverUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      )}

      <div style={{ background: BRAND_GRADIENT, color: "#fff", paddingLeft: 32, paddingRight: 32, paddingTop: 40, paddingBottom: 28 }}>
        <h1
          className="mb-4"
          style={{
            fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 44,
            lineHeight: 1.05, letterSpacing: "0", textTransform: "uppercase",
          }}
        >
          {resolvedTitle || "Untitled report"}
        </h1>
        <div className="uppercase" style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.22em", marginBottom: 6 }}>
          POLESTAR INSIGHTS
        </div>
        <div className="uppercase" style={{ fontFamily: "Roboto, sans-serif", fontWeight: 400, fontSize: 12, letterSpacing: "0.18em", color: "rgba(255,255,255,0.92)" }}>
          {ds.reportingPeriodLong.toUpperCase()}
        </div>
        <div className="uppercase" style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.18em", marginTop: 32 }}>
          polestar-advisory.com
        </div>
      </div>
      </div>

      <div className="px-10 py-10">
        <Section hidden={!show("executive-summary")} title="Executive Summary">
          <Paragraphs text={execText} />
        </Section>

        <Section hidden={!show("fast-facts")} title="Fast Facts">
          <KpiGrid cards={model.fastFacts} />
        </Section>

        <Section hidden={!show("activism")} title="Activism and Protest Read">
          <Paragraphs text={model.prose.activismRead} />
          <div className="mt-4">
            <IncidentTable
              rows={ds.activismRows}
              emptyMessage="No protest or activism activity was reported this week."
            />
          </div>
        </Section>

        <Section hidden={!show("civil-unrest")} title="Civil Unrest and Public Order Read">
          <Paragraphs text={model.prose.civilUnrestRead} />
          <div className="mt-4">
            <IncidentTable
              rows={ds.unrestRows}
              emptyMessage="No civil unrest or public-order activity was reported this week."
            />
          </div>
        </Section>

        <Section hidden={!show("forecast")} title={PROTEST_FORECAST_HEADING}>
          <ProtestScheduleView model={model.protestSchedule} />
          <Paragraphs text={model.prose.forecastRead} />
        </Section>

        <Section hidden={!show("regional")} title="Regional and Country View">
          <div className="mb-4">
            <div
              className="uppercase mb-2"
              style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
            >
              {ds.countryRows.length >= 12 ? "Incidents by Country (Top 12)" : "Incidents by Country"}
            </div>
            {ds.countryRows.length > 0 && (
            <div
              className="mb-2"
              style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, fontStyle: "italic", color: DUSK, opacity: 0.8 }}
            >
              Bar length shows incident count; colour shows the highest severity reported in each country.
            </div>
            )}
            <HorizontalBarChart rows={ds.countryRows} labelW={180} emptyMessage="No countries with reported activity this week." />
          </div>
          <Paragraphs text={model.prose.regionalCountryRead} />
        </Section>

        <Section hidden={!show("what-matters")} title="What Matters">
          <Paragraphs text={model.prose.whatMatters} />
        </Section>
        <Section hidden={!show("implications")} title="Implications for Business">
          <Bullets text={model.prose.implications} />
        </Section>
        <Section hidden={!show("watch-next")} title="Watch Next">
          <Bullets text={model.prose.watchNext} max={8} />
        </Section>
        <Section hidden={!show("polestar-view")} title="Polestar View">
          <Paragraphs text={model.prose.polestarView} />
        </Section>

        {/* Source Notes / Data Notes removed per editorial direction —
            internal methodology must not appear in client-facing
            Flashpoint reports. Preview and PDF stay aligned. */}

        <Section title="Disclaimer">
          <p
            className="leading-[1.7]"
            style={{ color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: "9pt" }}
          >
            {DISCLAIMER_TEXT}
          </p>
        </Section>
      </div>

      <div
        className="pdf-preview-footer px-10 flex items-center justify-between"
        style={{ background: POLAR, color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 11, minHeight: 36 }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
    </div>
  );
}
