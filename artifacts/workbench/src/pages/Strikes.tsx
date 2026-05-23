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

const WINDOWS = [7, 14, 30, 60, 90, 120] as const;

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
const CAT_PALETTE = ["#0B0B3D", "#2A9D8F", "#E67E22", "#C0392B", "#4655FF", "#F4D35E", "#6FB872", "#B8C2CC"];

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

  const { data: strikes = [] } = useListStrikes({ theatre, days: days as 7 });

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
  const byWeapon = useMemo(() => groupCount(filtered, (s) => munitionLabel(s.munition)), [filtered]);
  const byTarget = useMemo(() => groupCount(filtered, (s) => munitionLabel(s.targetCategory)), [filtered]);
  const byInfra = useMemo(() => groupCount(filtered, (s) => munitionLabel(s.infrastructure)), [filtered]);
  const byEmirate = useMemo(() => {
    const uae = filtered.filter((s) => /united arab|uae/i.test(s.country));
    return groupCount(uae, (s) => s.location ?? "Unknown");
  }, [filtered]);
  const byLocation = useMemo(() => {
    return groupCount(filtered, (s) => s.location ?? "Unknown").slice(0, 10);
  }, [filtered]);
  const byCasualties = useMemo(() => {
    const buckets: Record<string, number> = { "0": 0, "1–5": 0, "6–20": 0, "21+": 0 };
    for (const s of filtered) {
      const c = s.casualties ?? 0;
      if (c === 0) buckets["0"]++;
      else if (c <= 5) buckets["1–5"]++;
      else if (c <= 20) buckets["6–20"]++;
      else buckets["21+"]++;
    }
    return Object.entries(buckets).map(([key, count]) => ({ key, count }));
  }, [filtered]);

  const uaeTotal = useMemo(
    () => filtered.filter((s) => /united arab|uae/i.test(s.country)).length,
    [filtered],
  );

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

      {/* Daily timeline */}
      <Card
        title="Daily strike timeline"
        subtitle={`UTC days, last ${days} days (today partial). Daily counts sum to ${filtered.length}.`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={timeline} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="strikeArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4655FF" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#4655FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
            <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
            <Area type="monotone" dataKey="count" stroke="#0B0B3D" strokeWidth={1.5} fill="url(#strikeArea)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Two-column chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Total strikes by country"
          subtitle={`All countries in window. Bars sum to ${filtered.length}.`}
        >
          <CatBar data={byCountry} />
        </Card>
        {theatre === "land_gcc" ? (
          <Card
            title="UAE strikes by emirate"
            subtitle={`UAE only. "Unknown" = emirate not yet attributed. Bars sum to ${uaeTotal} (= UAE total above).`}
          >
            {byEmirate.length === 0 ? <Empty /> : <CatBar data={byEmirate} />}
          </Card>
        ) : (
          <Card
            title="Strikes by port / chokepoint"
            subtitle={`Top maritime locations in window. Bars sum to ${byLocation.reduce((a, b) => a + b.count, 0)}.`}
          >
            {byLocation.length === 0 ? <Empty /> : <CatBar data={byLocation} />}
          </Card>
        )}
        <Card
          title={theatre === "land_gcc" ? "Attack context" : "Maritime context"}
          subtitle={`Single-system vs combined (multi-weapon) salvos. Bars sum to ${filtered.length}.`}
        >
          <CatBar data={byInfra} />
        </Card>
        <Card
          title="Weapon family"
          subtitle={`One-way attack drone · ballistic · cruise · unknown. Bars sum to ${filtered.length}.`}
        >
          <CatBar data={byWeapon} />
        </Card>
      </div>

      {/* Strike profile */}
      <div>
        <h2 className="font-serif font-bold uppercase text-primary text-sm tracking-wide">Strike profile</h2>
        <p className="text-xs text-muted-foreground font-sans mt-1 mb-3">
          Bucket counts across the four standardised incident-level columns. Bars sum to {filtered.length}
          {" "}(= rows below). Reflects current filters.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card title="Target" compact><CatBar data={byTarget} height={170} /></Card>
          <Card title="Weapon" compact><CatBar data={byWeapon} height={170} /></Card>
          <Card title="Casualties" compact><CatBar data={byCasualties} height={170} /></Card>
          <Card title="Impact" compact><CatBar data={byInfra} height={170} /></Card>
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
                <div className="p-3 text-xs truncate">{s.location ?? "—"}</div>
                <div className="p-3 text-xs uppercase font-serif">{munitionLabel(s.munition)}</div>
                <div className="p-3 text-xs">{munitionLabel(s.targetCategory)}</div>
                <div className="p-3 text-xs font-mono">{s.casualties ?? 0}</div>
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
  title, subtitle, children, compact,
}: { title: string; subtitle?: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cn("bg-card border border-border rounded-sm", compact ? "p-3" : "p-4")}>
      <h3 className={cn("font-serif font-bold uppercase text-primary tracking-wide", compact ? "text-xs" : "text-sm")}>{title}</h3>
      {subtitle && <p className="text-[11px] text-muted-foreground font-sans mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
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
        <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={{ stroke: "#E2E2E2" }}
          fontSize={10}
          interval={0}
          angle={data.length > 4 ? -25 : 0}
          textAnchor={data.length > 4 ? "end" : "middle"}
          height={data.length > 4 ? 50 : 30}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
        <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
        <Bar dataKey="count">
          {data.map((_, i) => <Cell key={i} fill={CAT_PALETTE[i % CAT_PALETTE.length]} />)}
          <LabelList dataKey="count" position="top" fontSize={10} fill="#303030" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground font-sans">No data in selected window.</div>;
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

function groupCount<T>(arr: T[], key: (x: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of arr) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

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
