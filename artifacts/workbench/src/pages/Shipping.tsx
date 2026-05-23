import { useMemo } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format } from "date-fns";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { severityBadgeStyle, ratingColor, SEVERITY_LEVELS } from "@/lib/topics";
import { ExternalLink } from "lucide-react";

const MIDDLE_EAST = new Set([
  "Saudi Arabia","UAE","United Arab Emirates","Oman","Qatar","Bahrain","Kuwait",
  "Jordan","Iran","Iraq","Yemen","Israel","Lebanon","Syria","Egypt",
]);
const APAC = new Set([
  "Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines","Cambodia","Laos","Myanmar",
  "India","Pakistan","Bangladesh","Sri Lanka","China","Taiwan","South Korea","Japan",
  "Australia","New Zealand","Papua New Guinea","West Papua",
]);

type Region = "Middle East" | "APAC" | "Other / Unknown";

function classifyRegion(country: string | null | undefined): Region {
  if (!country) return "Other / Unknown";
  const first = country.split(/[;,]/)[0].trim();
  if (MIDDLE_EAST.has(first)) return "Middle East";
  if (APAC.has(first)) return "APAC";
  return "Other / Unknown";
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
  "Other / Unknown": "#B8C2CC",
};

const ISSUE_PALETTE = ["#0B0B3D", "#4655FF", "#303030", "#7A8FA6", "#B8C2CC", "#E2E2E2", "#0B0B3D", "#4655FF", "#303030", "#7A8FA6"];

export default function Shipping() {
  const { data: incidents = [], isLoading } = useListIncidents({ topic: "shipping" });

  const enriched = useMemo(
    () => incidents.map((i) => ({
      ...i,
      region: classifyRegion(i.country),
      issue: classifyIssue(i),
    })),
    [incidents],
  );

  const total = enriched.length;

  const byRegion = useMemo(() => {
    const m = new Map<Region, number>([["Middle East", 0], ["APAC", 0], ["Other / Unknown", 0]]);
    enriched.forEach((i) => m.set(i.region, (m.get(i.region) ?? 0) + 1));
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
      if (c === null) return; // excluded from the country chart
      m.set(c, (m.get(c) ?? 0) + 1);
    });
    const ranked = Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    if (ranked.length === 0 && notIdentifiedCount > 0) {
      ranked.push({ country: NOT_IDENTIFIED, count: notIdentifiedCount });
    }
    return ranked;
  }, [enriched, notIdentifiedCount]);

  const bySeverity = useMemo(() => SEVERITY_LEVELS.map((s) => ({
    severity: s,
    count: enriched.filter((i) => i.severity === s).length,
  })), [enriched]);

  const withCoords = enriched.filter((i) => i.latitude != null && i.longitude != null);
  const withSource = enriched.filter((i) => i.sourceUrl).length;

  const me = byRegion.find((r) => r.region === "Middle East")?.count ?? 0;
  const ap = byRegion.find((r) => r.region === "APAC")?.count ?? 0;
  const ot = byRegion.find((r) => r.region === "Other / Unknown")?.count ?? 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Shipping</h1>
        <p className="text-sm text-muted-foreground font-sans mt-1">
          Port disruption, chokepoint risk, vessel attacks, route diversion, shipping delays, insurance pressure, naval advisories, port strikes and cargo movement disruption. Cargo theft and pilferage are tracked under Cargo Watch.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-px bg-border p-px rounded-sm overflow-hidden">
        <Kpi label="Total Shipping Incidents" value={total} />
        <Kpi label="APAC" value={ap} />
        <Kpi label="Middle East" value={me} />
        <Kpi label="Other / Unknown" value={ot} />
        <Kpi label="With Coordinates" value={withCoords.length} small />
        <Kpi label="With Source Link" value={withSource} small />
        <Kpi label="Country Not Identified" value={notIdentifiedCount} small />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Incidents by Issue Type">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byIssue} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis dataKey="issue" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={180} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count">
                {byIssue.map((_, idx) => <Cell key={idx} fill={ISSUE_PALETTE[idx % ISSUE_PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Incidents by Region">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byRegion} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis dataKey="region" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={120} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count">
                {byRegion.map((d) => <Cell key={d.region} fill={REGION_COLOR[d.region as Region]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Incidents by Country (Top 12)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byCountry} margin={{ left: 8, right: 16, bottom: 40 }}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fill="#4655FF" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Severity Distribution">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bySeverity}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="severity" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count">
                {bySeverity.map((d) => <Cell key={d.severity} fill={ratingColor(d.severity)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">
          Shipping Map
        </div>
        {withCoords.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No shipping incidents have coordinates in the imported data. ({total} records total, 0 geocoded.)
          </div>
        ) : (
          <div className="h-[420px]">
            <MapContainer center={[15, 60]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {withCoords.map((i) => {
                const c = ratingColor(i.severity);
                return (
                  <CircleMarker key={i.id} center={[i.latitude!, i.longitude!]} radius={6}
                    pathOptions={{ fillColor: c, color: c, fillOpacity: 0.78, weight: 1.5 }}>
                    <LeafletTooltip>
                      <div className="text-xs">
                        <div className="font-bold">{i.title}</div>
                        <div>{i.country} · {classifyRegion(i.country)} · {classifyIssue(i)}</div>
                      </div>
                    </LeafletTooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">
          Recent Shipping Incidents
        </div>
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
                  <th className="text-left p-2 font-sans font-medium w-[120px]">Country</th>
                  <th className="text-left p-2 font-sans font-medium w-[110px]">Region</th>
                  <th className="text-left p-2 font-sans font-medium w-[170px]">Issue Type</th>
                  <th className="text-left p-2 font-sans font-medium w-[90px]">Severity</th>
                  <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {enriched.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{format(new Date(i.occurredAt), "dd MMM yyyy")}</td>
                    <td className="p-2 font-medium">{i.title}</td>
                    <td className="p-2 text-xs">{i.country}</td>
                    <td className="p-2 text-xs">{i.region}</td>
                    <td className="p-2 text-xs">{i.issue}</td>
                    <td className="p-2">
                      <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>
                        {i.severity}
                      </span>
                    </td>
                    <td className="p-2">
                      {i.sourceUrl ? (
                        <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs">
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
    </div>
  );
}

function Kpi({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-card p-4">
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={"font-serif font-bold leading-none text-primary " + (small ? "text-xl" : "text-3xl")}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-sm p-4">
      <h2 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">{title}</h2>
      <div className="h-72">{children}</div>
    </div>
  );
}
