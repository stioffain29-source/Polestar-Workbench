// Static country-intensity choropleth for the Cargo Watch REPORT (preview + PDF).
//
// A non-interactive SVG mirror of the interactive Leaflet choropleth on the
// Cargo Watch monitor. It shades each in-scope country by cargo incident count
// using the SAME shared bands + legend (lib/cargoChoropleth.ts) so the report
// and the monitor never disagree. Rendered as plain SVG <path>/<text> (like
// CargoTrendChart) so html2canvas rasterises it verbatim into the report PDF —
// no Leaflet, no map tiles, no interactivity required.

import type { FeatureCollection, Geometry } from "geojson";
import cargoScopeCountriesGeo from "@/assets/cargoScopeCountries.geo.json";
import {
  COUNT_BANDS,
  countBandColor,
  featureCountryName,
  buildChoroplethProjection,
  featurePath,
  featureCenter,
  type CargoCountryIntensity,
} from "@/lib/cargoChoropleth";

const NAVY = "#0b0a3d";
const DUSK = "#363636";
const BORDER = "#8A94A6";

export interface CargoChoroplethStaticProps {
  intensity: Map<string, CargoCountryIntensity>;
  // Heading wording is driven by the theft-only predicate upstream (spec pt3):
  // "Cargo Theft Incidents by Country" when the map holds theft only, otherwise
  // "Cargo Security Reporting by Country". Defaults to the theft wording.
  title?: string;
}

const geo = cargoScopeCountriesGeo as unknown as FeatureCollection<
  Geometry,
  { name?: string }
>;
const projection = buildChoroplethProjection(geo, 640);

export default function CargoChoroplethStatic({
  intensity,
  title = "Cargo Theft Incidents by Country",
}: CargoChoroplethStaticProps) {
  const { width: W, height: H, project } = projection;

  return (
    <div style={{ fontFamily: "Roboto, sans-serif", color: DUSK }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>
          {title}
        </div>
        <div style={{ fontSize: 11 }}>
          {intensity.size} {intensity.size === 1 ? "country" : "countries"} with incidents
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {geo.features.map((f, idx) => {
          const name = featureCountryName(f);
          const count = intensity.get(name)?.count ?? 0;
          const fill = countBandColor(count);
          return (
            <path
              key={name || idx}
              d={featurePath(f, project)}
              fill={fill ?? "#f2f3f7"}
              fillOpacity={fill ? 0.9 : 1}
              stroke={BORDER}
              strokeWidth={0.6}
            />
          );
        })}
        {geo.features.map((f, idx) => {
          const name = featureCountryName(f);
          const count = intensity.get(name)?.count ?? 0;
          if (count <= 0) return null;
          const c = featureCenter(f, project);
          if (!c) return null;
          // Deep bands get white ink for contrast; the two lightest keep navy.
          const ink = count >= 21 ? "#ffffff" : NAVY;
          return (
            <text
              key={`lbl-${name || idx}`}
              x={c[0]}
              y={c[1]}
              fontSize={11}
              fontWeight={700}
              fill={ink}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {count}
            </text>
          );
        })}
      </svg>
      {/* Legend — mirrors the monitor's count-intensity bands + the "none" swatch. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11 }}>
        <span style={{ fontWeight: 700, color: NAVY, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Cargo incidents
        </span>
        {COUNT_BANDS.map((b) => (
          <span key={b.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 12, background: b.color, display: "inline-block", border: `1px solid ${BORDER}` }} />
            <span style={{ color: DUSK }}>{b.label}</span>
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 12, background: "#f2f3f7", display: "inline-block", border: `1px solid ${BORDER}` }} />
          <span style={{ color: DUSK }}>0 (none)</span>
        </span>
      </div>
    </div>
  );
}
