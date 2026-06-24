import { useMemo, useState } from "react";
import {
  useListIncidents,
  useUpdateIncident,
  getListIncidentsQueryKey,
  getGetDashboardOverviewQueryKey,
} from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";
import { severityBadgeStyle, ratingColor } from "@/lib/topics";
import { ExternalLink } from "lucide-react";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import {
  classifyRegion,
  classifyCategory,
  classifyScope,
  classifyLocationType,
  classifyIncidentType,
  parseUsdLoss,
  identifyCountry,
  cargoCountry,
  IN_SCOPE_COUNTRIES,
  type Region,
} from "@/lib/cargoAnalysis";
import { dedupeMonitorRows } from "@/lib/monitorDedupe";
import { buildCargoPortBreakdown } from "@/lib/cargoNarratives";
import {
  buildCargoGroupedDataset,
  cargoClusterLocationLabel,
  cargoClusterDetailLine,
  cargoClusterSourceLabel,
  cargoClusterSeverityKey,
  type CargoGroupedDataset,
  type CargoGroupedSection,
} from "@/lib/cargoGroupedDataset";
import { SEV_LABEL } from "@/lib/pdfChrome";

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

type RangeKey = "24h" | "7d" | "30d" | "90d" | "180d" | "1y" | "all";
const RANGE_DAYS: Record<RangeKey, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "180d": 180, "1y": 365, "all": Infinity };
const RANGE_LABEL: Record<RangeKey, string> = { "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", "180d": "180d", "1y": "1y", "all": "All time" };

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
  // Default to the full record set so the headline count and confirmed-loss
  // total reflect every in-scope cargo incident — matching the Dashboard card
  // (isCargoInScope, all-time) instead of hiding most incidents behind a
  // 30-day window. The range pills below still let an analyst narrow the view.
  const [range, setRange] = useState<RangeKey>("all");
  const [mapMode, setMapMode] = useState<"spot" | "density">("spot");
  const [recentTab, setRecentTab] = useState<"main" | "review">("main");

  // Needs Review resolution: an analyst assigns the correct country to an
  // unidentified-country incident, which promotes it into the in-scope main
  // lane (and thus the map, charts and reports). The assignment is persisted
  // as analystInScope:true so it is authoritative past the heuristic cargo
  // gates (see classifyScope). The workbench is intentionally public, so no
  // auth gate is applied (consistent with the project's edit-anywhere policy).
  const queryClient = useQueryClient();
  const updateIncident = useUpdateIncident();
  const [reviewCountry, setReviewCountry] = useState<Record<number, string>>({});
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const assignReviewCountry = (id: number) => {
    const country = reviewCountry[id];
    if (!country) return;
    setAssigningId(id);
    updateIncident.mutate(
      { id, data: { country, analystInScope: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIncidentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
          setReviewCountry((m) => {
            const next = { ...m };
            delete next[id];
            return next;
          });
        },
        onSettled: () => setAssigningId(null),
      },
    );
  };

  // Scope: APAC + Middle East cargo / logistics crime ONLY. Region classified
  // from incident country (with location-text override); non-cargo content and
  // explicit foreign-location context are excluded from the main view; records
  // with no identifiable country sit in a small "needs review" bucket.
  // No DB writes — pure UI filtering and derivation.
  const allEnriched = useMemo(
    () => incidents.map((i) => {
      const rawRegion = classifyRegion(i.country);
      // Effective country = stored, else recovered from text for an in-scope
      // place. The region shown follows the effective country so a recovered
      // record reads "APAC" rather than contradicting itself.
      const displayCountry = cargoCountry(i);
      const region: Region = displayCountry ? classifyRegion(displayCountry) : "Country not identified";
      return {
        ...i,
        displayCountry,
        region,
        category: classifyCategory(i),
        scope: classifyScope(i, rawRegion),
        locationType: classifyLocationType(i),
        incidentType: classifyIncidentType(i),
        usdLoss: parseUsdLoss(i),
        company: companyNamed(i),
      };
    }),
    [incidents],
  );

  type Enriched = (typeof allEnriched)[number];

  // Raw source-data buckets (pre-dedup) — these FOUR scopes partition every
  // fetched record, so they always sum exactly to totalInDb and the banner can
  // account for every row instead of leaving a silent remainder.
  const totalInDb = allEnriched.length;
  const inScopeRaw = allEnriched.filter((i) => i.scope === "in_scope").length;
  const outOfScopeCount = allEnriched.filter((i) => i.scope === "out_of_scope_geo").length;
  const excludedNonCargoCount = allEnriched.filter((i) => i.scope === "excluded_non_cargo").length;
  const reviewCount = allEnriched.filter((i) => i.scope === "country_review").length;

  // Collapse syndicated re-runs of the same wire (an identical headline carried
  // by many outlets) BEFORE deriving the visible working sets, so the record
  // counts, map, country tallies and confirmed-loss total reflect DISTINCT
  // events — not the number of outlets. Prefer the in-scope copy, then higher
  // severity, then the newest. The raw DB tallies above stay un-deduped, since
  // they describe the source data, not the working set.
  const deduped = useMemo(
    () =>
      dedupeMonitorRows(
        allEnriched.map((i) => ({ ...i, date: new Date(i.occurredAt) })),
        (i) => (i.scope === "in_scope" ? 2 : i.scope === "country_review" ? 1 : 0),
      ),
    [allEnriched],
  );

  // All in-scope records (no time filter) — used by the long-range trend chart.
  const inScope = useMemo(() => deduped.filter((i) => i.scope === "in_scope"), [deduped]);
  const needsReview = useMemo(() => deduped.filter((i) => i.scope === "country_review"), [deduped]);
  // Distinct (deduped, all-time) in-scope events vs the raw pre-dedup count, so
  // the banner can explain how many syndicated copies were collapsed.
  const distinctInScope = inScope.length;
  const collapsedCopies = Math.max(0, inScopeRaw - distinctInScope);

  // Time-window filter drives the map, recent list, country chart, KPIs, table.
  const cutoff = useMemo(() => (range === "all" ? null : subDays(new Date(), RANGE_DAYS[range])), [range]);
  const enriched = useMemo(
    () => inScope.filter((i) => cutoff === null || new Date(i.occurredAt) >= cutoff).sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt)),
    [inScope, cutoff],
  );
  const reviewInWindow = useMemo(
    () => needsReview.filter((i) => cutoff === null || new Date(i.occurredAt) >= cutoff).sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt)),
    [needsReview, cutoff],
  );
  // "last 7d" reads wrong for the all-time view; render a clean scope phrase.
  const rangeText = range === "all" ? "all time" : `last ${RANGE_LABEL[range]}`;

  const total = enriched.length;
  const confirmedValue = enriched.reduce((s, i) => s + (i.usdLoss ?? 0), 0);
  const companiesNamed = enriched.filter((i) => i.company).length;
  const countriesCovered = new Set(enriched.map((i) => i.displayCountry).filter(Boolean)).size;
  // Markers: prefer precise DB coordinates; otherwise fall back to the country
  // centroid (jittered, flagged approximate) so real incidents still appear on
  // the map. Records with no identifiable in-scope country are dropped.
  const markers = useMemo(
    () => enriched.flatMap((i) => {
      if (i.latitude != null && i.longitude != null) {
        return [{ id: i.id, lat: i.latitude, lng: i.longitude, approx: false, severity: i.severity, title: i.title, region: i.region, category: i.category, country: i.displayCountry }];
      }
      const c = i.displayCountry;
      const ctr = c ? COUNTRY_CENTROID[c] : null;
      if (!ctr) return [];
      const [dLat, dLng] = jitter(i.id);
      return [{ id: i.id, lat: ctr[0] + dLat, lng: ctr[1] + dLng, approx: true, severity: i.severity, title: i.title, region: i.region, category: i.category, country: i.displayCountry }];
    }),
    [enriched],
  );
  const approxCount = markers.filter((m) => m.approx).length;

  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      const c = i.displayCountry;
      if (c == null) return;
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

  // Named Port Breakdown — ranks the ports named in this window's in-scope
  // records. Same builder the report preview + PDF use, so all three surfaces
  // stay byte-for-byte in sync. Strict no-fabrication: only records whose own
  // text names exactly one port are counted; the rest stay uncounted.
  const cargoPorts = useMemo(() => buildCargoPortBreakdown(enriched), [enriched]);
  // Cargo Incident Clusters — the SAME shared grouping module the report
  // preview + PDF consume (buildCargoGroupedDataset). The monitor builds from
  // its own windowed in-scope set and shows the full section list (incl. the
  // New & Updated cross-cut); the report renders the fixed report subset. Same
  // module, same clustering, same per-cluster text — so they cannot drift.
  const cargoGrouped = useMemo(
    () =>
      buildCargoGroupedDataset(
        enriched.map((i) => ({
          id: i.id,
          topic: i.topic,
          title: i.title,
          summary: i.summary ?? null,
          source: i.source ?? null,
          sourceUrl: i.sourceUrl ?? null,
          location: i.location ?? null,
          country: i.displayCountry ?? i.country ?? null,
          severity: i.severity ?? null,
          occurredAt: i.occurredAt,
        })),
        { referenceDate: new Date().toISOString().slice(0, 10) },
      ),
    [enriched],
  );

  // Captured Incidents by Country & Cargo — stacked bars (cargo categories
  // stacked per country), matching the requested layout.
  const stacked = useMemo(() => {
    const topCountries = byCountry.slice(0, 10).map((c) => c.country);
    const categories = byCategory.map((c) => c.category);
    return topCountries.map((country) => {
      const row: Record<string, string | number> = { country };
      categories.forEach((cat) => { row[cat] = 0; });
      enriched
        .filter((i) => i.displayCountry === country)
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
                    {incidentSourceUrl(i) ? (
                      <a href={incidentSourceUrl(i)!} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{i.title}</a>
                    ) : i.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-sans mt-1 flex items-center justify-between gap-2">
                    <span className="truncate">{i.source ?? "—"}</span>
                    {recentTab === "review" ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          aria-label="Assign country"
                          value={reviewCountry[i.id] ?? ""}
                          onChange={(e) => setReviewCountry((m) => ({ ...m, [i.id]: e.target.value }))}
                          disabled={assigningId === i.id}
                          className="h-7 rounded-sm border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                        >
                          <option value="">Set country…</option>
                          {IN_SCOPE_COUNTRIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => assignReviewCountry(i.id)}
                          disabled={!reviewCountry[i.id] || assigningId === i.id}
                          className="h-7 whitespace-nowrap rounded-sm bg-accent px-2 text-[11px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Assign this country and add the incident to the in-scope main lane"
                        >
                          {assigningId === i.id ? "Adding…" : "Add to lane"}
                        </button>
                      </div>
                    ) : i.displayCountry ? (
                      <span className="whitespace-nowrap">{i.displayCountry}</span>
                    ) : incidentSourceUrl(i) ? (
                      <a
                        href={incidentSourceUrl(i)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap font-medium text-accent hover:underline"
                        title="Open the source article to review and identify the country"
                      >
                        Review
                      </a>
                    ) : (
                      <span className="whitespace-nowrap text-muted-foreground">Review</span>
                    )}
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
          <span className="text-[11px] text-muted-foreground font-sans">{total} incidents across {countriesCovered} countries · {rangeText}</span>
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

      {/* Named Port Breakdown — same builder as report preview + PDF */}
      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 flex items-baseline justify-between">
          <span className="font-serif font-bold uppercase text-sm text-primary">Named Port Breakdown</span>
          <span className="text-[11px] text-muted-foreground font-sans">{rangeText}</span>
        </div>
        {cargoPorts.rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Not reported.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-sans font-medium w-[22%]">Port</th>
                  <th className="text-left p-2 font-sans font-medium w-[28%]">Current Pattern</th>
                  <th className="text-left p-2 font-sans font-medium w-[16%]">Severity</th>
                  <th className="text-left p-2 font-sans font-medium w-[34%]">Operational Read</th>
                </tr>
              </thead>
              <tbody>
                {cargoPorts.rows.map((r) => (
                  <tr key={`${r.port}-${r.country}`} className="border-t border-border align-top">
                    <td className="p-2">
                      <div className="font-sans font-bold text-primary">{r.port}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.country} · {r.count} record{r.count === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">{r.pattern}</td>
                    <td className="p-2">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
                        style={severityBadgeStyle(r.severityKey)}
                      >
                        {r.severityLabel}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">{r.operationalRead}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border italic">
          {cargoPorts.coverageLabel}
        </div>
      </div>

      {/* Cargo Incident Clusters — shared grouping module (== report preview + PDF) */}
      <CargoClusterPanel grouped={cargoGrouped} rangeText={rangeText} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border p-px rounded-sm overflow-hidden">
        <Kpi label="Total Incidents" value={total} sub={`Cargo Watch · ${rangeText}`} />
        <Kpi label="Confirmed Value Stolen" value={confirmedValue > 0 ? usd(confirmedValue) : "—"} sub="Source-stated USD only" />
        <Kpi label="Incidents With Companies Named" value={companiesNamed} sub="Named commercial entity in source" />
      </div>

      <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2 space-y-1">
        <div>
          Showing {total} distinct in-scope cargo / logistics crime record{total === 1 ? "" : "s"} ({rangeText}). Scope: APAC + Middle East cargo theft, hijack, pilferage, warehouse, depot and container crime only.
        </div>
        <div>
          Source data holds {totalInDb} cargo record{totalInDb === 1 ? "" : "s"} in total, every one accounted for: {inScopeRaw} in scope
          {collapsedCopies > 0 ? ` (merged to ${distinctInScope} distinct after collapsing ${collapsedCopies} syndicated ${collapsedCopies === 1 ? "copy" : "copies"})` : ""}; {outOfScopeCount} out-of-scope location (outside APAC / Middle East); {excludedNonCargoCount} non-cargo (governance, civil affairs, film reviews, electricity theft, port congestion, freight rates, etc.); {reviewCount} unidentified country — needs review (see the Needs Review tab).
        </div>
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
                    <td className="p-2 text-xs">{i.location?.trim() || i.displayCountry || "—"}</td>
                    <td className="p-2 text-xs">{i.locationType}</td>
                    <td className="p-2 text-xs">{i.incidentType}</td>
                    <td className="p-2 text-xs">{i.category}</td>
                    <td className="p-2 text-xs text-right font-mono whitespace-nowrap">{i.usdLoss != null ? usd(i.usdLoss) : "—"}</td>
                    <td className="p-2 text-xs">{i.company ?? <span className="text-muted-foreground">None named</span>}</td>
                    <td className="p-2 text-xs capitalize">{i.confidence}</td>
                    <td className="p-2">
                      {incidentSourceUrl(i) ? (
                        <a href={incidentSourceUrl(i)!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs">
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

// Cargo Incident Clusters — consumes the SAME shared grouping module that drives
// the report preview + PDF (buildCargoGroupedDataset). The monitor renders every
// populated section (incl. the New & Updated cross-cut) plus the de-duped watch
// items; the report renders the fixed report subset. Native monitor styling, but
// the clusters, per-cluster text and severity all come from the shared module.
function CargoClusterPanel({ grouped, rangeText }: { grouped: CargoGroupedDataset; rangeText: string }) {
  const tableSections = grouped.sections.filter(
    (s) => s.key !== "watch_items" && s.clusters.length > 0,
  );
  return (
    <div className="bg-card border border-border rounded-sm">
      <div className="p-3 border-b border-border bg-muted/50 flex items-baseline justify-between">
        <span className="font-serif font-bold uppercase text-sm text-primary">Cargo Incident Clusters</span>
        <span className="text-[11px] text-muted-foreground font-sans">{rangeText}</span>
      </div>
      {tableSections.length === 0 && grouped.watchItems.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Not reported.</div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {tableSections.map((section) => (
              <CargoClusterSectionTable key={section.key} section={section} />
            ))}
          </div>
          {grouped.watchItems.length > 0 && (
            <div className="p-4 border-t border-border">
              <div className="font-serif font-bold uppercase text-[13px] text-primary mb-2">Recommended Watch Items</div>
              <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                {grouped.watchItems.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CargoClusterSectionTable({ section }: { section: CargoGroupedSection }) {
  return (
    <div className="p-4">
      <div className="font-serif font-bold uppercase text-[13px] text-primary mb-2">{section.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-sans font-medium w-[110px]">Date</th>
              <th className="text-left p-2 font-sans font-medium w-[160px]">Category</th>
              <th className="text-left p-2 font-sans font-medium">Incident</th>
              <th className="text-left p-2 font-sans font-medium w-[110px]">Severity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.clusters.map((c) => {
              const sk = cargoClusterSeverityKey(c);
              return (
                <tr key={c.id} className="align-top">
                  <td className="p-2 font-mono text-xs whitespace-nowrap">{format(new Date(c.latestOccurredAt), "yyyy-MM-dd")}</td>
                  <td className="p-2 text-xs">{c.enrichment.category}</td>
                  <td className="p-2">
                    <div className="text-sm font-medium leading-snug text-primary">{c.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {cargoClusterLocationLabel(c)} · Confidence: {c.enrichment.confidence} · Status: {c.enrichment.status}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{cargoClusterDetailLine(c)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 italic">{cargoClusterSourceLabel(c)}</div>
                  </td>
                  <td className="p-2">
                    <span
                      className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
                      style={severityBadgeStyle(sk)}
                    >
                      {SEV_LABEL[sk] ?? "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
