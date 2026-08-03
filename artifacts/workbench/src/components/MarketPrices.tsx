import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";
import { useListMarketPrices } from "@workspace/api-client-react";
import type { MarketPrice } from "@workspace/api-client-react";
import { SEVERITY_LABELS, severityBadgeStyle } from "@/lib/topics";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import { ExternalLink } from "lucide-react";

const FILL_OPACITY = 0.78;

// Format an ISO "as of" date. Monthly series (MoM change or first-of-month
// anchor) read as "MMM yyyy"; daily series keep the full date. Truthful either
// way — we never round a monthly observation up to "today".
function formatAsOf(asOf: string, change?: string | null): string {
  let d: Date;
  try { d = parseISO(asOf); } catch { return asOf; }
  if (isNaN(d.getTime())) return asOf;
  const monthly = (change ?? "").includes("MoM") || /-01$/.test(asOf);
  return format(d, monthly ? "MMM yyyy" : "dd MMM yyyy");
}

function PriceCard({ p }: { p: MarketPrice }) {
  const traj = (p.trajectory ?? []).map((t) => ({
    date: t.date,
    label: formatAsOf(t.date, p.change),
    value: t.value,
  }));
  // Compact value formatting: keep small unit prices (e.g. $/kWh) readable.
  const valueStr = p.value < 10 ? p.value.toFixed(3) : p.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="bg-white border border-border rounded-sm p-4 relative overflow-hidden flex flex-col">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "#465bff" }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-1">{p.label}</div>
      {p.benchmark ? (
        <div className="text-[11px] text-muted-foreground font-sans mt-0.5 leading-snug">{p.benchmark}</div>
      ) : null}
      <div className="flex items-baseline gap-2 mt-2">
        <span className="font-serif font-bold text-primary text-2xl leading-none">{valueStr}</span>
        <span className="text-xs font-sans text-muted-foreground">{p.unit}</span>
      </div>
      {p.change ? (
        <div className="text-xs font-mono text-[#363636] mt-1">{p.change}</div>
      ) : (
        <div className="text-xs font-mono text-muted-foreground mt-1">no prior observation</div>
      )}
      {traj.length > 1 ? (
        <div className="h-[88px] mt-3 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={traj} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={9} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} width={34} fontSize={9} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 11 }} />
              <Line type="monotone" dataKey="value" stroke="#0b0a3d" strokeWidth={2} isAnimationActive={false} dot={{ r: 2, stroke: "#0b0a3d", strokeWidth: 1, fill: "#465bff", fillOpacity: FILL_OPACITY }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <div className="text-[10px] text-muted-foreground font-sans mt-3 leading-snug">
        As of {formatAsOf(p.asOf, p.change)} · {p.source}
      </div>
    </div>
  );
}

// Live commodity-price snapshot for one monitor group. Every value is fetched
// from a real public feed via /api/market-prices; when the feed is empty we say
// so rather than render a fabricated fallback.
export function MarketPricesSection({ group }: { group: string }) {
  const { data = [], isLoading } = useListMarketPrices({ group });
  const rows = useMemo(
    () => [...data].sort((a, b) => a.label.localeCompare(b.label)),
    [data],
  );

  return (
    <div className="space-y-3">
      <h2 className="font-serif font-bold uppercase text-primary text-base tracking-wide border-b-2 border-accent pb-1 inline-block">
        Market Prices
      </h2>
      {isLoading ? (
        <div className="bg-white border border-border rounded-sm p-8 text-center text-sm text-muted-foreground">Loading prices...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-border rounded-sm p-8 text-center text-sm text-muted-foreground italic">
          No live price data available. Prices populate from public market feeds on the next ingestion run.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((p) => <PriceCard key={`${p.group}:${p.key}`} p={p} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report-embedded Market Prices section (Energy Watch report).
//
// The dashboard PriceCard above uses recharts + Tailwind, which html2canvas
// cannot rasterise reliably for the PDF. This report variant is built with
// inline styles + a static SVG mini-chart (mirroring JetFuelTrajectoryChart)
// so a SINGLE component renders identically in the on-screen preview AND when
// rasterised into the PDF — preview and PDF can never disagree. It takes its
// rows as a prop (fetched once by the caller) so both surfaces read the same
// live market-prices feed.
// ---------------------------------------------------------------------------

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const POLAR = "#e2e2e2";
const DUSK = "#363636";

function MiniTrajectory({ points, unit }: { points: { date: string; value: number }[]; unit: string }) {
  const W = 300;
  const H = 96;
  const padL = 36, padR = 10, padT = 10, padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const values = points.map((p) => p.value);
  const minP = Math.min(...values);
  const maxP = Math.max(...values);
  const span = Math.max(maxP - minP, Math.abs(maxP) * 0.02, 0.0001);
  const yMin = minP - span * 0.15;
  const yMax = maxP + span * 0.15;
  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const yTicks = [0, 1, 2].map((k) => yMin + (k / 2) * (yMax - yMin));
  const dec = span >= 10 ? 0 : span >= 1 ? 1 : 3;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", marginTop: 8 }}>
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={POLAR} strokeWidth={1} />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={POLAR} strokeWidth={1} />
      {yTicks.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={POLAR} strokeWidth={0.5} />
          <text x={padL - 4} y={y(v) + 3} fontSize={8} fill={DUSK} textAnchor="end">
            {v.toFixed(dec)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke={ELECTRIC} strokeWidth={1.5} />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={3} fill={NAVY} />
      <text x={W - padR} y={H - padB + 14} fontSize={8} fill={DUSK} textAnchor="end">
        {unit}
      </text>
    </svg>
  );
}

function ReportPriceCard({ p }: { p: MarketPrice }) {
  const traj = (p.trajectory ?? []).map((t) => ({ date: t.date, value: t.value }));
  const valueStr =
    p.value < 10
      ? p.value.toFixed(3)
      : p.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${POLAR}`,
        borderRadius: 2,
        padding: 14,
        position: "relative",
        overflow: "hidden",
        fontFamily: "Roboto, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: ELECTRIC }} />
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", color: DUSK, marginTop: 4 }}>
        {p.label}
      </div>
      {p.benchmark ? (
        <div style={{ fontSize: 11, color: DUSK, opacity: 0.75, marginTop: 2, lineHeight: 1.3 }}>{p.benchmark}</div>
      ) : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <span style={{ fontFamily: "'Roboto Condensed', Roboto, sans-serif", fontWeight: 700, color: NAVY, fontSize: 24, lineHeight: 1 }}>
          {valueStr}
        </span>
        <span style={{ fontSize: 11, color: DUSK, opacity: 0.75 }}>{p.unit}</span>
      </div>
      <div style={{ fontSize: 11, fontFamily: "monospace", color: p.change ? DUSK : "#8a8a8a", marginTop: 4 }}>
        {p.change ?? "no prior observation"}
      </div>
      {traj.length > 1 ? <MiniTrajectory points={traj} unit={p.unit} /> : null}
      <div style={{ fontSize: 10, color: DUSK, opacity: 0.7, marginTop: 10, lineHeight: 1.3 }}>
        As of {formatAsOf(p.asOf, p.change)} · {p.source}
      </div>
    </div>
  );
}

const REPORT_EMPTY_TEXT =
  "No live price data available. Prices populate from public market feeds on the next ingestion run.";

/** Cards-only grid for the report — rasterised into the PDF (heading drawn
 *  separately in jsPDF so it stays selectable Roboto text). */
export function MarketPricesReportGrid({ rows }: { rows: MarketPrice[] }) {
  const sorted = [...rows].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {sorted.map((p) => <ReportPriceCard key={`${p.group}:${p.key}`} p={p} />)}
    </div>
  );
}

/** Full report section (heading + grid/empty state) for the on-screen preview. */
export function MarketPricesReportSection({ rows }: { rows: MarketPrice[] }) {
  return (
    <section style={{ fontFamily: "Roboto, sans-serif" }}>
      {rows.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${POLAR}`,
            borderRadius: 2,
            padding: 24,
            textAlign: "center",
            fontSize: 12,
            fontStyle: "italic",
            color: DUSK,
          }}
        >
          {REPORT_EMPTY_TEXT}
        </div>
      ) : (
        <MarketPricesReportGrid rows={rows} />
      )}
    </section>
  );
}

export const MARKET_PRICES_REPORT_EMPTY_TEXT = REPORT_EMPTY_TEXT;

export type DerivedIncidentRow = {
  id: number;
  dateLabel: string;
  country: string | null;
  title: string;
  severity: string;
  sourceUrl?: string | null;
  resolvedUrl?: string | null;
};

// Presentational panel for incidents derived from the loaded set by keyword
// (e.g. brownouts, supply pinch points). Counts and rows are computed by the
// caller from the same windowed incident set every other surface uses.
export function IncidentDerivedPanel({
  title, subtitle, accent, countryRows, rows, emptyText,
}: {
  title: string;
  subtitle: string;
  accent: string;
  countryRows: { label: string; value: number }[];
  rows: DerivedIncidentRow[];
  emptyText: string;
}) {
  const max = countryRows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <section className="space-y-3">
      <h2 className="font-serif font-bold uppercase text-primary text-base tracking-wide border-b-2 border-accent pb-1 inline-block">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground font-sans -mt-1">{subtitle}</p>
      {rows.length === 0 ? (
        <div className="bg-white border border-border rounded-sm p-8 text-center text-sm text-muted-foreground italic">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-white border border-border rounded-sm p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">By Country</div>
            {countryRows.length === 0 ? (
              <p className="text-sm text-muted-foreground italic mt-3">No country attributed.</p>
            ) : (
              <div className="space-y-2 mt-3">
                {countryRows.map((r) => {
                  const pct = max > 0 ? Math.round((r.value / max) * 100) : 0;
                  return (
                    <div key={r.label} className="space-y-1">
                      <div className="flex items-baseline justify-between">
                        <div className="text-xs font-sans text-primary">{r.label}</div>
                        <div className="text-xs font-mono text-muted-foreground">{r.value}</div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
                        <div className="h-full" style={{ width: `${pct}%`, background: accent, opacity: FILL_OPACITY }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="bg-white border border-border rounded-sm overflow-hidden lg:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-sans font-medium w-[120px]">Date</th>
                    <th className="text-left p-2 font-sans font-medium w-[140px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium">Headline</th>
                    <th className="text-left p-2 font-sans font-medium w-[110px]">Severity</th>
                    <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/30 align-top">
                      <td className="p-2 font-mono text-xs whitespace-nowrap">{i.dateLabel}</td>
                      <td className="p-2 text-xs">{i.country ?? "—"}</td>
                      <td className="p-2 font-medium">{i.title}</td>
                      <td className="p-2">
                        <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>
                          {SEVERITY_LABELS[i.severity] ?? i.severity}
                        </span>
                      </td>
                      <td className="p-2">
                        {incidentSourceUrl(i) ? (
                          <a href={incidentSourceUrl(i)!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs" aria-label="Open source">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
