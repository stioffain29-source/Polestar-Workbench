import { format } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import { resolveReportTitle } from "@/lib/reportNaming";
import {
  makeSectionGate,
  applyFastFactOverrides,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { aiOr, type TopicAiProse } from "@/lib/topicProseResolution";
import { TOPIC_COVER_URLS } from "@/lib/coverImages";
import {
  buildFlashpointReportDataset,
  isGenericFlashpointProse,
  type FlashpointReportIncident,
  type KpiCard,
  type BarRow,
  type EnrichedIncident,
  FLASHPOINT_SEV_LABEL,
} from "@/lib/flashpointReportDataset";
import { SEV_COLOR, parseBullets } from "@/lib/pdfChrome";

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

// Match exportFlashpointReportPdf.pickProse: editor text wins only when
// it carries substance (>= 240 chars) AND is not a recognised generic
// seed. Canned template prose (from the legacy draftReportProse packs,
// e.g. "Operational tempo, not headline severity") is always replaced
// by the dataset's data-driven auto-prose — even when it is long enough
// to clear the substance bar — so already-saved reports stop showing
// the boilerplate without a reseed. Genuine short analyst notes are
// preserved (appended ahead of the auto-prose).
function pickProse(editor: string | null | undefined, auto: string): string {
  const t = (editor ?? "").trim();
  if (!t || isGenericFlashpointProse(t)) return auto;
  if (t.length >= 240) return t;
  return `${t}\n\n${auto}`;
}

// Data-driven "reads" (Activism, Civil Unrest, Forecast, Regional) are full
// section bodies, not short analyst notes: a saved override REPLACES the
// generated read outright; a blank value falls back to the dataset read so
// nothing is fabricated and the editor preview == the PDF.
function pickRead(editor: string | null | undefined, auto: string): string {
  const t = (editor ?? "").trim();
  return t ? t : auto;
}

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

function KpiGrid({ cards }: { cards: KpiCard[] }) {
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
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
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
            fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, alignItems: "center",
          }}
        >
          <div>{format(r.date, "dd MMM yyyy")}</div>
          <div>{r.issue}</div>
          <div style={{ color: NAVY }}>{r.title}</div>
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

function RelatedIncidentsTable({ rows }: { rows: EnrichedIncident[] }) {
  if (rows.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13 }}>
        Little related activity was reported this week. Treat the quiet stretch as a gap in reporting rather than a lasting calm.
      </p>
    );
  }
  return (
    <div className="w-full">
      {rows.length < 4 && (
        <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13, marginBottom: 8 }}>
          Little related activity was reported this week, so the list below is short. It is kept deliberately brief — minor items are left out rather than used to fill space.
        </p>
      )}
      <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: "0.7fr 1.0fr 2.2fr 0.7fr", background: NAVY, color: "#fff",
          fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 10,
          padding: "8px 10px", gap: 10,
        }}
      >
        <div>Date</div>
        <div>Issue</div>
        <div>Title</div>
        <div>Severity</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={String(r.id)}
          className="grid"
          style={{
            gridTemplateColumns: "0.7fr 1.0fr 2.2fr 0.7fr", padding: "8px 10px", gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, alignItems: "center",
          }}
        >
          <div>{format(r.date, "dd MMM yyyy")}</div>
          <div>{r.issue}</div>
          <div style={{ color: NAVY }}>{r.title}</div>
          <div>
            <SeverityChip
              sevKey={sevKey(r.severity)}
              label={FLASHPOINT_SEV_LABEL[sevKey(r.severity)] ?? r.severity}
            />
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

