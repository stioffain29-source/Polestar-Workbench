import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip as LeafletTooltip,
  Popup as LeafletPopup,
  useMap,
} from "react-leaflet";
import { Link } from "wouter";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format, parseISO } from "date-fns";
import type { DataCentreFacility } from "@workspace/api-client-react";
import { SEVERITY_LABELS, ratingColor } from "@/lib/topics";
import { displayIncidentTitle } from "@/lib/incidentTitle";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";

// Purpose-built Data-Centre facility overlay map.
//
// Overlays the analyst facility REGISTRY (status-coded pins, recent status
// movers flagged with a ring) against nearby `data_centres` incidents. A
// facility with a `linkedIncidentId` that resolves to a plotted incident is
// tied to it with a connector line.
//
// STRICT no-fabrication: only facilities / incidents that actually carry
// coordinates are plotted. Everything else reads "not reported" and empty
// states say so plainly — nothing is invented to fill the map.

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

// Registry status → brand-safe marker colour (mirrors DataCentres.tsx).
const STATUS_COLOR: Record<string, string> = {
  Operational: "#1B6B7A",
  "Under construction": "#4655FF",
  Approved: "#4655FF",
  Proposed: "#303030",
  "Planning submitted": "#303030",
  "Planning refused": "#A33232",
  Delayed: "#303030",
  Suspended: "#A33232",
  Cancelled: "#A33232",
  Unknown: "#8A94A6",
};
function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? "#8A94A6";
}

function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Minimal shape the overlay needs from an incident.
export type OverlayIncident = {
  id: number;
  title: string;
  displayTitle?: string | null;
  severity: string;
  country?: string | null;
  occurredAt: string;
  latitude?: number | null;
  longitude?: number | null;
  resolvedUrl?: string | null;
  sourceUrl?: string | null;
};

function hasCoords<T extends { latitude?: number | null; longitude?: number | null }>(
  x: T,
): x is T & { latitude: number; longitude: number } {
  return x.latitude != null && x.longitude != null;
}

// Fit the map to every plotted point once they are known.
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 6);
      return;
    }
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }, [map, points]);
  return null;
}

