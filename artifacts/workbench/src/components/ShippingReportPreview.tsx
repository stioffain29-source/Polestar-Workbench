import {
  makeSectionGate,
  type TopicSectionOverrides,
} from "@/lib/topicSectionOverrides";
import { format, parseISO } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
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
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(145deg, #0b0a3d 0%, #17145f 56%, #465bff 145%)",
          }}
        />
        <div className="relative z-10 h-full flex flex-col p-[20mm] text-white">
          <img
            src={polestarLogo}
            alt="Polestar Advisory"
            className="h-10 w-auto self-start"
          />
          <div className="flex-1 flex flex-col justify-center">
            <div className="text-[12px] font-bold tracking-[0.24em] uppercase mb-5 text-white/85">
              Polestar Insights · Maritime Intelligence
            </div>
            <h1 className="text-[48px] font-bold uppercase tracking-wide leading-none mb-6">
              {resolvedTitle}
            </h1>
            <div className="w-20 h-1 bg-[#465bff] mb-6" />
            <div className="text-[15px] font-light uppercase tracking-[0.12em]">
              {ds.reportingPeriodLong}
            </div>
          </div>
          <div className="text-[12px] font-medium uppercase tracking-[0.14em]">
            polestaradvisory.com
          </div>
        </div>
      </div>

      {/* PAGE 2: MARITIME SITUATION */}
       {showSituation && (
       <div className="shipping-page" data-shipping-page="2">
         <div className="page-header">
           <div className="page-title">Maritime Situation</div>
           <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
         </div>

          {show("fast-facts") && <div className="flex items-center justify-between border-y-2 border-[#0b0a3d] py-4 mb-6">
           {[
             { label: "Overall Risk", value: isPending ? "PENDING" : riskFact.label.toUpperCase() },
              { label: "Confirmed Incidents", value: confirmedCount },
             { label: "Chokepoints Affected", value: `${affectedChokepoints} / 7` },
             { label: "Vessel Attacks / Seizures", value: String(vesselAttacks) },
             { label: "Main Affected Chokepoint", value: mainAffected.toUpperCase() }
           ].map((f, i, arr) => (
              <div key={i} className={`flex flex-col text-center px-4 ${i !== arr.length - 1 ? 'border-r border-[#e2e2e2]' : ''} flex-1`}>
                 <span className="text-[10px] uppercase font-bold tracking-widest text-[#363636] mb-1">{f.label}</span>
                 <span className="text-[14px] font-bold text-[#0b0a3d] leading-none">{f.value}</span>
               </div>
           ))}
          </div>}

         {show("executive-summary") && (
           <div className="bg-[#0b0a3d] text-white p-6 rounded-[2px] mb-6 flex-shrink-0 shadow-md">
             <h3 className="uppercase text-[11px] tracking-widest text-[#465bff] mb-2 font-bold">Bottom Line Up Front</h3>
             <p className="font-light leading-relaxed text-[15px]">{publication.prose.executiveSummary}</p>
           </div>
         )}

          {show("maritime-intelligence") && <div className="flex-1 min-h-0 w-full relative pb-[15mm]">
            <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] mb-3 font-bold">Regional Maritime Map</h3>
             <ShippingSituationMap chokepoints={presentation.matrix.map(row => ({
               name: row.key,
               level: row.risk.level ?? 1,
               label: row.risk.display,
             }))} />
          </div>}
         <div className="page-footer"><span>Shipping Watch</span><span>Page 2</span></div>
       </div>
       )}

      {/* PAGE 3: CHOKEPOINT WATCH */}
      {show("chokepoint-route") && (
      <div className="shipping-page" data-shipping-page="3">
         <div className="page-header">
           <div className="page-title">Chokepoint Watch</div>
           <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
         </div>
         <ShippingReportMatrix rows={presentation.matrix} />
         <div className="page-footer"><span>Shipping Watch</span><span>Page 3</span></div>
      </div>
      )}

      {/* PAGE 4: THREAT PICTURE */}
       {(show("vessel-piracy") || show("maritime-security")) && (
      <div className="shipping-page" data-shipping-page="4">
         <div className="page-header">
           <div className="page-title">Threat Picture</div>
           <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
         </div>
         <div className="flex flex-col gap-6">
           {show("vessel-piracy") && (
           <div>
             <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] font-bold">Major Incidents Timeline</h3>
             {presentation.timeline.countNote && (
               <div className="flex flex-col gap-1 mb-2">
                 <div className="text-[11px] text-[#363636] font-light">
                   {presentation.timeline.countNote}
                 </div>
               </div>
             )}
             <ShippingThreatTimeline incidents={presentation.timeline.rows} />
           </div>
           )}
           
            {show("maritime-security") && (
           <div className={show("vessel-piracy") ? "mt-8 border-t border-[#e2e2e2] pt-6" : ""}>
             <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] font-bold mb-4">Piracy and Armed Robbery</h3>
             {presentation.piracySecondary.rows.length > 0 ? (
               <>
                 {presentation.piracySecondary.countNote && (
                   <div className="text-[11px] text-[#363636] font-light mb-2">
                     {presentation.piracySecondary.countNote}
                   </div>
                 )}
                 <ShippingThreatTimeline incidents={presentation.piracySecondary.rows} />
               </>
             ) : (
               <div className="text-[14px] text-[#363636] font-light leading-relaxed">
                 No validated piracy or armed-robbery event is reported.
               </div>
             )}
           </div>
           )}
         </div>
         {presentation.matrix.some(row => row.movement) && <div style={{ marginTop: 24, paddingTop: 10, borderTop: `1px solid ${POLAR}`, fontSize: 10, lineHeight: 1.5, color: DUSK }}>
           <strong>AIS movement context — </strong>
           {presentation.matrix.filter(row => row.movement).map(row => `${row.key}: ${format(new Date(row.movement!.dataAsOf), "dd MMM")}, ${row.movement!.totalVessels == null ? "sample size unavailable" : `${row.movement!.totalVessels} vessels tracked`}`).join(" · ")}
         </div>}
         <div className="page-footer"><span>Shipping Watch</span><span>Page 4</span></div>
      </div>
      )}

      {/* PAGE 5: COMMERCIAL AND REGIONAL IMPACT */}
      {(show("commercial-impact") || show("regional")) && (
      <div className="shipping-page" data-shipping-page="5">
         <div className="page-header">
           <div className="page-title">Commercial & Regional Impact</div>
           <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
         </div>
         <div className="flex-1 flex flex-col gap-8">
            {show("commercial-impact") && (
            <div className="flex-shrink-0">
               <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] mb-3 font-bold">Commercial Impact on Shipping</h3>
               <div className="text-[14px] text-[#363636] font-light leading-relaxed mb-6"><Paragraphs text={publication.prose.commercialImpactRead} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px 24px", marginBottom: 12 }}>
               {buildShippingCommercialCategories(presentation.commercialEffects).map(group => (
                 <div key={group.title} style={{ borderTop: "1px solid #e2e2e2", paddingTop: 8, gridColumn: group.title === "Other documented effects" ? "1 / -1" : undefined }}>
                   <div style={{ textTransform: "uppercase", fontSize: 11, color: NAVY, fontWeight: 700, marginBottom: 5 }}>{group.title}</div>
                   {(group.lines.length ? group.lines : ["Not established in available reporting."]).map((line, i) =>
                     <p key={i} style={{ fontSize: 11, lineHeight: 1.5, color: DUSK, fontWeight: 300, marginBottom: 4 }}>{line}</p>)}
                 </div>
               ))}
            </div>
            
            </div>
            )}
            {show("regional") && (
            <div className={`flex flex-col gap-4 flex-1 min-h-0 ${show("commercial-impact") ? 'pt-4 border-t border-[#e2e2e2]' : ''}`}>
               <div className="flex gap-8 flex-1">
                 <div className="flex-1">
                   <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] mb-4 font-bold">Incidents by Region</h3>
                   <HorizontalBarChart rows={presentation.geography.regions.rows} labelW={120} />
                 </div>
                 <div className="flex-1">
                   <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] mb-4 font-bold">Records by Country</h3>
                   <HorizontalBarChart rows={presentation.geography.countries.rows} labelW={120} />
                 </div>
               </div>
               
               {(presentation.geography.regions.unknownCount > 0 || presentation.geography.countries.unknownCount > 0) && (
                 <div className="text-[11px] text-[#363636] font-light mt-2 pt-2 border-t border-dashed border-[#e2e2e2]">
                   {[
                     presentation.geography.regions.unknownCount > 0 ? `${presentation.geography.regions.unknownCount} incidents have no established region` : null,
                     presentation.geography.countries.unknownCount > 0 ? `${presentation.geography.countries.unknownCount} incidents have no established country` : null,
                   ].filter(Boolean).join("; ")}. Unknown records remain in the totals.
                 </div>
               )}
            </div>
            )}
         </div>
         <div className="page-footer"><span>Shipping Watch</span><span>Page 5</span></div>
      </div>
      )}

      {/* PAGE 6: WHAT MATTERS */}
       {showAssessment && (
       <div className="shipping-page" data-shipping-page="6">
         <div className="page-header">
           <div className="page-title">Analytical Assessment</div>
           <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
         </div>
         <div className="flex flex-col gap-10 mt-6">
             {show("what-matters") && <div>
               <h3 className="uppercase text-[14px] tracking-widest text-[#465bff] mb-3 font-bold border-b border-[#e2e2e2] pb-2">What Matters</h3>
               <div className="text-[16px] leading-relaxed text-[#363636] font-light"><Paragraphs text={publication.prose.whatMatters} /></div>
             </div>}
             {show("implications") && <div>
               <h3 className="uppercase text-[14px] tracking-widest text-[#465bff] mb-3 font-bold border-b border-[#e2e2e2] pb-2">Implications for Business</h3>
               <div className="text-[15px] leading-relaxed text-[#0b0a3d] font-medium"><Paragraphs text={publication.prose.implications} /></div>
             </div>}
             {show("watch-next") && <div>
               <h3 className="uppercase text-[14px] tracking-widest text-[#465bff] mb-3 font-bold border-b border-[#e2e2e2] pb-2">Watch Next</h3>
               <div className="text-[15px] leading-relaxed text-[#363636]"><Paragraphs text={publication.prose.watchNext} /></div>
             </div>}
          </div>
          <div className="page-footer"><span>Shipping Watch</span><span>Page 6</span></div>
       </div>
       )}

      {/* PAGE 7: POLESTAR VIEW AND RELATED INCIDENTS */}
       {showClosing && (
       <div className="shipping-page" data-shipping-page="7">
         <div className="page-header">
           <div className="page-title">Polestar View</div>
           <img src={polestarLogo} alt="Polestar" className="h-5 opacity-80 mix-blend-multiply filter brightness-0" />
         </div>

          {show("polestar-view") && <div className="bg-[#0b0a3d] text-white p-6 rounded-[2px] mb-6 flex-shrink-0 shadow-md">
           <h3 className="uppercase text-[11px] tracking-widest text-[#465bff] mb-2 font-bold">Current Judgement</h3>
           <div className="font-light leading-relaxed text-[15px]"><Paragraphs text={publication.prose.polestarView} color="#fff" /></div>
          </div>}

           {show("related-incidents") && <div className="flex-1 min-h-0 flex flex-col mb-4">
           <h3 className="uppercase text-[12px] tracking-widest text-[#0b0a3d] mb-3 font-bold">Related Incidents</h3>
           <div className="text-[11px] text-[#363636] font-light mb-2">
             {presentation.register.countNote || `Compact register: latest ${presentation.register.shownCount} prioritised developments.`}
            </div>
            <RelatedIncidentsTable rows={presentation.register.rows} />
          </div>}

          <div
            className="bg-[#e2e2e2] p-4 text-[#363636] leading-relaxed font-light flex-shrink-0 rounded-[2px] mt-auto mb-[15mm]"
            style={{ fontSize: "9pt" }}
          >
           {DISCLAIMER_TEXT}
          </div>
         <div className="page-footer"><span>Shipping Watch</span><span>Page 7</span></div>
      </div>
       )}

    </div>
  );
}