export default function FlashpointReportPreview({
  report,
  incidents,
  aiProse,
  hiddenSections,
  sectionOverrides,
}: {
  report: FlashpointPreviewReport;
  incidents: FlashpointReportIncident[];
  aiProse?: TopicAiProse | null;
  hiddenSections?: string[];
  sectionOverrides?: TopicSectionOverrides | null;
}) {
  const show = makeSectionGate(hiddenSections);
  const topic = report.topic ?? "flashpoint";
  const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
  const resolvedTitle = resolveReportTitle(topic, report.title);
  const coverUrl = TOPIC_COVER_URLS[topic];

  const ds = useMemo(
    () => buildFlashpointReportDataset(incidents, topic, issueDate),
    [incidents, topic, issueDate],
  );

  // Mirror the PDF: the Executive Summary renders the data-driven
  // ds.autoExecutiveSummary unless the analyst has written a genuine
  // (non-generic) override. Previously the preview used a thin one-liner
  // fallback that never matched the PDF — a preview==PDF violation.
  const execText = pickProse(
    report.executiveSummary,
    aiOr(aiProse?.executiveSummary, ds.autoExecutiveSummary),
  );

  return (
    <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
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
          <KpiGrid cards={applyFastFactOverrides(ds.fastFacts, sectionOverrides?.fastFactOverrides)} />
        </Section>

        <Section hidden={!show("activism")} title="Activism and Protest Read">
          <Paragraphs text={pickRead(report.activismRead, ds.activismRead)} />
          <div className="mt-4">
            <IncidentTable
              rows={ds.activismRows}
              emptyMessage="No protest or activism activity was reported this week."
            />
          </div>
        </Section>

        <Section hidden={!show("civil-unrest")} title="Civil Unrest and Public Order Read">
          <Paragraphs text={pickRead(report.civilUnrestRead, ds.civilUnrestRead)} />
          <div className="mt-4">
            <IncidentTable
              rows={ds.unrestRows}
              emptyMessage="No civil unrest or public-order activity was reported this week."
            />
          </div>
        </Section>

        <Section hidden={!show("forecast")} title={"Forecast: Next 7\u201314 Days"}>
          {ds.forecastFuture.length > 0 && (
            <div className="mb-4 overflow-hidden" style={{ border: `1px solid ${POLAR}` }}>
              <table className="w-full border-collapse" style={{ fontFamily: "Roboto, sans-serif", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: NAVY, color: "#FFFFFF" }}>
                    <th className="text-left px-2 py-2" style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", width: "12%" }}>DATE</th>
                    <th className="text-left px-2 py-2" style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", width: "16%" }}>COUNTRY</th>
                    <th className="text-left px-2 py-2" style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", width: "28%" }}>SIGNAL</th>
                    <th className="text-left px-2 py-2" style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.08em" }}>OPERATIONAL MEANING</th>
                  </tr>
                </thead>
                <tbody>
                  {ds.forecastFuture.map((r, idx) => (
                    <tr key={idx} style={{ borderTop: `1px solid ${POLAR}` }}>
                      <td className="px-2 py-2 align-top" style={{ color: NAVY }}>{r.date ?? "\u2014"}</td>
                      <td className="px-2 py-2 align-top" style={{ color: NAVY, fontWeight: 700 }}>{r.country}</td>
                      <td className="px-2 py-2 align-top" style={{ color: NAVY }}>{r.signal}</td>
                      <td className="px-2 py-2 align-top" style={{ color: DUSK }}>{r.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Paragraphs text={pickRead(report.forecastRead, ds.forecastRead)} />
        </Section>

        <Section hidden={!show("regional")} title="Regional and Country View">
          <Paragraphs text={pickRead(report.regionalCountryRead, ds.regionalCountryRead)} />
          <div className="mt-4">
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
        </Section>

        <Section hidden={!show("what-matters")} title="What Matters">
          <Paragraphs text={pickProse(report.whatMatters, aiOr(aiProse?.whatMatters, ds.autoWhatMatters))} />
        </Section>
        <Section hidden={!show("implications")} title="Implications for Business">
          <Bullets text={pickProse(report.implications, aiOr(aiProse?.implications, ds.autoImplications))} />
        </Section>
        <Section hidden={!show("watch-next")} title="Watch Next">
          <Bullets text={pickProse(report.watchNext, aiOr(aiProse?.watchNext, ds.autoWatchNext))} max={8} />
        </Section>
        <Section hidden={!show("polestar-view")} title="Polestar View">
          <Paragraphs text={pickProse(report.polestarView, aiOr(aiProse?.polestarView, ds.autoPolestarView))} />
        </Section>

        <Section hidden={!show("related-incidents")} title="Related Incidents">
          <RelatedIncidentsTable rows={ds.relatedIncidents} />
        </Section>

        {/* Source Notes / Data Notes removed per editorial direction —
            internal methodology must not appear in client-facing
            Flashpoint reports. Preview and PDF stay aligned. */}

        <Section title="Disclaimer">
          <p className="text-[12px] leading-[1.7]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
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
