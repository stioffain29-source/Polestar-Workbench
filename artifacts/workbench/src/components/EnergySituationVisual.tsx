/**
 * Static Energy Situation country visual shared by the report preview and PDF.
 *
 * The monitor's CountryChoroplethMap is intentionally interactive Leaflet and
 * cannot be mounted by the PDF export's off-screen renderer. This component
 * uses the same world GeoJSON and count-band primitives as that monitor, but
 * emits plain SVG so html2canvas can rasterise it deterministically.
 */

import type { FeatureCollection, Geometry } from "geojson";
import cargoScopeCountriesGeo from "@/assets/cargoScopeCountries.geo.json";
import monitorChoroplethExtrasGeo from "@/assets/monitorChoroplethExtras.geo.json";
import worldChoroplethExtrasGeo from "@/assets/worldChoroplethExtras.geo.json";
import {
  COUNT_BANDS,
  countBandColor,
  featureCountryName,
  buildChoroplethProjection,
  featurePath,
} from "@/lib/cargoChoropleth";

const DUSK = "#363636";
const NAVY = "#0b0a3d";
const POLAR = "#e2e2e2";
const BORDER = "#8A94A6";
const EMPTY_FILL = "#f2f3f7";

type CountryFeatureProperties = { name?: string };
type CountryGeo = FeatureCollection<Geometry, CountryFeatureProperties>;

// Keep this scope identical to CountryChoroplethMap's world scope. The
// intensity map is built upstream from the existing in-window country counts;
// this component only projects and paints those already-selected values.
const cargoGeo = cargoScopeCountriesGeo as unknown as CountryGeo;
const monitorGeo = monitorChoroplethExtrasGeo as unknown as CountryGeo;
const worldExtrasGeo = worldChoroplethExtrasGeo as unknown as CountryGeo;
const worldGeo: CountryGeo = {
  type: "FeatureCollection",
  features: [
    ...cargoGeo.features,
    ...monitorGeo.features,
    ...worldExtrasGeo.features,
  ],
};
// Keep the source SVG just below the PDF body column width (515pt). The PDF
// rasteriser replaces SVGs with canvases at their viewBox size; this avoids
// clipping the right side of the map in the off-screen export host while the
// browser still scales it fluidly to the wider preview column.
const projection = buildChoroplethProjection(worldGeo, 500);

export interface EnergySituationVisualProps {
  intensity: Map<string, number>;
  /** Height of the map viewport in pixels. Preview uses 300; PDF uses 220. */
  mapHeight?: number;
}

export function EnergySituationVisual({
  intensity,
  mapHeight = 300,
}: EnergySituationVisualProps) {
  if (intensity.size === 0) {
    return (
      <div
        style={{
          color: DUSK,
          fontFamily: "Roboto, sans-serif",
          fontSize: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        No identified countries available for this view.
      </div>
    );
  }

  return (
    <div
      style={{
        color: DUSK,
        fontFamily: "Roboto, sans-serif",
        width: "100%",
      }}
    >
      <svg
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        width="100%"
        height={mapHeight}
        preserveAspectRatio="xMidYMid meet"
        style={{
          background: "#f8f9fb",
          border: `1px solid ${POLAR}`,
          boxSizing: "border-box",
          display: "block",
        }}
      >
        <rect
          x="0"
          y="0"
          width={projection.width}
          height={projection.height}
          fill="#f8f9fb"
        />
        {worldGeo.features.map((feature, index) => {
          const country = featureCountryName(feature);
          const count = intensity.get(country) ?? 0;
          const fill = countBandColor(count);
          return (
            <path
              key={`${country || "country"}-${index}`}
              d={featurePath(feature, projection.project)}
              fill={fill ?? EMPTY_FILL}
              fillOpacity={fill ? 0.9 : 1}
              stroke={BORDER}
              strokeWidth={0.6}
            />
          );
        })}
      </svg>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          padding: "8px 4px 2px",
          fontSize: 10,
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            color: NAVY,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Energy incidents
        </span>
        {COUNT_BANDS.map((band) => (
          <span
            key={band.label}
            style={{ alignItems: "center", display: "inline-flex", gap: 4 }}
          >
            <span
              style={{
                background: band.color,
                border: `1px solid ${BORDER}`,
                display: "inline-block",
                height: 10,
                width: 10,
              }}
            />
            <span>{band.label}</span>
          </span>
        ))}
        <span style={{ alignItems: "center", display: "inline-flex", gap: 4 }}>
          <span
            style={{
              background: "transparent",
              border: `1px solid ${BORDER}`,
              display: "inline-block",
              height: 10,
              width: 10,
            }}
          />
          <span>0 (none)</span>
        </span>
      </div>
    </div>
  );
}

export default EnergySituationVisual;