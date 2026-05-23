import { useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useListIncidents, useListStrikes } from "@workspace/api-client-react";
import { RATING_COLORS, SEVERITY_LABELS, markerStyle } from "@/lib/topics";
import { cn } from "@/lib/utils";

function munitionRating(munition: string): string {
  if (munition === "ballistic_missile" || munition === "cruise_missile") return "extreme";
  if (munition === "drone") return "high";
  if (munition === "mixed") return "moderate";
  return "low";
}

export default function MapPage() {
  const [view, setView] = useState<"incidents" | "maritime" | "land">("incidents");
  const { data: incidents = [] } = useListIncidents({});
  const { data: maritime = [] } = useListStrikes({ theatre: "maritime_hormuz" });
  const { data: land = [] } = useListStrikes({ theatre: "land_gcc" });

  const points = useMemo(() => {
    if (view === "incidents") {
      return incidents
        .filter((i) => i.latitude != null && i.longitude != null)
        .map((i) => ({
          id: `i-${i.id}`,
          lat: i.latitude!,
          lng: i.longitude!,
          title: i.title,
          country: i.country,
          when: i.occurredAt,
          rating: i.severity,
        }));
    }
    const strikes = view === "maritime" ? maritime : land;
    return strikes
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({
        id: `s-${s.id}`,
        lat: s.latitude!,
        lng: s.longitude!,
        title: `${s.munition.replace(/_/g, " ")} · ${s.targetCategory.replace(/_/g, " ")}`,
        country: s.country,
        when: s.occurredAt,
        rating: munitionRating(s.munition),
      }));
  }, [view, incidents, maritime, land]);

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight">Geospatial Map</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">APAC and Middle East operating area</p>
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
          {points.map((p) => {
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
                  <div style={{ fontFamily: "Roboto Condensed, sans-serif" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#666" }}>{p.country}</div>
                    <div style={{ fontWeight: 700, color: "#0B0B3D" }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>{new Date(p.when).toLocaleString()}</div>
                  </div>
                </LeafletTooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground font-sans">
        <span>Showing {points.length} markers. Hover for detail.</span>
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
