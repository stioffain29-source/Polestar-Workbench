import { useMemo } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format } from "date-fns";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";
import { severityBadgeStyle, ratingColor } from "@/lib/topics";
import { ExternalLink } from "lucide-react";
import TopicReports from "@/components/TopicReports";

const MIDDLE_EAST = new Set([
  "Saudi Arabia","UAE","United Arab Emirates","Oman","Qatar","Bahrain","Kuwait",
  "Jordan","Iraq","Yemen","Israel","Lebanon","Syria","Turkey","Turkiye","Türkiye",
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

// Specific cargo type rules run first; the General Cargo fallback catches
// generic freight/container/truck wording so that "Other" is reserved for
// genuinely unclear records. Order matters — more specific rules first.
const CATEGORY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Cash / High Value Goods", pattern: /\b(cash|currency|bullion|gold|silver|jewell?ery|diamond|atm|valuables|high[- ]value)\b/i },
  { label: "Electronics", pattern: /\b(electronic|electronics|smartphone|smartphones|mobile phone|mobile phones|cellphone|laptop|laptops|semiconductor|semiconductors|chip|chips|tv|television|tablet|tablets|gadget|consumer electronics|appliance|appliances)\b/i },
  { label: "Pharmaceuticals", pattern: /\b(pharma|pharmaceutical|pharmaceuticals|medicine|medicines|medical supplies|medical supply|vaccine|vaccines|drug|drugs)\b/i },
  { label: "Tobacco", pattern: /\b(tobacco|cigarette|cigarettes|cigar|cigars|vape|vapes|e-cigarette|e-cigarettes)\b/i },
  { label: "Alcohol", pattern: /\b(alcohol|liquor|whisky|whiskey|wine|wines|beer|beers|spirits|rum|vodka|gin)\b/i },
  { label: "Fuel", pattern: /\b(fuel|petrol|diesel|gasoline|lpg|cng|kerosene|jet fuel|aviation fuel)\b/i },
  { label: "Vehicles / Auto Parts", pattern: /\b(vehicle|vehicles|auto parts|car parts|motorcycle|motorcycles|motorbike|tyres?|tires|automobile|automobiles|spare parts|car|cars|truck part|truck parts)\b/i },
  { label: "Textiles / Apparel", pattern: /\b(garment|garments|textile|textiles|apparel|clothing|fabric|fabrics|cotton|denim)\b/i },
  { label: "Chemicals", pattern: /\b(chemical|chemicals|fertili[sz]er|fertili[sz]ers|solvent|solvents|ammonia|acid|hazmat|industrial chemical)\b/i },
  { label: "Food", pattern: /\b(food|foods|grain|grains|rice|wheat|sugar|edible oil|produce|frozen|meat|poultry|dairy|seafood|fish|coffee|tea|beef|chicken)\b/i },
  { label: "FMCG", pattern: /\b(fmcg|consumer goods|household goods|household|personal care|toiletries|fast[- ]moving)\b/i },
  // General Cargo — generic freight/container/truck wording with no specific cargo type detail.
  { label: "General Cargo", pattern: /\b(cargo|freight|container|containers|shipment|shipments|consignment|consignments|truck|trucks|lorry|lorries|warehouse|godown|depot|parcel|parcels|goods)\b/i },
];

function classifyCategory(i: Incident): string {
  // Per spec: parse from title + summary + source text.
  const text = `${i.title} ${i.summary ?? ""} ${i.source ?? ""}`;
  for (const r of CATEGORY_RULES) {
    if (r.pattern.test(text)) return r.label;
  }
  return "Other";
}

const VALUE_RE = /(rs\.?\s*\d|usd\s*\$?\d|\$\s*\d|€\s*\d|£\s*\d|\d+\s*(crore|lakh|million|billion)|worth\s+\w|valued\s+at)/i;
const COMPANY_RE = /\b(ltd\.?|inc\.?|pvt\.?|corp\.?|llp|holdings|logistics|express|cargo co)\b/i;

const REGION_COLOR: Record<Region, string> = {
  "Middle East": "#0B0B3D",
  "APAC": "#4655FF",
  "Country not identified": "#7A8FA6",
  "Out of scope": "#B8C2CC",
};

const CAT_PALETTE = ["#0B0B3D", "#2A9D8F", "#E67E22", "#4655FF", "#F4D35E", "#6FB872", "#B8C2CC", "#303030", "#7A8FA6"];

export default function CargoWatch() {
  const { data: incidents = [], isLoading } = useListIncidents({ topic: "cargo_watch" });

  // Scope: APAC + Middle East only. Records that classify to a country outside
  // those regions (e.g. South Africa, Canada, US, UK, Brazil) are dropped from
  // this view. Records with no identifiable country are kept and surfaced as
  // "Country not identified" so dirty data is not hidden.
  const allEnriched = useMemo(
    () => incidents.map((i) => ({
      ...i,
      region: classifyRegion(i.country),
      category: classifyCategory(i),
    })),
    [incidents],
  );
  const outOfScopeCount = allEnriched.filter((i) => i.region === "Out of scope").length;
  const enriched = useMemo(
    () => allEnriched.filter((i) => i.region !== "Out of scope"),
    [allEnriched],
  );

  const total = enriched.length;
  // Region chart shows only the two in-scope regions. Records with no
  // identifiable country are still counted in `total` and surfaced via a
  // small data-quality note below, but they are not a main chart category.
  const byRegion = useMemo(() => {
    const m = new Map<Region, number>([
      ["Middle East", 0],
      ["APAC", 0],
    ]);
    enriched.forEach((i) => {
      if (i.region === "Middle East" || i.region === "APAC") {
        m.set(i.region, (m.get(i.region) ?? 0) + 1);
      }
    });
    return Array.from(m.entries()).map(([region, count]) => ({ region, count }));
  }, [enriched]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => m.set(i.category, (m.get(i.category) ?? 0) + 1));
    return Array.from(m.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
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
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [enriched]);

  const stacked = useMemo(() => {
    const topCountries = byCountry.slice(0, 10).map((c) => c.country);
    const categories = byCategory.map((c) => c.category);
    return topCountries.map((country) => {
      const row: Record<string, string | number> = { country };
      categories.forEach((cat) => { row[cat] = 0; });
      enriched
        .filter((i) => identifyCountry(i.country) === country)
        .forEach((i) => { row[i.category] = (row[i.category] as number) + 1; });
      return row;
    });
  }, [enriched, byCountry, byCategory]);

  const valueMentions = enriched.filter((i) => VALUE_RE.test(`${i.title} ${i.summary ?? ""}`)).length;
  const companyMentions = enriched.filter((i) => COMPANY_RE.test(`${i.title} ${i.summary ?? ""}`)).length;
  const withCoords = enriched.filter((i) => i.latitude != null && i.longitude != null);

  const me = byRegion.find((r) => r.region === "Middle East")?.count ?? 0;
  const ap = byRegion.find((r) => r.region === "APAC")?.count ?? 0;

  const allCategoriesForStack = byCategory.map((c) => c.category);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Cargo Watch</h1>
        <p className="text-sm text-muted-foreground font-sans mt-1">
          Cargo theft, hijack and loss incidents across APAC and the Middle East. Records from other regions are excluded.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-border p-px rounded-sm overflow-hidden">
        <Kpi label="Total Cargo Incidents" value={total} />
        <Kpi label="APAC" value={ap} />
        <Kpi label="Middle East" value={me} />
        <Kpi label="Records Mentioning Value" value={valueMentions} small />
        <Kpi label="Records Mentioning Company" value={companyMentions} small />
        <Kpi label="Excluded (Out of Scope)" value={outOfScopeCount} small />
      </div>

      {notIdentifiedCount > 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          Records needing country review: {notIdentifiedCount} (kept in totals but excluded from the country and region charts).
        </div>
      )}

      {outOfScopeCount > 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          {outOfScopeCount} cargo record{outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East (e.g. North America, Europe, Africa, South America) are excluded from this view.
        </div>
      )}

      {me === 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          Middle East coverage gap: the imported legacy dataset does not contain cargo theft, pilferage or hijack records for Saudi Arabia, the UAE, Oman, Qatar, Bahrain, Kuwait, Jordan, Iraq, Yemen, Israel, Lebanon, Syria or Turkey. Maritime piracy and vessel attacks involving these countries are tracked under Shipping.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

        <ChartCard title="Incidents by Cargo Category">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byCategory} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis dataKey="category" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={120} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count">
                {byCategory.map((_, idx) => <Cell key={idx} fill={CAT_PALETTE[idx % CAT_PALETTE.length]} />)}
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

        <ChartCard title="Country × Cargo Category (Top 10)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stacked} margin={{ left: 8, right: 16, bottom: 40 }}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {allCategoriesForStack.map((cat, idx) => (
                <Bar key={cat} dataKey={cat} stackId="cat" fill={CAT_PALETTE[idx % CAT_PALETTE.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">
          Cargo Map
        </div>
        {withCoords.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No cargo incidents have coordinates in the imported data. ({total} records total, 0 geocoded.)
          </div>
        ) : (
          <div className="h-[420px]">
            <MapContainer center={[10, 100]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {withCoords.map((i) => {
                const c = ratingColor(i.severity);
                return (
                  <CircleMarker key={i.id} center={[i.latitude!, i.longitude!]} radius={6}
                    pathOptions={{ fillColor: c, color: c, fillOpacity: 0.78, weight: 1.5 }}>
                    <LeafletTooltip>
                      <div className="text-xs">
                        <div className="font-bold">{i.title}</div>
                        <div>{identifyCountry(i.country) ?? "—"} · {i.region} · {i.category}</div>
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
          Recent Cargo Incidents
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !enriched.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No cargo incidents recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-sans font-medium w-[140px]">Date</th>
                  <th className="text-left p-2 font-sans font-medium">Title</th>
                  <th className="text-left p-2 font-sans font-medium w-[120px]">Country</th>
                  <th className="text-left p-2 font-sans font-medium w-[110px]">Region</th>
                  <th className="text-left p-2 font-sans font-medium w-[120px]">Category</th>
                  <th className="text-left p-2 font-sans font-medium w-[90px]">Severity</th>
                  <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {enriched.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{format(new Date(i.occurredAt), "dd MMM yyyy")}</td>
                    <td className="p-2 font-medium">{i.title}</td>
                    <td className="p-2 text-xs">{identifyCountry(i.country) ?? "—"}</td>
                    <td className="p-2 text-xs">{i.region}</td>
                    <td className="p-2 text-xs">{i.category}</td>
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

      <TopicReports topic="cargo_watch" />
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
