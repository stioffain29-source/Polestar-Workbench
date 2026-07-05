import { useMemo, useState } from "react";
import {
  useListIncidents,
  useUpdateIncident,
  getListIncidentsQueryKey,
  getGetDashboardOverviewQueryKey,
} from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, GeoJSON, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import cargoScopeCountriesGeo from "@/assets/cargoScopeCountries.geo.json";
import { COUNT_BANDS, countBandColor, featureCountryName } from "@/lib/cargoChoropleth";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, LabelList } from "recharts";
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


// Country-intensity choropleth bands, legend colours and the polygon-name
// lookup now live in the shared lib/cargoChoropleth module so the interactive
// monitor map and the static report/PDF choropleth read one source of truth.

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

// Word-wrap a long axis label into up to three short lines so full cargo
// category names are never truncated on the horizontal bar chart.
function wrapAxisLabel(s: string, maxChars = 22): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

// Multi-line Y-axis tick for the cargo-category chart. Renders the wrapped
// label right-aligned into the axis gutter, vertically centred on the bar.
function CategoryAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}) {
  const { x = 0, y = 0, payload } = props;
  const lines = wrapAxisLabel(String(payload?.value ?? ""));
  const lineH = 11;
  const top = y - ((lines.length - 1) * lineH) / 2;
  return (
    <text x={x} y={top} textAnchor="end" fontSize={10} fill="#303030">
      {lines.map((ln, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineH}>
          {ln}
        </tspan>
      ))}
    </text>
  );
}

