import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useListStrikes } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { RefreshCw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { munitionLabel } from "@/lib/topics";
import {
  type StrikeLike, strikeText, deriveTarget, deriveWeapon, groupCount,
} from "@/lib/strikeAnalysis";

const WINDOWS = [7, 14, 30, 60, 90, 120] as const;

// ---------------------------------------------------------------------------
// Client-side derivation
//
// The strikes table stores `target_category` / `infrastructure` for some rows
// but leaves ~77% as `unknown`, `casualties` as NULL on ~99%, and a fair share
// of `summary` / `analyst_notes` blank. So the dashboard breakdowns derive from
// the DB category (when meaningful) plus the incident-descriptive text in
// `summary`, `analyst_notes`, and `location`. We deliberately EXCLUDE the
// `source` outlet name and the opaque base64 `sourceUrl` slug — both are noise
// that previously polluted the target/impact regexes. When nothing matches we
// return "Unknown" honestly; we never invent values.
// ---------------------------------------------------------------------------

// StrikeLike, strikeText, deriveTarget, deriveWeapon and groupCount now live in
// @/lib/strikeAnalysis so the dashboard and the Infographic Card Builder bucket
// strikes through one shared rulebook and can never drift.

function deriveCasualties(s: StrikeLike): string {
  if (typeof s.casualties === "number") {
    return s.casualties === 0 ? "No casualties reported" : "Casualties reported";
  }
  const text = strikeText(s);
  // Check explicit negatives FIRST so "no casualties reported" doesn't get
  // misclassified as Reported by the generic casualty token.
  if (/\b(no casualt|no injur|no deaths|no one (was )?hurt|nobody hurt|none (?:reported|injured|killed))\b/.test(text)) return "No casualties reported";
  if (/\b(killed|dead|fatalit|wounded|injur|casualt)\b/.test(text)) return "Casualties reported";
  return "Unknown / not reported";
}

// Compact casualty label for the dense strike-log table cell.
function casualtyShort(s: StrikeLike): string {
  const v = deriveCasualties(s);
  if (v === "Casualties reported") return "Reported";
  if (v === "No casualties reported") return "None";
  return "—";
}

function deriveImpact(s: StrikeLike): string {
  const text = strikeText(s);
  // Negation / interception first, before any damage token can match.
  if (/\b(no damage|no impact|intercept|shot down|repelled|destroyed (the )?(drone|missile)|thwart)\b/.test(text)) return "No impact";
  if (/\b(destroyed|severe damage|major damage|leveled|massive)\b/.test(text)) return "Severe";
  if (/\b(damage|damaged|fire|blast|explosion)\b/.test(text)) return "Damage";
  if (/\b(disrupt|suspend|delay|outage|shutdown|halt|closure|closed|evacuat)\b/.test(text)) return "Disruption";
  return "Not reported";
}

function deriveContext(s: StrikeLike): string {
  const m = (s.munition ?? "").toLowerCase();
  if (m === "mixed") return "Combined";
  const text = strikeText(s);
  if (/\b(combined|coordinated|multi[\s-]?(wave|prong)|swarm|drones?\s+and\s+missiles?|missiles?\s+and\s+drones?)\b/.test(text)) return "Combined";
  if (m === "drone" || m === "ballistic_missile" || m === "cruise_missile") return "Single-system";
  return "Unknown";
}

const UAE_EMIRATES = ["Abu Dhabi", "Dubai", "Fujairah", "Sharjah", "Ajman", "Ras al-Khaimah", "Umm al-Quwain"];

function deriveEmirate(s: StrikeLike): string {
  const loc = (s.location ?? "").trim();
  if (!loc || /^unknown$/i.test(loc)) {
    // Try to recover from source / URL text.
    const text = strikeText(s);
    for (const e of UAE_EMIRATES) {
      if (new RegExp(`\\b${e.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(text)) return e;
    }
    return "Unknown";
  }
  // Location strings look like "Al Taweelah (EGA), Abu Dhabi" or "Fujairah, Fujairah".
  for (const e of UAE_EMIRATES) {
    if (new RegExp(`\\b${e.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(loc)) return e;
  }
  return "Unknown";
}

/** Treat empty / unattributed / not-reported bars as carrying no real signal. */
function isUnknownKey(key: string): boolean {
  return /unknown|unattributed|not reported/i.test(key);
}

/** True when "Unknown"-type buckets account for more than half the records. */
function dominatedByUnknown(data: { key: string; count: number }[]): boolean {
  const total = data.reduce((a, b) => a + b.count, 0);
  if (total === 0) return false;
  const unknown = data.filter((d) => isUnknownKey(d.key)).reduce((a, b) => a + b.count, 0);
  return unknown / total > 0.5;
}

const UNKNOWN_CAVEAT = "Mostly unattributed — limited public source detail, not an operational finding.";

const SUBTITLE: Record<"maritime_hormuz" | "land_gcc", string> = {
  land_gcc:
    "Land-based missile and drone strikes against Saudi Arabia, Kuwait, UAE, Oman, Bahrain, Qatar, and Jordan. Maritime incidents, naval interceptions, and threat-only reports are excluded.",
  maritime_hormuz:
    "Maritime missile, drone, mine, and small-boat attacks against vessels and ports in the Strait of Hormuz and northern Arabian Gulf. Land-based strikes are excluded.",
};

// Categorical palette. Largest series rendered in Midnight Blue; remaining
// categories cycle through neutral non-risk hues so they do not collide with
// risk-tier colours (Extreme/High/Moderate/Low/Insignificant) which remain
// reserved for severity rendering elsewhere in the workbench.
const CAT_PALETTE = ["#0b0a3d", "#2A9D8F", "#E67E22", "#C0392B", "#465bff", "#F4D35E", "#6FB872", "#B8C2CC"];

// Standard chart styling: slight translucency + darker edge so bars read
// crisply on the Polar Gray background. Matches the marker convention in
// lib/topics.ts (0.78 fill opacity, 1.5px stroke).
const CHART_FILL_OPACITY = 0.78;
const CHART_STROKE_WIDTH = 1.5;

function darken(hex: string, amount = 0.35): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function resolveTheatre(slug: string | undefined): "maritime_hormuz" | "land_gcc" {
  if (slug === "land" || slug === "land_gcc") return "land_gcc";
  return "maritime_hormuz";
}

export default function Strikes() {
  const [, params] = useRoute("/strikes/:theatre");
  const theatre = resolveTheatre(params?.theatre);
  const [days, setDays] = useState<number>(60);
  const [country, setCountry] = useState<string>("");
  const [weapon, setWeapon] = useState<string>("");
  const [target, setTarget] = useState<string>("");

  const { data: strikes = [], isLoading } = useListStrikes({ theatre, days });

  const filtered = useMemo(() => {
    return strikes.filter((s) =>
      (!country || s.country === country) &&
      (!weapon || s.munition === weapon) &&
      (!target || s.targetCategory === target),
    );
  }, [strikes, country, weapon, target]);

  const countries = useMemo(() => uniq(strikes.map((s) => s.country)).sort(), [strikes]);
  const weapons = useMemo(() => uniq(strikes.map((s) => s.munition)).sort(), [strikes]);
  const targets = useMemo(() => uniq(strikes.map((s) => s.targetCategory)).sort(), [strikes]);

  const timeline = useMemo(() => groupTimeline(filtered, days), [filtered, days]);
  const byCountry = useMemo(() => groupCount(filtered, (s) => s.country), [filtered]);
  const byWeapon = useMemo(() => groupCount(filtered, deriveWeapon), [filtered]);
  const byTarget = useMemo(() => groupCount(filtered, deriveTarget), [filtered]);
  const byImpact = useMemo(() => groupCount(filtered, deriveImpact), [filtered]);
  const byContext = useMemo(() => groupCount(filtered, deriveContext), [filtered]);
  const byCasualties = useMemo(() => groupCount(filtered, deriveCasualties), [filtered]);

  const exportCsv = () => {
    const headers = [
      "occurred_at", "theatre", "country", "location", "latitude", "longitude",
      "munition", "target_category", "infrastructure", "casualties",
      "source", "source_url", "confidence", "summary",
    ];
    const rows = filtered.map((s) => [
      s.occurredAt, s.theatre, s.country, s.location ?? "",
      s.latitude ?? "", s.longitude ?? "",
      s.munition, s.targetCategory, s.infrastructure, s.casualties ?? "",
      s.source ?? "", s.sourceUrl ?? "", s.confidence, (s.summary ?? "").replace(/\s+/g, " "),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map(csvEscape).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `missile-strike-tracker-${theatre}-${days}d-${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-primary tracking-tight">Missile Strike Tracker</h1>
          <p className="text-sm text-muted-foreground font-sans mt-2 max-w-4xl">{SUBTITLE[theatre]}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/strikes/backfill"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium border border-border rounded-sm bg-card hover:bg-muted"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Run Backfill
          </Link>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium rounded-sm bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-card border border-border rounded-sm px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3 justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <FilterRow label="Range">
            <div className="flex border border-border rounded-sm overflow-hidden">
              {WINDOWS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-sans",
                    days === d ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted",
                  )}
                >{d}d</button>
              ))}
            </div>
          </FilterRow>
          <FilterSelect label="Country" value={country} setValue={setCountry} options={countries} />
          <FilterSelect label="Weapon" value={weapon} setValue={setWeapon} options={weapons} format={munitionLabel} />
          <FilterSelect label="Target" value={target} setValue={setTarget} options={targets} format={munitionLabel} />
        </div>
        <div className="text-xs font-sans text-muted-foreground">
          {filtered.length} strikes in window · {filtered.length} rows
        </div>
      </div>

      {!isLoading && strikes.length === 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          {theatre === "maritime_hormuz" ? (
            <>
              No maritime-theatre strikes are currently on file for this window.{" "}
              <Link href="/strikes/land" className="text-accent hover:underline">View Land — GCC</Link>.
            </>
          ) : (
            <>
              No land-theatre strikes are currently on file for this window.{" "}
              <Link href="/strikes/maritime" className="text-accent hover:underline">View Maritime — Hormuz</Link>.
            </>
          )}
        </div>
      )}

      {/* Daily timeline */}
      <Card
        title="Daily strike timeline"
        subtitle={`UTC days, last ${days} days (today partial). Daily counts sum to ${filtered.length}.`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={timeline} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="strikeArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#465bff" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#465bff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} />
            <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
            <Area type="monotone" dataKey="count" stroke={darken("#465bff")} strokeWidth={CHART_STROKE_WIDTH} fill="url(#strikeArea)" fillOpacity={CHART_FILL_OPACITY} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Top section: three standardised overview charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card
          title="Total strikes by country"
          subtitle={`All countries in window. Bars sum to ${filtered.length}.`}
        >
          <CatBar data={byCountry} height={220} />
        </Card>
        <Card
          title="Attack context"
          subtitle="Combined (multi-system) vs single-system attacks."
          caveat={dominatedByUnknown(byContext) ? UNKNOWN_CAVEAT : undefined}
        >
          <CatBar data={byContext} height={220} />
        </Card>
        <Card
          title="Weapon family"
          subtitle="Drone · ballistic · cruise · unknown."
          caveat={dominatedByUnknown(byWeapon) ? UNKNOWN_CAVEAT : undefined}
        >
          <CatBar data={byWeapon} height={220} />
        </Card>
      </div>

      {/* Strike profile */}
      <div>
        <h2 className="font-serif font-bold uppercase text-primary text-sm tracking-wide">Strike profile</h2>
        <p className="text-xs text-muted-foreground font-sans mt-1 mb-3">
          Standardised incident-level breakdown. Bars sum to {filtered.length} (= rows below). Reflects current filters.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card title="Target" compact caveat={dominatedByUnknown(byTarget) ? UNKNOWN_CAVEAT : undefined}>
            <CatBar data={byTarget} height={190} />
          </Card>
          <Card title="Weapon" compact caveat={dominatedByUnknown(byWeapon) ? UNKNOWN_CAVEAT : undefined}>
            <CatBar data={byWeapon} height={190} />
          </Card>
          <Card title="Casualties" compact caveat={dominatedByUnknown(byCasualties) ? UNKNOWN_CAVEAT : undefined}>
            <CatBar data={byCasualties} height={190} />
          </Card>
          <Card title="Impact" compact caveat={dominatedByUnknown(byImpact) ? UNKNOWN_CAVEAT : undefined}>
            <CatBar data={byImpact} height={190} />
          </Card>
        </div>
      </div>

      {/* Strike log */}
      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">Strike Log</div>
        <div className="grid grid-cols-[160px_140px_1fr_140px_140px_90px_80px] text-[10px] font-sans uppercase tracking-widest text-muted-foreground bg-muted/30 border-b border-border">
          <div className="p-3">Occurred</div><div className="p-3">Country</div><div className="p-3">Location</div>
          <div className="p-3">Weapon</div><div className="p-3">Target</div><div className="p-3">Cas.</div><div className="p-3">Conf</div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No strikes match the selected filters.</div>
        ) : (
          <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {filtered.map((s) => (
              <div key={s.id} className="grid grid-cols-[160px_140px_1fr_140px_140px_90px_80px] items-center text-sm hover:bg-muted/30">
                <div className="p-3 font-mono text-xs">{format(new Date(s.occurredAt), "dd MMM yyyy HH:mm")}</div>
                <div className="p-3 text-xs">{s.country}</div>
                <div className="p-3 text-xs truncate">{(() => {
                  const loc = (s.location ?? "").trim();
                  if (loc && !/^unknown$/i.test(loc)) return loc;
                  if (/united arab|uae/i.test(s.country)) {
                    const e = deriveEmirate(s);
                    if (e !== "Unknown") return e;
                  }
                  return "—";
                })()}</div>
                <div className="p-3 text-xs uppercase font-serif">{deriveWeapon(s)}</div>
                <div className="p-3 text-xs">{deriveTarget(s)}</div>
                <div className="p-3 text-xs font-mono">{casualtyShort(s)}</div>
                <div className="p-3 text-xs uppercase font-serif">{s.confidence}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  title, subtitle, children, compact, caveat,
}: { title: string; subtitle?: string; children: React.ReactNode; compact?: boolean; caveat?: string }) {
  return (
    <div className={cn("bg-card border border-border rounded-sm", compact ? "p-3" : "p-4")}>
      <h3 className={cn("font-serif font-bold uppercase text-primary tracking-wide", compact ? "text-xs" : "text-sm")}>{title}</h3>
      {subtitle && <p className="text-[11px] text-muted-foreground font-sans mt-0.5">{subtitle}</p>}
      {caveat && <p className="text-[10px] text-muted-foreground font-sans italic mt-0.5">{caveat}</p>}
      <div className="mb-3" />
      {children}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-sans uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FilterSelect({
  label, value, setValue, options, format,
}: { label: string; value: string; setValue: (v: string) => void; options: string[]; format?: (s: string) => string }) {
  return (
    <FilterRow label={label}>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="bg-card border border-border rounded-sm px-2 py-1 text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-accent min-w-[120px]"
      >
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{format ? format(o) : o}</option>)}
      </select>
    </FilterRow>
  );
}

function CatBar({ data, height = 240 }: { data: { key: string; count: number }[]; height?: number }) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={{ stroke: "#e2e2e2" }}
          fontSize={10}
          interval={0}
          angle={data.length > 3 ? -25 : 0}
          textAnchor={data.length > 3 ? "end" : "middle"}
          height={data.length > 3 ? 50 : 30}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} />
        <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
        <Bar dataKey="count">
          {data.map((_, i) => {
            const fill = CAT_PALETTE[i % CAT_PALETTE.length];
            return (
              <Cell
                key={i}
                fill={fill}
                fillOpacity={CHART_FILL_OPACITY}
                stroke={darken(fill)}
                strokeWidth={CHART_STROKE_WIDTH}
              />
            );
          })}
          <LabelList dataKey="count" position="top" fontSize={10} fill="#363636" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground font-sans">No data in selected window.</div>;
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }


function groupTimeline(arr: { occurredAt: string }[], days: number): { date: string; count: number }[] {
  const m = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    m.set(format(d, "yyyy-MM-dd"), 0);
  }
  for (const x of arr) {
    const k = format(new Date(x.occurredAt), "yyyy-MM-dd");
    if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries()).map(([date, count]) => ({ date: format(new Date(date), "MMM d"), count }));
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
