import { Fragment, useMemo, useState } from "react";
import {
  useListIncidents,
  useListSocialRawItems,
  usePromoteSocialRawItem,
  useUpdateSocialRawReviewStatus,
  getListSocialRawItemsQueryKey,
  type SocialRawItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  classifyProtestCategory, detectOperationalImpacts,
  PROTEST_CATEGORIES, CATEGORY_COLOR, CATEGORY_CARD_LABEL,
  OPERATIONAL_IMPACTS, groupByMonth, type ProtestCategory,
} from "@/lib/protestsAnalysis";
import { ExternalLink } from "lucide-react";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import { buildUpcomingSignalRows, formatAnnouncedDate } from "@/lib/upcomingSignals";

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

export default function Protests() {
  // The "Protests & Civil Unrest" monitor is fed by the scraper under the
  // "flashpoint" topic ("protests" is a legacy snapshot with no live feed).
  // Resolve to the live topic — consistent with the reports / data-status
  // protests→flashpoint mapping.
  const { data: raw = [], isLoading } = useListIncidents({ topic: "flashpoint" });

  // Facebook OSINT watch — Papua New Guinea + Indonesian Papua. ADDITIVE context
  // only (own `social_raw` table; never feeds incident counts). The board lets an
  // operator promote a security-relevant, credible post to a flashpoint OR
  // conflict incident; the server re-derives eligibility and dedups on promote.
  const { data: osintItems = [], isLoading: osintLoading } =
    useListSocialRawItems({ limit: 100 });

  // Date-range window. Defaults to the widest option so the first load shows the
  // full record set; the analyst can narrow the whole dashboard from the header.
  const [range, setRange] = useState<RangeKey>("2y");
  const windowDays = RANGE_DAYS[range];

  // Which archived month (yyyy-MM key) is currently expanded in the incident
  // archive below the main table, if any.
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Reconcile to the same scoped, noise-filtered set the dashboard card and the
  // reports use, so every surface tallies.
  const trueIncidents = useMemo(() => resolveTrueIncidents("flashpoint", raw), [raw]);

  // Enrich each record with category, operational-impact tags and a parsed date.
  const enriched = useMemo(
    () =>
      trueIncidents.map((i) => ({
        ...i,
        category: classifyProtestCategory(i),
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
  // Requires the record to fall in [now - days, now]: future-dated records are
  // excluded (lower bound), and the upper bound is inclusive of `days` ago.
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
    () => PROTEST_CATEGORIES.map((cat) => ({
      category: cat,
      count: inWindow.filter((i) => i.category === cat).length,
    })),
    [inWindow],
  );
  const byCategoryWindow = useMemo(() => {
    const m = new Map<ProtestCategory, number>(PROTEST_CATEGORIES.map((c) => [c, 0]));
    inWindow.forEach((i) => m.set(i.category, (m.get(i.category) ?? 0) + 1));
    return m;
  }, [inWindow]);

  const mostActiveCategory = useMemo(() => {
    const ranked = PROTEST_CATEGORIES
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
      // An unlocated incident must never be crowned the highest-severity
      // "country" — exclude Unknown / placeholder rows from the ranking.
      if (!i.country || i.country === "Unknown" || i.country === "—") return;
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

  // --- Reported upcoming activity (advance warning) -----------------------
  // Forward-looking signals extracted from reporting that ANNOUNCES a
  // scheduled / planned protest. Built from the full resolved set (NOT the
  // RangeToggle window) on a FIXED 14-day announcement lookback via the shared
  // upcomingSignals authority, so it never drifts from the report/brief. Empty
  // is normal (STRICT no-fabrication: an unreported march is not surfaced).
  const upcomingSignals = useMemo(
    () =>
      buildUpcomingSignalRows(
        enriched.map((i) => ({
          // Translated title first so English cues fire on Bahasa headlines —
          // parity with the Indonesia brief, which also feeds displayTitle.
          title: i.displayTitle ?? i.title,
          summary: i.summary ?? null,
          country: i.country ?? null,
          occurredAt: i.occurredAt,
          sourceUrl: incidentSourceUrl(i),
        })),
        { windowDays: 14 },
      ),
    [enriched],
  );

  // Chunk the (date-sorted, in-window) table by calendar month so the main
  // table stays short: the most recent month renders in full, every earlier
  // month collapses into an expandable archive box below.
  const monthGroups = useMemo(() => groupByMonth(sortedForTable), [sortedForTable]);
  const currentMonth = monthGroups[0] ?? null;
  const archiveMonths = monthGroups.slice(1);
  const expandedMonthGroup =
    archiveMonths.find((g) => g.key === expandedMonth) ?? null;

  // Shared renderer for the incident table so the current month and every
  // expanded archive month stay byte-identical.
  const renderIncidentTable = (rows: typeof sortedForTable) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-2 font-sans font-medium w-[120px]">Date</th>
            <th className="text-left p-2 font-sans font-medium w-[140px]">Type</th>
            <th className="text-left p-2 font-sans font-medium w-[130px]">Country</th>
            <th className="text-left p-2 font-sans font-medium">Headline</th>
            <th className="text-left p-2 font-sans font-medium w-[180px]">Sector / Impact</th>
            <th className="text-left p-2 font-sans font-medium w-[100px]">Severity</th>
            <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((i) => (
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
              <td className="p-2 font-medium">{i.title}</td>
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
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Protests &amp; Civil Unrest</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
            Activism, protests, industrial action and civil unrest monitor.
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
            label="Most Active Category"
            value={mostActiveCategory ? CATEGORY_CARD_LABEL[mostActiveCategory.category] : "—"}
            note={
              mostActiveCategory
                ? `${mostActiveCategory.count} record${mostActiveCategory.count === 1 ? "" : "s"} in the ${RANGE_NOTE[range]}.`
                : "No category activity in window."
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
            label={`Industrial Action (${RANGE_LABEL[range]})`}
            value={String(byCategoryWindow.get("Industrial Action") ?? 0)}
            note={`Strikes, walkouts and labour disputes in the ${RANGE_NOTE[range]}.`}
            accent={CATEGORY_COLOR["Industrial Action"]}
          />
          <FastFactCard
            label={`Civil Unrest (${RANGE_LABEL[range]})`}
            value={String(byCategoryWindow.get("Civil Unrest") ?? 0)}
            note={`Riots, clashes and disorder in the ${RANGE_NOTE[range]}.`}
            accent={CATEGORY_COLOR["Civil Unrest"]}
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
          {PROTEST_CATEGORIES.map((cat) => (
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
          <ChartCard title="Category Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                <XAxis dataKey="category" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} interval={0} />
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
            legendLabel="Civil-unrest incidents"
            caption={`Countries shaded by civil-unrest incident count (${RANGE_LABEL[range]}).`}
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
                        {r.title}
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

      {/* 6b. Reported upcoming activity — advance warning of scheduled/announced protests */}
      <Section title="Reported Upcoming Activity">
        <div className="bg-white border border-border rounded-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : upcomingSignals.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No scheduled or announced upcoming activity has been reported.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-sans font-medium w-[130px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium">Reported Signal</th>
                    <th className="text-left p-2 font-sans font-medium">Operational Meaning</th>
                    <th className="text-left p-2 font-sans font-medium w-[120px]">Announced</th>
                    <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {upcomingSignals.map((r, idx) => (
                    <tr key={`${r.country}-${idx}`} className="hover:bg-muted/30 align-top">
                      <td className="p-2 text-xs">{r.country}</td>
                      <td className="p-2 font-medium">{r.signal}</td>
                      <td className="p-2 text-xs text-foreground/80">{r.meaning}</td>
                      <td className="p-2 font-mono text-xs whitespace-nowrap">
                        {formatAnnouncedDate(r.announcedAt)}
                      </td>
                      <td className="p-2">
                        {r.sourceUrl ? (
                          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs" aria-label="Open source">
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
          Forward-looking signals drawn from reporting that announces scheduled or planned protest activity over the next 14 days. The date shown is the announcement date, not a confirmed event date. An empty panel means no upcoming activity has been reported — not that none will occur.
        </p>
      </Section>

      {/* 7. Incident table */}
      <Section title="Recent Incidents">
        <div className="bg-white border border-border rounded-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : !currentMonth ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No incidents recorded for this topic.</div>
          ) : (
            <>
              <div className="flex items-baseline justify-between px-3 pt-2.5 pb-1.5 border-b border-border">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted-foreground">{currentMonth.label}</span>
                <span className="text-[11px] text-muted-foreground">{currentMonth.rows.length} incident{currentMonth.rows.length === 1 ? "" : "s"}</span>
              </div>
              {renderIncidentTable(currentMonth.rows)}
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground italic mt-2">
          Showing the most recent month only; earlier incidents are archived by month below. Highest severity on file: {highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}. Type is keyword-classified from the headline and summary; where uncertain, records default to Protest.
        </p>
      </Section>

      {/* 7b. Incident archive — earlier months collapsed into expandable boxes */}
      {archiveMonths.length > 0 && (
        <Section title="Incident Archive">
          <p className="text-xs text-muted-foreground font-sans mb-3">
            Earlier incidents grouped by month. Select a month to expand its records.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {archiveMonths.map((mth) => {
              const active = expandedMonth === mth.key;
              return (
                <button
                  key={mth.key}
                  type="button"
                  onClick={() => setExpandedMonth(active ? null : mth.key)}
                  aria-expanded={active}
                  className={`text-left border rounded-sm p-3 transition-colors ${active ? "border-accent bg-accent/5" : "border-border bg-white hover:bg-muted/30"}`}
                >
                  <div className="text-sm font-sans font-medium text-primary">{mth.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {mth.rows.length} incident{mth.rows.length === 1 ? "" : "s"}
                  </div>
                </button>
              );
            })}
          </div>
          {expandedMonthGroup && (
            <div className="bg-white border border-border rounded-sm mt-4">
              <div className="flex items-baseline justify-between px-3 pt-2.5 pb-1.5 border-b border-border">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted-foreground">{expandedMonthGroup.label}</span>
                <span className="text-[11px] text-muted-foreground">{expandedMonthGroup.rows.length} incident{expandedMonthGroup.rows.length === 1 ? "" : "s"}</span>
              </div>
              {renderIncidentTable(expandedMonthGroup.rows)}
            </div>
          )}
        </Section>
      )}

      {/* Papua / PNG Facebook OSINT — additive context, never incidents */}
      <Section title="Papua / PNG Facebook OSINT">
        <FacebookOsintPanel items={osintItems} isLoading={osintLoading} />
      </Section>
    </div>
  );
}

// Source-tier badge for a Facebook OSINT page. Mirrors the brand five-tier
// palette: official = Electric Blue, local media = Midnight, OSINT = Dusk Gray.
const OSINT_TIER_COLOR: Record<string, string> = {
  official: "#465bff",
  local_media: "#0B0B3D",
  osint: "#303030",
};

const OSINT_TIER_LABEL: Record<string, string> = {
  official: "Official",
  local_media: "Local media",
  osint: "OSINT",
};

function OsintTierBadge({ tier }: { tier: string }) {
  return (
    <span
      className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm text-white"
      style={{ backgroundColor: OSINT_TIER_COLOR[tier] ?? "#303030" }}
    >
      {OSINT_TIER_LABEL[tier] ?? tier}
    </span>
  );
}

function FacebookOsintPanel({ items, isLoading }: { items: SocialRawItem[]; isLoading: boolean }) {
  const promote = usePromoteSocialRawItem();
  const updateStatus = useUpdateSocialRawReviewStatus();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [statusPendingId, setStatusPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    let securityRelevant = 0;
    let flagged = 0;
    let eligible = 0;
    let promoted = 0;
    for (const it of items) {
      const isPromoted = it.promotedIncidentId != null;
      if (it.securityRelevant) securityRelevant += 1;
      if (it.reviewFlag && !isPromoted) flagged += 1;
      if (it.promotable && !isPromoted) eligible += 1;
      if (isPromoted) promoted += 1;
    }
    return { securityRelevant, flagged, eligible, promoted };
  }, [items]);

  // Group so an analyst sees the actionable queue first, then their decided
  // (context / ignored) rows, then promoted. Precedence: promoted → ignored →
  // context → (auto-triaged pending) eligible → flagged → other. The analyst's
  // explicit Ignore / Keep-as-context decision overrides the auto signals and
  // pulls a row out of the actionable queue.
  const groups = useMemo(() => {
    const eligible: SocialRawItem[] = [];
    const review: SocialRawItem[] = [];
    const other: SocialRawItem[] = [];
    const context: SocialRawItem[] = [];
    const ignored: SocialRawItem[] = [];
    const promoted: SocialRawItem[] = [];
    for (const it of items) {
      // Precedence: a promoted row is terminal; then the analyst's explicit
      // Ignore / Keep-as-context decision pulls the row OUT of the actionable
      // queue; only a still-pending row is triaged by the auto-derived signals.
      if (it.promotedIncidentId != null) promoted.push(it);
      else if (it.reviewStatus === "ignored") ignored.push(it);
      else if (it.reviewStatus === "context") context.push(it);
      else if (it.promotable) eligible.push(it);
      else if (it.reviewFlag) review.push(it);
      else other.push(it);
    }
    return [
      {
        key: "eligible",
        title: "Eligible to promote",
        note: "Security-relevant and credible — ready for analyst promotion to an incident.",
        items: eligible,
      },
      {
        key: "review",
        title: "Flagged for review",
        note: "Security-relevant but not yet credible — needs an analyst's eye before promotion.",
        items: review,
      },
      {
        key: "other",
        title: "Other context",
        note: "Not flagged as security-relevant; retained as background context only.",
        items: other,
      },
      {
        key: "context",
        title: "Kept as context",
        note: "An analyst marked these as supporting context — out of the actionable queue, retained for reference.",
        items: context,
      },
      {
        key: "ignored",
        title: "Ignored",
        note: "An analyst dismissed these as noise — out of the actionable queue. Re-open to restore.",
        items: ignored,
      },
      {
        key: "promoted",
        title: "Promoted to incidents",
        note: "Already linked to a tracked incident.",
        items: promoted,
      },
    ].filter((g) => g.items.length > 0);
  }, [items]);

  async function onPromote(id: number) {
    setError(null);
    setPendingId(id);
    try {
      await promote.mutateAsync({ id });
      // The mutation does not auto-refetch the board, so the promoted row would
      // otherwise keep showing a live "Promote" button. Invalidate every
      // social-raw list query so the row flips to its back-linked
      // "Incident #N" state.
      await queryClient.invalidateQueries({
        queryKey: getListSocialRawItemsQueryKey(),
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Promotion failed — the item may already be promoted, ineligible, or a duplicate of a tracked incident.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function onSetStatus(
    id: number,
    status: "pending_review" | "ignored" | "context",
  ) {
    setError(null);
    setStatusPendingId(id);
    try {
      await updateStatus.mutateAsync({ id, data: { reviewStatus: status } });
      // Orval mutations don't auto-invalidate the board, so without this refetch
      // the row would keep its old buttons. Invalidate every social-raw list
      // query so the row moves to its new review bucket.
      await queryClient.invalidateQueries({
        queryKey: getListSocialRawItemsQueryKey(),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update the review status.",
      );
    } finally {
      setStatusPendingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white border border-border rounded-sm p-8 text-center text-sm text-muted-foreground">
        Loading Facebook OSINT…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white border border-border rounded-sm p-6 text-sm text-muted-foreground">
        No Facebook OSINT posts collected yet. Collection requires a paid Apify scraper key; without it this pass is disabled. These posts are supporting context only — they are never counted as incidents. See Source Health for the live configuration state.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Posts on file" value={items.length} accent="#465bff" small />
        <Kpi label="Security-relevant" value={stats.securityRelevant} accent="#0B0B3D" small />
        <Kpi label="Flagged for review" value={stats.flagged} accent="#1B6B7A" small />
        <Kpi label="Eligible to promote" value={stats.eligible} accent="#0B0B3D" small />
        <Kpi label="Promoted" value={stats.promoted} accent="#303030" small />
      </div>

      <p className="text-[11px] text-muted-foreground font-sans leading-snug">
        Public Facebook posts for Papua New Guinea and Indonesian Papua, monitored
        as ADDITIVE context — never incidents, so they never affect any incident
        count. Only a security-relevant, credible post can be promoted (to a
        flashpoint or conflict incident), which links the new incident back to the
        source post; the server re-derives eligibility and blocks duplicates of
        already-tracked incidents. Captions are sanitised; no comments, author
        profiles, or personal contact data are stored.
      </p>

      {error && (
        <p className="text-[12px] font-sans" style={{ color: "#A33232" }}>
          {error}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <div>
            <h3 className="font-sans font-medium text-xs uppercase tracking-wider text-primary">
              {g.title}{" "}
              <span className="text-muted-foreground font-normal normal-case tracking-normal">
                ({g.items.length})
              </span>
            </h3>
            <p className="text-[10px] text-muted-foreground font-sans leading-snug">
              {g.note}
            </p>
          </div>
          <OsintTable
            items={g.items}
            pendingId={pendingId}
            statusPendingId={statusPendingId}
            onPromote={onPromote}
            onSetStatus={onSetStatus}
          />
        </div>
      ))}
    </div>
  );
}

function ConfidenceCell({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1">
      <div className="text-xs font-mono text-primary">{pct}</div>
      <div className="h-1 w-12 bg-muted rounded-sm overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${pct}%`, background: "#465bff", opacity: FILL_OPACITY }}
        />
      </div>
    </div>
  );
}

function OsintActions({
  it,
  pendingId,
  statusPendingId,
  onPromote,
  onSetStatus,
}: {
  it: SocialRawItem;
  pendingId: number | null;
  statusPendingId: number | null;
  onPromote: (id: number) => void;
  onSetStatus: (id: number, status: "pending_review" | "ignored" | "context") => void;
}) {
  // A promoted row is terminal — it back-links to its incident and has no actions.
  if (it.promotedIncidentId != null) {
    return (
      <span className="text-muted-foreground">Incident #{it.promotedIncidentId}</span>
    );
  }

  const busy = pendingId === it.id || statusPendingId === it.id;
  const decided = it.reviewStatus === "ignored" || it.reviewStatus === "context";
  const btn =
    "px-2 py-1 text-[11px] font-sans font-medium uppercase tracking-wider rounded-sm disabled:opacity-50";

  return (
    <div className="flex flex-col items-start gap-1">
      {it.promotable && (
        <button
          type="button"
          onClick={() => onPromote(it.id)}
          disabled={busy}
          className={btn + " text-white"}
          style={{ backgroundColor: "#465bff" }}
        >
          {pendingId === it.id ? "Promoting…" : "Promote"}
        </button>
      )}
      {decided ? (
        <button
          type="button"
          onClick={() => onSetStatus(it.id, "pending_review")}
          disabled={busy}
          className={btn + " border border-border bg-white text-primary"}
        >
          {statusPendingId === it.id ? "Saving…" : "Re-open"}
        </button>
      ) : (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onSetStatus(it.id, "context")}
            disabled={busy}
            className={btn + " border border-border bg-white text-primary"}
          >
            Context
          </button>
          <button
            type="button"
            onClick={() => onSetStatus(it.id, "ignored")}
            disabled={busy}
            className={btn + " border border-border bg-white text-muted-foreground"}
          >
            Ignore
          </button>
        </div>
      )}
      {!it.promotable && !decided && (
        <span className="text-muted-foreground text-[10px]">
          Not eligible to promote
        </span>
      )}
    </div>
  );
}

function OsintTable({
  items,
  pendingId,
  statusPendingId,
  onPromote,
  onSetStatus,
}: {
  items: SocialRawItem[];
  pendingId: number | null;
  statusPendingId: number | null;
  onPromote: (id: number) => void;
  onSetStatus: (id: number, status: "pending_review" | "ignored" | "context") => void;
}) {
  return (
    <div className="bg-white border border-border rounded-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-2 font-sans font-medium w-[120px]">Source</th>
            <th className="text-left p-2 font-sans font-medium w-[110px]">When</th>
            <th className="text-left p-2 font-sans font-medium w-[130px]">Where</th>
            <th className="text-left p-2 font-sans font-medium w-[120px]">Category</th>
            <th className="text-left p-2 font-sans font-medium w-[70px]">Confidence</th>
            <th className="text-left p-2 font-sans font-medium">Caption / signals</th>
            <th className="text-left p-2 font-sans font-medium w-[50px]">Link</th>
            <th className="text-left p-2 font-sans font-medium w-[160px]">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((it) => {
            const when =
              (it.incidentDate
                ? format(new Date(it.incidentDate), "dd MMM yyyy")
                : null) ||
              (it.postedAt ? format(new Date(it.postedAt), "dd MMM yyyy") : null) ||
              "—";
            const where = it.location || it.province || it.country || "—";
            const keywords = it.detectedKeywords ?? [];
            return (
              <tr key={it.id} className="hover:bg-muted/30 align-top">
                <td className="p-2 whitespace-nowrap">
                  <OsintTierBadge tier={it.sourceTier} />
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    {it.pageName || it.pageHandle}
                  </span>
                </td>
                <td className="p-2 text-xs whitespace-nowrap">{when}</td>
                <td className="p-2 text-xs">{where}</td>
                <td className="p-2 text-xs">
                  {it.category}
                  {!it.securityRelevant && (
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      not security-relevant
                    </span>
                  )}
                </td>
                <td className="p-2">
                  <ConfidenceCell value={it.confidence} />
                </td>
                <td className="p-2 text-xs text-foreground/80">
                  <span className="line-clamp-2">
                    {it.caption || <span className="text-muted-foreground">—</span>}
                  </span>
                  {keywords.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-1">
                      {keywords.slice(0, 6).map((k) => (
                        <span
                          key={k}
                          className="px-1 py-0.5 text-[9px] uppercase tracking-wider rounded-sm bg-muted text-muted-foreground"
                        >
                          {k}
                        </span>
                      ))}
                    </span>
                  )}
                  {it.reviewReason && (
                    <span className="block text-[10px] text-muted-foreground mt-1">
                      Review: {it.reviewReason}
                    </span>
                  )}
                  {it.credibilityReason && (
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      {it.credibilityReason}
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {it.url ? (
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline inline-flex items-center gap-1 text-xs"
                      aria-label="Open post"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
                <td className="p-2 text-xs">
                  <OsintActions
                    it={it}
                    pendingId={pendingId}
                    statusPendingId={statusPendingId}
                    onPromote={onPromote}
                    onSetStatus={onSetStatus}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
