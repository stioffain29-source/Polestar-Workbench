import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip, Popup as LeafletPopup } from "react-leaflet";
import { displayIncidentTitle } from "@/lib/incidentTitle";
import { UntranslatedBadge } from "@/components/UntranslatedBadge";
import "leaflet/dist/leaflet.css";
import { useLocation } from "wouter";
import {
  useListIncidents,
  useListStrikes,
  useListLiveuamapEvents,
  useListMaritimeSecurityEvents,
  getListLiveuamapEventsQueryKey,
  getListIncidentsQueryKey,
  getListStrikesQueryKey,
  getListMaritimeSecurityEventsQueryKey,
  LiveuamapRegion,
  type LiveuamapEventsResponse,
} from "@workspace/api-client-react";
import { RATING_COLORS, SEVERITY_LABELS, markerStyle } from "@/lib/topics";
import { toMaritimeRow, maritimeTypeSeverityKey } from "@/lib/maritimeSecurity";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { RANGE_DAYS, RANGE_NOTE, type RangeKey } from "@/lib/dateRange";
import { RangeToggle } from "@/components/RangeToggle";

// Date windows offered on the map. Distinct from the topic monitors' default
// set: the map exposes 60d/120d (per request) instead of 90d/180d/2y.
const MAP_RANGES: RangeKey[] = ["24h", "7d", "14d", "30d", "60d", "120d", "1y"];

// Controlled category list per spec.
const INCIDENT_CATEGORIES = [
  "Fuel",
  "Fertiliser",
  "Civil Unrest",
  "Energy / Grid",
  "Shipping",
  "Cargo",
  "Crime",
  "Maritime Security (IMB)",
  "Other",
] as const;

// Category for the standalone ICC/IMB maritime-security layer. These points are
// plotted for geospatial context only — they are NOT incidents and feed no count.
const MARITIME_SECURITY_CATEGORY = "Maritime Security (IMB)";

const MARITIME_CATEGORIES = ["Maritime Strike"] as const;
const LAND_CATEGORIES = ["Land Strike"] as const;

function topicToCategory(topic: string): string {
  switch (topic) {
    case "fuel": return "Fuel";
    case "fertiliser": return "Fertiliser";
    case "protests": return "Civil Unrest";
    case "flashpoint": return "Civil Unrest";
    case "apac_local": return "Civil Unrest";
    case "energy": return "Energy / Grid";
    case "shipping": return "Shipping";
    case "cargo_watch": return "Cargo";
    case "crime": return "Crime";
    default: return "Other";
  }
}

// Incidents that couldn't be geocoded to a specific town/city fall back to
// their country's centroid, so several unrelated incidents can share the
// exact same coordinates. Rather than randomly displacing every point (which
// makes accurately-placed markers look wrong too), only points that truly
// share a coordinate are fanned out into a small ring around that shared
// spot — points with a unique, resolved location are left exactly where they
// belong. Ring position is deterministic (seeded on the shared coordinate),
// so it doesn't flicker between renders.
function spreadOverlapping<T extends { lat: number; lng: number }>(points: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of points) {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const existing = groups.get(key);
    if (existing) existing.push(p);
    else groups.set(key, [p]);
  }
  const result: T[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const n = group.length;
    // Ring grows gently with the number of stacked incidents but stays close
    // enough to the real point to still read as "this country/area".
    const radius = Math.min(0.12 + n * 0.015, 0.4);
    const seedAngle =
      ((Math.abs(group[0].lat) * 1000 + Math.abs(group[0].lng) * 1000) % 360) *
      (Math.PI / 180);
    group.forEach((p, i) => {
      const angle = seedAngle + (2 * Math.PI * i) / n;
      result.push({
        ...p,
        lat: p.lat + Math.sin(angle) * radius,
        lng: p.lng + Math.cos(angle) * radius,
      });
    });
  }
  return result;
}

// An incident keeps the pulsing-ring "new" map treatment indefinitely until
// an analyst explicitly clears it — there is no time cutoff. The cleared set
// is a plain array of marker IDs (`i-123`, `s-456`, `ms-789`) persisted in
// localStorage so it survives reloads and stays scoped to this browser/analyst.
const CLEARED_MARKERS_STORAGE_KEY = "polestar.map.clearedMarkerIds";

function loadClearedMarkerIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CLEARED_MARKERS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveClearedMarkerIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(CLEARED_MARKERS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private browsing, quota) — clearing just won't
    // persist across reloads; the map still works.
  }
}

function munitionRating(munition: string): string {
  if (munition === "ballistic_missile" || munition === "cruise_missile") return "extreme";
  if (munition === "drone") return "high";
  if (munition === "mixed") return "moderate";
  return "low";
}

// Slug -> human label for the Liveuamap region selector (e.g. "hong-kong" ->
// "Hong Kong").
function regionLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Explicit overlay states — a successful fetch always sets fetchedAt; failures
// leave it null so analysts never read an empty layer as "zero live events".
type LiveOverlayPanel =
  | { kind: "loading" }
  | { kind: "unavailable"; title: string; detail: string };

function liveOverlayPanel(live: LiveuamapEventsResponse | undefined): LiveOverlayPanel | null {
  if (!live) return { kind: "loading" };
  if (!live.configured) {
    return {
      kind: "unavailable",
      title: "Liveuamap overlay unavailable",
      detail: "LIVEUAMAP_API_KEY is not configured. The curated incident map is unaffected.",
    };
  }
  if (!live.fetchedAt) {
    return {
      kind: "unavailable",
      title: "Liveuamap overlay unavailable",
      detail:
        "The server could not reach Liveuamap (often an egress IP block on paid API access). Incident markers still work. An operator should ask Liveuamap support to allowlist this deployment's public IP.",
    };
  }
  return null;
}

function liveOverlayActive(live: LiveuamapEventsResponse | undefined): boolean {
  return !!live?.configured && !!live.fetchedAt;
}

type Corroboration = {
  id: number;
  url: string;
  reportTitle: string;
  sourceAgency?: string | null;
};

type Point = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  // English advisory title when the ingest translation produced one; null
  // otherwise. Lets the map flag a headline that is still in a foreign language.
  displayTitle: string | null;
  category: string;
  country: string;
  location: string | null;
  when: string;
  rating: string;
  summary: string;
  corroborations: Corroboration[];
  // GDELT precision-enrichment fields — present only when the GDELT pass matched
  // this incident; the popup shows them when set and is silent otherwise.
  fatalities: number | null;
  actors: string | null;
  gdeltEventType: string | null;
  gdeltSubEventType: string | null;
  gdeltConfidence: number | null;
};

