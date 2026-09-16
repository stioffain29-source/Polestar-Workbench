import {
  makeSectionGate,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { format, parseISO } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import polestarLogoWhite from "@assets/Reverse_white_logo_hor_1779525768654.png";
import shippingCoverUrl from "@assets/william-william-NndKt2kF1L4-unsplash_1779617475306.jpg";
import { resolveReportTitle } from "@/lib/reportNaming";
import type { TopicAiProse } from "@/lib/topicProseResolution";
import { ShippingSituationMap } from "./shipping-report/ShippingSituationMap";
import { ShippingReportMatrix } from "./shipping-report/ShippingReportMatrix";
import { ShippingThreatTimeline } from "./shipping-report/ShippingThreatTimeline";
import { buildShippingCommercialCategories } from "@/lib/shippingCommercialCategories";
import {
  type ShippingReportIncident,
  type ShippingReportDataset,
  type KpiCard,
  type BarRow,
  type ChokepointRow,
  type EnrichedIncident,
  SHIPPING_SEV_COLOR,
  SHIPPING_SEV_LABEL,
  shippingSevKey,
} from "@/lib/shippingReportDataset";
import { resolveIncidentSummary } from "@/lib/incidentSummary";
import type { MaritimeMovement, MaritimeSecurityEvent } from "@workspace/api-client-react";
import {
  MARITIME_RISK_COLOR,
  type MaritimeIntelligence,
  type ChokepointCard,
  type LatestIncident,
} from "@/lib/maritimeIntelligence";
import {
  finalizeShippingPublication,
} from "@/lib/shippingPublication";
import type { ShippingSevenPageRegisterRow } from "@/lib/shippingSevenPagePresentation";
import {
  MARITIME_CHOKEPOINT_CARDS_TITLE,
  MARITIME_COVERAGE_STATUS_LABEL,
  MARITIME_SUBSECTION_ORDER,
  maritimeExecCards,
  maritimeReportChokepointCards,
  maritimeReportMovementTheatres,
  formatMaritimeMovementDate,
  formatMaritimeMovementSample,
  type MaritimeReportCompleteness,
} from "@/lib/maritimeReportView";
import {
  MARITIME_SECURITY_SOURCE_LABEL,
  maritimeTypeColor,
} from "@/lib/maritimeSecurity";

// Polestar disclaimer text used at the foot of every report. Kept inline
// here (rather than imported from the PDF chrome) so the on-screen
// preview never has to load the jsPDF chunk just to render this paragraph.
const DISCLAIMER_TEXT =
  "Polestar Advisory Pte. Ltd. is an independent company registered in Singapore. " +
  "The information in this report is based on open sources and is assessed as accurate at the time of writing. " +
  "It is provided for general informational purposes only and does not constitute advice or a comprehensive " +
  "assessment of all risks. No reliance should be placed on this information for decision making without " +
  "further independent verification.";

// Shipping-specific on-screen preview. Renders the same sections as
// exportShippingReportPdf, in the same order, from the same dataset
// (buildShippingReportDataset). Anything that draws in the PDF must
// appear here so the editor preview and the export never disagree.

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";

// Subtle bar styling helpers. Keep effects restrained: a touch of fill
// translucency and a slightly darker stroke on the same hue. No gradients,
// no shadows, no glow.
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
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

export interface ShippingPreviewReport {
  title?: string;
  topic?: string;
  issueDate?: string;
  author?: string | null;
  executiveSummary?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
  chokepointRouteRead?: string | null;
  vesselPiracyRead?: string | null;
  commercialImpactRead?: string | null;
  maritimeSecurityRead?: string | null;
  regionalCountryRead?: string | null;

  vesselSecurityAssessment?: string | null;
  vesselSecurityTrend?: string | null;
  piracyAssessment?: string | null;
  piracyTrend?: string | null;
  portsTerminalsAssessment?: string | null;
  portsTerminalsTrend?: string | null;
  routesChokepointsAssessment?: string | null;
  routesChokepointsTrend?: string | null;
  commercialDisruptionAssessment?: string | null;
  commercialDisruptionTrend?: string | null;
  keyJudgements?: string | null;
  routesAndPortsRead?: string | null;
  polestarOutlookRead?: string | null;
  polestarWatchIndicators?: string | null;
  polestarEscalationTriggers?: string | null;
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

function Paragraphs({ text, color = DUSK }: { text?: string | null; color?: string }) {
  if (!text) return null;
  const parts = text.split(/\n+/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p
          key={i}
          className="text-[14px] leading-[1.7] mb-3 font-light"
          style={{ color, fontFamily: "Roboto, sans-serif" }}
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

function KpiGrid({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const sevK = c.severity ? shippingSevKey(c.severity) : "";
        const accent = c.accent ?? (sevK && SHIPPING_SEV_COLOR[sevK] ? SHIPPING_SEV_COLOR[sevK] : ELECTRIC);
        return (
          <div
            key={i}
            className="bg-white border rounded-[2px] relative"
            style={{ borderColor: POLAR, paddingLeft: 14, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}
          >
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: accent }} />
            <div
              className="uppercase tracking-widest"
              style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 9, color: DUSK }}
            >
              {c.label}
            </div>
            <div
              style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 20, color: NAVY, marginTop: 4, lineHeight: 1.15 }}
            >
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
  const bg = k === "high" || k === "extreme" ? NAVY : k === "moderate" ? ELECTRIC : DUSK;
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

function ChokepointTable({ rows }: { rows: ChokepointRow[] }) {
  const populated = rows.filter((row) => row.count > 0);
  if (populated.length === 0) return null;
  return (
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: "1.3fr 0.5fr 0.8fr 0.8fr 2.2fr",
          background: NAVY,
          color: "#fff",
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 10,
          padding: "8px 10px",
          gap: 10,
        }}
      >
        <div>Chokepoint</div>
        <div>Records</div>
        <div>Highest Sev</div>
        <div>Latest</div>
        <div>Operational Read</div>
      </div>
       {populated.map((r, i) => (
        <div
          key={r.name}
          className="grid"
          style={{
            gridTemplateColumns: "1.3fr 0.5fr 0.8fr 0.8fr 2.2fr",
            padding: "8px 10px",
            gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif",
            fontSize: 12,
            color: DUSK,
            alignItems: "center",
          }}
        >
          <div style={{ color: NAVY, fontWeight: 700, fontFamily: "Roboto, sans-serif" }}>{r.name}</div>
          <div>{r.count}</div>
          <div><SeverityChip sevKey={r.highestSeverityKey} label={r.highestSeverityLabel} /></div>
          <div>{r.latestDate ? format(r.latestDate, "dd MMM yyyy") : "—"}</div>
          <div style={{ lineHeight: 1.5 }}>{r.readText}</div>
        </div>
      ))}
    </div>
  );
}

