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
  countBandColor,
  featureCountryName,
  buildChoroplethProjection,
  featurePath,
  featureCenter,
  visibleCountBands,
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

interface PlacedLabel {
  key: string;
  x: number;
  y: number;
  count: number;
}

// Minimum spacing between two count labels before they read as overlapping.
// DY is generous: at font 11 two vertically-stacked labels (Malaysia over
// Indonesia, both anchored on Borneo) read as a cramped cluster well before
// their boxes actually touch.
const LABEL_MIN_DX = 16;
const LABEL_MIN_DY = 22;

/**
 * Build the count-label anchors, then nudge apart any that would overlap.
 * featureCenter anchors on each country's largest polygon, so spread-out
 * neighbours whose biggest landmass shares an island (Indonesia + Malaysia
 * both centroid onto Borneo) would stack their labels. A small deterministic
 * vertical relaxation separates them while keeping preview==PDF.
 */
function resolveLabels(
  fc: FeatureCollection<Geometry, { name?: string }>,
  intensity: Map<string, CargoCountryIntensity>,
  project: (lon: number, lat: number) => [number, number],
  height: number,
): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  fc.features.forEach((f, idx) => {
    const name = featureCountryName(f);
    const count = intensity.get(name)?.count ?? 0;
    if (count <= 0) return;
    const c = featureCenter(f, project);
    if (!c) return;
    labels.push({ key: `lbl-${name || idx}`, x: c[0], y: c[1], count });
  });

  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        const dy = b.y - a.y;
        if (Math.abs(a.x - b.x) < LABEL_MIN_DX && Math.abs(dy) < LABEL_MIN_DY) {
          const push = (LABEL_MIN_DY - Math.abs(dy)) / 2 + 0.5;
          if (dy >= 0) {
            a.y -= push;
            b.y += push;
          } else {
            a.y += push;
            b.y -= push;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Keep nudged labels inside the map frame.
  for (const l of labels) l.y = Math.max(8, Math.min(height - 6, l.y));
  return labels;
}

export default function CargoChoroplethStatic({
  intensity,
  title = "Cargo Theft Incidents by Country",
}: CargoChoroplethStaticProps) {
  const { width: W, height: H, project } = projection;
  let maxCount = 0;
  for (const v of intensity.values()) {
    if (v.count > maxCount) maxCount = v.count;
  }
  const legendBands = visibleCountBands(maxCount);

  return (
    // paddingBottom reserves whitespace UNDER the legend that is captured as
    // part of the rasterised image. In the PDF the whole block (title + map +
    // legend) is one html2canvas image; when the page above it is full the
    // embed scales the image to fill the remaining space down to the footer
    // margin, which otherwise jams the legend against the footer (and lets
    // html2canvas shave the legend's bottom edge). The padding scales with the
    // image, so the legend keeps clearance from the footer in every case. It is
    // the shared preview+PDF component, so parity holds.
    <div style={{ fontFamily: "Roboto, sans-serif", color: DUSK, paddingBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>
          {title}
        </div>
        <div style={{ fontSize: 11 }}>
          {intensity.size} {intensity.size === 1 ? "country" : "countries"} with incidents
        </div>
      </div>
      {/* Rendered at 88% width (centred) rather than full-bleed to keep the
          whole block — title, map, legend — a little shorter, so it more often
          fits the remaining page space naturally instead of being scaled to
          fill it. NOTE: the shrink alone does NOT guarantee footer clearance —
          the PDF embed (embedReactChartInPdf) scales the whole rasterised block
          to fill leftover space down to the footer margin, which overrides the
          SVG size. The paddingBottom on the root div is what actually keeps the
          legend clear of the footer under that fill-scaling. Same shared
          component, so preview==PDF. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="88%"
        style={{ display: "block", margin: "0 auto" }}
      >
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
        {resolveLabels(geo, intensity, project, H).map((l) => {
          // Deep bands get white ink for contrast; the two lightest keep navy.
          const ink = l.count >= 21 ? "#ffffff" : NAVY;
          return (
            <text
              key={l.key}
              x={l.x}
              y={l.y}
              fontSize={11}
              fontWeight={700}
              fill={ink}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {l.count}
            </text>
          );
        })}
      </svg>
      {/* Legend — mirrors the monitor's count-intensity bands + the "none" swatch. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11 }}>
        <span style={{ fontWeight: 700, color: NAVY, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Cargo incidents
        </span>
        {legendBands.map((b) => (
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
