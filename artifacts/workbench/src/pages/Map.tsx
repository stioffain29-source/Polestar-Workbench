import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useListIncidents, useListStrikes } from "@workspace/api-client-react";
import { RATING_COLORS, SEVERITY_LABELS, markerStyle } from "@/lib/topics";
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
  "Other",
] as const;

const MARITIME_CATEGORIES = ["Maritime Strike"] as const;
const LAND_CATEGORIES = ["Land Strike"] as const;

function topicToCategory(topic: string): string {
  switch (topic) {
    case "fuel": return "Fuel";
    case "fertiliser": return "Fertiliser";
    case "protests": return "Civil Unrest";
    case "flashpoint": return "Civil Unrest";
    case "energy": return "Energy / Grid";
    case "shipping": return "Shipping";
    case "cargo_watch": return "Cargo";
    default: return "Other";
  }
}

// Deterministic small offset so many incidents sharing a country centroid do
// not stack into a single unreadable marker. Keyed on the incident id, the
// jitter is stable across renders (no random flicker) and tiny (~±0.25°) so
// markers stay within their country.
function jitter(seed: number): [number, number] {
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  const b = Math.sin(seed * 78.233) * 43758.5453;
  const fa = a - Math.floor(a);
  const fb = b - Math.floor(b);
  return [(fa - 0.5) * 0.5, (fb - 0.5) * 0.5];
}

function munitionRating(munition: string): string {
  if (munition === "ballistic_missile" || munition === "cruise_missile") return "extreme";
  if (munition === "drone") return "high";
  if (munition === "mixed") return "moderate";
  return "low";
}

type Point = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  category: string;
  country: string;
  location: string | null;
  when: string;
  rating: string;
  summary: string;
};

export default function MapPage() {
  const [view, setView] = useState<"incidents" | "maritime" | "land">("incidents");
  const [range, setRange] = useState<RangeKey>("1y");
  // Fetch only the records within the selected window. Switching ranges issues a
  // new request (React Query keys on the params) rather than re-filtering a full
  // in-memory list, so the payload stays small as the table grows.
  const days = RANGE_DAYS[range];
  const { data: incidents = [] } = useListIncidents({ days });
  const { data: maritime = [] } = useListStrikes({ theatre: "maritime_hormuz", days });
  const { data: land = [] } = useListStrikes({ theatre: "land_gcc", days });

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
      return incidents
        .filter((i) => i.latitude != null && i.longitude != null)
        .map<Point>((i) => {
          const [dLat, dLng] = jitter(i.id);
          return {
          id: `i-${i.id}`,
          lat: i.latitude! + dLat,
          lng: i.longitude! + dLng,
          title: i.title,
          category: topicToCategory(i.topic),
          country: i.country,
          location: i.location ?? null,
          when: i.occurredAt,
          rating: i.severity,
          summary: i.summary,
          };
        });
    }
    const strikes = view === "maritime" ? maritime : land;
    const fixedCat = view === "maritime" ? "Maritime Strike" : "Land Strike";
    return strikes
      .filter((s) => s.latitude != null && s.longitude != null)
      .map<Point>((s) => ({
        id: `s-${s.id}`,
        lat: s.latitude!,
        lng: s.longitude!,
        title: `${s.munition.replace(/_/g, " ")} · ${s.targetCategory.replace(/_/g, " ")}`,
        category: fixedCat,
        country: s.country,
        location: s.location ?? null,
        when: s.occurredAt,
        rating: munitionRating(s.munition),
        summary: `${s.munition.replace(/_/g, " ")} on ${s.targetCategory.replace(/_/g, " ")} in ${s.country}.`,
      }));
  }, [view, incidents, maritime, land]);

  // The API already returns only records within the selected window, so the
  // fetched set is the windowed set — no client-side date filtering needed.
  const windowedPoints = allPoints;

  const visiblePoints = useMemo(
    () => windowedPoints.filter((p) => activeCategories.has(p.category)),
    [windowedPoints, activeCategories],
  );

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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        <div className="rounded-sm border border-border overflow-hidden" style={{ height: "72vh" }}>
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
              return (
                <CircleMarker
                  key={p.id}
                  center={[p.lat, p.lng]}
                  radius={7}
                  pathOptions={{
                    color: s.stroke,
                    opacity: s.strokeOpacity,
                    weight: s.strokeWidth,
                    fillColor: s.fill,
                    fillOpacity: s.fillOpacity,
                  }}
                >
                  <LeafletTooltip direction="top" offset={[0, -6]}>
                    <div style={{ fontFamily: "Roboto Condensed, sans-serif", maxWidth: 280 }}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#666" }}>
                        {p.category}
                      </div>
                      <div style={{ fontWeight: 700, color: "#0b0a3d", marginTop: 2 }}>{p.title}</div>
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
                    </div>
                  </LeafletTooltip>
                </CircleMarker>
              );
            })}
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
        </span>
      </div>
    </div>
  );
}
