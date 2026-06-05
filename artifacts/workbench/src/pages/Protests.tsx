import { useMemo } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, differenceInDays, parseISO, startOfDay } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line, LabelList,
} from "recharts";
import { severityBadgeStyle, ratingColor, SEVERITY_LEVELS, SEVERITY_LABELS } from "@/lib/topics";
import { resolveTrueIncidents } from "@/lib/trueIncidents";
import {
  classifyProtestCategory, detectOperationalImpacts,
  PROTEST_CATEGORIES, CATEGORY_COLOR, CATEGORY_CARD_LABEL,
  OPERATIONAL_IMPACTS, type ProtestCategory,
} from "@/lib/protestsAnalysis";
import { ExternalLink } from "lucide-react";

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

  const in30d = useMemo(() => enriched.filter((i) => within(i, 30)), [enriched]);
  const count30d = in30d.length;
  const critical30d = useMemo(
    () => in30d.filter((i) => i.severity === "high" || i.severity === "extreme").length,
    [in30d],
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
      count: enriched.filter((i) => i.category === cat).length,
    })),
    [enriched],
  );
  const byCategory30d = useMemo(() => {
    const m = new Map<ProtestCategory, number>(PROTEST_CATEGORIES.map((c) => [c, 0]));
    in30d.forEach((i) => m.set(i.category, (m.get(i.category) ?? 0) + 1));
    return m;
  }, [in30d]);

  const mostActiveCategory = useMemo(() => {
    // Rank on the 30-day window, falling back to the full dataset.
    const ranked30 = PROTEST_CATEGORIES
      .map((c) => ({ category: c, count: byCategory30d.get(c) ?? 0 }))
      .sort((a, b) => b.count - a.count);
    if (ranked30[0] && ranked30[0].count > 0) return ranked30[0];
    const rankedAll = [...byCategory].sort((a, b) => b.count - a.count);
    return rankedAll[0] && rankedAll[0].count > 0 ? rankedAll[0] : null;
  }, [byCategory30d, byCategory]);

  // --- Countries ----------------------------------------------------------
  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      if (!i.country) return;
      m.set(i.country, (m.get(i.country) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }, [enriched]);

  const countriesAffected = byCountry.length;
  const topCountry = byCountry[0] ?? null;

  // Country severity profile — count of high/extreme records per country.
  const countrySeverity = useMemo(() => {
    const m = new Map<string, { severe: number; maxRank: number; total: number }>();
    enriched.forEach((i) => {
      if (!i.country) return;
      const rank = SEV_RANK[i.severity] ?? 0;
      const cur = m.get(i.country) ?? { severe: 0, maxRank: 0, total: 0 };
      cur.total += 1;
      if (rank >= 4) cur.severe += 1;
      if (rank > cur.maxRank) cur.maxRank = rank;
      m.set(i.country, cur);
    });
    return m;
  }, [enriched]);

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
      count: enriched.filter((i) => i.severity === s).length,
    })),
    [enriched],
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

  // --- 30-day trend -------------------------------------------------------
  // Built from the EXACT same set the "Incidents (30d)" card counts (`in30d`),
  // so the trend total and the card can never diverge. Falls back to the full
  // valid-date set only when nothing lands in the last 30 days.
  const timeline = useMemo(() => {
    const source = in30d.length > 0
      ? in30d
      : enriched.filter((i) => !isNaN(i.occurredDate.getTime()));
    const m = new Map<string, number>();
    source.forEach((i) => {
      const k = format(startOfDay(i.occurredDate), "yyyy-MM-dd");
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([date, count]) => ({ date, label: format(parseISO(date), "dd MMM"), count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [in30d, enriched]);

  const byCountryTop12 = byCountry.slice(0, 12);
  const withCoords = enriched.filter((i) => i.latitude != null && i.longitude != null);

  // --- Operational impact aggregation ------------------------------------
  const impactRows = useMemo(() => {
    const sorted = [...enriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return OPERATIONAL_IMPACTS.map((rule) => {
      const records = sorted.filter((i) => i.impacts.includes(rule.label));
      return { ...rule, count: records.length, recent: records.slice(0, 3) };
    });
  }, [enriched]);

  const sortedForTable = useMemo(
    () => [...enriched].sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime()),
    [enriched],
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Protests &amp; Civil Unrest</h1>
        <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
          Activism, protests, industrial action and civil unrest monitor.
        </p>
      </div>

      {/* 1. Top metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Incidents (30d)" value={count30d} accent="#465bff" />
        <Kpi label="Critical (30d)" value={critical30d} accent="#C0392B" />
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
                ? `${mostActiveCategory.count} record${mostActiveCategory.count === 1 ? "" : "s"} in the past 30 days.`
                : "No category activity in window."
            }
            accent={mostActiveCategory ? CATEGORY_COLOR[mostActiveCategory.category] : "#B8C2CC"}
          />
          <FastFactCard
            label="Top Country"
            value={topCountry ? topCountry.country : "—"}
            note={
              topCountry
                ? `${topCountry.count} of ${total} record${total === 1 ? "" : "s"} on file.`
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
            label="Industrial Action (30d)"
            value={String(byCategory30d.get("Industrial Action") ?? 0)}
            note="Strikes, walkouts and labour disputes in the past 30 days."
            accent={CATEGORY_COLOR["Industrial Action"]}
          />
          <FastFactCard
            label="Civil Unrest (30d)"
            value={String(byCategory30d.get("Civil Unrest") ?? 0)}
            note="Riots, clashes and disorder in the past 30 days."
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

      {/* 3. Key Metrics — category 30-day counts */}
      <Section title="Key Metrics">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {PROTEST_CATEGORIES.map((cat) => (
            <Kpi
              key={cat}
              label={`${CATEGORY_CARD_LABEL[cat]} (30d)`}
              value={byCategory30d.get(cat) ?? 0}
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

          <ChartCard title="30 Day Incident Trend">
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
          {withCoords.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No geocoded records available for this view.
            </div>
          ) : (
            <div className="h-[420px]">
              <MapContainer center={[5, 115]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {withCoords.map((i) => {
                  const c = ratingColor(i.severity);
                  return (
                    <CircleMarker
                      key={i.id}
                      center={[i.latitude!, i.longitude!]}
                      radius={6}
                      pathOptions={{ fillColor: c, color: darken(c), fillOpacity: FILL_OPACITY, weight: STROKE_WIDTH }}
                    >
                      <LeafletTooltip>
                        <div className="text-xs">
                          <div className="font-bold">{i.title}</div>
                          <div>{i.country ?? "Location not identified"} · {i.category}</div>
                        </div>
                      </LeafletTooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          )}
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
                    <th className="text-left p-2 font-sans font-medium w-[140px]">Type</th>
                    <th className="text-left p-2 font-sans font-medium w-[130px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium">Headline</th>
                    <th className="text-left p-2 font-sans font-medium w-[180px]">Sector / Impact</th>
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
                        {i.sourceUrl ? (
                          <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs" aria-label="Open source">
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
          Highest severity on file: {highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}. Type is keyword-classified from the headline and summary; where uncertain, records default to Protest.
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
