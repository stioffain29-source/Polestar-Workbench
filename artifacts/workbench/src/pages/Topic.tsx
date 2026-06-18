import { useRoute } from "wouter";
import { useMemo, useState } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, differenceInDays, parseISO, startOfDay } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line, LabelList,
} from "recharts";
import {
  TOPIC_LABELS, SEVERITY_LEVELS, SEVERITY_LABELS, severityBadgeStyle, ratingColor,
} from "@/lib/topics";
import { resolveTrueIncidents } from "@/lib/trueIncidents";
import { RangeToggle } from "@/components/RangeToggle";
import { RANGE_DAYS, RANGE_LABEL, RANGE_NOTE, type RangeKey } from "@/lib/dateRange";
import { MarketPricesSection, IncidentDerivedPanel, type DerivedIncidentRow } from "@/components/MarketPrices";
import { ExternalLink, BadgeCheck } from "lucide-react";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import { GdeltCoding } from "@/components/GdeltCoding";
import { displayIncidentTitle } from "@/lib/incidentTitle";
import { UntranslatedBadge } from "@/components/UntranslatedBadge";

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};

// Keyword patterns for the topic-specific derived panels. Matched against the
// headline + summary of the already-loaded, noise-filtered incident set — these
// surface a slice of real records, never fabricated rows.
const BROWNOUT_RE = /\b(brownout|blackout|black-?out|load[\s-]?shedding|power (?:cut|outage|outages|failure|loss)|grid (?:failure|collapse|down|instability)|rolling (?:outage|blackout)|electricity (?:shortage|rationing)|power shortage|power rationing|outage)\b/i;
const PINCH_RE = /\b(shortage|scarcity|supply (?:disruption|crunch|squeeze|shortfall)|export ban|export restriction|export curb|production (?:halt|cut|stoppage)|plant (?:shutdown|closure|outage|halt)|curtail|rationing|stockout|out of stock|run short|short supply)\b/i;

