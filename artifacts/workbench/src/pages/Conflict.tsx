import { useMemo, useState } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import { CountryChoroplethMap, buildCountryIntensity } from "@/components/CountryChoroplethMap";
import "leaflet/dist/leaflet.css";
import { format, differenceInDays, parseISO, startOfDay } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line, LabelList,
} from "recharts";
import { severityBadgeStyle, ratingColor, SEVERITY_LEVELS, SEVERITY_LABELS } from "@/lib/topics";
import { resolveTrueIncidents } from "@/lib/trueIncidents";
import { RangeToggle } from "@/components/RangeToggle";
import { RANGE_DAYS, RANGE_LABEL, RANGE_NOTE, type RangeKey } from "@/lib/dateRange";
import {
  classifyConflictCategory, detectOperationalImpacts,
  CONFLICT_CATEGORIES, CATEGORY_COLOR, CATEGORY_CARD_LABEL,
  OPERATIONAL_IMPACTS, type ConflictCategory,
} from "@/lib/conflictAnalysis";
import { ExternalLink } from "lucide-react";
import { UntranslatedBadge } from "@/components/UntranslatedBadge";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import OfficialMilitaryMaritimeWatchPanel from "@/components/OfficialMilitaryMaritimeWatchPanel";

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};

function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function cleanCountry(c?: string | null): string | null {
  if (!c) return null;
  const t = c.trim();
  if (!t || /^unknown$/i.test(t)) return null;
  return t;
}

// Prefer the translated English headline when present (foreign-language rows
// carry a `displayTitle`), falling back to the original title.
function displayTitle(i: { displayTitle?: string | null; title: string }): string {
  const d = i.displayTitle?.trim();
  return d && d.length > 0 ? d : i.title;
}

