import {
  makeSectionGate,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { format, parseISO } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import shippingCoverUrl from "@assets/william-william-NndKt2kF1L4-unsplash_1779617475306.jpg";
import { resolveReportTitle } from "@/lib/reportNaming";
import type { TopicAiProse } from "@/lib/topicProseResolution";
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
  shippingPublicationIssueAction,
  shippingPublicationIssueSection,
} from "@/lib/shippingPublication";
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
  polestarView?: string | null; chokepointRouteRead?: string | null; vesselPiracyRead?: string | null; commercialImpactRead?: string | null; maritimeSecurityRead?: string | null; regionalCountryRead?: string | null;
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

function ShippingPublicationWarnings({
  issues,
}: {
  issues: Array<{
    code: string;
    section?: string;
    message: string;
    incidentIds?: Array<number | string>;
  }>;
}) {
  if (issues.length === 0) return null;
  return (
    <aside
      aria-label="Shipping Watch draft validation warnings"
      data-testid="shipping-publication-warnings"
      className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <h2 className="font-semibold">
        Draft preview — PDF export is blocked until these checks are resolved
      </h2>
      <p className="mt-1 leading-6">
        The report below is still your live draft. Saved edits and all report
        sections remain visible while you address the warnings.
      </p>
      <ul className="mt-3 space-y-3">
        {issues.map((item, index) => {
          const section = shippingPublicationIssueSection(item);
          const action = shippingPublicationIssueAction(item);
          return (
            <li
              key={`${item.code}-${item.section ?? "report"}-${index}`}
              data-testid="shipping-publication-warning"
              className="border-l-2 border-amber-500 pl-3 leading-6"
            >
              <div>
                <strong>{section}</strong>
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">
                  {item.code}
                </span>
              </div>
              <div>{item.message}</div>
              <div>
                <strong>Action:</strong> {action}
                {item.incidentIds && item.incidentIds.length > 0
                  ? ` Incident ${item.incidentIds.join(", ")}.`
                  : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
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
            className="bg-white border rounded-sm relative"
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
  const bg = SHIPPING_SEV_COLOR[k] ?? "#999";
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
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3" style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: NAVY }}>
            <div style={{ width: labelW, flexShrink: 0, fontWeight: 700 }}>{r.label}</div>
            <div className="flex-1 relative" style={{ background: "#F3F4F8", height: 18 }}>
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
                  background: rgba(r.color ?? ELECTRIC, 0.85),
                  border: `1px solid ${darken(r.color ?? ELECTRIC, 0.25)}`,
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

function RelatedIncidentsTable({ rows, summaries }: { rows: EnrichedIncident[]; summaries: Record<string, string> }) {
  if (rows.length === 0) return null;
  return (
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: "0.7fr 1.0fr 2.2fr 0.7fr",
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
        <div>Issue</div>
        <div>Title</div>
        <div>Severity</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={String(r.id)}
          className="grid"
          style={{
            gridTemplateColumns: "0.7fr 1.0fr 2.2fr 0.7fr",
            padding: "8px 10px",
            gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif",
            fontSize: 12,
            color: DUSK,
            alignItems: "flex-start",
          }}
        >
          <div>{format(r.date, "dd MMM yyyy")}</div>
          <div>{r.issue}</div>
          <div style={{ color: NAVY }}>
            {r.title}
            <div style={{ fontSize: 11, color: DUSK, marginTop: 4, lineHeight: 1.4 }}>
              {resolveIncidentSummary(r, summaries)}
            </div>
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
      className="rounded-sm px-3 py-2"
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

      <div className="rounded-sm p-4" style={{ background: NAVY, marginTop: 12 }}>
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
  // remains fail-closed; the preview must keep the cover, tables and saved
  // analyst edits visible so the owner can fix the associated section.
  return (
    <>
      <ShippingPublicationWarnings issues={publication.auditIssues} />
      <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
      <div className="pdf-cover-page">
      {/* 1. Top gradient band — full width, logo left, no margins. */}
      <div
        className="flex items-center"
        style={{ background: BRAND_GRADIENT, color: "#fff", height: 64, paddingLeft: 24, paddingRight: 24 }}
      >
        <img src={polestarLogo} alt="Polestar Advisory" style={{ height: 26, width: "auto", maxWidth: 180, display: "block" }} />
      </div>

      {/* 2. Hero image — full width, cropped, no borders. */}
      <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", display: "block" }}>
        <img
          src={shippingCoverUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>

      {/* 3. Bottom gradient title block — full width, title + subtitle + period + website. */}
      <div
        style={{
          background: BRAND_GRADIENT,
          color: "#fff",
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
          {ds.reportingPeriodLong.toUpperCase()}
        </div>
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
        {prose.executiveSummary.trim() && (
          <Section hidden={!show("executive-summary")} title="Executive Summary">
            <Paragraphs text={prose.executiveSummary} />
          </Section>
        )}

        {show("maritime-intelligence") && (
          <MaritimeIntelligenceReportSection
            board={maritimeBoard}
            completeness={publication.completeness}
          />
        )}

        <Section hidden={!show("fast-facts")} title="Fast Facts">
          <KpiGrid cards={renderedFastFacts} />
        </Section>

        <Section hidden={!show("chokepoint-route")} title="Chokepoint / Route Read">
          <Paragraphs text={prose.chokepointRouteRead} />
          {ds.chokepointRows.some((row) => row.count > 0) && (
            <div className="mt-4">
              <ChokepointTable rows={ds.chokepointRows} />
            </div>
          )}
        </Section>

        <Section hidden={!show("vessel-piracy")} title="Vessel Threat and Piracy Read">
          <Paragraphs text={prose.vesselPiracyRead} />
          {ds.vesselRows.length > 0 && (
            <>
              <div
                className="uppercase mb-2 mt-4"
                style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
              >
                Vessel Attacks ({ds.thirtyDayShortLabel})
              </div>
              <IncidentTable
                rows={ds.vesselRows}
                actLabel="Act"
                actFor={(r) => r.vesselType}
                emptyMessage="No hostile vessel incidents reported this week."
              />
            </>
          )}
          {ds.piracyRows.length > 0 && (
            <>
              <div
                className="uppercase mb-2 mt-4"
                style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
              >
                Piracy and Armed Robbery ({ds.thirtyDayShortLabel})
              </div>
              <IncidentTable
                rows={ds.piracyRows}
                actLabel="Act"
                actFor={(r) => r.act}
                emptyMessage="No piracy or armed-robbery reports this week."
              />
            </>
          )}
        </Section>

        <Section hidden={!show("maritime-security")} title="Maritime Security (ICC CCS / IMB)">
          <Paragraphs text={prose.maritimeSecurityRead} />
          {ds.maritimeSecurity.byType.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4 mb-3">
              {ds.maritimeSecurity.byType.map((b) => (
                <span
                  key={b.type}
                  style={{
                    fontFamily: "Roboto, sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    backgroundColor: maritimeTypeColor(b.type),
                    padding: "3px 9px",
                    borderRadius: 2,
                  }}
                >
                  {b.type}: {b.count}
                </span>
              ))}
            </div>
          )}
          {ds.maritimeSecurity.rows.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead>
                <tr>
                  {["Date", "Type", "Location", "Coastal State"].map((h) => (
                    <th
                      key={h}
                      className="uppercase"
                      style={{
                        textAlign: "left",
                        fontFamily: "Roboto, sans-serif",
                        fontWeight: 700,
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        color: DUSK,
                        borderBottom: `1px solid ${POLAR}`,
                        padding: "5px 8px",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ds.maritimeSecurity.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: NAVY, borderBottom: `1px solid ${POLAR}`, padding: "5px 8px", whiteSpace: "nowrap" }}>
                      {r.date ? format(r.date, "dd MMM yyyy") : "—"}
                    </td>
                    <td style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: NAVY, borderBottom: `1px solid ${POLAR}`, padding: "5px 8px" }}>
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, backgroundColor: maritimeTypeColor(r.type), marginRight: 6, verticalAlign: "middle" }} />
                      {r.type}
                    </td>
                    <td style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: NAVY, borderBottom: `1px solid ${POLAR}`, padding: "5px 8px" }}>
                      {r.location ?? "—"}
                    </td>
                    <td style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: NAVY, borderBottom: `1px solid ${POLAR}`, padding: "5px 8px" }}>
                      {r.country ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, marginTop: 8 }}>
              No piracy or armed-robbery activity recorded for this period by the {MARITIME_SECURITY_SOURCE_LABEL}.
            </p>
          )}
        </Section>

        <Section hidden={!show("commercial-impact")} title="Commercial Impact on Shipping">
          <Paragraphs text={prose.commercialImpactRead} />
          {ds.commercialRows.length > 0 && (
            <div className="mt-4">
              <IncidentTable
                rows={ds.commercialRows}
                actLabel="Issue"
                actFor={(r) => r.issue}
                emptyMessage="No port, freight, insurance or commercial-shipping disruption records in the weekly window."
              />
            </div>
          )}
        </Section>

        <Section hidden={!show("regional")} title="Regional and Country View">
          <Paragraphs text={prose.regionalCountryRead} />
          {ds.regionRows.some((row) => row.value > 0) && (
            <div className="mt-4 mb-5">
              <div
                className="uppercase mb-2"
                style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
              >
                Incidents by Region
              </div>
              <HorizontalBarChart rows={ds.regionRows.filter((row) => row.value > 0)} labelW={180} />
            </div>
          )}
          {ds.countryRows.length > 0 && (
            <>
              <div
                className="uppercase mb-2"
                style={{ fontFamily: "Roboto, sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
              >
                {ds.countryRows.length >= 12 ? "Incidents by Country (Top 12)" : "Incidents by Country"}
              </div>
              <HorizontalBarChart rows={ds.countryRows} labelW={180} />
            </>
          )}
        </Section>

        <Section hidden={!show("what-matters")} title="What Matters">
          <Paragraphs text={prose.whatMatters} />
        </Section>
        <Section hidden={!show("implications")} title="Implications for Business">
          <Bullets text={prose.implications} />
        </Section>
        <Section hidden={!show("watch-next")} title="Watch Next">
          <Bullets text={prose.watchNext} max={8} />
        </Section>
        <Section hidden={!show("polestar-view")} title="Polestar View">
          <Paragraphs text={prose.polestarView} />
        </Section>

        {ds.relatedIncidents.length > 0 && (
          <Section hidden={!show("related-incidents")} title="Related Incidents">
            <RelatedIncidentsTable rows={ds.relatedIncidents} summaries={publication.incidentSummaries} />
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
        style={{ background: POLAR, color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 11, minHeight: 36 }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
      </div>
    </>
  );
}