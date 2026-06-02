import { useMemo, useState } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";
import { severityBadgeStyle, ratingColor } from "@/lib/topics";
import { ExternalLink } from "lucide-react";

// Cargo Watch scope: APAC + Middle East cargo / hijack / logistics crime only.
// Turkey is intentionally excluded per the current scope spec; Iran is included.
const MIDDLE_EAST = new Set([
  "Saudi Arabia","UAE","United Arab Emirates","Oman","Qatar","Bahrain","Kuwait",
  "Jordan","Iran","Iraq","Yemen","Israel","Lebanon","Syria",
]);

const APAC = new Set([
  "Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines","Cambodia","Laos","Myanmar",
  "India","Pakistan","Bangladesh","Sri Lanka","China","Taiwan","South Korea","Japan",
  "Australia","New Zealand","Papua New Guinea",
]);

type Region = "Middle East" | "APAC" | "Out of scope" | "Country not identified";

// City / sub-region aliases per the scope spec. Mapped to canonical country
// names so a record tagged "Dubai" or "Hong Kong" is treated as UAE / China.
const COUNTRY_ALIASES: Record<string, string> = {
  // UAE
  "dubai": "UAE", "abu dhabi": "UAE", "jebel ali": "UAE", "sharjah": "UAE",
  // Saudi Arabia
  "riyadh": "Saudi Arabia", "jeddah": "Saudi Arabia", "dammam": "Saudi Arabia",
  // Other GCC
  "doha": "Qatar", "manama": "Bahrain", "muscat": "Oman",
  // Indonesia
  "soekarno-hatta": "Indonesia", "soekarno hatta": "Indonesia",
  "tanjung priok": "Indonesia", "west papua": "Indonesia",
  // China (Hong Kong is part of the China SAR, treated as China for APAC scope)
  "hong kong": "China",
};

function normalizeCountry(name: string): string {
  return COUNTRY_ALIASES[name.toLowerCase()] ?? name;
}

function identifyCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0].trim();
  if (!first) return null;
  if (/^unknown$/i.test(first)) return null;
  return normalizeCountry(first);
}

function classifyRegion(country: string | null | undefined): Region {
  const first = identifyCountry(country);
  if (!first) return "Country not identified";
  if (MIDDLE_EAST.has(first)) return "Middle East";
  if (APAC.has(first)) return "APAC";
  return "Out of scope";
}

// Out-of-scope context: explicit foreign location words in the headline /
// summary override an APAC/ME country tag. Geography only — no brand or
// nationality tokens. Used to catch records like "Indian-origin men arrested
// in Canada" (country tagged India, incident in Canada) or South African
// records tagged Unknown but mentioning Gauteng / Johannesburg / Musina.
const OOS_CONTEXT_RE = /\b(in Canada|in the US|in the United States|in Italy|in Europe|in Africa|in Brazil|in Mexico|in the UK|in Britain|in Germany|in France|in Spain|US Northeast|Italian|Polish|Kenyan|Nigerian|Ghanaian|Moroccan|Egyptian|Mexican|Brazilian|Gauteng|Johannesburg|Pretoria|Cape Town|Musina|Vryburg|Gqeberha|Port Elizabeth|Philippi|Sowetan)\b/i;

// Nationality-only triggers (e.g. "Indian-origin men arrested in Canada").
// Treated as out-of-scope ONLY when combined with an explicit foreign-location
// word, so a real APAC story about "Indian-origin businessmen in Mumbai" is
// not wrongly excluded.
const NATIONALITY_OFFSHORE_RE = /\b(Indian[- ]origin|Punjab[- ]origin|Pakistani[- ]origin|Filipino[- ]origin|Bangladeshi[- ]origin)\b/i;

// Records that are clearly NOT cargo / logistics theft incidents — civic /
// governance / film / non-cargo crime — even if the source feed labels them
// as cargo-related.
const NON_CARGO_RE = /\b(trailer.*film|heist film|movie review|HAM Berat|kekerasan|pemenuhan SDM|nakes|gubernur|pemprov|prioritaskan|infrastruktur|kabupaten|pemkot diminta|fasilitasi penyelesaian|consumer.*anti-theft|anti-theft feature|electricity theft|port congestion|freight rate|commercial partnership|payment dispute)\b/i;

