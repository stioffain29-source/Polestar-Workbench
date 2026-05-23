import { useMemo } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, differenceInDays, parseISO, startOfDay } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { severityBadgeStyle, ratingColor, SEVERITY_LEVELS, SEVERITY_LABELS } from "@/lib/topics";
import { ExternalLink } from "lucide-react";

const MIDDLE_EAST = new Set([
  "Saudi Arabia","UAE","United Arab Emirates","Oman","Qatar","Bahrain","Kuwait",
  "Jordan","Iran","Iraq","Yemen","Israel","Lebanon","Syria",
]);
const APAC = new Set([
  "Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines","Cambodia","Laos","Myanmar",
  "India","Pakistan","Bangladesh","Sri Lanka","China","Taiwan","South Korea","Japan",
  "Australia","New Zealand","Papua New Guinea","West Papua",
]);

type Region = "Middle East" | "APAC" | "Out of scope" | "Country not identified";

function classifyRegion(country: string | null | undefined): Region {
  if (!country) return "Country not identified";
  const first = country.split(/[;,]/)[0].trim();
  if (!first) return "Country not identified";
  if (/^unknown$/i.test(first)) return "Country not identified";
  if (MIDDLE_EAST.has(first)) return "Middle East";
  if (APAC.has(first)) return "APAC";
  return "Out of scope";
}

const NOT_IDENTIFIED = "Country not identified";

function identifyCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0].trim();
  if (!first) return null;
  if (/^unknown$/i.test(first)) return null;
  return first;
}

// Shipping issue types — movement, ports, routes, vessels, chokepoints, maritime
// disruption. Theft / pilferage / hijack belong to Cargo Watch and are NOT
// classified here; if a shipping record mentions theft only, it falls to
// "Other Maritime".
const ISSUE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Vessel Attack", pattern: /\b(vessel attack|attack on (a |the )?(ship|tanker|vessel|carrier)|missile (struck|hit) (a |the )?(ship|tanker|vessel)|drone (hit|struck) (a |the )?(ship|tanker|vessel)|houthi attack)\b/i },
  { label: "Chokepoint Risk", pattern: /\b(strait of hormuz|bab[- ]el[- ]mandeb|suez canal|malacca|gibraltar|panama canal|chokepoint|transit risk)\b/i },
  { label: "Route Diversion", pattern: /\b(reroute|re[- ]routing|diverted|divert(ing|ed)? (away|around)|cape of good hope|avoiding)\b/i },
  { label: "Port Strike / Labour", pattern: /\b(port (workers? )?strike|dock(workers?| strike)|stevedore strike|labour (dispute|stoppage|action)|union (walkout|strike))\b/i },
  { label: "Port Disruption", pattern: /\b(port (closure|closed|shutdown|halted|suspended)|terminal (closed|shut|congestion)|congestion at (the )?port|berth (closure|delay))\b/i },
  { label: "Shipping Delay", pattern: /\b(shipping delay|vessel delay|delivery delay|delayed (shipment|cargo)|backlog|schedule disruption|transit delay)\b/i },
  { label: "Insurance / Freight Pressure", pattern: /\b(war risk (premium|insurance)|insurance (premium|surcharge|cost)|freight rate|bunker surcharge|war risk zone)\b/i },
  { label: "Naval / Maritime Advisory", pattern: /\b(naval (advisory|patrol|escort)|coast guard advisory|imo advisory|ukmto|maritime warning|nav warning|maritime advisory)\b/i },
  { label: "Cargo Movement Disruption", pattern: /\b(cargo (delay|disruption|halt|backlog|movement)|container (backlog|delay)|supply chain disruption)\b/i },
];

function classifyIssue(i: Incident): string {
  const text = `${i.title} ${i.summary ?? ""}`;
  for (const r of ISSUE_RULES) if (r.pattern.test(text)) return r.label;
  return "Other Maritime";
}

const REGION_COLOR: Record<Region, string> = {
  "Middle East": "#0B0B3D",
  "APAC": "#4655FF",
  "Country not identified": "#7A8FA6",
  "Out of scope": "#B8C2CC",
};