export default function Conflict() {
  // The "Conflict Watch" monitor is fed by the live `conflict` data topic —
  // war, armed conflict, insurgency and serious armed crime. This is a
  // SEPARATE kinetic theatre from the flashpoint/protests civil-disorder feed.
  const { data: raw = [], isLoading } = useListIncidents({ topic: "conflict" });

  // Date-range window. Defaults to the widest option so the first load shows the
  // full record set; the analyst can narrow the whole dashboard from the header.
  const [range, setRange] = useState<RangeKey>("2y");
  const windowDays = RANGE_DAYS[range];

  // Reconcile to the same scoped, noise-filtered set the dashboard card and the
  // reports use, so every surface tallies.
  const trueIncidents = useMemo(() => resolveTrueIncidents("conflict", raw), [raw]);

  // Enrich each record with event type, operational-impact tags and a parsed date.
  const enriched = useMemo(
    () =>
      trueIncidents.map((i) => ({
        ...i,
        category: classifyConflictCategory(i),
        impacts: detectOperationalImpacts(i),
        country: cleanCountry((i as { country?: string | null }).country),
        occurredDate: (() => { try { return parseISO(i.occurredAt); } catch { return new Date(NaN); } })(),
      })),
    [trueIncidents],
  );

  const total = enriched.length;
  const now = new Date();

  // Single window predicate for every time-scoped metric on this page, so the
  // cards, fast facts and the trend chart can never disagree at a boundary.
  const within = (i: { occurredDate: Date }, days: number) => {
    if (isNaN(i.occurredDate.getTime())) return false;
    const diff = differenceInDays(now, i.occurredDate);
    return diff >= 0 && diff <= days;
  };

  // Windowed working set — drives every range-scoped metric, chart, the map and
  // the incident table. No lower bound so the widest default never hides a
  // (possibly future-dated) record that the all-time view used to show.
  const inWindow = useMemo(
    () => enriched.filter(
      (i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= windowDays,
    ),
    [enriched, windowDays],
  );
  const countWindow = inWindow.length;
  const criticalWindow = useMemo(
    () => inWindow.filter((i) => i.severity === "high" || i.severity === "extreme").length,
    [inWindow],
  );

  // 7-day change: last 7 days vs the 7 days before that.
  const last7 = useMemo(() => enriched.filter((i) => within(i, 7)).length, [enriched]);
  const prev7 = useMemo(
    () => enriched.filter(
      (i) => !isNaN(i.occurredDate.getTime())
        && differenceInDays(now, i.occurredDate) > 7
        && differenceInDays(now, i.occurredDate) <= 14,
    ).length,
    [enriched],
  );
  const change7 = last7 - prev7;

  const latest = useMemo(() => {
    const sorted = [...enriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return sorted[0] ?? null;
  }, [enriched]);

  // --- Categories ---------------------------------------------------------
  const byCategory = useMemo(
    () => CONFLICT_CATEGORIES.map((cat) => ({
      category: cat,
      count: inWindow.filter((i) => i.category === cat).length,
    })),
    [inWindow],
  );
  const byCategoryWindow = useMemo(() => {
    const m = new Map<ConflictCategory, number>(CONFLICT_CATEGORIES.map((c) => [c, 0]));
    inWindow.forEach((i) => m.set(i.category, (m.get(i.category) ?? 0) + 1));
    return m;
  }, [inWindow]);

  const mostActiveCategory = useMemo(() => {
    const ranked = CONFLICT_CATEGORIES
      .map((c) => ({ category: c, count: byCategoryWindow.get(c) ?? 0 }))
      .sort((a, b) => b.count - a.count);
    return ranked[0] && ranked[0].count > 0 ? ranked[0] : null;
  }, [byCategoryWindow]);

  // --- Countries ----------------------------------------------------------
  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    inWindow.forEach((i) => {
      if (!i.country) return;
      m.set(i.country, (m.get(i.country) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }, [inWindow]);

  const countryIntensity = useMemo(() => buildCountryIntensity(byCountry), [byCountry]);

  const countriesAffected = byCountry.length;
  const topCountry = byCountry[0] ?? null;

  // Country severity profile — count of high/extreme records per country.
  const countrySeverity = useMemo(() => {
    const m = new Map<string, { severe: number; maxRank: number; total: number }>();
    inWindow.forEach((i) => {
      if (!i.country) return;
      const rank = SEV_RANK[i.severity] ?? 0;
      const cur = m.get(i.country) ?? { severe: 0, maxRank: 0, total: 0 };
      cur.total += 1;
      if (rank >= 4) cur.severe += 1;
      if (rank > cur.maxRank) cur.maxRank = rank;
      m.set(i.country, cur);
    });
    return m;
  }, [inWindow]);

  const topByHighExtreme = useMemo(
    () =>
      Array.from(countrySeverity.entries())
        .map(([country, v]) => ({ country, count: v.severe }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    [countrySeverity],
  );

  const highestSeverityCountry = useMemo(() => {
    const ranked = Array.from(countrySeverity.entries())
      .map(([country, v]) => ({ country, ...v }))
      .sort((a, b) => b.severe - a.severe || b.maxRank - a.maxRank || b.total - a.total);
    return ranked[0] ?? null;
  }, [countrySeverity]);

  // Countries newly active in the last 7 days (present in last 7d, absent
  // before then in the loaded window).
  const newlyActive = useMemo(() => {
    const recent = new Set<string>();
    const prior = new Set<string>();
    enriched.forEach((i) => {
      if (!i.country || isNaN(i.occurredDate.getTime())) return;
      if (differenceInDays(now, i.occurredDate) <= 7) recent.add(i.country);
      else prior.add(i.country);
    });
    return Array.from(recent).filter((c) => !prior.has(c)).sort();
  }, [enriched]);

  const top5Countries = byCountry.slice(0, 5);

  // --- Severity -----------------------------------------------------------
  const bySeverity = useMemo(
    () => SEVERITY_LEVELS.map((s) => ({
      severity: s,
      label: SEVERITY_LABELS[s] ?? s,
      count: inWindow.filter((i) => i.severity === s).length,
    })),
    [inWindow],
  );

  const highestSev = useMemo(() => {
    let key = "";
    let rank = 0;
    enriched.forEach((i) => {
      const r = SEV_RANK[i.severity] ?? 0;
      if (r > rank) { rank = r; key = i.severity; }
    });
    return key;
  }, [enriched]);

  // --- Windowed trend -----------------------------------------------------
  // Built from the EXACT same windowed set the "Incidents" card counts
  // (`inWindow`), so the trend total and the card can never diverge.
  const timeline = useMemo(() => {
    const source = inWindow.filter((i) => !isNaN(i.occurredDate.getTime()));
    const m = new Map<string, number>();
    source.forEach((i) => {
      const k = format(startOfDay(i.occurredDate), "yyyy-MM-dd");
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([date, count]) => ({ date, label: format(parseISO(date), "dd MMM"), count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [inWindow]);

  const byCountryTop12 = byCountry.slice(0, 12);

  // --- Operational impact aggregation ------------------------------------
  const impactRows = useMemo(() => {
    const sorted = [...inWindow]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return OPERATIONAL_IMPACTS.map((rule) => {
      const records = sorted.filter((i) => i.impacts.includes(rule.label));
      return { ...rule, count: records.length, recent: records.slice(0, 3) };
    });
  }, [inWindow]);

  const sortedForTable = useMemo(
    () => [...inWindow].sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime()),
    [inWindow],
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Conflict Watch</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
            Armed conflict, insurgency, war and serious armed crime monitor — a separate kinetic theatre from the Protests &amp; Civil Unrest feed.
          </p>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      {/* 1. Top metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label={`Incidents (${RANGE_LABEL[range]})`} value={countWindow} accent="#465bff" />
        <Kpi label={`Critical (${RANGE_LABEL[range]})`} value={criticalWindow} accent="#C0392B" />
        <Kpi label="Total Recorded" value={total} accent="#0b0a3d" />
        <Kpi label="Countries Affected" value={countriesAffected} accent="#363636" />
        <Kpi
          label="Latest Incident"
          value={latest ? format(latest.occurredDate, "dd MMM yyyy") : "—"}
          accent={latest ? ratingColor(latest.severity) : "#B8C2CC"}
          small
        />
      </div>

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <FastFactCard
            label="Most Active Type"
            value={mostActiveCategory ? CATEGORY_CARD_LABEL[mostActiveCategory.category] : "—"}
            note={
              mostActiveCategory
                ? `${mostActiveCategory.count} record${mostActiveCategory.count === 1 ? "" : "s"} in the ${RANGE_NOTE[range]}.`
                : "No event activity in window."
            }
            accent={mostActiveCategory ? CATEGORY_COLOR[mostActiveCategory.category] : "#B8C2CC"}
          />
          <FastFactCard
            label="Top Country"
            value={topCountry ? topCountry.country : "—"}
            note={
              topCountry
                ? `${topCountry.count} of ${countWindow} record${countWindow === 1 ? "" : "s"} in the ${RANGE_NOTE[range]}.`
                : "No identified countries."
            }
            accent="#465bff"
          />
          <FastFactCard
            label="Highest Severity Country"
            value={highestSeverityCountry ? highestSeverityCountry.country : "—"}
            note={
              highestSeverityCountry
                ? `${highestSeverityCountry.severe} high/extreme record${highestSeverityCountry.severe === 1 ? "" : "s"}; worst rating ${SEVERITY_LABELS[Object.keys(SEV_RANK).find((k) => SEV_RANK[k] === highestSeverityCountry.maxRank) ?? "insignificant"] ?? "—"}.`
                : "No severity attributed to a country."
            }
            accent={highestSeverityCountry ? ratingColor(Object.keys(SEV_RANK).find((k) => SEV_RANK[k] === highestSeverityCountry.maxRank) ?? "insignificant") : "#B8C2CC"}
          />
          <FastFactCard
            label={`Insurgency (${RANGE_LABEL[range]})`}
            value={String(byCategoryWindow.get("Insurgency") ?? 0)}
            note={`Rebel, separatist and militia activity in the ${RANGE_NOTE[range]}.`}
            accent={CATEGORY_COLOR["Insurgency"]}
          />
          <FastFactCard
            label={`Bombings & Airstrikes (${RANGE_LABEL[range]})`}
            value={String(byCategoryWindow.get("Bombing & Airstrike") ?? 0)}
            note={`IEDs, bombings, airstrikes and shelling in the ${RANGE_NOTE[range]}.`}
            accent={CATEGORY_COLOR["Bombing & Airstrike"]}
          />
          <FastFactCard
            label="7 Day Change"
            value={`${change7 >= 0 ? "+" : ""}${change7}`}
            note={`${last7} in the past 7 days vs ${prev7} in the prior 7 days.`}
            accent={change7 > 0 ? "#C0392B" : change7 < 0 ? "#6FB872" : "#363636"}
          />
        </div>
      </Section>

      {/* 3. Key Metrics — windowed category counts */}
      <Section title="Key Metrics">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CONFLICT_CATEGORIES.map((cat) => (
            <Kpi
              key={cat}
              label={`${CATEGORY_CARD_LABEL[cat]} (${RANGE_LABEL[range]})`}
              value={byCategoryWindow.get(cat) ?? 0}
              accent={CATEGORY_COLOR[cat]}
            />
          ))}
        </div>
      </Section>

      {/* 4. Charts */}
      <Section title="Charts">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Event Type Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                <XAxis dataKey="category" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={9} interval={0} />
                <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  {byCategory.map((d) => {
                    const c = CATEGORY_COLOR[d.category];
                    return <Cell key={d.category} fill={c} stroke={darken(c)} />;
                  })}
                  <LabelList dataKey="count" position="top" fontSize={13} fontWeight={700} fill="#303030" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Severity Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySeverity} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
                <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  {bySeverity.map((d) => {
                    const c = ratingColor(d.severity);
                    return <Cell key={d.severity} fill={c} stroke={darken(c)} />;
                  })}
                  <LabelList dataKey="count" position="top" fontSize={13} fontWeight={700} fill="#303030" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={`Incident Trend (${RANGE_LABEL[range]})`}>
            {timeline.length === 0 ? (
              <EmptyChart message="No timeline data available." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="#0b0a3d" strokeWidth={2} isAnimationActive={false} dot={{ r: 3, stroke: "#0b0a3d", strokeWidth: 1.5, fill: "#465bff", fillOpacity: FILL_OPACITY }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Top Countries by Incident Count">
            {byCountryTop12.length === 0 ? (
              <EmptyChart message="No identified countries on file." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCountryTop12} margin={{ left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#465bff" stroke={darken("#465bff")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </Section>

      {/* 5. Geography */}
      <Section title="Geography">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <GeoCard
            title="Top 5 Countries by Incident Count"
            rows={top5Countries.map((c) => ({ label: c.country, value: c.count }))}
            empty="No identified countries on file."
            accent="#465bff"
          />
          <GeoCard
            title="Top 5 Countries by High / Extreme"
            rows={topByHighExtreme.map((c) => ({ label: c.country, value: c.count }))}
            empty="No high or extreme records attributed to a country."
            accent="#C0392B"
          />
          <div className="bg-white border border-border rounded-sm p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">Newly Active (Last 7 Days)</div>
            {newlyActive.length === 0 ? (
              <p className="text-sm text-muted-foreground italic mt-3">No countries became newly active in the last 7 days.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-3">
                {newlyActive.map((c) => (
                  <span key={c} className="px-2 py-1 text-xs font-sans rounded-sm bg-muted text-primary border border-border">{c}</span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground font-sans mt-3 leading-snug">
              Countries with records in the last 7 days and none earlier in the loaded window.
            </p>
          </div>
        </div>

        <div className="bg-white border border-border rounded-sm overflow-hidden mt-3">
          <CountryChoroplethMap
            intensity={countryIntensity}
            legendLabel="Conflict incidents"
            caption={`Countries shaded by conflict incident count (${RANGE_LABEL[range]}).`}
            center={[5, 105]}
          />
        </div>
      </Section>

      {/* 6. Operational Impact */}
      <Section title="Operational Impact">
        <p className="text-xs text-muted-foreground font-sans -mt-1 mb-3">
          Indicators inferred cautiously from incident title and summary text using keyword matching. They flag possible operational exposure, not confirmed disruption.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {impactRows.map((row) => {
            const active = row.count > 0;
            const accent = active ? "#4655FF" : "#E2E2E2";
            return (
              <div
                key={row.label}
                className="rounded-sm border bg-white p-3"
                style={{ borderColor: "#E2E2E2", borderLeftColor: accent, borderLeftWidth: 4 }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-serif font-bold text-sm" style={{ color: "#0B0B3D" }}>{row.label}</div>
                  <div className="font-mono text-sm" style={{ color: active ? "#0B0B3D" : "#303030" }}>{row.count}</div>
                </div>
                <div className="text-[11px] font-sans mt-0.5" style={{ color: "#303030" }}>{row.description}</div>
                {active ? (
                  <ul className="mt-2 space-y-1">
                    {row.recent.map((r, idx) => (
                      <li key={`${r.id ?? ""}-${idx}`} className="text-xs font-sans" style={{ color: "#303030" }}>
                        <span className="font-mono mr-1.5" style={{ color: "#303030" }}>
                          {isNaN(r.occurredDate.getTime()) ? "—" : format(r.occurredDate, "dd MMM")}
                        </span>
                        {displayTitle(r)}
                        <UntranslatedBadge title={r.title} displayTitle={r.displayTitle} className="ml-1.5" />
                      </li>
                    ))}
                    {row.count > 3 && (
                      <li className="text-[11px] font-sans italic" style={{ color: "#303030" }}>
                        +{row.count - 3} more in window
                      </li>
                    )}
                  </ul>
                ) : (
                  <div className="text-xs font-sans italic mt-2" style={{ color: "#303030" }}>
                    Nothing matched for this indicator in the loaded window.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <OfficialMilitaryMaritimeWatchPanel
        title="Official CENTCOM Releases"
        subtitle="U.S. Central Command press releases ingested as standalone official sources — routed to Conflict Watch (and Shipping when maritime terms match). These rows never count as incidents."
        query={{ watch: "conflict", source: "centcom", limit: 25 }}
      />

      {/* 7. Incident table */}
      <Section title="Recent Incidents">
        <div className="bg-white border border-border rounded-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : !sortedForTable.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No incidents recorded for this topic.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-sans font-medium w-[120px]">Date</th>
                    <th className="text-left p-2 font-sans font-medium w-[170px]">Type</th>
                    <th className="text-left p-2 font-sans font-medium w-[130px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium">Headline</th>
                    <th className="text-left p-2 font-sans font-medium w-[200px]">Impact</th>
                    <th className="text-left p-2 font-sans font-medium w-[100px]">Severity</th>
                    <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedForTable.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/30 align-top">
                      <td className="p-2 font-mono text-xs whitespace-nowrap">
                        {isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy")}
                      </td>
                      <td className="p-2">
                        <span
                          className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm text-white"
                          style={{ backgroundColor: CATEGORY_COLOR[i.category] }}
                        >
                          {i.category}
                        </span>
                      </td>
                      <td className="p-2 text-xs">{i.country ?? "—"}</td>
                      <td className="p-2 font-medium">
                        {displayTitle(i)}
                        <UntranslatedBadge title={i.title} displayTitle={i.displayTitle} className="ml-1.5" />
                      </td>
                      <td className="p-2 text-xs text-foreground/80">
                        {i.impacts.length > 0 ? i.impacts[0] : <span className="text-muted-foreground">—</span>}
                      </td>
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
          )}
        </div>
        <p className="text-[11px] text-muted-foreground italic mt-2">
          Highest severity on file: {highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}. Type is keyword-classified from the headline and summary; where uncertain, records default to Armed Clash.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-serif font-bold uppercase text-primary text-base tracking-wide border-b-2 border-accent pb-1 inline-block">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FastFactCard({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-1">{label}</div>
      <div className="font-serif font-bold text-primary leading-tight mt-1 text-xl">{value}</div>
      <div className="text-[11px] text-muted-foreground font-sans mt-2 leading-snug">{note}</div>
    </div>
  );
}

function Kpi({ label, value, accent, small }: { label: string; value: string | number; accent: string; small?: boolean }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans pl-2">{label}</div>
      <div className={"font-serif font-bold leading-none text-primary mt-2 pl-2 " + (small ? "text-lg" : "text-2xl")}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children, height = 280 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4">
      <h3 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">{title}</h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
      {message}
    </div>
  );
}

function GeoCard({ title, rows, empty, accent }: { title: string; rows: { label: string; value: number }[]; empty: string; accent: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <div className="bg-white border border-border rounded-sm p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic mt-3">{empty}</p>
      ) : (
        <div className="space-y-2 mt-3">
          {rows.map((r) => {
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
  );
}
