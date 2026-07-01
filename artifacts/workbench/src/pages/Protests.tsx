import { Fragment, useMemo, useState } from "react";
import {
  useListIncidents,
  useListSocialWatchItems,
  usePromoteSocialWatchItem,
  useCreateSocialWatchItem,
  useUpdateSocialWatchItem,
  useDeleteSocialWatchItem,
  getListSocialWatchItemsQueryKey,
  useListSocialRawItems,
  usePromoteSocialRawItem,
  useUpdateSocialRawReviewStatus,
  getListSocialRawItemsQueryKey,
  type SocialWatchItem,
  type SocialRawItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
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
  OPERATIONAL_IMPACTS, type ProtestCategory,
} from "@/lib/protestsAnalysis";
import { ExternalLink } from "lucide-react";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";

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

  // KAMMI social-media protest watch — ADDITIVE context only (own table; never
  // feeds incident counts). The board groups planned vs active mobilisation and
  // lets an operator promote a confirmed-active item to a flashpoint incident.
  const { data: socialItems = [], isLoading: socialLoading } =
    useListSocialWatchItems({ limit: 60 });

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
  const withCoords = inWindow.filter((i) => i.latitude != null && i.longitude != null);

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
          Highest severity on file: {highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}. Type is keyword-classified from the headline and summary; where uncertain, records default to Protest.
        </p>
      </Section>

      {/* KAMMI / Indonesia Social Watch — additive context, never incidents */}
      <Section title="KAMMI / Indonesia Social Watch">
        <SocialWatchPanel items={socialItems} isLoading={socialLoading} />
      </Section>

      {/* Papua / PNG Facebook OSINT — additive context, never incidents */}
      <Section title="Papua / PNG Facebook OSINT">
        <FacebookOsintPanel items={osintItems} isLoading={osintLoading} />
      </Section>
    </div>
  );
}

// Status → board grouping. "Planned" gathers mobilisation that is announced but
// not yet underway; "Active" gathers anything currently on the street (active /
// dispersed / arrests); "Other" holds cancelled/unclear context.
const SOCIAL_ACTIVE_STATUSES = new Set(["active", "dispersed"]);
const SOCIAL_PLANNED_STATUSES = new Set(["planned"]);

const SOCIAL_STATUS_COLOR: Record<string, string> = {
  planned: "#1B6B7A",
  active: "#A33232",
  dispersed: "#303030",
  cancelled: "#303030",
  unclear: "#303030",
};

function SocialStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm text-white"
      style={{ backgroundColor: SOCIAL_STATUS_COLOR[status] ?? "#303030" }}
    >
      {status}
    </span>
  );
}

function AddWatchItemForm() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider rounded-sm text-white"
          style={{ backgroundColor: "#465bff" }}
        >
          Add watch item
        </button>
      </div>
    );
  }
  return <WatchItemForm onClose={() => setOpen(false)} />;
}

