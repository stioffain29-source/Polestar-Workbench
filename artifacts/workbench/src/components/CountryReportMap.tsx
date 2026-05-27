import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

const SEV_COLOR: Record<string, string> = {
  extreme: "#800000",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#B8C2CC",
};

const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};

const POLAR = "#e2e2e2";
const DUSK = "#363636";
const NAVY = "#0b0a3d";

export interface CountryReportMapProps {
  incidents: CountryFastFactsIncident[];
  /** Optional DOM id used by html2canvas during PDF export. */
  domId?: string;
}

/**
 * Interactive incident map for the Country Report Builder.
 *
 * Uses CartoDB Positron tiles (clean, light, professional basemap, no API
 * key required). Plots incidents that have valid latitude+longitude as
 * severity-coloured circle markers. Records without coordinates are not
 * plotted but remain in totals and tables elsewhere on the page.
 */
export default function CountryReportMap({ incidents, domId }: CountryReportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const plottable = incidents.filter(
    (i) => typeof i.latitude === "number" && typeof i.longitude === "number"
      && !Number.isNaN(i.latitude) && !Number.isNaN(i.longitude),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
      });
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
        },
      ).addTo(mapRef.current);
    }

    const map = mapRef.current;

    // Clear any previously plotted layers (re-render on incidents change).
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) map.removeLayer(layer);
    });

    if (plottable.length === 0) {
      map.setView([0, 120], 2);
      return;
    }

    const latLngs: L.LatLngExpression[] = [];
    for (const i of plottable) {
      const sk = (i.severity ?? "").toLowerCase();
      const color = SEV_COLOR[sk] ?? "#999999";
      const lat = i.latitude as number;
      const lng = i.longitude as number;
      const marker = L.circleMarker([lat, lng], {
        radius: 6,
        weight: 1.5,
        color: "#ffffff",
        fillColor: color,
        fillOpacity: 0.85,
      });
      const label = (i.title ?? "Incident").replace(/</g, "&lt;");
      const loc = (i.location ?? "").trim();
      const sevDisplay = SEV_LABEL[sk] ?? i.severity ?? "";
      marker.bindTooltip(
        `<div style="font-family:Roboto,sans-serif;font-size:11px;color:${DUSK};max-width:240px">
          <div style="font-weight:700;color:${NAVY};margin-bottom:2px">${label}</div>
          ${loc ? `<div>${loc.replace(/</g, "&lt;")}</div>` : ""}
          <div style="margin-top:2px">Severity: <span style="color:${color};font-weight:700">${sevDisplay}</span></div>
        </div>`,
        { direction: "top" },
      );
      marker.addTo(map);
      latLngs.push([lat, lng]);
    }

    // Thin data: zoom tighter so the affected areas are legible instead
    // of being lost inside a large country outline. With one or two
    // points a country-wide framing leaves the report looking empty.
    if (latLngs.length === 1) {
      map.setView(latLngs[0] as L.LatLngTuple, 10);
    } else if (latLngs.length === 2) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40], maxZoom: 11 });
    } else {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24], maxZoom: 9 });
    }
  }, [plottable]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const unplotted = incidents.length - plottable.length;

  return (
    <div>
      <div
        id={domId}
        ref={containerRef}
        style={{
          height: 360,
          width: "100%",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#fafafa",
        }}
      />
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {(["extreme", "high", "moderate", "low", "insignificant"] as const).map((k) => (
          <div key={k} className="flex items-center gap-1.5">
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: SEV_COLOR[k],
                border: `1px solid ${POLAR}`,
              }}
            />
            <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
              {SEV_LABEL[k]}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
      >
        Records without coordinates are included in totals and tables but not plotted on the map.
        {unplotted > 0 ? ` ${unplotted} of ${incidents.length} record${incidents.length === 1 ? "" : "s"} excluded from the map.` : ""}
      </div>
    </div>
  );
}