// Required cargo / logistics incident vocabulary. At least one match needed
// or the record is excluded from the main view as "not a cargo incident".
const CARGO_INCIDENT_RE = /\b(cargo|freight|container|truck|lorry|hijack|warehouse|godown|depot|pilfer|seal[- ]?tamper|consignment|shipment|parcel|logistic|theft|stolen|stole|robbery|burglar|raid|loot|siphon|smuggl|fraud|busted)\b/i;

// Non-cargo "fish/lobster/oyster" pattern unless the same text also clearly
// frames it as cargo/logistics theft (per spec).
const NON_CARGO_FISH_RE = /\b(lobster|oyster|fish theft)\b/i;

type Scope = "in_scope" | "out_of_scope_geo" | "excluded_non_cargo" | "country_review";

function classifyScope(i: Incident, region: Region): Scope {
  const text = `${i.title} ${i.summary ?? ""}`;
  // Reject non-cargo / civic / film / etc. content first.
  if (NON_CARGO_RE.test(text)) return "excluded_non_cargo";
  // Fish/lobster/oyster only counts as cargo if cargo verbs are also present.
  if (NON_CARGO_FISH_RE.test(text) && !/\b(cargo|freight|container|truck|warehouse|depot|consignment|shipment|logistic)\b/i.test(text)) {
    return "excluded_non_cargo";
  }
  // Must reference cargo / logistics crime vocabulary at all.
  if (!CARGO_INCIDENT_RE.test(text)) return "excluded_non_cargo";
  // Foreign-location override: text says incident is in a non-scope country.
  if (OOS_CONTEXT_RE.test(text)) return "out_of_scope_geo";
  // Nationality-only override applies only when paired with explicit foreign
  // place name (Canada/US/Europe). Already handled above; keep here as a
  // belt-and-braces for combined phrasing like "Indian-origin ... Canada".
  if (NATIONALITY_OFFSHORE_RE.test(text) && /\b(Canada|United States|USA|US|UK|Britain|Italy|Europe|Africa|Brazil|Mexico|Australia)\b/i.test(text) && region !== "APAC" && region !== "Middle East") {
    return "out_of_scope_geo";
  }
  // Country-driven classification.
  if (region === "Out of scope") return "out_of_scope_geo";
  if (region === "Country not identified") return "country_review";
  return "in_scope";
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

// Where the loss happened — derived from incident text. Order matters: more
// specific premises first, transit last so "truck stolen from depot" reads as
// Depot, not Highway. Returns "—" when nothing concrete is stated.
function classifyLocationType(i: Incident): string {
  const text = `${i.title} ${i.summary ?? ""} ${i.location ?? ""}`;
  if (/\b(warehouse|godown|storage facility|industrial[- ]zone)\b/i.test(text)) return "Warehouse";
  if (/\b(depot|distribution cent(?:re|er)|freight depot|inland container depot|icd|terminal|yard)\b/i.test(text)) return "Depot";
  if (/\b(airport|air cargo|air freight)\b/i.test(text)) return "Airport";
  if (/\b(port|harbour|harbor|wharf|dock|quay)\b/i.test(text)) return "Port";
  if (/\b(highway|expressway|motorway|freeway|toll road|en route|in[- ]transit|convoy|roadside|on the road)\b/i.test(text)) return "Highway";
  return "—";
}

// What kind of cargo crime — derived from incident text. Order matters.
function classifyIncidentType(i: Incident): string {
  const text = `${i.title} ${i.summary ?? ""}`;
  if (/\b(truck|lorry|consignment|cargo|freight)\b[^.]*\bhijack/i.test(text) || /\bhijack[^.]*\b(truck|lorry|cargo|freight|consignment)\b/i.test(text)) return "Truck hijacking";
  if (/\bhijack/i.test(text)) return "Hijacking";
  if (/\bwarehouse\b[^.]*\b(theft|burglar|robber|raid|stolen|loot|broke)\b/i.test(text) || /\b(theft|stolen|raid|burglar|loot)\b[^.]*\bwarehouse\b/i.test(text)) return "Warehouse theft";
  if (/\bcontainer\b[^.]*\b(theft|stolen|stole)\b/i.test(text) || /\b(theft|stolen|stole)\b[^.]*\bcontainer\b/i.test(text)) return "Container theft";
  if (/\bpilfer/i.test(text)) return "Pilferage";
  if (/\bseal[- ]?tamper/i.test(text)) return "Seal tampering";
  if (/\bsmuggl/i.test(text)) return "Smuggling";
  if (/\bfraud\b/i.test(text)) return "Cargo fraud";
  if (/\b(robbery|robbed|loot|burglar|raid|stolen|stole|theft)\b/i.test(text)) return "Other land-based cargo theft";
  return "Other";
}

// Explicit monetary loss in USD only. Rupee / local-currency figures are NOT
// converted (that would require a fabricated FX rate), so they read as "—"
// in the USD column and do not inflate the confirmed-value total. Honest by
// design: we report only what the source states in dollars.
function parseUsdLoss(i: Incident): number | null {
  const text = `${i.title} ${i.summary ?? ""}`;
  // Industry-wide cost/loss STATISTICS are not single-incident losses and must
  // never feed the "value stolen" total (e.g. "cargo theft costs $35bn a year",
  // "losses hit $725M", "$18M a day"). Drop the whole record's figure.
  if (/\b(a day|per day|\/day|a year|per year|per annum|annually|every year|daily)\b/i.test(text)) return null;
  if (/\blosses\s+(hit|exceed|reach|top|cost)/i.test(text)) return null;
  if (/\bcosts?\s+(trucking|supply|the industry|logistics|exceed|u\.?s\.?)/i.test(text)) return null;
  const m = text.match(/(?:US\$|USD\s*\$?|\$)\s?([\d][\d,]*(?:\.\d+)?)\s*(billion|million|bn|mn|m)?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const suf = (m[2] ?? "").toLowerCase();
  if (suf.startsWith("b")) n *= 1e9;
  else if (suf === "m" || suf === "mn" || suf === "million") n *= 1e6;
  // Sanity ceiling: a single cargo-theft incident is never $100M+. Figures at
  // or above this are aggregate industry statistics or unrelated monetary
  // numbers (e.g. a $7bn governance headline that mentions "fraud") — never a
  // real per-incident loss, so they must not pollute the value totals.
  if (n >= 1e8) return null;
  // The figure must sit next to theft/value language, so an unrelated dollar
  // amount in the text (a fine, a budget, a market-size aside) is not misread
  // as the incident's loss. We deliberately take the FIRST such figure, not the
  // largest: sources lead with the cargo value and only later mention recovered
  // or total asset-seizure figures, which are not the cargo loss.
  const at = text.indexOf(m[0]);
  const ctx = text.slice(Math.max(0, at - 45), at + m[0].length + 45);
  if (!/(stolen|theft|stole|loss|lost|robbed|robber|hijack|loot|burglar|pilfer|siphon|smuggl|seiz|recover|worth|valued|value|cargo|goods|consignment|shipment|haul|diesel|fuel)/i.test(ctx)) return null;
  return Math.round(n);
}

// A named commercial entity, detected conservatively: a proper noun followed
// by a corporate suffix. Police forces, ministries and generic words like
// "logistics" do NOT count, so the "companies named" total stays honest.
function companyNamed(i: Incident): string | null {
  const text = `${i.title} ${i.summary ?? ""}`;
  const m = text.match(/\b([A-Z][A-Za-z&.\-]+(?:\s+[A-Z][A-Za-z&.\-]+){0,3})\s+(Ltd|Limited|Inc|Incorporated|Pvt\.?\s*Ltd|Private Limited|Corp|Corporation|PLC|Sdn\.?\s*Bhd|Bhd|Tbk|GmbH|LLC|LLP|Holdings|Group)\b/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
}

const REGION_COLOR: Record<Region, string> = {
  "Middle East": "#0b0a3d",
  "APAC": "#465bff",
  "Country not identified": "#7A8FA6",
  "Out of scope": "#B8C2CC",
};

const CAT_PALETTE = ["#0b0a3d", "#2A9D8F", "#E67E22", "#465bff", "#F4D35E", "#6FB872", "#B8C2CC", "#363636", "#7A8FA6"];

// Country centroids for in-scope APAC + Middle East countries. Used ONLY as a
// fallback when a record has no precise lat/long in the database, so the map
// can place the incident at its country (clearly flagged as approximate). This
// mirrors the ingest geocoder, which resolves a city to its country centroid.
const COUNTRY_CENTROID: Record<string, [number, number]> = {
  "Indonesia": [-2.5, 118], "Papua New Guinea": [-6.3, 143.9], "Vietnam": [14.1, 108.3],
  "Australia": [-25.3, 133.8], "Malaysia": [4.2, 101.9], "India": [22.0, 79.0],
  "Philippines": [12.9, 121.8], "Singapore": [1.35, 103.8], "Thailand": [15.1, 101.0],
  "Cambodia": [12.6, 104.9], "Laos": [18.2, 103.9], "Myanmar": [21.9, 95.9],
  "Pakistan": [30.4, 69.3], "Bangladesh": [23.7, 90.4], "Sri Lanka": [7.9, 80.8],
  "China": [35.9, 104.2], "Taiwan": [23.7, 121.0], "South Korea": [36.5, 127.9],
  "Japan": [36.2, 138.3], "New Zealand": [-41.5, 172.8],
  "Saudi Arabia": [23.9, 45.1], "UAE": [23.4, 53.8], "United Arab Emirates": [23.4, 53.8],
  "Oman": [21.5, 55.9], "Qatar": [25.3, 51.2], "Bahrain": [26.0, 50.5], "Kuwait": [29.3, 47.5],
  "Jordan": [31.3, 36.2], "Iran": [32.4, 53.7], "Iraq": [33.2, 43.7], "Yemen": [15.6, 48.0],
  "Israel": [31.0, 34.9], "Lebanon": [33.9, 35.9], "Syria": [34.8, 38.9],
};

// Deterministic small offset so several incidents sharing a country centroid do
// not stack on the exact same pixel. Spread only — no semantic meaning.
function jitter(seed: number): [number, number] {
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  const b = Math.sin(seed * 78.233) * 43758.5453;
  return [((a - Math.floor(a)) - 0.5) * 1.4, ((b - Math.floor(b)) - 0.5) * 1.4];
}

type RangeKey = "24h" | "7d" | "30d" | "90d" | "1y";
const RANGE_DAYS: Record<RangeKey, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const RANGE_LABEL: Record<RangeKey, string> = { "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", "1y": "1y" };

function usd(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

function usdAxis(v: number): string {
  if (v >= 1e6) return "$" + (v % 1e6 === 0 ? v / 1e6 : (v / 1e6).toFixed(1)) + "m";
  if (v >= 1e3) return "$" + Math.round(v / 1e3) + "k";
  return "$" + v;
}

export default function CargoWatch() {
  const { data: incidents = [], isLoading } = useListIncidents({ topic: "cargo_watch" });
  const [range, setRange] = useState<RangeKey>("30d");
  const [mapMode, setMapMode] = useState<"spot" | "density">("spot");
  const [recentTab, setRecentTab] = useState<"main" | "review">("main");

  // Scope: APAC + Middle East cargo / logistics crime ONLY. Region classified
  // from incident country (with location-text override); non-cargo content and
  // explicit foreign-location context are excluded from the main view; records
  // with no identifiable country sit in a small "needs review" bucket.
  // No DB writes — pure UI filtering and derivation.
  const allEnriched = useMemo(
    () => incidents.map((i) => {
      const region = classifyRegion(i.country);
      return {
        ...i,
        region,
        category: classifyCategory(i),
        scope: classifyScope(i, region),
        locationType: classifyLocationType(i),
        incidentType: classifyIncidentType(i),
        usdLoss: parseUsdLoss(i),
        company: companyNamed(i),
      };
    }),
    [incidents],
  );

  type Enriched = (typeof allEnriched)[number];

  const totalInDb = allEnriched.length;
  const outOfScopeCount = allEnriched.filter((i) => i.scope === "out_of_scope_geo").length;
  const excludedNonCargoCount = allEnriched.filter((i) => i.scope === "excluded_non_cargo").length;

  // All in-scope records (no time filter) — used by the long-range trend chart.
  const inScope = useMemo(() => allEnriched.filter((i) => i.scope === "in_scope"), [allEnriched]);
  const needsReview = useMemo(() => allEnriched.filter((i) => i.scope === "country_review"), [allEnriched]);

  // Time-window filter drives the map, recent list, country chart, KPIs, table.
  const cutoff = useMemo(() => subDays(new Date(), RANGE_DAYS[range]), [range]);
  const enriched = useMemo(
    () => inScope.filter((i) => new Date(i.occurredAt) >= cutoff).sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt)),
    [inScope, cutoff],
  );
  const reviewInWindow = useMemo(
    () => needsReview.filter((i) => new Date(i.occurredAt) >= cutoff).sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt)),
    [needsReview, cutoff],
  );

  const total = enriched.length;
  const confirmedValue = enriched.reduce((s, i) => s + (i.usdLoss ?? 0), 0);
  const companiesNamed = enriched.filter((i) => i.company).length;
  const countriesCovered = new Set(enriched.map((i) => identifyCountry(i.country)).filter(Boolean)).size;
  // Markers: prefer precise DB coordinates; otherwise fall back to the country
  // centroid (jittered, flagged approximate) so real incidents still appear on
  // the map. Records with no identifiable in-scope country are dropped.
  const markers = useMemo(
    () => enriched.flatMap((i) => {
      if (i.latitude != null && i.longitude != null) {
        return [{ id: i.id, lat: i.latitude, lng: i.longitude, approx: false, severity: i.severity, title: i.title, region: i.region, category: i.category, country: i.country }];
      }
      const c = identifyCountry(i.country);
      const ctr = c ? COUNTRY_CENTROID[c] : null;
      if (!ctr) return [];
      const [dLat, dLng] = jitter(i.id);
      return [{ id: i.id, lat: ctr[0] + dLat, lng: ctr[1] + dLng, approx: true, severity: i.severity, title: i.title, region: i.region, category: i.category, country: i.country }];
    }),
    [enriched],
  );
  const approxCount = markers.filter((m) => m.approx).length;

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

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => m.set(i.category, (m.get(i.category) ?? 0) + 1));
    return Array.from(m.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  }, [enriched]);

  // Captured Incidents by Country & Cargo — stacked bars (cargo categories
  // stacked per country), matching the requested layout.
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
  const stackCategories = byCategory.map((c) => c.category);

  // Incidents — last 30 days, one bar per day (independent of the range pill).
  const last30 = useMemo(() => {
    const days: { day: string; label: string; count: number }[] = [];
    const idx = new Map<string, number>();
    for (let d = 29; d >= 0; d--) {
      const date = subDays(new Date(), d);
      const key = format(date, "yyyy-MM-dd");
      idx.set(key, days.length);
      days.push({ day: key, label: format(date, "d MMM"), count: 0 });
    }
    inScope.forEach((i) => {
      const key = format(new Date(i.occurredAt), "yyyy-MM-dd");
      const at = idx.get(key);
      if (at != null) days[at].count += 1;
    });
    return days;
  }, [inScope]);

  // Estimated cargo loss in USD per calendar month — contiguous last 12 months
  // (independent of the range pill, a longer-run trend). Sums only explicit,
  // source-stated USD incident-loss figures; industry statistics and local-
  // currency amounts are excluded by parseUsdLoss.
  const lossByMonth = useMemo(() => {
    const months: { key: string; month: string; value: number }[] = [];
    const idx = new Map<string, number>();
    const now = new Date();
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = format(d, "yyyy-MM");
      idx.set(key, months.length);
      months.push({ key, month: format(d, "MMM yyyy"), value: 0 });
    }
    inScope.forEach((i) => {
      if (i.usdLoss == null) return;
      const at = idx.get(format(new Date(i.occurredAt), "yyyy-MM"));
      if (at != null) months[at].value += i.usdLoss;
    });
    return months;
  }, [inScope]);
  const hasLossData = lossByMonth.some((m) => m.value > 0);

  const recentList: Enriched[] = recentTab === "main" ? enriched : reviewInWindow;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Cargo Watch</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            Cargo theft, hijack and loss incidents across APAC and the Middle East. Records from other regions are excluded.
          </p>
        </div>
        <div className="flex items-center gap-px bg-border rounded-sm overflow-hidden border border-border">
          {(Object.keys(RANGE_DAYS) as RangeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={
                "px-3 py-1.5 text-xs font-sans font-medium uppercase tracking-wider transition-colors " +
                (range === k ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")
              }
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Map + Recent Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-sm flex flex-col">
          <div className="p-3 border-b border-border bg-muted/50 flex items-center justify-between gap-2">
            <span className="font-serif font-bold uppercase text-sm text-primary">Cargo Theft Map</span>
            <div className="flex items-center gap-px bg-border rounded-sm overflow-hidden border border-border">
              {(["spot", "density"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMapMode(m)}
                  className={
                    "px-2.5 py-1 text-[11px] font-sans font-medium capitalize transition-colors " +
                    (mapMode === m ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")
                  }
                >
                  {m === "spot" ? "Spot map" : "Density"}
                </button>
              ))}
            </div>
          </div>
          {markers.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No mappable cargo incidents in this window. ({total} record{total === 1 ? "" : "s"} — none with an identifiable in-scope country.)
            </div>
          ) : (
            <>
              <div className="h-[440px]">
                <MapContainer center={[10, 100]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
                  <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {mapMode === "spot"
                    ? markers.map((m) => {
                        const c = ratingColor(m.severity);
                        return (
                          <CircleMarker key={m.id} center={[m.lat, m.lng]} radius={6}
                            pathOptions={{ fillColor: c, color: c, fillOpacity: m.approx ? 0.55 : 0.78, weight: 1.5 }}>
                            <LeafletTooltip>
                              <div className="text-xs">
                                <div className="font-bold">{m.title}</div>
                                <div>{identifyCountry(m.country) ?? "—"} · {m.region} · {m.category}{m.approx ? " · country-level" : ""}</div>
                              </div>
                            </LeafletTooltip>
                          </CircleMarker>
                        );
                      })
                    : densityClusters(markers).map((cl) => (
                        <CircleMarker key={cl.key} center={[cl.lat, cl.lng]} radius={6 + Math.sqrt(cl.count) * 4}
                          pathOptions={{ fillColor: "#0b0a3d", color: "#0b0a3d", fillOpacity: 0.5, weight: 1 }}>
                          <LeafletTooltip>
                            <div className="text-xs">
                              <div className="font-bold">{cl.count} incident{cl.count === 1 ? "" : "s"}</div>
                              <div>{cl.label}</div>
                            </div>
                          </LeafletTooltip>
                        </CircleMarker>
                      ))}
                </MapContainer>
              </div>
              {approxCount > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-sans border-t border-border">
                  {approxCount} of {markers.length} marker{markers.length === 1 ? "" : "s"} placed at country level (no precise coordinates in source data).
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-card border border-border rounded-sm flex flex-col">
          <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">
            Recent Incidents
          </div>
          <div className="flex border-b border-border text-xs font-sans">
            <button
              onClick={() => setRecentTab("main")}
              className={"flex-1 px-3 py-2 font-medium " + (recentTab === "main" ? "text-primary border-b-2 border-accent" : "text-muted-foreground")}
            >
              Main lane
            </button>
            <button
              onClick={() => setRecentTab("review")}
              className={"flex-1 px-3 py-2 font-medium " + (recentTab === "review" ? "text-primary border-b-2 border-accent" : "text-muted-foreground")}
            >
              Needs Review ({reviewInWindow.length})
            </button>
          </div>
          <div className="h-[388px] overflow-y-auto divide-y divide-border">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : recentList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No incidents in this window.</div>
            ) : (
              recentList.map((i) => (
                <div key={i.id} className="p-3 hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>
                      {i.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-sans whitespace-nowrap">
                      {formatDistanceToNow(new Date(i.occurredAt), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="text-sm font-medium leading-snug">
                    {i.sourceUrl ? (
                      <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{i.title}</a>
                    ) : i.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-sans mt-1 flex items-center justify-between gap-2">
                    <span className="truncate">{i.source ?? "—"}</span>
                    <span className="whitespace-nowrap">{identifyCountry(i.country) ?? "Review"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Requested trend charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Incidents — Last 30 Days">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={last30} margin={{ left: 8, right: 16, bottom: 8 }}>
              <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={9} interval={4} />
              <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fill="#465bff" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Estimated Cargo Loss (USD per Month)">
          {!hasLossData ? (
            <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground px-6">
              No source-stated USD loss figures in the last 12 months. Local-currency amounts are not converted, so they are not shown here.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lossByMonth} margin={{ left: 16, right: 16, bottom: 8 }}>
                <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={9} angle={-30} textAnchor="end" height={48} interval={0} />
                <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} tickFormatter={usdAxis} />
                <Tooltip formatter={(v: number) => usd(v)} contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="value" fill="#0b0a3d" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Captured Incidents by Country & Cargo */}
      <div className="bg-card border border-border rounded-sm p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-serif font-bold uppercase text-primary text-sm tracking-wide">Captured Incidents by Country &amp; Cargo</h2>
          <span className="text-[11px] text-muted-foreground font-sans">{total} incidents across {countriesCovered} countries · last {RANGE_LABEL[range]}</span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stacked} margin={{ left: 8, right: 16, bottom: 40 }}>
              <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
              <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
              <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {stackCategories.map((cat, idx) => (
                <Bar key={cat} dataKey={cat} stackId="cat" fill={CAT_PALETTE[idx % CAT_PALETTE.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border p-px rounded-sm overflow-hidden">
        <Kpi label="Total Incidents" value={total} sub={`Cargo Watch · last ${RANGE_LABEL[range]}`} />
        <Kpi label="Confirmed Value Stolen" value={confirmedValue > 0 ? usd(confirmedValue) : "—"} sub="Source-stated USD only" />
        <Kpi label="Incidents With Companies Named" value={companiesNamed} sub="Named commercial entity in source" />
      </div>

      <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2 space-y-1">
        <div>
          Showing {total} in-scope cargo / logistics crime record{total === 1 ? "" : "s"} from {totalInDb} total in source data (last {RANGE_LABEL[range]}). Scope: APAC + Middle East cargo theft, hijack, pilferage, warehouse, depot and container crime only.
        </div>
        {outOfScopeCount > 0 && (
          <div>Out-of-scope records excluded (incident location outside APAC / Middle East): {outOfScopeCount}.</div>
        )}
        {excludedNonCargoCount > 0 && (
          <div>Non-cargo records excluded (governance, civil affairs, film reviews, electricity theft, port congestion, freight rates, etc.): {excludedNonCargoCount}.</div>
        )}
      </div>

      {/* Captured incidents table */}
      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 flex items-baseline justify-between">
          <span className="font-serif font-bold uppercase text-sm text-primary">Captured Incidents</span>
          <span className="text-[11px] text-muted-foreground font-sans">{total} record{total === 1 ? "" : "s"}</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !enriched.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No cargo incidents in this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-sans font-medium w-[110px]">Date</th>
                  <th className="text-left p-2 font-sans font-medium">Place</th>
                  <th className="text-left p-2 font-sans font-medium w-[100px]">Location Type</th>
                  <th className="text-left p-2 font-sans font-medium w-[150px]">Incident Type</th>
                  <th className="text-left p-2 font-sans font-medium w-[120px]">Cargo</th>
                  <th className="text-right p-2 font-sans font-medium w-[90px]">USD</th>
                  <th className="text-left p-2 font-sans font-medium w-[130px]">Companies</th>
                  <th className="text-left p-2 font-sans font-medium w-[80px]">Conf.</th>
                  <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {enriched.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{format(new Date(i.occurredAt), "yyyy-MM-dd")}</td>
                    <td className="p-2 text-xs">{i.location?.trim() || identifyCountry(i.country) || "—"}</td>
                    <td className="p-2 text-xs">{i.locationType}</td>
                    <td className="p-2 text-xs">{i.incidentType}</td>
                    <td className="p-2 text-xs">{i.category}</td>
                    <td className="p-2 text-xs text-right font-mono whitespace-nowrap">{i.usdLoss != null ? usd(i.usdLoss) : "—"}</td>
                    <td className="p-2 text-xs">{i.company ?? <span className="text-muted-foreground">None named</span>}</td>
                    <td className="p-2 text-xs capitalize">{i.confidence}</td>
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

// Aggregate geocoded incidents into coarse density clusters (~0.5° grid) so the
// Density view sizes a single solid marker by incident count — no gradient or
// blur, per the brand spec.
function densityClusters(rows: Array<{ lat: number; lng: number; country: string | null }>): Array<{ key: string; lat: number; lng: number; count: number; label: string }> {
  const m = new Map<string, { lat: number; lng: number; count: number; label: string }>();
  for (const r of rows) {
    const gl = Math.round(r.lat * 2) / 2;
    const gn = Math.round(r.lng * 2) / 2;
    const key = `${gl},${gn}`;
    const ex = m.get(key);
    if (ex) ex.count += 1;
    else m.set(key, { lat: r.lat, lng: r.lng, count: 1, label: identifyCountry(r.country) ?? "—" });
  }
  return Array.from(m.entries()).map(([key, v]) => ({ key, ...v }));
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card p-4">
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="font-serif font-bold leading-none text-primary text-3xl">{value}</div>
      {sub && <div className="text-[10px] font-sans text-muted-foreground mt-1.5">{sub}</div>}
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