// Shared manual-entry form for a KAMMI social-watch context row. With no
// `editItem` it CREATES a new row; with one it EDITS that row in place (fix a
// typo, a wrong location, a missing URL, the event date/time or status) instead
// of deleting and re-pasting. Either way the item stays supporting CONTEXT only
// — the server re-derives status and promotion eligibility, so this never
// becomes or inflates an incident.
function WatchItemForm({
  editItem,
  onClose,
}: {
  editItem?: SocialWatchItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useCreateSocialWatchItem();
  const update = useUpdateSocialWatchItem();
  const isEdit = editItem != null;
  const [platform, setPlatform] = useState<"instagram" | "telegram">(
    (editItem?.platform as "instagram" | "telegram") ?? "instagram",
  );
  const [url, setUrl] = useState(editItem?.url ?? "");
  const [caption, setCaption] = useState(editItem?.caption ?? "");
  const [imageUrl, setImageUrl] = useState(editItem?.imageUrls?.[0] ?? "");
  const [postedAt, setPostedAt] = useState(
    editItem?.postedAt ? format(new Date(editItem.postedAt), "yyyy-MM-dd'T'HH:mm") : "",
  );
  const [actor, setActor] = useState(editItem?.actor ?? "");
  const [channel, setChannel] = useState(editItem?.channel ?? "");
  const [issue, setIssue] = useState(editItem?.issue ?? "");
  const [location, setLocation] = useState(editItem?.location ?? "");
  const [city, setCity] = useState(editItem?.city ?? "");
  const [province, setProvince] = useState(editItem?.province ?? "");
  const [eventDate, setEventDate] = useState(
    editItem?.eventDate ? format(new Date(editItem.eventDate), "yyyy-MM-dd") : "",
  );
  const [eventTimeText, setEventTimeText] = useState(editItem?.eventTimeText ?? "");
  const [statusChoice, setStatusChoice] = useState(editItem?.status ?? "");
  const [confidence, setConfidence] = useState(editItem?.confidence ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  function reset() {
    setUrl("");
    setCaption("");
    setImageUrl("");
    setPostedAt("");
    setActor("");
    setChannel("");
    setIssue("");
    setLocation("");
    setCity("");
    setProvince("");
    setEventDate("");
    setEventTimeText("");
    setStatusChoice("");
    setConfidence("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    if (!url.trim() || !caption.trim()) {
      setErr("Post URL and caption are both required.");
      return;
    }
    const data = {
      platform,
      url: url.trim(),
      caption: caption.trim(),
      ...(imageUrl.trim() ? { imageUrls: [imageUrl.trim()] } : {}),
      ...(postedAt.trim() ? { postedAt: new Date(postedAt).toISOString() } : {}),
      ...(actor.trim() ? { actor: actor.trim() } : {}),
      ...(channel.trim() ? { channel: channel.trim() } : {}),
      ...(issue.trim() ? { issue: issue.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(province.trim() ? { province: province.trim() } : {}),
      ...(eventDate.trim() ? { eventDate: new Date(eventDate).toISOString() } : {}),
      ...(eventTimeText.trim() ? { eventTimeText: eventTimeText.trim() } : {}),
      ...(statusChoice
        ? {
            status: statusChoice as
              | "planned"
              | "active"
              | "dispersed"
              | "cancelled"
              | "unclear",
          }
        : {}),
      ...(confidence ? { confidence } : {}),
    };
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: editItem.id, data })
        : await create.mutateAsync({ data });
      // Orval mutations don't auto-refetch — invalidate so the new/edited (or
      // existing, on a deduped re-paste) row appears in the board immediately.
      await queryClient.invalidateQueries({
        queryKey: getListSocialWatchItemsQueryKey(),
      });
      if (isEdit) {
        onClose();
        return;
      }
      setOk(
        `Added as context — status "${saved.status}"` +
          (saved.promotable ? ", eligible to promote." : " (not promotable)."),
      );
      reset();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : `Could not ${isEdit ? "save" : "add"} the item. Check the admin token in Source Health.`,
      );
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white border border-border rounded-sm p-4 space-y-3 font-sans"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold uppercase tracking-wider">
          {isEdit ? "Edit watch item" : "Add watch item (manual)"}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-muted-foreground underline"
        >
          {isEdit ? "Cancel" : "Close"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {isEdit
          ? "Correct this KAMMI post in place. It stays ADDITIVE context only — never an incident. Status and promotion eligibility are re-derived from the caption on the server."
          : "Paste a KAMMI Instagram/Telegram post by hand. Stored as ADDITIVE context only — never an incident. Status and promotion eligibility are re-derived from the caption on the server."}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-[12px] font-medium">
          Platform
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "instagram" | "telegram")}
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          >
            <option value="instagram">Instagram</option>
            <option value="telegram">Telegram</option>
          </select>
        </label>
        <label className="text-[12px] font-medium">
          Post date/time (optional)
          <input
            type="datetime-local"
            value={postedAt}
            onChange={(e) => setPostedAt(e.target.value)}
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
      </div>

      <label className="block text-[12px] font-medium">
        Post URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.instagram.com/p/…"
          className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
        />
      </label>

      <label className="block text-[12px] font-medium">
        Caption / post text
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          placeholder="Paste the post caption verbatim…"
          className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
        />
      </label>

      <label className="block text-[12px] font-medium">
        Image URL (optional)
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://…/photo.jpg"
          className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
        />
      </label>

      <p className="text-[11px] text-muted-foreground leading-snug pt-1">
        Optional analyst details — leave blank to let the server derive them from
        the caption.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-[12px] font-medium">
          Organiser / actor
          <input
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="KAMMI Pusat"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Channel / account
          <input
            type="text"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="kammi.pusat"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Issue / campaign
          <input
            type="text"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Indonesia Darurat"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Location / venue
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Gedung DPR/MPR RI"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          City
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Jakarta"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Province
          <input
            type="text"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            placeholder="DKI Jakarta"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Event date
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Start time (text)
          <input
            type="text"
            value={eventTimeText}
            onChange={(e) => setEventTimeText(e.target.value)}
            placeholder="13.00 WIB"
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="text-[12px] font-medium">
          Status
          <select
            value={statusChoice}
            onChange={(e) => setStatusChoice(e.target.value)}
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          >
            <option value="">Auto (derive from caption)</option>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="dispersed">Dispersed</option>
            <option value="cancelled">Cancelled</option>
            <option value="unclear">Unclear</option>
          </select>
        </label>
        <label className="text-[12px] font-medium">
          Confidence
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            className="mt-1 w-full border border-border rounded-sm px-2 py-1.5 text-[13px]"
          >
            <option value="">Default (medium)</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>

      {err && (
        <p className="text-[12px]" style={{ color: "#A33232" }}>
          {err}
        </p>
      )}
      {ok && (
        <p className="text-[12px]" style={{ color: "#1B6B7A" }}>
          {ok}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider rounded-sm text-white disabled:opacity-50"
          style={{ backgroundColor: "#465bff" }}
        >
          {isEdit
            ? pending
              ? "Saving…"
              : "Save changes"
            : pending
              ? "Adding…"
              : "Add as context"}
        </button>
      </div>
    </form>
  );
}

function SocialWatchPanel({ items, isLoading }: { items: SocialWatchItem[]; isLoading: boolean }) {
  const promote = usePromoteSocialWatchItem();
  const remove = useDeleteSocialWatchItem();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const planned: SocialWatchItem[] = [];
    const active: SocialWatchItem[] = [];
    const other: SocialWatchItem[] = [];
    for (const it of items) {
      if (SOCIAL_ACTIVE_STATUSES.has(it.status)) active.push(it);
      else if (SOCIAL_PLANNED_STATUSES.has(it.status)) planned.push(it);
      else other.push(it);
    }
    return { planned, active, other };
  }, [items]);

  const alertCount = useMemo(
    () => items.filter((i) => (i.alertReasons?.length ?? 0) > 0).length,
    [items],
  );

  async function onPromote(id: number) {
    setError(null);
    setPendingId(id);
    try {
      await promote.mutateAsync({ id });
      // The mutation does not auto-refetch the board, so the promoted row would
      // otherwise keep showing a live "Promote" button. Invalidate every
      // social-watch list query so the row flips to its back-linked
      // "Incident #N" state.
      await queryClient.invalidateQueries({
        queryKey: getListSocialWatchItemsQueryKey(),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Promotion failed — the item may already be promoted or no longer eligible.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function onRemove(id: number) {
    if (!window.confirm("Remove this social-watch post? This only deletes the context row — it never affects any incident.")) {
      return;
    }
    setError(null);
    setRemovingId(id);
    try {
      await remove.mutateAsync({ id });
      // Deleting does not auto-refetch the board, so invalidate every
      // social-watch list query to drop the removed row from the panel.
      await queryClient.invalidateQueries({
        queryKey: getListSocialWatchItemsQueryKey(),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Removal failed — the item may have already been promoted to an incident.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white border border-border rounded-sm p-8 text-center text-sm text-muted-foreground">
        Loading social watch…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <AddWatchItemForm />
        <div className="bg-white border border-border rounded-sm p-6 text-sm text-muted-foreground">
          No KAMMI social-media posts on file yet. Add posts by hand with "Add watch item" above (no scraper key needed), or configure the paid Instagram scraper. These posts are supporting context only — they are never counted as incidents. See Source Health for the live configuration state.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AddWatchItemForm />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Posts on file" value={items.length} accent="#465bff" small />
        <Kpi label="Planned" value={groups.planned.length} accent="#1B6B7A" small />
        <Kpi label="Active / on-street" value={groups.active.length} accent="#A33232" small />
        <Kpi label="Watch alerts" value={alertCount} accent="#303030" small />
      </div>

      <p className="text-[11px] text-muted-foreground font-sans leading-snug">
        Public KAMMI Pusat Instagram posts, monitored as ADDITIVE
        context — never incidents, so they never affect any incident count. Only a
        confirmed-active item can be promoted to a flashpoint incident (Indonesia),
        which links the new incident back to the source post. Captions are
        sanitised; no phone numbers, personal accounts or member data are stored.
      </p>

      {error && (
        <p className="text-[12px] font-sans" style={{ color: "#A33232" }}>
          {error}
        </p>
      )}

      <SocialWatchGroup
        title="Planned mobilisation"
        items={groups.planned}
        empty="No planned mobilisation posts."
        onPromote={onPromote}
        pendingId={pendingId}
        onRemove={onRemove}
        removingId={removingId}
        editingId={editingId}
        onEdit={setEditingId}
      />
      <SocialWatchGroup
        title="Active / on-street"
        items={groups.active}
        empty="No active mobilisation posts."
        onPromote={onPromote}
        pendingId={pendingId}
        onRemove={onRemove}
        removingId={removingId}
        editingId={editingId}
        onEdit={setEditingId}
      />
      <SocialWatchGroup
        title="Other context (cancelled / unclear)"
        items={groups.other}
        empty="No additional context posts."
        onPromote={onPromote}
        pendingId={pendingId}
        onRemove={onRemove}
        removingId={removingId}
        editingId={editingId}
        onEdit={setEditingId}
      />
    </div>
  );
}

function SocialWatchGroup({
  title,
  items,
  empty,
  onPromote,
  pendingId,
  onRemove,
  removingId,
  editingId,
  onEdit,
}: {
  title: string;
  items: SocialWatchItem[];
  empty: string;
  onPromote: (id: number) => void;
  pendingId: number | null;
  onRemove: (id: number) => void;
  removingId: number | null;
  editingId: number | null;
  onEdit: (id: number | null) => void;
}) {
  return (
    <div className="bg-white border border-border rounded-sm">
      <div className="px-3 py-2 border-b border-border flex items-baseline justify-between">
        <h3 className="font-serif font-bold uppercase text-primary text-xs tracking-wide">{title}</h3>
        <span className="text-[11px] font-mono text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground italic">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-sans font-medium w-[90px]">Platform</th>
                <th className="text-left p-2 font-sans font-medium w-[110px]">Status</th>
                <th className="text-left p-2 font-sans font-medium w-[140px]">When</th>
                <th className="text-left p-2 font-sans font-medium w-[130px]">Where</th>
                <th className="text-left p-2 font-sans font-medium">Caption</th>
                <th className="text-left p-2 font-sans font-medium w-[70px]">Source</th>
                <th className="text-left p-2 font-sans font-medium w-[150px]">Promote</th>
                <th className="text-left p-2 font-sans font-medium w-[70px]">Edit</th>
                <th className="text-left p-2 font-sans font-medium w-[90px]">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => {
                const when =
                  it.eventTimeText ||
                  (it.eventDate ? format(new Date(it.eventDate), "dd MMM yyyy") : null) ||
                  it.postedAtDisplay ||
                  (it.postedAt ? format(new Date(it.postedAt), "dd MMM yyyy") : null) ||
                  "—";
                const where = it.location || it.city || "—";
                const promoted = it.promotedIncidentId != null;
                return (
                  <Fragment key={it.id}>
                  <tr className="hover:bg-muted/30 align-top">
                    <td className="p-2 text-xs capitalize whitespace-nowrap">{it.platform}</td>
                    <td className="p-2">
                      <SocialStatusBadge status={it.status} />
                      {(it.alertReasons?.length ?? 0) > 0 && (
                        <span className="ml-1 px-1 py-0.5 text-[9px] font-bold uppercase rounded-sm border" style={{ color: "#A33232", borderColor: "#A33232" }}>
                          alert
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-xs whitespace-nowrap">{when}</td>
                    <td className="p-2 text-xs">{where}</td>
                    <td className="p-2 text-xs text-foreground/80">
                      <span className="line-clamp-2">{it.caption || <span className="text-muted-foreground">—</span>}</span>
                      {it.issue && <span className="block text-[10px] text-muted-foreground mt-0.5">Issue: {it.issue}</span>}
                    </td>
                    <td className="p-2">
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs" aria-label="Open post">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      {promoted ? (
                        <span className="text-muted-foreground">Incident #{it.promotedIncidentId}</span>
                      ) : it.promotable ? (
                        <button
                          type="button"
                          onClick={() => onPromote(it.id)}
                          disabled={pendingId === it.id}
                          className="px-2 py-1 text-[11px] font-sans font-medium uppercase tracking-wider rounded-sm text-white disabled:opacity-50"
                          style={{ backgroundColor: "#465bff" }}
                        >
                          {pendingId === it.id ? "Promoting…" : "Promote"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">Not eligible</span>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      {promoted ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEdit(editingId === it.id ? null : it.id)}
                          className="px-2 py-1 text-[11px] font-sans font-medium uppercase tracking-wider rounded-sm border"
                          style={{ color: "#0B0B3D", borderColor: "#0B0B3D" }}
                        >
                          {editingId === it.id ? "Close" : "Edit"}
                        </button>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      {promoted ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRemove(it.id)}
                          disabled={removingId === it.id}
                          className="px-2 py-1 text-[11px] font-sans font-medium uppercase tracking-wider rounded-sm border disabled:opacity-50"
                          style={{ color: "#A33232", borderColor: "#A33232" }}
                        >
                          {removingId === it.id ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {editingId === it.id && !promoted && (
                    <tr>
                      <td colSpan={9} className="p-2 bg-muted/20">
                        <WatchItemForm editItem={it} onClose={() => onEdit(null)} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