const TOPIC_SUBTITLE: Record<string, string> = {
  energy: "Power, grid and energy-infrastructure disruption monitor.",
  fertiliser: "Fertiliser supply, plant and input-cost disruption monitor.",
  fuel: "Fuel supply, refining and pricing disruption monitor.",
  flashpoint: "Cross-topic flashpoint and civil-disturbance monitor.",
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

export default function Topic() {
  const [, params] = useRoute("/topics/:topic");
  const slug = params?.topic ?? "";
  // Slug → label key (cargo-watch URL uses an underscored topic id).
  const labelKey = slug === "cargo-watch" ? "cargo_watch" : slug;
  // Data topic. The "protests" monitor is fed by the scraper under the
  // "flashpoint" topic; resolve it to the live topic so the monitor reflects
  // fresh ingested data — consistent with the reports / data-status mapping.
  const topic = labelKey === "protests" ? "flashpoint" : labelKey;
  const label = TOPIC_LABELS[labelKey] ?? topic;
  const subtitle = TOPIC_SUBTITLE[topic] ?? `${label} incident monitor.`;

  const { data: raw = [], isLoading } = useListIncidents({ topic: topic as never });

  // Date-range window. Defaults to the widest option so the first load shows the
  // full record set; the analyst can narrow the whole dashboard from the header.
  const [range, setRange] = useState<RangeKey>("2y");
  const windowDays = RANGE_DAYS[range];

  // Reconcile to the same scoped, noise-filtered set the dashboard card and the
  // reports use, so every surface tallies.
  const trueIncidents = useMemo(() => resolveTrueIncidents(topic, raw), [topic, raw]);

  const enriched = useMemo(
    () =>
      trueIncidents.map((i) => ({
        ...i,
        country: cleanCountry((i as { country?: string | null }).country),
        occurredDate: (() => { try { return parseISO(i.occurredAt); } catch { return new Date(NaN); } })(),
      })),
    [trueIncidents],
  );

  const total = enriched.length;
  const now = new Date();

  // Single window predicate for every time-scoped metric, so the cards, fast
  // facts and the trend chart can never disagree at a boundary.
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
  const moderatePlusWindow = useMemo(
    () => inWindow.filter((i) => (SEV_RANK[i.severity] ?? 0) >= 3).length,
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

  const hiExtremeTotal = useMemo(
    () => enriched.filter((i) => (SEV_RANK[i.severity] ?? 0) >= 4).length,
    [enriched],
  );

  const latest = useMemo(() => {
    const sorted = [...enriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return sorted[0] ?? null;
  }, [enriched]);

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
  const byCountryTop12 = byCountry.slice(0, 12);
  const top5Countries = byCountry.slice(0, 5);

  const distinctCountriesWindow = useMemo(() => {
    const s = new Set<string>();
    inWindow.forEach((i) => { if (i.country) s.add(i.country); });
    return s.size;
  }, [inWindow]);

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

  // Countries newly active in the last 7 days (present in last 7d, absent before).
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

  // --- Trend (windowed) ---------------------------------------------------
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

  const withCoords = inWindow.filter((i) => i.latitude != null && i.longitude != null);

  const sortedForTable = useMemo(
    () => [...inWindow].sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime()),
    [inWindow],
  );

  // --- Derived panels (energy brownouts / fertiliser supply pinch points) ----
  // Slice the windowed set by keyword. The matcher reads the same incidents the
  // rest of the page tallies, so these panels never invent records.
  const derived = useMemo(() => {
    const re = topic === "energy" ? BROWNOUT_RE : topic === "fertiliser" ? PINCH_RE : null;
    if (!re) return { rows: [] as DerivedIncidentRow[], countryRows: [] as { label: string; value: number }[] };
    const matched = sortedForTable.filter((i) => {
      const text = `${i.title ?? ""} ${(i as { summary?: string | null }).summary ?? ""}`;
      return re.test(text);
    });
    const cm = new Map<string, number>();
    matched.forEach((i) => { if (i.country) cm.set(i.country, (cm.get(i.country) ?? 0) + 1); });
    const countryRows = Array.from(cm.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const rows: DerivedIncidentRow[] = matched.map((i) => ({
      id: i.id,
      dateLabel: isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy"),
      country: i.country,
      title: i.title,
      severity: i.severity,
      sourceUrl: (i as { sourceUrl?: string | null }).sourceUrl,
      resolvedUrl: (i as { resolvedUrl?: string | null }).resolvedUrl,
    }));
    return { rows, countryRows };
  }, [topic, sortedForTable]);

  const showPrices = topic === "fuel" || topic === "energy" || topic === "fertiliser";

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">{label}</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">{subtitle}</p>
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

      {/* Market Prices (fuel / energy / fertiliser only) */}
      {showPrices && <MarketPricesSection group={topic} />}

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <FastFactCard
            label="Top Country"
            value={topCountry ? topCountry.country : "—"}
            note={topCountry ? `${topCountry.count} of ${countWindow} record${countWindow === 1 ? "" : "s"} in the ${RANGE_NOTE[range]}.` : "No identified countries."}
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
            label={`High / Extreme (${RANGE_LABEL[range]})`}
            value={String(criticalWindow)}
            note={`Elevated-severity records in the ${RANGE_NOTE[range]}.`}
            accent="#C0392B"
          />
          <FastFactCard
            label={`Moderate+ (${RANGE_LABEL[range]})`}
            value={String(moderatePlusWindow)}
            note={`Moderate, high or extreme records in the ${RANGE_NOTE[range]}.`}
            accent="#E67E22"
          />
          <FastFactCard
            label={`Active Countries (${RANGE_LABEL[range]})`}
            value={String(distinctCountriesWindow)}
            note={`Distinct countries with records in the ${RANGE_NOTE[range]}.`}
            accent="#363636"
          />
          <FastFactCard
            label="7 Day Change"
            value={`${change7 >= 0 ? "+" : ""}${change7}`}
            note={`${last7} in the past 7 days vs ${prev7} in the prior 7 days.`}
            accent={change7 > 0 ? "#C0392B" : change7 < 0 ? "#6FB872" : "#363636"}
          />
        </div>
      </Section>

      {/* 3. Key Metrics */}
      <Section title="Key Metrics">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Last 7 Days" value={last7} accent="#465bff" />
          <Kpi label="Prior 7 Days" value={prev7} accent="#363636" />
          <Kpi label="High / Extreme (Total)" value={hiExtremeTotal} accent="#C0392B" />
          <Kpi label={`Active Countries (${RANGE_LABEL[range]})`} value={distinctCountriesWindow} accent="#0b0a3d" />
        </div>
      </Section>

      {/* 4. Charts */}
      <Section title="Charts">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                <BarChart data={byCountryTop12} margin={{ top: 16, left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#465bff" stroke={darken("#465bff")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY}>
                    <LabelList dataKey="count" position="top" fontSize={12} fontWeight={700} fill="#303030" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title={`Severity Mix (${RANGE_LABEL[range]})`}>
            {countWindow === 0 ? (
              <EmptyChart message={`No records in the ${RANGE_NOTE[range]}.`} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={SEVERITY_LEVELS.map((s) => ({
                    severity: s,
                    label: SEVERITY_LABELS[s] ?? s,
                    count: inWindow.filter((i) => i.severity === s).length,
                  }))}
                  margin={{ top: 16, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                    {SEVERITY_LEVELS.map((s) => {
                      const c = ratingColor(s);
                      return <Cell key={s} fill={c} stroke={darken(c)} />;
                    })}
                    <LabelList dataKey="count" position="top" fontSize={13} fontWeight={700} fill="#303030" />
                  </Bar>
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
              <MapContainer center={[20, 80]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
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
                          <div className="font-bold">
                            {displayIncidentTitle(i.title, i.displayTitle)}
                            <UntranslatedBadge title={i.title} displayTitle={i.displayTitle} className="ml-1.5" />
                          </div>
                          <div>{i.country ?? "Location not identified"}</div>
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

      {/* Derived risk panel (energy brownouts / fertiliser supply pinch points) */}
      {topic === "energy" && (
        <IncidentDerivedPanel
          title="Brownouts & Power Disruptions"
          subtitle={`Power outages, blackouts, load-shedding and grid failures within the loaded ${RANGE_NOTE[range]}.`}
          accent="#465bff"
          countryRows={derived.countryRows}
          rows={derived.rows}
          emptyText={`No power-disruption records matched in the ${RANGE_NOTE[range]}.`}
        />
      )}
      {topic === "fertiliser" && (
        <IncidentDerivedPanel
          title="Supply Pinch Points & Shortages"
          subtitle={`Shortages, supply disruptions, export bans and plant shutdowns within the loaded ${RANGE_NOTE[range]}.`}
          accent="#465bff"
          countryRows={derived.countryRows}
          rows={derived.rows}
          emptyText={`No supply-pinch records matched in the ${RANGE_NOTE[range]}.`}
        />
      )}

      {/* 6. Incident table */}
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
                    <th className="text-left p-2 font-sans font-medium w-[150px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium">Headline</th>
                    <th className="text-left p-2 font-sans font-medium w-[110px]">Severity</th>
                    <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedForTable.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/30 align-top">
                      <td className="p-2 font-mono text-xs whitespace-nowrap">
                        {isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy")}
                      </td>
                      <td className="p-2 text-xs">{i.country ?? "—"}</td>
                      <td className="p-2 font-medium">
                        {displayIncidentTitle(i.title, i.displayTitle)}
                        <UntranslatedBadge title={i.title} displayTitle={i.displayTitle} className="ml-1.5" />
                        {i.corroborations?.length ? (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold uppercase tracking-wider text-accent">
                              <BadgeCheck className="w-3 h-3" />
                              Corroborated by UN OCHA (ReliefWeb)
                            </span>
                            {i.corroborations.map((c) => (
                              <a
                                key={c.id}
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                              >
                                {c.sourceAgency ?? c.reportTitle}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                        <GdeltCoding incident={i} variant="inline" />
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
          Highest severity on file: {highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}. Severity is keyword-rated from the headline and summary.
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