export default function MapPage() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<"incidents" | "maritime" | "land">("incidents");
  const [range, setRange] = useState<RangeKey>("24h");
  // Fetch only the records within the selected window. Switching ranges issues a
  // new request (React Query keys on the params) rather than re-filtering a full
  // in-memory list, so the payload stays small as the table grows.
  const days = RANGE_DAYS[range];
  // Poll every 5 minutes so freshly-ingested incidents/strikes appear on the
  // map throughout the day without requiring a manual page reload.
  const LIVE_REFETCH_MS = 5 * 60 * 1000;
  const incidentsParams = { days };
  const { data: incidents = [], isLoading: incidentsLoading } = useListIncidents(incidentsParams, {
    query: { refetchInterval: LIVE_REFETCH_MS, queryKey: getListIncidentsQueryKey(incidentsParams) },
  });
  const maritimeParams = { theatre: "maritime_hormuz" as const, days };
  const { data: maritime = [] } = useListStrikes(maritimeParams, {
    query: { refetchInterval: LIVE_REFETCH_MS, queryKey: getListStrikesQueryKey(maritimeParams) },
  });
  const landParams = { theatre: "land_gcc" as const, days };
  const { data: land = [] } = useListStrikes(landParams, {
    query: { refetchInterval: LIVE_REFETCH_MS, queryKey: getListStrikesQueryKey(landParams) },
  });
  // Standalone ICC/IMB maritime-security events (current calendar year). Plotted
  // as their own toggleable layer on the incidents tab; never an incident count.
  const maritimeSecurityParams = { limit: 500 };
  const { data: maritimeSecurityEvents = [] } = useListMaritimeSecurityEvents(maritimeSecurityParams, {
    query: {
      refetchInterval: LIVE_REFETCH_MS,
      queryKey: getListMaritimeSecurityEventsQueryKey(maritimeSecurityParams),
    },
  });

  // Cleared markers: an analyst dismisses the pulsing "new" ring by clicking
  // Clear; the ID is remembered in localStorage so it never blinks again on
  // this browser — but any newly-ingested incident that shows up on a later
  // poll starts blinking automatically since its ID has never been cleared.
  const [clearedIds, setClearedIds] = useState<Set<string>>(() => loadClearedMarkerIds());
  const clearMarkers = (ids: string[]) => {
    setClearedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      saveClearedMarkerIds(next);
      return next;
    });
  };

  // Liveuamap live overlay — a separate reference layer, kept apart from the
  // curated incident data. It only fetches while the toggle is on (no paid call
  // otherwise) and refreshes every 5 minutes. The key lives server-side; if it
  // is unconfigured the response reports configured:false and we show a note
  // instead of markers.
  const [liveOn, setLiveOn] = useState(false);
  const [liveRegion, setLiveRegion] = useState<LiveuamapRegion>("asia");
  const liveParams = { region: liveRegion, count: 75 };
  const { data: live } = useListLiveuamapEvents(liveParams, {
    query: {
      enabled: liveOn,
      refetchInterval: liveOn ? 5 * 60 * 1000 : false,
      queryKey: getListLiveuamapEventsQueryKey(liveParams),
    },
  });
  const livePanel = liveOn ? liveOverlayPanel(live) : null;
  const liveMarkersOn = liveOn && liveOverlayActive(live);

  const availableCategories = useMemo<readonly string[]>(() => {
    if (view === "incidents") return INCIDENT_CATEGORIES;
    if (view === "maritime") return MARITIME_CATEGORIES;
    return LAND_CATEGORIES;
  }, [view]);

  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set(INCIDENT_CATEGORIES),
  );

  // When the tab changes, default to all categories of the new tab on.
  useEffect(() => {
    setActiveCategories(new Set(availableCategories));
  }, [availableCategories]);

  const allPoints = useMemo<Point[]>(() => {
    if (view === "incidents") {
      const incidentPoints = incidents
        .filter((i) => i.latitude != null && i.longitude != null)
        .map<Point>((i) => ({
          id: `i-${i.id}`,
          lat: i.latitude!,
          lng: i.longitude!,
          title: i.title,
          displayTitle: i.displayTitle ?? null,
          category: topicToCategory(i.topic),
          country: i.country,
          location: i.location ?? null,
          when: i.occurredAt,
          rating: i.severity,
          summary: i.summary,
          corroborations: i.corroborations ?? [],
          fatalities: i.fatalities ?? null,
          actors: i.actors ?? null,
          gdeltEventType: i.gdeltEventType ?? null,
          gdeltSubEventType: i.gdeltSubEventType ?? null,
          gdeltConfidence: i.gdeltConfidence ?? null,
        }));
      // Append the standalone ICC/IMB maritime-security layer (own category,
      // own colour-by-type-severity). Plotted only where the IMB position is
      // usable. These are NOT incidents and never enter any count.
      const msWindowStart =
        days == null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const maritimePoints = maritimeSecurityEvents
        .map(toMaritimeRow)
        .filter((r) => r.lat != null && r.lng != null)
        .filter((r) => !msWindowStart || (r.date != null && r.date >= msWindowStart))
        .map<Point>((r) => ({
          id: `ms-${r.id}`,
          lat: r.lat!,
          lng: r.lng!,
          title: r.incidentNumber ? `${r.type} · ${r.incidentNumber}` : r.type,
          displayTitle: null,
          category: MARITIME_SECURITY_CATEGORY,
          country: r.country ?? "—",
          location: r.location ?? null,
          when: r.date ? r.date.toISOString() : "",
          rating: maritimeTypeSeverityKey(r.type),
          summary: r.narrative ?? `${r.type} reported by the ICC IMB Piracy Reporting Centre.`,
          corroborations: [],
          fatalities: null,
          actors: null,
          gdeltEventType: null,
          gdeltSubEventType: null,
          gdeltConfidence: null,
        }));
      return spreadOverlapping([...incidentPoints, ...maritimePoints]);
    }
    const strikes = view === "maritime" ? maritime : land;
    const fixedCat = view === "maritime" ? "Maritime Strike" : "Land Strike";
    return spreadOverlapping(strikes
      .filter((s) => s.latitude != null && s.longitude != null)
      .map<Point>((s) => ({
        id: `s-${s.id}`,
        lat: s.latitude!,
        lng: s.longitude!,
        title: `${s.munition.replace(/_/g, " ")} · ${s.targetCategory.replace(/_/g, " ")}`,
        displayTitle: null,
        category: fixedCat,
        country: s.country,
        location: s.location ?? null,
        when: s.occurredAt,
        rating: munitionRating(s.munition),
        summary: `${s.munition.replace(/_/g, " ")} on ${s.targetCategory.replace(/_/g, " ")} in ${s.country}.`,
        corroborations: [],
        fatalities: null,
        actors: null,
        gdeltEventType: null,
        gdeltSubEventType: null,
        gdeltConfidence: null,
      })));
  }, [view, incidents, maritime, land, maritimeSecurityEvents]);

  // The API already returns only records within the selected window, so the
  // fetched set is the windowed set — no client-side date filtering needed.
  const windowedPoints = allPoints;

  const visiblePoints = useMemo(
    () => windowedPoints.filter((p) => activeCategories.has(p.category)),
    [windowedPoints, activeCategories],
  );

  // Markers currently on screen that haven't been cleared yet — these are the
  // ones pulsing. Recomputed whenever the visible set or cleared set changes,
  // so a fresh ingest poll (new IDs) or a Clear click both update the count.
  const newMarkerIds = useMemo(
    () => visiblePoints.filter((p) => !clearedIds.has(p.id)).map((p) => p.id),
    [visiblePoints, clearedIds],
  );

  // Refs to the live Leaflet CircleMarker instances, keyed by incident id.
  // Leaflet's SVG renderer only applies pathOptions.className once, at the
  // moment a marker's underlying <path> is first created (_initPath). Every
  // later style update (which is how React-Leaflet applies pathOptions on
  // re-render) goes through setStyle(), which only touches stroke/fill
  // attributes and never touches the CSS class list. So passing
  // `className: isNew ? "map-dot-blink" : undefined` through pathOptions is
  // silently a no-op after mount — confirmed by reproducing this exact
  // pattern against the real react-leaflet + leaflet libraries. Instead we
  // grab the real marker instances via ref and toggle classList directly.
  // Leaflet's own Path type doesn't publicly declare `_path` (it's an
  // internal implementation detail), so we narrow to just what we read.
  type PathLikeInstance = { _path?: SVGPathElement } | null;
  const dotPathRefs = useRef<Record<string, PathLikeInstance>>({});
  const ringPathRefs = useRef<Record<string, PathLikeInstance>>({});

  useEffect(() => {
    const newIdSet = new Set(newMarkerIds);
    for (const [id, marker] of Object.entries(dotPathRefs.current)) {
      const path = marker?._path;
      if (path) path.classList.toggle("map-dot-blink", newIdSet.has(id));
    }
    for (const marker of Object.values(ringPathRefs.current)) {
      // The ring marker is only ever mounted while its incident is new (see
      // the `{isNew && (...)}` guard below), so if it exists it should pulse.
      const path = marker?._path;
      if (path) path.classList.add("map-pulse-ring");
    }
  }, [newMarkerIds]);

  function toggle(cat: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight">Geospatial Map</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">APAC and Middle East operating area</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider font-serif font-medium text-muted-foreground">
              Range
            </span>
            <RangeToggle range={range} onChange={setRange} keys={MAP_RANGES} />
          </div>
          <div className="flex border border-border rounded-sm overflow-hidden">
            {(["incidents", "maritime", "land"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-4 py-2 text-xs uppercase tracking-wider font-serif font-medium",
                  view === v ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted",
                )}
              >
                {v === "incidents" ? "Incidents" : v === "maritime" ? "Maritime Strikes" : "Land Strikes"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLiveOn((on) => !on)}
              className={cn(
                "px-4 py-2 text-xs uppercase tracking-wider font-serif font-medium border rounded-sm",
                liveOn && livePanel?.kind === "unavailable"
                  ? "bg-orange-100 text-orange-900 border-orange-200"
                  : liveOn
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-card hover:bg-muted border-border",
              )}
            >
              Live (Liveuamap)
            </button>
            {liveOn && (
              <select
                value={liveRegion}
                onChange={(e) => setLiveRegion(e.target.value as LiveuamapRegion)}
                className="px-2 py-2 text-xs font-sans border border-border rounded-sm bg-card"
              >
                {Object.values(LiveuamapRegion).map((r) => (
                  <option key={r} value={r}>
                    {regionLabel(r)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        <div className="relative rounded-sm border border-border overflow-hidden" style={{ height: "72vh" }}>
          {!incidentsLoading && windowedPoints.length === 0 && (
            <div
              className="absolute inset-0 z-[900] flex items-center justify-center bg-background/55 pointer-events-none"
              aria-live="polite"
            >
              <div className="pointer-events-auto mx-4 max-w-md rounded-sm border border-border bg-card px-5 py-4 text-center shadow-none">
                <p className="font-serif text-sm font-bold uppercase tracking-wide text-primary">
                  No {view === "incidents" ? "incidents" : view === "maritime" ? "maritime strikes" : "land strikes"} recorded
                </p>
                <p className="mt-2 text-[12px] font-sans leading-relaxed text-muted-foreground">
                  Nothing landed in this feed for {RANGE_NOTE[range]}. Widen the range above, or use Run Ingest Now on the Source Health page to force a fresh pull.
                </p>
              </div>
            </div>
          )}
          {livePanel && (
            <div
              className={cn(
                "absolute inset-0 z-[1000] flex pointer-events-none",
                livePanel.kind === "unavailable"
                  ? "items-center justify-center bg-background/55"
                  : "items-start justify-center pt-3",
              )}
              aria-live="polite"
            >
              {livePanel.kind === "loading" ? (
                <p className="rounded-sm border border-border bg-card/95 px-3 py-1.5 text-[11px] font-sans text-muted-foreground shadow-none">
                  Checking Liveuamap overlay…
                </p>
              ) : (
                <div className="pointer-events-auto mx-4 max-w-md rounded-sm border border-border bg-card px-5 py-4 text-center shadow-none">
                  <p className="font-serif text-sm font-bold uppercase tracking-wide text-primary">
                    {livePanel.title}
                  </p>
                  <p className="mt-2 text-[12px] font-sans leading-relaxed text-muted-foreground">
                    {livePanel.detail}
                  </p>
                </div>
              )}
            </div>
          )}
          <MapContainer
            center={[15, 80]}
            zoom={4}
            minZoom={2}
            scrollWheelZoom
            worldCopyJump
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              subdomains={["a", "b", "c", "d"]}
            />
            {visiblePoints.map((p) => {
              const s = markerStyle(p.rating);
              const isNew = !clearedIds.has(p.id);
              return (
                <Fragment key={p.id}>
                {isNew && (
                  <CircleMarker
                    key={`${p.id}-pulse`}
                    ref={(instance) => {
                      // Leaflet only applies pathOptions.className at initial
                      // path creation (_initPath), never on later setStyle()
                      // calls — so React-Leaflet's pathOptions.className is
                      // silently dropped. Set the CSS class directly on the
                      // underlying SVG path instead.
                      if (instance) ringPathRefs.current[p.id] = instance as unknown as PathLikeInstance;
                      else delete ringPathRefs.current[p.id];
                    }}
                    center={[p.lat, p.lng]}
                    radius={7}
                    interactive={false}
                    pathOptions={{
                      color: s.stroke,
                      weight: 2,
                      fillOpacity: 0,
                    }}
                  />
                )}
                <CircleMarker
                  key={p.id}
                  ref={(instance) => {
                    if (instance) dotPathRefs.current[p.id] = instance as unknown as PathLikeInstance;
                    else delete dotPathRefs.current[p.id];
                  }}
                  center={[p.lat, p.lng]}
                  radius={7}
                  pathOptions={{
                    color: s.stroke,
                    opacity: s.strokeOpacity,
                    weight: s.strokeWidth,
                    fillColor: s.fill,
                    fillOpacity: s.fillOpacity,
                  }}
                  eventHandlers={
                    isNew ? { click: () => clearMarkers([p.id]) } : undefined
                  }
                >
                  <LeafletTooltip direction="top" offset={[0, -6]}>
                    <div style={{ fontFamily: "Roboto Condensed, sans-serif", maxWidth: 280 }}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#666" }}>
                        {p.category}
                      </div>
                      <div style={{ fontWeight: 700, color: "#0b0a3d", marginTop: 2 }}>
                        {displayIncidentTitle(p.title, p.displayTitle)}
                        {p.id.startsWith("i-") && (
                          <UntranslatedBadge title={p.title} displayTitle={p.displayTitle} className="ml-1.5" />
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#363636", marginTop: 4 }}>
                        <div>
                          <strong>Country:</strong> {p.country}
                          {p.location ? ` · ${p.location}` : ""}
                        </div>
                        <div>
                          <strong>Date:</strong> {format(new Date(p.when), "dd MMM yyyy HH:mm")}
                        </div>
                        <div>
                          <strong>Risk:</strong> {SEVERITY_LABELS[p.rating] ?? p.rating}
                        </div>
                      </div>
                      {p.summary && (
                        <div style={{ fontSize: 11, color: "#363636", marginTop: 6, lineHeight: 1.35 }}>
                          {p.summary.length > 220 ? `${p.summary.slice(0, 217)}…` : p.summary}
                        </div>
                      )}
                      {p.corroborations.length > 0 && (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#4655FF",
                          }}
                        >
                          Corroborated by UN OCHA (ReliefWeb)
                        </div>
                      )}
                    </div>
                  </LeafletTooltip>
                  {p.id.startsWith("i-") && (
                    <LeafletPopup>
                      <div style={{ fontFamily: "Roboto Condensed, sans-serif", maxWidth: 240 }}>
                        <div style={{ fontWeight: 700, color: "#0b0a3d" }}>
                          {displayIncidentTitle(p.title, p.displayTitle)}
                          <UntranslatedBadge title={p.title} displayTitle={p.displayTitle} className="ml-1.5" />
                        </div>
                        {p.corroborations.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                color: "#4655FF",
                              }}
                            >
                              Corroborated by UN OCHA (ReliefWeb)
                            </div>
                            <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
                              {p.corroborations.map((c) => (
                                <li key={c.id} style={{ marginTop: 2 }}>
                                  <a
                                    href={c.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: 11, color: "#4655FF", textDecoration: "underline" }}
                                  >
                                    {c.sourceAgency ?? c.reportTitle}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {(p.fatalities != null ||
                          p.actors ||
                          p.gdeltEventType ||
                          p.gdeltSubEventType ||
                          p.gdeltConfidence != null) && (
                          <div style={{ marginTop: 6 }}>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                color: "#4655FF",
                              }}
                            >
                              GDELT structured coding
                            </div>
                            <div style={{ fontSize: 11, color: "#363636", marginTop: 2, lineHeight: 1.35 }}>
                              {p.fatalities != null && (
                                <div>
                                  <strong>Fatalities:</strong> {p.fatalities}
                                </div>
                              )}
                              {p.actors && (
                                <div>
                                  <strong>Actors:</strong> {p.actors}
                                </div>
                              )}
                              {(p.gdeltEventType || p.gdeltSubEventType) && (
                                <div>
                                  <strong>Event:</strong>{" "}
                                  {[p.gdeltEventType, p.gdeltSubEventType].filter(Boolean).join(" · ")}
                                </div>
                              )}
                              {p.gdeltConfidence != null && (
                                <div>
                                  <strong>Confidence:</strong> {Math.round(p.gdeltConfidence * 100)}%
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => setLocation(`/spot-reports/new?incidentId=${p.id.slice(2)}`)}
                          style={{
                            marginTop: 8,
                            background: "#4655FF",
                            color: "#fff",
                            border: "none",
                            borderRadius: 2,
                            padding: "6px 10px",
                            fontSize: 12,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            cursor: "pointer",
                          }}
                        >
                          Create Spot Report
                        </button>
                      </div>
                    </LeafletPopup>
                  )}
                </CircleMarker>
                </Fragment>
              );
            })}
            {liveMarkersOn &&
              live!.events.map((e) => (
                <CircleMarker
                  key={`lua-${e.id}`}
                  center={[e.lat, e.lng]}
                  radius={6}
                  pathOptions={{
                    color: "#4655FF",
                    opacity: 0.95,
                    weight: 2,
                    fillColor: "#4655FF",
                    fillOpacity: 0.55,
                  }}
                >
                  <LeafletTooltip direction="top" offset={[0, -6]}>
                    <div style={{ fontFamily: "Roboto Condensed, sans-serif", maxWidth: 280 }}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#4655FF" }}>
                        Liveuamap
                      </div>
                      <div style={{ fontWeight: 700, color: "#0b0a3d", marginTop: 2 }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: "#363636", marginTop: 4 }}>
                        {e.location && (
                          <div>
                            <strong>Location:</strong> {e.location}
                          </div>
                        )}
                        <div>
                          <strong>Time:</strong> {format(new Date(e.time), "dd MMM yyyy HH:mm")}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>Data: Liveuamap</div>
                    </div>
                  </LeafletTooltip>
                  {e.link && (
                    <LeafletPopup>
                      <div style={{ fontFamily: "Roboto Condensed, sans-serif", maxWidth: 240 }}>
                        <div style={{ fontWeight: 700, color: "#0b0a3d" }}>{e.name}</div>
                        <a
                          href={e.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 11,
                            color: "#4655FF",
                            textDecoration: "underline",
                            display: "inline-block",
                            marginTop: 6,
                          }}
                        >
                          {e.source ?? "Open source"}
                        </a>
                        <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>Data: Liveuamap</div>
                      </div>
                    </LeafletPopup>
                  )}
                </CircleMarker>
              ))}
          </MapContainer>
        </div>

        <aside className="bg-card border border-border rounded-sm p-4 h-fit">
          <div className="font-serif font-bold uppercase text-primary text-sm tracking-wide mb-1">Categories</div>
          <div className="text-[11px] font-sans text-muted-foreground mb-3">
            Showing {visiblePoints.length} of {windowedPoints.length} markers · {RANGE_NOTE[range]}
          </div>
          <div className="space-y-2">
            {availableCategories.map((cat) => {
              const checked = activeCategories.has(cat);
              return (
                <label key={cat} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(cat)}
                    className="h-4 w-4 accent-accent"
                  />
                  <span>{cat}</span>
                </label>
              );
            })}
          </div>
          {liveOn && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="font-serif font-bold uppercase text-primary text-sm tracking-wide mb-1">Liveuamap</div>
              {livePanel?.kind === "loading" ? (
                <div className="text-[11px] font-sans text-muted-foreground">Checking live layer…</div>
              ) : livePanel?.kind === "unavailable" ? (
                <div className="text-[11px] font-sans text-muted-foreground">{livePanel.detail}</div>
              ) : live ? (
                <div className="text-[11px] font-sans text-muted-foreground">
                  {live.events.length} live events · {regionLabel(liveRegion)}
                  {live.cached ? " · cached" : ""}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground font-sans">
        <span className="inline-flex items-center gap-4">
          {(["extreme", "high", "moderate", "low", "insignificant"] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor: RATING_COLORS[r],
                  opacity: 0.78,
                  border: `1.5px solid ${RATING_COLORS[r]}`,
                }}
              />
              {SEVERITY_LABELS[r]}
            </span>
          ))}
          {liveMarkersOn && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: "#4655FF", opacity: 0.78, border: "1.5px solid #4655FF" }}
              />
              Liveuamap (live)
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="map-dot-blink w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: RATING_COLORS.high }}
            />
            New{newMarkerIds.length > 0 ? ` (${newMarkerIds.length})` : ""}
          </span>
          {newMarkerIds.length > 0 && (
            <button
              type="button"
              onClick={() => clearMarkers(newMarkerIds)}
              className="rounded-sm border border-border px-2 py-0.5 text-[11px] font-sans text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Stop the pulsing ring on every currently visible new marker"
            >
              Clear all new
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
