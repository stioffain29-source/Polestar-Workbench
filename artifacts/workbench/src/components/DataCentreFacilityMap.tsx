import { useEffect, useMemo, useRef, useState } from "react";
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

// Purpose-built Data-Centre facility OPERATIONAL map.
//
// Overlays the analyst facility REGISTRY (status-coded pins, recent status
// movers flagged with a ring) against nearby `data_centres` incidents. The
// incident feed is a SEPARATE layer the analyst can switch on or off
// independently of the facility registry; a facility with a `linkedIncidentId`
// that resolves to a plotted incident is tied to it with a connector line
// (its own toggle).
//
// This is an interactive on-screen tool (scroll-zoom, hover tooltips, click
// popups) — it is NOT a PDF surface.
//
// STRICT no-fabrication: only facilities / incidents that actually carry
// coordinates are plotted. Everything else reads "not reported" and empty
// states say so plainly — nothing is invented to fill the map.

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

// Fallback marker colour for any status not explicitly mapped below.
export const STATUS_FALLBACK_COLOR = "#8A94A6";

// Registry status → brand-safe marker colour (mirrors DataCentres.tsx).
export const STATUS_COLOR: Record<string, string> = {
  Operational: "#1B6B7A",
  "Under construction": "#465bff",
  Approved: "#465bff",
  Proposed: "#363636",
  "Planning submitted": "#363636",
  "Planning refused": "#A33232",
  Delayed: "#363636",
  Suspended: "#A33232",
  Cancelled: "#A33232",
  Unknown: "#8A94A6",
};
export function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? STATUS_FALLBACK_COLOR;
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