export default function CargoWatch() {
  // includeIrrelevant=true: Cargo Watch MUST NOT inherit the server's persisted
  // relevance verdict. That verdict is the general TOPIC classifier, which marks
  // many genuine cargo thefts (a cigarette-distributor warehouse raid with a
  // fatality, ship stowaways, a one-ton commodity haul, a clothing-warehouse
  // robbery) as "irrelevant" and drops them before they ever reach the browser —
  // leaving the 30-day view implausibly empty. This page already re-derives
  // scope per row via classifyScope (the curated cargo gate), so we fetch raw
  // and let that gate be the single source of truth. Mirrors CountryReport.
  const { data: incidents = [], isLoading } = useListIncidents({
    topic: "cargo_watch",
    includeIrrelevant: true,
  } as never);
  // Default to the full record set so the headline count and confirmed-loss
  // total reflect every in-scope cargo incident — matching the Dashboard card
  // (isCargoInScope, all-time) instead of hiding most incidents behind a
  // 30-day window. The range pills below still let an analyst narrow the view.
  const [range, setRange] = useState<RangeKey>("all");
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
  // Point markers: ONLY records that carry reliable latitude/longitude in the
  // source data. Records with only country/city data contribute to the country
  // choropleth shading instead — never a jittered pin that would fake a precise
  // location. No approximate centroid markers.
  const pointMarkers = useMemo(
    () => enriched.flatMap((i) =>
      i.latitude != null && i.longitude != null
        ? [{ id: i.id, lat: i.latitude, lng: i.longitude, severity: i.severity, title: i.title, region: i.region, category: i.category, country: i.displayCountry }]
        : [],
    ),
    [enriched],
  );

  // Per-country choropleth aggregation: incident count and summed source-stated
  // USD loss, over the SAME windowed in-scope set the rest of the page uses.
  // Records with no identifiable in-scope country are excluded from shading.
  const countryIntensity = useMemo(() => {
    const m = new Map<string, { count: number; usd: number }>();
    enriched.forEach((i) => {
      const c = i.displayCountry;
      if (!c) return;
      const e = m.get(c) ?? { count: 0, usd: 0 };
      e.count += 1;
      e.usd += i.usdLoss ?? 0;
      m.set(c, e);
    });
    return m;
  }, [enriched]);
  const shadedCountryCount = countryIntensity.size;
  const mappable = shadedCountryCount > 0 || pointMarkers.length > 0;

  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      const c = i.displayCountry;
      if (c == null) return;
      m.set(c, (m.get(c) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
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

  // Captured Incidents — country and cargo category shown as two separate
  // horizontal bar charts. The earlier single stacked chart crammed the whole
  // ~30-label taxonomy into each country bar over a 9-colour palette, so the
  // categories were unreadable. Split, sorted, single-colour, labelled. Both
  // charts cap at the top 10 rows; any remainder rolls into a single honest
  // "Other" bar so nothing is silently dropped.
  const countryBars = useMemo(() => {
    if (byCountry.length <= 10) return byCountry;
    const rest = byCountry.slice(10).reduce((s, r) => s + r.count, 0);
    return [...byCountry.slice(0, 10), { country: "Other countries", count: rest }];
  }, [byCountry]);
  const categoryBars = useMemo(() => {
    if (byCategory.length <= 10) return byCategory;
    const rest = byCategory.slice(10).reduce((s, r) => s + r.count, 0);
    return [...byCategory.slice(0, 10), { category: "Other categories", count: rest }];
  }, [byCategory]);

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
            <span className="text-[11px] text-muted-foreground font-sans">Country intensity · {rangeText}</span>
          </div>
          {!mappable ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No mappable cargo incidents in this window. ({total} record{total === 1 ? "" : "s"} — none with an identifiable in-scope country.)
            </div>
          ) : (
            <>
              <div className="relative h-[440px]">
                <MapContainer center={[10, 100]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
                  <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <CargoChoropleth intensity={countryIntensity} />
                  {pointMarkers.map((m) => {
                    const c = ratingColor(m.severity);
                    return (
                      <CircleMarker key={m.id} center={[m.lat, m.lng]} radius={6}
                        pathOptions={{ fillColor: c, color: c, fillOpacity: 0.78, weight: 1.5 }}>
                        <LeafletTooltip>
                          <div className="text-xs">
                            <div className="font-bold">{m.title}</div>
                            <div>{identifyCountry(m.country) ?? "—"} · {m.region} · {m.category}</div>
                          </div>
                        </LeafletTooltip>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
                <ChoroplethLegend />
              </div>
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-sans border-t border-border">
                Countries shaded by cargo-incident count ({rangeText}). {pointMarkers.length > 0
                  ? `${pointMarkers.length} record${pointMarkers.length === 1 ? "" : "s"} with precise coordinates also shown as ${pointMarkers.length === 1 ? "a point" : "points"}.`
                  : "No records in this window carry precise coordinates, so no point markers are shown."}
              </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              By Country · top {Math.min(10, byCountry.length)}{byCountry.length > 10 ? " + other" : ""}
            </div>
            <div style={{ height: Math.max(260, countryBars.length * 30 + 24) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={countryBars} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="country" tickLine={false} axisLine={false} width={110} fontSize={11} interval={0} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#465bff" radius={[0, 2, 2, 0]}>
                    <LabelList dataKey="count" position="right" fontSize={11} fill="#303030" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              By Cargo Category · top {Math.min(10, byCategory.length)} of {byCategory.length}{byCategory.length > 10 ? " + other" : ""}
            </div>
            <div style={{ height: Math.max(300, categoryBars.length * 46 + 24) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryBars} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tickLine={false}
                    axisLine={false}
                    width={150}
                    interval={0}
                    tick={<CategoryAxisTick />}
                  />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#0b0a3d" radius={[0, 2, 2, 0]}>
                    <LabelList dataKey="count" position="right" fontSize={11} fill="#303030" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
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

// Country choropleth layer. Shades each in-scope country polygon by its cargo
// incident count using the sequential brand-blue ramp; zero-count countries are
// left unshaded (outline only). A hover tooltip reports country, count and the
// summed source-stated USD loss. A `key` derived from the current aggregation
// forces a clean re-style whenever the range pill changes the counts.
function CargoChoropleth({ intensity }: { intensity: Map<string, { count: number; usd: number }> }) {
  const geo = cargoScopeCountriesGeo as unknown as FeatureCollection<Geometry, { name?: string }>;
  const styleKey = Array.from(intensity.entries())
    .map(([c, v]) => `${c}:${v.count}`)
    .sort()
    .join("|");

  const style = (feature?: Feature<Geometry, { name?: string }>): PathOptions => {
    const name = feature ? featureCountryName(feature) : "";
    const count = intensity.get(name)?.count ?? 0;
    const fill = countBandColor(count);
    return {
      color: "#8A94A6",
      weight: 0.8,
      fillColor: fill ?? "#000000",
      fillOpacity: fill ? 0.85 : 0,
    };
  };

  const onEachFeature = (feature: Feature<Geometry, { name?: string }>, layer: Layer) => {
    const name = featureCountryName(feature);
    const rec = intensity.get(name);
    const count = rec?.count ?? 0;
    const lossLine = rec && rec.usd > 0
      ? `Est. cargo loss: ${usd(rec.usd)}`
      : "Est. cargo loss: not reported";
    layer.bindTooltip(
      `<div style="font-size:11px"><div style="font-weight:700">${name}</div>` +
        `<div>${count} cargo incident${count === 1 ? "" : "s"}</div>` +
        `<div>${lossLine}</div></div>`,
      { sticky: true },
    );
  };

  return <GeoJSON key={styleKey} data={geo} style={style} onEachFeature={onEachFeature} />;
}

// Compact legend for the count-intensity bands, overlaid on the map.
function ChoroplethLegend() {
  return (
    <div className="absolute bottom-3 right-3 z-[1000] bg-card/95 border border-border rounded-sm px-2.5 py-2 text-[10px] font-sans shadow-sm">
      <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Cargo incidents</div>
      <div className="space-y-0.5">
        {COUNT_BANDS.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-[1px]" style={{ backgroundColor: b.color }} />
            <span className="text-foreground">{b.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[1px] border border-border" style={{ backgroundColor: "transparent" }} />
          <span className="text-muted-foreground">0 (none)</span>
        </div>
      </div>
    </div>
  );
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