const ISSUE_PALETTE = ["#0B0B3D", "#4655FF", "#303030", "#7A8FA6", "#B8C2CC", "#6FB872", "#E67E22", "#C0392B", "#0B0B3D", "#4655FF"];

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default function Shipping() {
  const { data: incidents = [], isLoading } = useListIncidents({ topic: "shipping" });

  // Scope: APAC + Middle East only. Records that classify to a country outside
  // those regions are dropped from this view. Records with no identifiable
  // country are kept and surfaced as "Country not identified".
  const allEnriched = useMemo(
    () => incidents.map((i) => ({
      ...i,
      region: classifyRegion(i.country),
      issue: classifyIssue(i),
      occurredDate: (() => { try { return parseISO(i.occurredAt); } catch { return new Date(NaN); } })(),
    })),
    [incidents],
  );
  const outOfScopeCount = allEnriched.filter((i) => i.region === "Out of scope").length;
  const enriched = useMemo(
    () => allEnriched.filter((i) => i.region !== "Out of scope"),
    [allEnriched],
  );

  const total = enriched.length;

  const last7 = useMemo(() => {
    const now = new Date();
    return enriched.filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 7).length;
  }, [enriched]);
  const last30 = useMemo(() => {
    const now = new Date();
    return enriched.filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 30).length;
  }, [enriched]);

  const byRegion = useMemo(() => {
    const m = new Map<Region, number>([
      ["Middle East", 0],
      ["APAC", 0],
      ["Country not identified", 0],
    ]);
    enriched.forEach((i) => {
      if (i.region === "Out of scope") return;
      m.set(i.region, (m.get(i.region) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([region, count]) => ({ region, count }));
  }, [enriched]);

  const byIssue = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => m.set(i.issue, (m.get(i.issue) ?? 0) + 1));
    return Array.from(m.entries()).map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count);
  }, [enriched]);

  const notIdentifiedCount = useMemo(
    () => enriched.filter((i) => identifyCountry(i.country) === null).length,
    [enriched],
  );

  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      const c = identifyCountry(i.country);
      if (c === null) return;
      m.set(c, (m.get(c) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [enriched]);

  const bySeverity = useMemo(() => SEVERITY_LEVELS.map((s) => ({
    severity: s,
    label: SEVERITY_LABELS[s] ?? s,
    count: enriched.filter((i) => i.severity === s).length,
  })), [enriched]);

  const withCoords = enriched.filter((i) => i.latitude != null && i.longitude != null);
  const withSource = enriched.filter((i) => i.sourceUrl).length;

  // Timeline — bucket by day for the last 30 days that have records, fall back
  // to grouping the whole dataset by day if there aren't enough recent rows.
  const timeline = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      if (isNaN(i.occurredDate.getTime())) return;
      const d = startOfDay(i.occurredDate);
      const k = format(d, "yyyy-MM-dd");
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([date, count]) => ({ date, label: format(parseISO(date), "dd MMM"), count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [enriched]);

  // Fast Facts — short narrative-style cards.
  const meCount = byRegion.find((r) => r.region === "Middle East")?.count ?? 0;
  const apCount = byRegion.find((r) => r.region === "APAC")?.count ?? 0;

  const mainRegion = useMemo(() => {
    const ranked = [...byRegion].sort((a, b) => b.count - a.count);
    const top = ranked[0];
    if (!top || top.count === 0) return null;
    return top;
  }, [byRegion]);

  const mainIssue = byIssue[0] ?? null;

  const highestSev = useMemo(() => {
    let key = "";
    let rank = 0;
    enriched.forEach((i) => {
      const r = SEV_RANK[i.severity] ?? 0;
      if (r > rank) { rank = r; key = i.severity; }
    });
    return key;
  }, [enriched]);

  const highestSevCount = highestSev ? enriched.filter((i) => i.severity === highestSev).length : 0;

  const latestSignificant = useMemo(() => {
    const sorted = [...enriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return sorted.find((i) => i.severity === "extreme" || i.severity === "high") ?? sorted[0] ?? null;
  }, [enriched]);

  // Daily Intelligence Summary buckets — sorted newest-first so "Most recent" copy is honest.
  const recent7 = useMemo(() => {
    const now = new Date();
    return enriched
      .filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 7)
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
  }, [enriched]);

  const transitRecords = recent7.filter((i) =>
    i.issue === "Vessel Attack" || i.issue === "Route Diversion" || i.issue === "Chokepoint Risk" || i.issue === "Naval / Maritime Advisory",
  );
  const portRecords = recent7.filter((i) =>
    i.issue === "Port Disruption" || i.issue === "Port Strike / Labour" || i.issue === "Cargo Movement Disruption" || i.issue === "Shipping Delay",
  );
  const intelRecord = latestSignificant;

  // Page render
  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* 1. Header */}
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Shipping</h1>
        <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
          Port disruption, chokepoint risk, vessel attacks, route diversion, shipping delays, insurance pressure, naval advisories, port strikes and cargo movement disruption. APAC and the Middle East only — records from other regions are excluded. Cargo theft and pilferage are tracked under Cargo Watch.
        </p>
      </div>

      {outOfScopeCount > 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          {outOfScopeCount} shipping record{outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East (e.g. North America, Europe, Africa, South America) are excluded from this view.
        </div>
      )}

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <FastFactCard
            label="Total Shipping Records"
            value={String(total)}
            note={`${last7} in the past 7 days · ${last30} in the past 30 days.`}
            accent="#4655FF"
          />
          <FastFactCard
            label="Highest Severity On File"
            value={highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}
            note={
              highestSev
                ? `${highestSevCount} record${highestSevCount === 1 ? "" : "s"} at this rating across the dataset.`
                : "No severity recorded."
            }
            accent={highestSev ? ratingColor(highestSev) : "#B8C2CC"}
          />
          <FastFactCard
            label="Main Affected Region"
            value={mainRegion ? mainRegion.region : "—"}
            note={
              mainRegion
                ? `${mainRegion.count} of ${total} shipping records mapped to this region.`
                : "No regional distribution available."
            }
            accent={mainRegion ? REGION_COLOR[mainRegion.region] : "#B8C2CC"}
          />
          <FastFactCard
            label="Main Issue Type"
            value={mainIssue ? mainIssue.issue : "—"}
            note={
              mainIssue
                ? `${mainIssue.count} record${mainIssue.count === 1 ? "" : "s"} classified as ${mainIssue.issue.toLowerCase()}.`
                : "No issue classification available."
            }
            accent="#0B0B3D"
          />
          <FastFactCard
            label="Latest Significant Incident"
            value={latestSignificant ? format(latestSignificant.occurredDate, "dd MMM yyyy") : "—"}
            note={
              latestSignificant
                ? `${latestSignificant.title} (${identifyCountry(latestSignificant.country) ?? NOT_IDENTIFIED}).`
                : "No significant shipping incident on record."
            }
            accent={latestSignificant ? ratingColor(latestSignificant.severity) : "#B8C2CC"}
          />
        </div>
      </Section>

      {/* 3. Key Metrics */}
      <Section title="Key Metrics">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Kpi label="Total Shipping Incidents" value={total} accent="#0B0B3D" />
          <Kpi label="Incidents (7d)" value={last7} accent="#4655FF" />
          <Kpi label="Incidents (30d)" value={last30} accent="#4655FF" />
          <Kpi label="Highest Severity" value={highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"} accent={highestSev ? ratingColor(highestSev) : "#B8C2CC"} small />
          <Kpi label="Main Affected Region" value={mainRegion?.region ?? "—"} accent={mainRegion ? REGION_COLOR[mainRegion.region] : "#B8C2CC"} small />
          <Kpi label="With Source Link" value={withSource} accent="#303030" />
          <Kpi label="With Coordinates" value={withCoords.length} accent="#303030" />
        </div>
      </Section>

      {/* 4. Regional Split */}
      <Section title="Regional Split">
        <div className="bg-white border border-border rounded-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <RegionRow label="Middle East" count={meCount} total={total} accent={REGION_COLOR["Middle East"]} />
            <RegionRow label="APAC" count={apCount} total={total} accent={REGION_COLOR["APAC"]} />
            <RegionRow label={NOT_IDENTIFIED} count={notIdentifiedCount} total={total} accent={REGION_COLOR["Country not identified"]} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Records with country not identified are kept in totals but separated from the country charts. Records outside APAC and the Middle East are excluded entirely.
          </p>
        </div>
      </Section>

      {/* 5. Issue Type Breakdown */}
      <Section title="Issue Type Breakdown">
        <ChartCard title="Incidents by Issue Type" height={320}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byIssue} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis dataKey="issue" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={200} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                {byIssue.map((_, idx) => {
                  const c = ISSUE_PALETTE[idx % ISSUE_PALETTE.length];
                  return <Cell key={idx} fill={c} stroke={darken(c)} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      {/* 6. Daily Intelligence Summary */}
      <Section title="Daily Intelligence Summary">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <IntelCard
            label="Transit / Route Activity"
            body={
              transitRecords.length > 0
                ? `${transitRecords.length} transit-related record${transitRecords.length === 1 ? "" : "s"} in the past 7 days, covering vessel attacks, route diversion, chokepoint risk and naval advisories. Most recent: ${transitRecords[0].title}.`
                : null
            }
          />
          <IntelCard
            label="Port and Chokepoint Watch"
            body={
              portRecords.length > 0
                ? `${portRecords.length} port-side record${portRecords.length === 1 ? "" : "s"} in the past 7 days, covering port disruption, port strikes, cargo movement disruption and shipping delays. Most recent: ${portRecords[0].title}.`
                : null
            }
          />
          <IntelCard
            label="Key Intelligence Note"
            body={
              intelRecord
                ? `${intelRecord.title} — rated ${SEVERITY_LABELS[intelRecord.severity] ?? intelRecord.severity} (${identifyCountry(intelRecord.country) ?? NOT_IDENTIFIED}, ${format(intelRecord.occurredDate, "dd MMM yyyy")}). Issue type: ${intelRecord.issue}.`
                : null
            }
          />
        </div>
      </Section>

      {/* 7. Shipping Map */}
      <Section title="Shipping Map">
        <div className="bg-white border border-border rounded-sm overflow-hidden">
          {withCoords.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No geocoded shipping records available for this view.
            </div>
          ) : (
            <div className="h-[420px]">
              <MapContainer center={[15, 60]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
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
                          <div>{identifyCountry(i.country) ?? NOT_IDENTIFIED} · {i.region} · {i.issue}</div>
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

      {/* 8. Charts */}
      <Section title="Charts">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Incident Timeline">
            {timeline.length === 0 ? (
              <EmptyChart message="No timeline data available." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="#0B0B3D" strokeWidth={2} dot={{ r: 3, stroke: "#0B0B3D", strokeWidth: 1.5, fill: "#4655FF", fillOpacity: FILL_OPACITY }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Incidents by Region">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byRegion} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
                <YAxis dataKey="region" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={130} />
                <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  {byRegion.map((d) => {
                    const c = REGION_COLOR[d.region as Region];
                    return <Cell key={d.region} fill={c} stroke={darken(c)} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Incidents by Country (Top 12)">
            {byCountry.length === 0 ? (
              <EmptyChart message="No identified countries in shipping records." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCountry} margin={{ left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#4655FF" stroke={darken("#4655FF")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Severity Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySeverity}>
                <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
                <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  {bySeverity.map((d) => {
                    const c = ratingColor(d.severity);
                    return <Cell key={d.severity} fill={c} stroke={darken(c)} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Section>

      {/* 9. Recent Incidents */}
      <Section title="Recent Shipping Incidents">
        <div className="bg-white border border-border rounded-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : !enriched.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No shipping incidents recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-sans font-medium w-[140px]">Date</th>
                    <th className="text-left p-2 font-sans font-medium">Title</th>
                    <th className="text-left p-2 font-sans font-medium w-[140px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium w-[110px]">Region</th>
                    <th className="text-left p-2 font-sans font-medium w-[180px]">Issue Type</th>
                    <th className="text-left p-2 font-sans font-medium w-[100px]">Severity</th>
                    <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {enriched
                    .slice()
                    .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime())
                    .map((i) => {
                      const countryDisplay = identifyCountry(i.country) ?? NOT_IDENTIFIED;
                      return (
                        <tr key={i.id} className="hover:bg-muted/30">
                          <td className="p-2 font-mono text-xs whitespace-nowrap">
                            {isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy")}
                          </td>
                          <td className="p-2 font-medium">{i.title}</td>
                          <td className="p-2 text-xs">{countryDisplay}</td>
                          <td className="p-2 text-xs">{i.region}</td>
                          <td className="p-2 text-xs">{i.issue}</td>
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
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {/* 10. Data quality note */}
      <div className="bg-white border border-border rounded-sm p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">Data Quality</div>
          <div className="text-sm text-primary font-sans mt-1">
            Records with country not identified: <span className="font-bold">{notIdentifiedCount}</span>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground max-w-md text-right">
          Kept in totals; excluded from country-level charts. Source records show <span className="font-semibold">Country not identified</span> in place of "Unknown".
        </div>
      </div>
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

function RegionRow({ label, count, total, accent }: { label: string; count: number; total: number; accent: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{pct}%</div>
      </div>
      <div className="text-2xl font-serif font-bold text-primary leading-none">{count}</div>
      <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, background: accent, opacity: FILL_OPACITY }} />
      </div>
    </div>
  );
}

function IntelCard({ label, body }: { label: string; body: string | null }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-1">{label}</div>
      <p className="text-sm text-primary font-sans leading-relaxed mt-2">
        {body ?? <span className="italic text-muted-foreground">Data not currently available.</span>}
      </p>
    </div>
  );
}

function ChartCard({ title, children, height = 288 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4">
      <h3 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">{title}</h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
      {message}
    </div>
  );
}