export function DataCentreFacilityMap({
  facilities,
  incidents,
}: {
  facilities: DataCentreFacility[];
  incidents: OverlayIncident[];
}) {
  const facilitiesWithCoords = useMemo(
    () => facilities.filter(hasCoords),
    [facilities],
  );
  const incidentsWithCoords = useMemo(
    () => incidents.filter(hasCoords),
    [incidents],
  );

  // Resolve each facility's linked incident (if it is one of the plotted,
  // coordinate-bearing incidents) so we can draw a connector line.
  const linkedPairs = useMemo(() => {
    const byId = new Map<number, OverlayIncident & { latitude: number; longitude: number }>();
    incidentsWithCoords.forEach((i) => byId.set(i.id, i));
    const pairs: Array<{
      facility: DataCentreFacility & { latitude: number; longitude: number };
      incident: OverlayIncident & { latitude: number; longitude: number };
    }> = [];
    facilitiesWithCoords.forEach((f) => {
      if (f.linkedIncidentId == null) return;
      const inc = byId.get(f.linkedIncidentId);
      if (inc) pairs.push({ facility: f, incident: inc });
    });
    return pairs;
  }, [facilitiesWithCoords, incidentsWithCoords]);

  const linkedIncidentIds = useMemo(
    () => new Set(linkedPairs.map((p) => p.incident.id)),
    [linkedPairs],
  );

  const points = useMemo<Array<[number, number]>>(
    () => [
      ...facilitiesWithCoords.map((f) => [f.latitude, f.longitude] as [number, number]),
      ...incidentsWithCoords.map((i) => [i.latitude, i.longitude] as [number, number]),
    ],
    [facilitiesWithCoords, incidentsWithCoords],
  );

  const moverCount = facilitiesWithCoords.filter((f) => f.statusChanged).length;

  if (facilitiesWithCoords.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground italic">
        No facilities with coordinates on file — location not reported.
      </div>
    );
  }

  return (
    <div>
      <div className="relative h-[460px]">
        <MapContainer
          center={[20, 100]}
          zoom={3}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
          worldCopyJump
        >
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
          />
          <FitBounds points={points} />

          {/* Connector lines: facility → its linked incident */}
          {linkedPairs.map(({ facility, incident }) => (
            <Polyline
              key={`link-${facility.id}-${incident.id}`}
              positions={[
                [facility.latitude, facility.longitude],
                [incident.latitude, incident.longitude],
              ]}
              pathOptions={{ color: "#303030", weight: 1.25, opacity: 0.6, dashArray: "4 4" }}
            />
          ))}

          {/* Incident markers — hollow, severity-coloured, distinct from facilities */}
          {incidentsWithCoords.map((i) => {
            const c = ratingColor(i.severity);
            const linked = linkedIncidentIds.has(i.id);
            const title = displayIncidentTitle(i.title, i.displayTitle);
            const when = (() => {
              try {
                return format(parseISO(i.occurredAt), "dd MMM yyyy");
              } catch {
                return "Date not reported";
              }
            })();
            const url = incidentSourceUrl(i);
            return (
              <CircleMarker
                key={`inc-${i.id}`}
                center={[i.latitude, i.longitude]}
                radius={5}
                pathOptions={{
                  color: c,
                  fillColor: "#ffffff",
                  fillOpacity: 0.95,
                  weight: linked ? 2.5 : 1.75,
                }}
              >
                <LeafletTooltip>
                  <div style={{ fontSize: 11 }}>
                    <div style={{ fontWeight: 700 }}>{title}</div>
                    <div>{i.country || "Country not reported"}</div>
                    <div>Severity: {SEVERITY_LABELS[i.severity] ?? i.severity}</div>
                    <div>{when}</div>
                    {linked && <div style={{ fontWeight: 700, color: "#4655FF" }}>Linked to a tracked facility</div>}
                  </div>
                </LeafletTooltip>
                <LeafletPopup>
                  <div style={{ fontSize: 12, minWidth: 180 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div>
                    <div>{i.country || "Country not reported"}</div>
                    <div>Severity: {SEVERITY_LABELS[i.severity] ?? i.severity}</div>
                    <div>{when}</div>
                    {linked && (
                      <div style={{ fontWeight: 700, color: "#4655FF" }}>Linked to a tracked facility</div>
                    )}
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "inline-block", marginTop: 6, color: "#4655FF", fontWeight: 600 }}
                      >
                        Open source article ↗
                      </a>
                    ) : (
                      <div style={{ marginTop: 6, fontStyle: "italic", color: "#8A94A6" }}>
                        Source link not reported
                      </div>
                    )}
                  </div>
                </LeafletPopup>
              </CircleMarker>
            );
          })}

          {/* Facility pins — status-coloured; recent movers get an outer ring */}
          {facilitiesWithCoords.map((f) => {
            const c = statusColor(f.status);
            return (
              <div key={`fac-wrap-${f.id}`}>
                {f.statusChanged && (
                  <CircleMarker
                    key={`fac-ring-${f.id}`}
                    center={[f.latitude, f.longitude]}
                    radius={11}
                    interactive={false}
                    pathOptions={{ color: "#4655FF", fillOpacity: 0, weight: 2 }}
                  />
                )}
                <CircleMarker
                  key={`fac-${f.id}`}
                  center={[f.latitude, f.longitude]}
                  radius={7}
                  pathOptions={{ color: darken(c), fillColor: c, fillOpacity: FILL_OPACITY, weight: STROKE_WIDTH }}
                >
                  <LeafletTooltip>
                    <div style={{ fontSize: 11 }}>
                      <div style={{ fontWeight: 700 }}>{f.name}</div>
                      <div>{f.operator || "Operator not reported"}</div>
                      <div>{f.city ? `${f.city}, ` : ""}{f.country}</div>
                      <div>Status: {f.status}</div>
                      {f.statusChanged && (
                        <div style={{ fontWeight: 700, color: "#4655FF" }}>
                          Recent status change{f.previousStatus ? ` (from ${f.previousStatus})` : ""}
                        </div>
                      )}
                      {f.planningRisk !== "No known issue" && f.planningRisk !== "Unknown" && (
                        <div>Planning risk: {f.planningRisk}</div>
                      )}
                      {f.capacityMw != null && <div>Capacity: {f.capacityMw} MW</div>}
                    </div>
                  </LeafletTooltip>
                  <LeafletPopup>
                    <div style={{ fontSize: 12, minWidth: 190 }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{f.name}</div>
                      <div>{f.operator || "Operator not reported"}</div>
                      <div>{f.city ? `${f.city}, ` : ""}{f.country}</div>
                      <div>Status: {f.status}</div>
                      {f.statusChanged && (
                        <div style={{ fontWeight: 700, color: "#4655FF" }}>
                          Recent status change{f.previousStatus ? ` (from ${f.previousStatus})` : ""}
                        </div>
                      )}
                      {f.planningRisk !== "No known issue" && f.planningRisk !== "Unknown" && (
                        <div>Planning risk: {f.planningRisk}</div>
                      )}
                      {f.capacityMw != null && <div>Capacity: {f.capacityMw} MW</div>}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                        <Link
                          href={`/registry/data-centres?facility=${f.id}`}
                          style={{ color: "#4655FF", fontWeight: 600 }}
                        >
                          Open in registry →
                        </Link>
                        {f.sourceUrl && (
                          <a
                            href={f.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#4655FF", fontWeight: 600 }}
                          >
                            Open source ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </LeafletPopup>
                </CircleMarker>
              </div>
            );
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="border-t border-border px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-sans text-muted-foreground">
        <LegendSwatch color={STATUS_COLOR.Operational} label="Operational" />
        <LegendSwatch color={STATUS_COLOR["Under construction"]} label="Under construction / Approved" />
        <LegendSwatch color={STATUS_COLOR.Proposed} label="Proposed / Planning / Delayed" />
        <LegendSwatch color={STATUS_COLOR.Cancelled} label="Refused / Suspended / Cancelled" />
        <LegendRing />
        <LegendIncident />
        <LegendLink />
        <span className="ml-auto">
          {facilitiesWithCoords.length} facilit{facilitiesWithCoords.length === 1 ? "y" : "ies"}
          {" · "}
          {incidentsWithCoords.length} incident{incidentsWithCoords.length === 1 ? "" : "s"} mapped
          {moverCount > 0 && ` · ${moverCount} recent mover${moverCount === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-3 rounded-full"
        style={{ background: color, border: `1.5px solid ${darken(color)}` }}
      />
      {label}
    </span>
  );
}

function LegendRing() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3.5 h-3.5 rounded-full"
        style={{ border: "2px solid #4655FF" }}
      />
      Recent status mover
    </span>
  );
}

function LegendIncident() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-3 rounded-full bg-white"
        style={{ border: "1.75px solid #A33232" }}
      />
      Incident (by severity)
    </span>
  );
}

function LegendLink() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-5"
        style={{ borderTop: "1.5px dashed #303030" }}
      />
      Linked incident
    </span>
  );
}