// Fit the map to the supplied points ONCE. Re-fitting on every layer toggle
// would jump the view around, so we frame the full picture on first load and
// then leave the analyst in control of pan/zoom.
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    fitted.current = true;
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
  heightClass = "h-[68vh] min-h-[520px]",
}: {
  facilities: DataCentreFacility[];
  incidents: OverlayIncident[];
  heightClass?: string;
}) {
  const facilitiesWithCoords = useMemo(
    () => facilities.filter(hasCoords),
    [facilities],
  );
  const incidentsWithCoords = useMemo(
    () => incidents.filter(hasCoords),
    [incidents],
  );

  // Layer visibility — the incident feed is a SEPARATE operational layer,
  // toggled independently of the facility registry.
  const [showFacilities, setShowFacilities] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showConnectors, setShowConnectors] = useState(true);

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

  // Frame to EVERY plotted point once, regardless of current toggles.
  const allPoints = useMemo<Array<[number, number]>>(
    () => [
      ...facilitiesWithCoords.map((f) => [f.latitude, f.longitude] as [number, number]),
      ...incidentsWithCoords.map((i) => [i.latitude, i.longitude] as [number, number]),
    ],
    [facilitiesWithCoords, incidentsWithCoords],
  );

  const moverCount = facilitiesWithCoords.filter((f) => f.statusChanged).length;
  const connectorsDisabled =
    !showFacilities || !showIncidents || linkedPairs.length === 0;

  if (facilitiesWithCoords.length === 0 && incidentsWithCoords.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground italic">
        No facilities or incidents with coordinates on file — location not reported.
      </div>
    );
  }

  return (
    <div>
      {/* Layer controls — facilities / incidents / linked connectors */}
      <div className="border-b border-border px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-sans">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Layers
        </span>
        <LayerToggle
          checked={showFacilities}
          onChange={setShowFacilities}
          label={`Facilities (${facilitiesWithCoords.length})`}
          swatch={
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{
                background: STATUS_COLOR.Operational,
                border: `1.5px solid ${darken(STATUS_COLOR.Operational)}`,
              }}
            />
          }
        />
        <LayerToggle
          checked={showIncidents}
          onChange={setShowIncidents}
          label={`Incidents (${incidentsWithCoords.length})`}
          swatch={
            <span
              className="inline-block w-3 h-3 rounded-full bg-white"
              style={{ border: "1.75px solid #A33232" }}
            />
          }
        />
        <LayerToggle
          checked={showConnectors}
          onChange={setShowConnectors}
          disabled={connectorsDisabled}
          label={`Linked connectors (${linkedPairs.length})`}
          swatch={
            <span
              className="inline-block w-5"
              style={{ borderTop: "1.5px dashed #363636" }}
            />
          }
        />
      </div>

      <div className={`relative ${heightClass}`}>
        <MapContainer
          center={[20, 100]}
          zoom={3}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
          worldCopyJump
        >
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
          />
          <FitBounds points={allPoints} />

          {/* Connector lines: facility → its linked incident (own toggle) */}
          {showFacilities &&
            showIncidents &&
            showConnectors &&
            linkedPairs.map(({ facility, incident }) => (
              <Polyline
                key={`link-${facility.id}-${incident.id}`}
                positions={[
                  [facility.latitude, facility.longitude],
                  [incident.latitude, incident.longitude],
                ]}
                pathOptions={{ color: "#363636", weight: 1.25, opacity: 0.6, dashArray: "4 4" }}
              />
            ))}

          {/* Incident markers — hollow, severity-coloured, distinct from facilities */}
          {showIncidents &&
            incidentsWithCoords.map((i) => {
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
                      {linked && (
                        <div style={{ fontWeight: 700, color: "#465bff" }}>
                          Linked to a tracked facility
                        </div>
                      )}
                    </div>
                  </LeafletTooltip>
                  <LeafletPopup>
                    <div style={{ fontSize: 12, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div>
                      <div>{i.country || "Country not reported"}</div>
                      <div>Severity: {SEVERITY_LABELS[i.severity] ?? i.severity}</div>
                      <div>{when}</div>
                      {linked && (
                        <div style={{ fontWeight: 700, color: "#465bff" }}>
                          Linked to a tracked facility
                        </div>
                      )}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-block", marginTop: 6, color: "#465bff", fontWeight: 600 }}
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
          {showFacilities &&
            facilitiesWithCoords.map((f) => {
              const c = statusColor(f.status);
              return (
                <div key={`fac-wrap-${f.id}`}>
                  {f.statusChanged && (
                    <CircleMarker
                      key={`fac-ring-${f.id}`}
                      center={[f.latitude, f.longitude]}
                      radius={11}
                      interactive={false}
                      pathOptions={{ color: "#465bff", fillOpacity: 0, weight: 2 }}
                    />
                  )}
                  <CircleMarker
                    key={`fac-${f.id}`}
                    center={[f.latitude, f.longitude]}
                    radius={7}
                    pathOptions={{ color: darken(c), fillColor: c, fillOpacity: FILL_OPACITY, weight: STROKE_WIDTH }}
                  >
                    <LeafletTooltip>
                      <FacilityInfo f={f} />
                    </LeafletTooltip>
                    <LeafletPopup>
                      <div style={{ minWidth: 190 }}>
                        <FacilityInfo f={f} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                          <Link
                            href={`/registry/data-centres?facility=${f.id}`}
                            style={{ color: "#465bff", fontWeight: 600, fontSize: 12 }}
                          >
                            Open in registry →
                          </Link>
                          {f.sourceUrl && (
                            <a
                              href={f.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#465bff", fontWeight: 600, fontSize: 12 }}
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
        <LegendSwatch color={STATUS_FALLBACK_COLOR} label="Unknown / unclassified" />
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

// Shared facility detail block — used in both the hover tooltip and the click
// popup so they never drift. Every unknown reads "not reported" (no fabrication).
function FacilityInfo({
  f,
}: {
  f: DataCentreFacility & { latitude: number; longitude: number };
}) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700, fontSize: 12 }}>{f.name}</div>
      <div>{f.operator || "Operator not reported"}</div>
      <div>
        {f.city ? `${f.city}, ` : ""}
        {f.country}
      </div>
      <div>Type: {f.facilityType}</div>
      <div>Status: {f.status}</div>
      {f.statusChanged && (
        <div style={{ fontWeight: 700, color: "#465bff" }}>
          Recent status change{f.previousStatus ? ` (from ${f.previousStatus})` : ""}
        </div>
      )}
      {f.planningRisk !== "No known issue" && f.planningRisk !== "Unknown" && (
        <div>Planning risk: {f.planningRisk}</div>
      )}
      <div>Capacity: {f.capacityMw != null ? `${f.capacityMw} MW` : "not reported"}</div>
      {f.itLoadMw != null && <div>IT load: {f.itLoadMw} MW</div>}
    </div>
  );
}

function LayerToggle({
  checked,
  onChange,
  label,
  swatch,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  swatch?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 select-none ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5"
        style={{ accentColor: "#465bff" }}
      />
      {swatch}
      <span className="text-foreground">{label}</span>
    </label>
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
        style={{ border: "2px solid #465bff" }}
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
        style={{ borderTop: "1.5px dashed #363636" }}
      />
      Linked incident
    </span>
  );
}