interface IncidentTableProps<T extends EnrichedIncident> {
  rows: T[];
  emptyMessage: string;
  actLabel?: string;
  actFor?: (r: T) => string;
  rowLimit?: number;
}

function IncidentTable<T extends EnrichedIncident>({ rows, actLabel, actFor, rowLimit = 15 }: IncidentTableProps<T>) {
  if (rows.length === 0) {
    return null;
  }
  const limited = rows.slice(0, rowLimit);
  const showAct = !!actLabel && !!actFor;
  const cols = showAct ? "0.7fr 0.9fr 2.4fr 0.7fr" : "0.7fr 2.4fr 0.7fr";
  return (
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: cols,
          background: NAVY,
          color: "#fff",
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 10,
          padding: "8px 10px",
          gap: 10,
        }}
      >
        <div>Date</div>
        {showAct && <div>{actLabel}</div>}
        <div>Title</div>
        <div>Severity</div>
      </div>
      {limited.map((r, i) => (
        <div
          key={String(r.id)}
          className="grid"
          style={{
            gridTemplateColumns: cols,
            padding: "8px 10px",
            gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif",
            fontSize: 12,
            color: DUSK,
            alignItems: "center",
          }}
        >
          <div>{format(r.date, "dd MMM yyyy")}</div>
          {showAct && <div>{actFor!(r)}</div>}
          <div style={{ color: NAVY }}>{r.title}</div>
          <div>
            <SeverityChip
              sevKey={shippingSevKey(r.severity)}
              label={SHIPPING_SEV_LABEL[shippingSevKey(r.severity)] ?? r.severity}
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

function HorizontalBarChart({ rows, labelW = 160 }: { rows: BarRow[]; labelW?: number }) {
  if (rows.length === 0) {
    return null;
  }
  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const { max, step } = niceScale(rawMax);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return (
    <div className="flex flex-col gap-4">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3" style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: NAVY }}>
            <div style={{ width: labelW, flexShrink: 0, fontWeight: 700 }}>{r.label}</div>
            <div className="flex-1 relative" style={{ background: "#fff", height: 28 }}>
              {ticks.map((v) => (
                <div
                  key={v}
                  style={{
                    position: "absolute",
                    left: `${(v / max) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: POLAR,
                  }}
                />
              ))}
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: r.color ?? ELECTRIC,
                  border: `1px solid ${r.color ?? ELECTRIC}`,
                  boxSizing: "border-box",
                  position: "relative",
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
            <span
              key={v}
              style={{
                position: "absolute",
                left: `${(v / max) * 100}%`,
                top: 2,
                transform: "translateX(-50%)",
              }}
            >
              {v}
            </span>
          ))}
        </div>
        <div style={{ width: 34 }} />
      </div>
    </div>
  );
}

function RelatedIncidentsTable({
  rows,
  summaries = {},
}: {
  rows: Array<EnrichedIncident | ShippingSevenPageRegisterRow>;
  summaries?: Record<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="w-full" data-shipping-register style={{ borderTop: `1px solid ${POLAR}`, flexShrink: 0 }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: "0.55fr .85fr 2.6fr .7fr",
          background: NAVY,
          color: "#fff",
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 10,
          padding: "6px 7px",
          gap: 8,
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
            gridTemplateColumns: "0.55fr .85fr 2.6fr .7fr",
            padding: "5px 7px",
            gap: 8,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif",
            fontSize: 10,
            lineHeight: 1.35,
            color: DUSK,
            alignItems: "flex-start",
          }}
        >
          <div>{format(r.date, "dd MMM")}</div>
          <div>{"issue" in r ? r.issue : r.type}</div>
          <div style={{ color: NAVY }}>
            {r.title}
            {"topic" in r && (
              <div style={{ fontSize: 11, color: DUSK, marginTop: 4, lineHeight: 1.4 }}>
                {resolveIncidentSummary(r, summaries)}
              </div>
            )}
          </div>
          <div>
            <SeverityChip
              sevKey={shippingSevKey(r.severity)}
              label={SHIPPING_SEV_LABEL[shippingSevKey(r.severity)] ?? r.severity}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MaritimeSubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="uppercase mb-2 mt-5"
      style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
    >
      {children}
    </div>
  );
}

// Maritime Intelligence — the shared deterministic board, rendered in the
// report in the SAME order as the live Shipping monitor and the SAME order
// exportShippingReportPdf draws it. Movement (AIS) is CONTEXT only and
// is shown only as a dated latest-per-theatre sample. #A33232 is reserved for
// level 5.
function ChokepointReportCard({ card }: { card: ChokepointCard }) {
  const { key, risk, incidentCount, lastConfirmed, movement } = card;
  const pending = risk.label === "Assessment pending";
  return (
    <div style={{ border: `1px solid ${POLAR}`, borderRadius: 2, padding: 10, breakInside: "avoid" }}>
      <div className="flex items-start justify-between gap-2" style={{ marginBottom: 4 }}>
        <span style={{ color: NAVY, fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 13, lineHeight: 1.15 }}>{key}</span>
        <span
          className="uppercase"
          style={{ background: pending ? "#626773" : MARITIME_RISK_COLOR[risk.level], color: "#fff", fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", padding: "2px 6px", borderRadius: 2, whiteSpace: "nowrap" }}
        >
          {pending ? risk.label : `L${risk.level} · ${risk.label}`}
        </span>
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: NAVY, fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 16 }}>{incidentCount}</span>
        <span className="uppercase" style={{ color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 9, letterSpacing: "0.1em", marginLeft: 6 }}>confirmed &middot; 7 days</span>
      </div>
      <p className="text-[11px]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif", lineHeight: 1.5, margin: "0 0 3px 0" }}>
        <span className="uppercase" style={{ fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", marginRight: 4 }}>Last incident</span>
        {lastConfirmed ? `${format(parseISO(lastConfirmed.occurredAt), "d MMM")} — ${lastConfirmed.title}` : "None in window"}
      </p>
      {movement && (
        <p className="text-[11px]" style={{ color: DUSK, fontFamily: "Roboto, sans-serif", lineHeight: 1.5, margin: "0 0 3px 0" }}>
          <span className="uppercase" style={{ fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", marginRight: 4 }}>Movement:</span>
          {formatMaritimeMovementDate(movement.dataAsOf)} — {formatMaritimeMovementSample(movement)}
        </p>
      )}
    </div>
  );
}

function ConfirmedIncidentsReportTable({ rows }: { rows: LatestIncident[] }) {
  if (rows.length === 0) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Roboto, sans-serif" }}>
      <thead>
        <tr style={{ background: "#f4f4f8" }}>
          <th className="uppercase" style={{ textAlign: "left", padding: "6px 8px", fontSize: 9, letterSpacing: "0.08em", color: DUSK, fontWeight: 700, width: 70 }}>Date</th>
          <th className="uppercase" style={{ textAlign: "left", padding: "6px 8px", fontSize: 9, letterSpacing: "0.08em", color: DUSK, fontWeight: 700, width: 150 }}>Category</th>
          <th className="uppercase" style={{ textAlign: "left", padding: "6px 8px", fontSize: 9, letterSpacing: "0.08em", color: DUSK, fontWeight: 700, width: 80 }}>Severity</th>
          <th className="uppercase" style={{ textAlign: "left", padding: "6px 8px", fontSize: 9, letterSpacing: "0.08em", color: DUSK, fontWeight: 700, width: 120 }}>Chokepoint</th>
          <th className="uppercase" style={{ textAlign: "left", padding: "6px 8px", fontSize: 9, letterSpacing: "0.08em", color: DUSK, fontWeight: 700 }}>Event</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: `1px solid ${POLAR}`, breakInside: "avoid" }}>
            <td style={{ padding: "6px 8px", fontSize: 11, color: DUSK, whiteSpace: "nowrap" }}>{format(parseISO(r.occurredAt), "d MMM")}</td>
            <td style={{ padding: "6px 8px", fontSize: 11, color: NAVY }}>{r.category}</td>
            <td style={{ padding: "6px 8px", fontSize: 11, color: DUSK }}>{SHIPPING_SEV_LABEL[shippingSevKey(r.severity ?? "")] ?? r.severity}</td>
            <td style={{ padding: "6px 8px", fontSize: 11, color: DUSK }}>{r.chokepoint ?? "—"}</td>
            <td style={{ padding: "6px 8px", fontSize: 11, color: NAVY }}>{r.title}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MaritimeCoverageDisclosure({
  completeness,
}: {
  completeness: MaritimeReportCompleteness;
}) {
  const disclosure =
    completeness.complete ? "" : (completeness.disclosure ?? "").trim();
  if (!disclosure) return null;
  return (
    <div
      className="rounded-[2px] px-3 py-2"
      role="status"
      style={{
        marginTop: 10,
        background: "#f2f3f7",
        border: `1px solid ${POLAR}`,
        color: DUSK,
        fontFamily: "Roboto, sans-serif",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <div className="uppercase" style={{ fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: NAVY }}>
        {MARITIME_COVERAGE_STATUS_LABEL}
      </div>
      <div>{disclosure}</div>
    </div>
  );
}

function MaritimeIntelligenceReportSection({
  board,
  completeness,
}: {
  board: MaritimeIntelligence;
  completeness: MaritimeReportCompleteness;
}) {
  const { bluf, confirmedIncidents } = board;
  const movementTheatres = maritimeReportMovementTheatres(board);
  const chokepointCards = maritimeReportChokepointCards(board);
  const execCards: KpiCard[] = maritimeExecCards(board, completeness);
  return (
    <Section title="Maritime Intelligence">
      <KpiGrid cards={execCards} />
      <MaritimeCoverageDisclosure completeness={completeness} />

      <div className="rounded-[2px] p-4" style={{ background: NAVY, marginTop: 12 }}>
        <div
          className="uppercase"
          style={{ color: "rgba(255,255,255,0.7)", fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.18em", marginBottom: 6 }}
        >
          Bottom Line Up Front
        </div>
        <p style={{ color: "#fff", fontFamily: "Roboto, sans-serif", fontSize: 14, lineHeight: 1.6, fontWeight: 300, margin: 0 }}>
          {bluf}
        </p>
      </div>

      {chokepointCards.length > 0 && (
        <>
          <MaritimeSubLabel>{MARITIME_CHOKEPOINT_CARDS_TITLE}</MaritimeSubLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {chokepointCards.map((card) => (
              <ChokepointReportCard key={card.key} card={card} />
            ))}
          </div>
        </>
      )}

      {confirmedIncidents.length > 0 && (
        <>
          <MaritimeSubLabel>{MARITIME_SUBSECTION_ORDER[0]}</MaritimeSubLabel>
          <ConfirmedIncidentsReportTable rows={confirmedIncidents} />
        </>
      )}

      {movementTheatres.length > 0 && (
        <>
          <MaritimeSubLabel>{MARITIME_SUBSECTION_ORDER[1]}</MaritimeSubLabel>
          <ul className="space-y-1.5" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
            {movementTheatres.map((t) => (
              <li key={t.theatre} className="text-[13px] leading-[1.6]">
                <span style={{ color: NAVY, fontWeight: 700 }}>{t.theatre}</span>
                <span> &mdash; {formatMaritimeMovementDate(t.dataAsOf)} — {formatMaritimeMovementSample(t)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The board's internal Polestar View / Watch Next block is NOT rendered
          in the report — the report has exactly one of each in the standalone
          sections. */}
    </Section>
  );
}

export default function ShippingReportPreview({
  report,
  incidents,
  movement = [],
  maritimeSecurityEvents = [],
  dataset,
  incidentSummaries = {},
  aiProse,
  hiddenSections,
  sectionOverrides,
}: {
  report: ShippingPreviewReport;
  incidents: ShippingReportIncident[];
  movement?: MaritimeMovement[];
  maritimeSecurityEvents?: MaritimeSecurityEvent[];
  /** Optional editor-owned snapshot so every editor surface shares one build. */
  dataset?: ShippingReportDataset;
  incidentSummaries?: Record<string, string>;
  aiProse?: TopicAiProse | null;
  hiddenSections?: string[];
  sectionOverrides?: TopicSectionOverrides | null;
}) {
  const topic = report.topic ?? "shipping";
  const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
  const resolvedTitle = resolveReportTitle(topic, report.title);
  const publication = useMemo(
    () =>
      finalizeShippingPublication({
        report,
        incidents,
        movement,
        maritimeSecurityEvents,
        dataset,
        incidentSummaries,
        aiProse,
        hiddenSections,
        sectionOverrides,
      }),
    [
      report,
      incidents,
      movement,
      maritimeSecurityEvents,
      dataset,
      incidentSummaries,
      aiProse,
      hiddenSections,
      sectionOverrides,
    ],
  );
  const ds = publication.dataset;
  const maritimeBoard = publication.maritimeBoard;
  const renderedFastFacts = publication.fastFacts;
  const prose = publication.prose;
  const show = makeSectionGate([...publication.hiddenSections]);

  // Validation is an editor warning state, not a reason to replace the draft.
  // The PDF exporter still calls assertShippingPublication and therefore
  // remains fail-closed for ERROR issues; WARNING issues stay visible without
  // blocking the export. The preview keeps the cover, tables and saved
  // analyst edits visible so the owner can fix the associated section.

  const presentation = publication.sevenPage;
  const fastFactByAutoLabel = (label: string) => {
    const autoIndex = publication.dataset.fastFacts.findIndex((fact) => fact.label === label);
    return (
      (autoIndex >= 0 ? publication.fastFacts[autoIndex] : undefined) ??
      publication.fastFacts.find((fact) => fact.label === label)
    );
  };

  const riskFact = publication.maritimeBoard.risk;
  const confirmedCount =
    fastFactByAutoLabel("Confirmed Incidents")?.value ??
    String(presentation.canonicalIncidentCount);
  const affectedChokepoints = publication.maritimeBoard.chokepointsAffected;
  const vesselAttacks =
    fastFactByAutoLabel("Vessel Attacks / Seizures")?.value ??
    String(publication.dataset.vesselAttackSeizureCount);
  const mainAffected =
    fastFactByAutoLabel("Main Affected Chokepoint")?.value ??
    "N/A";

  const riskLabel = riskFact.label.toLowerCase();
  const isPending =
    !publication.completeness.complete ||
    riskFact.level === 1 ||
    riskLabel.includes("pending") ||
    riskLabel.includes("not assessed");
  const showSituation =
    show("maritime-intelligence") ||
    show("executive-summary") ||
    show("fast-facts");
  const showImpact = show("commercial-impact") || show("regional");
  const showAssessment =
    show("what-matters") ||
    show("implications") ||
    show("watch-next");
  const showClosing = show("polestar-view") || show("related-incidents");
  return (
    <div className="shipping-report-preview-root">
      <style>{`
        .shipping-page {
          width: 210mm;
          min-height: 297mm;
          height: 297mm;
          background: white;
          margin: 0 auto 2rem auto;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          padding: 15mm 20mm;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: visible;
          page-break-after: always;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #465bff;
          padding-bottom: 8px;
          margin-bottom: 24px;
        }
        .page-title {
          color: #0b0a3d;
          font-family: 'Roboto', sans-serif;
          font-size: 18px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .page-footer {
          position: absolute;
          bottom: 10mm;
          left: 20mm;
          right: 20mm;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid #e2e2e2;
          padding-top: 8px;
          font-size: 9px;
          color: #363636;
          text-transform: uppercase;
        }
        @media print {
          .shipping-report-preview-root { background: transparent; padding: 0; }
          .shipping-page { margin: 0; box-shadow: none; border: none; height: 297mm; overflow: visible; }
        }
      `}</style>
      {/* PAGE 1: COVER */}
      <div className="shipping-page p-0 relative overflow-hidden" data-shipping-page="1">
        <div className="absolute inset-x-0 top-0 h-[16mm] bg-gradient-to-r from-[#08073f] to-[#465bff]">
          <img
            src={polestarLogoWhite}
            alt="Polestar Advisory"
            className="absolute left-[7mm] top-1/2 h-[7mm] -translate-y-1/2 object-contain"
          />
        </div>
        <img
          src={shippingCoverUrl}
          alt=""
          className="absolute inset-x-0 top-[16mm] h-[197mm] w-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 h-[84mm] bg-gradient-to-r from-[#08073f] to-[#465bff] text-white">
          <div className="absolute left-[11mm] right-[11mm] top-[13mm]">
            <h1 className="text-[13mm] font-bold uppercase leading-none tracking-[-0.02em]">
              {resolvedTitle}
            </h1>
            <div className="mt-[11mm] text-[5mm] font-light uppercase tracking-[0.12em]">
              MONTHLY MARITIME SECURITY & OPERATIONAL RISK ASSESSMENT
            </div>
            <div className="mt-[3mm] text-[3.1mm] font-normal uppercase tracking-[0.12em]">
              Reporting period: {ds.reportingPeriodLong}
            </div>
          </div>
          <div className="absolute bottom-[7mm] left-[11mm] text-[3.1mm] font-light uppercase tracking-[0.12em]">
            Polestar-Advisory.com
          </div>
        </div>
      </div>


      {/* PAGE 1: MONTHLY EXECUTIVE ASSESSMENT */}
      <div className="shipping-page" data-shipping-page="2">
        <div className="page-header">
          <div className="page-title">Monthly Executive Assessment</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Indicators">
          <KpiGrid cards={[
            { label: "Vessel Security", value: report.vesselSecurityAssessment || "Insignificant", note: report.vesselSecurityTrend || "→", severity: report.vesselSecurityAssessment || undefined },
            { label: "Piracy / Armed Robbery", value: report.piracyAssessment || "Insignificant", note: report.piracyTrend || "→", severity: report.piracyAssessment || undefined },
            { label: "Ports & Terminals", value: report.portsTerminalsAssessment || "Insignificant", note: report.portsTerminalsTrend || "→", severity: report.portsTerminalsAssessment || undefined },
            { label: "Key Routes / Chokepoints", value: report.routesChokepointsAssessment || "Insignificant", note: report.routesChokepointsTrend || "→", severity: report.routesChokepointsAssessment || undefined },
            { label: "Commercial Disruption", value: report.commercialDisruptionAssessment || "Insignificant", note: report.commercialDisruptionTrend || "→", severity: report.commercialDisruptionAssessment || undefined },
          ]} />
        </Section>
        <Section title="Bottom Line Up Front">
          <Paragraphs text={report.executiveSummary} />
        </Section>
        <Section title="Key Judgements">
          <Paragraphs text={report.keyJudgements} />
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 1</div>
        </div>
      </div>

      {/* PAGE 2: REGIONAL MARITIME SECURITY PICTURE */}
      <div className="shipping-page" data-shipping-page="3">
        <div className="page-header">
          <div className="page-title">Regional Maritime Security Picture</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Regional Picture">
          <Paragraphs text={report.regionalCountryRead} />
        </Section>
        <Section title="Active Map">
          <div className="mt-4" style={{ height: 400 }}>
            {/* Map Component Updated */}
            <ShippingSituationMap chokepoints={maritimeBoard.chokepointCards.map(c => ({ name: c.key, level: c.risk.level, label: c.risk.label }))} />
          </div>
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 2</div>
        </div>
      </div>

      {/* PAGE 3: THREAT TRENDS */}
      <div className="shipping-page" data-shipping-page="4">
        <div className="page-header">
          <div className="page-title">Threat Trends</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Monthly Trends">
          {ds.threatTrends && ds.threatTrends.length > 0 ? (
            <div className="flex flex-col gap-4">
              {ds.threatTrends.map(t => (
                <div key={t.category} className="border p-4" style={{ borderColor: POLAR }}>
                  <div className="text-[14px] font-bold text-navy mb-2">{t.category}</div>
                  <div className="grid grid-cols-4 gap-4 text-[12px]">
                    <div><span className="text-dusk font-bold">Current month:</span> {t.currentMonth}</div>
                    <div><span className="text-dusk font-bold">Previous month:</span> {t.previousMonth !== null ? t.previousMonth : "—"}</div>
                    <div><span className="text-dusk font-bold">3-month average:</span> {t.threeMonthAverage !== null ? t.threeMonthAverage : "—"}</div>
                    <div><span className="text-dusk font-bold">Trend:</span> {t.trend !== null ? t.trend : "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
             <Paragraphs text="Trend data is unavailable for this reporting period." />
          )}
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 3</div>
        </div>
      </div>

      {/* PAGE 4: ROUTES & PORTS TO WATCH */}
      <div className="shipping-page" data-shipping-page="5">
        <div className="page-header">
          <div className="page-title">Routes & Ports to Watch</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Dynamic Routes and Ports">
          <Paragraphs text={report.routesAndPortsRead} />
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 4</div>
        </div>
      </div>

      {/* PAGE 5: COMMERCIAL & OPERATIONAL IMPACT */}
      <div className="shipping-page" data-shipping-page="6">
        <div className="page-header">
          <div className="page-title">Commercial & Operational Impact</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Commercial Signal">
          <Paragraphs text={report.commercialImpactRead} />
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 5</div>
        </div>
      </div>

      {/* PAGE 6: POLESTAR VIEW */}
      <div className="shipping-page" data-shipping-page="7">
        <div className="page-header">
          <div className="page-title">Polestar View — Next 30 Days</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Strategic Picture">
          <Paragraphs text={report.polestarView} />
        </Section>
        <Section title="Outlook — Next 30 Days">
          <Paragraphs text={report.polestarOutlookRead} />
        </Section>
        <Section title="Watch Indicators">
          <Paragraphs text={report.polestarWatchIndicators} />
        </Section>
        <Section title="Escalation Triggers">
          <Paragraphs text={report.polestarEscalationTriggers} />
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 6</div>
        </div>
      </div>

      {/* PAGE 7: MONTHLY INCIDENT REGISTER */}
      <div className="shipping-page" data-shipping-page="8">
        <div className="page-header">
          <div className="page-title">Monthly Incident Register</div>
          <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
        </div>
        <Section title="Incident Register">
          {ds.registerMetrics && (
            <div className="flex gap-6 mb-4 text-[12px] font-bold text-navy">
              <div>TOTAL MATERIAL INCIDENTS THIS MONTH: {ds.registerMetrics.currentMonth}</div>
              {ds.registerMetrics.previousMonth !== null && <div>PREVIOUS MONTH: {ds.registerMetrics.previousMonth}</div>}
              {ds.registerMetrics.threeMonthAverage !== null && <div>3-MONTH AVERAGE: {ds.registerMetrics.threeMonthAverage}</div>}
            </div>
          )}
          <div className="w-full border" style={{ borderColor: POLAR }}>
            <div className="grid uppercase tracking-widest" style={{ gridTemplateColumns: "0.6fr 0.8fr 0.8fr 1fr 2fr 1.5fr 0.6fr", background: NAVY, color: "#fff", fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 8, padding: "8px 10px", gap: 10 }}>
              <div>Date</div>
              <div>Location</div>
              <div>Country</div>
              <div>Category</div>
              <div>Incident</div>
              <div>Operational Relevance</div>
              <div>Confidence</div>
            </div>
            {ds.relatedIncidents.map((r, i) => (
              <div key={String(r.id)} className="grid" style={{ gridTemplateColumns: "0.6fr 0.8fr 0.8fr 1fr 2fr 1.5fr 0.6fr", padding: "8px 10px", gap: 10, borderTop: i === 0 ? "none" : `1px solid ${POLAR}`, fontFamily: "Roboto, sans-serif", fontSize: 10, color: DUSK, alignItems: "start" }}>
                <div>{format(r.date, "dd MMM")}</div>
                <div>{r.physicalLocation || "—"}</div>
                <div>{r.incidentCountry || "—"}</div>
                <div>{r.issue || "—"}</div>
                <div style={{ color: NAVY }}>{r.title}</div>
                <div>{incidentSummaries[String(r.id)] || r.summary || "—"}</div>
                <div>High</div>
              </div>
            ))}
          </div>
        </Section>
        <div className="page-footer">
          <div>{resolvedTitle}</div>
          <div>Page 7</div>
        </div>
      </div>
    </div>
  );
}
