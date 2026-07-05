// Shared Cargo Watch country-intensity choropleth primitives.
//
// The SINGLE source of truth for the count-intensity colour bands, the legend,
// and the country-name lookup that shades each in-scope country. Both the
// interactive Leaflet map on the Cargo Watch MONITOR (pages/CargoWatch.tsx) and
// the STATIC SVG choropleth in the Cargo Watch REPORT preview + PDF
// (components/CargoChoroplethStatic.tsx) read these so their shading can never
// disagree.
//
// The ramp is a single sequential brand-blue sequence (light -> Midnight Blue).
// It is DELIBERATELY DISTINCT from the reserved five-tier severity colours —
// count concentration is a separate, neutral scale, never a risk read.

import type { Feature, FeatureCollection, Geometry } from "geojson";

export const COUNT_BANDS: Array<{ min: number; label: string; color: string }> = [
  { min: 1, label: "1–5", color: "#DCE0FF" },
  { min: 6, label: "6–20", color: "#A9B2FF" },
  { min: 21, label: "21–50", color: "#6E7BFF" },
  { min: 51, label: "51–100", color: "#2E3BC7" },
  { min: 101, label: "100+", color: "#0B0B3D" },
];

/** Colour for a country's incident count. Zero incidents stay unshaded (null). */
export function countBandColor(count: number): string | null {
  let color: string | null = null;
  for (const b of COUNT_BANDS) {
    if (count >= b.min) color = b.color;
  }
  return color;
}

/**
 * Canonical name a choropleth polygon feature carries (matches the app's
 * display-country names, e.g. "UAE", "South Korea").
 */
export function featureCountryName(
  f: Feature<Geometry, { name?: string }>,
): string {
  return f.properties?.name ?? "";
}

/** Per-country choropleth aggregate: incident count + summed source-stated USD. */
export interface CargoCountryIntensity {
  count: number;
  usd: number;
}

// ---------------------------------------------------------------------------
// Static projection — a simple equirectangular projection with a cos(lat)
// east-west correction. No d3-geo dependency; the geometry is drawn as plain
// SVG <path> elements so html2canvas rasterises it verbatim (the report PDF
// rasterises the on-screen DOM), unlike recharts/Leaflet canvas panes.
// ---------------------------------------------------------------------------

interface BBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function extendBBoxFromCoords(coords: unknown, box: BBox): void {
  if (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    const lon = coords[0];
    const lat = coords[1];
    if (lon < box.minLon) box.minLon = lon;
    if (lon > box.maxLon) box.maxLon = lon;
    if (lat < box.minLat) box.minLat = lat;
    if (lat > box.maxLat) box.maxLat = lat;
    return;
  }
  if (Array.isArray(coords)) {
    for (const c of coords) extendBBoxFromCoords(c, box);
  }
}

function computeBBox(geo: FeatureCollection<Geometry, { name?: string }>): BBox {
  const box: BBox = {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  };
  for (const f of geo.features) {
    const g = f.geometry as { coordinates?: unknown } | null;
    if (g && "coordinates" in g) extendBBoxFromCoords(g.coordinates, box);
  }
  return box;
}

export interface ChoroplethProjection {
  width: number;
  height: number;
  project: (lon: number, lat: number) => [number, number];
}

/**
 * Build a stable equirectangular projection fitting the WHOLE scope extent
 * (every geojson feature), so the framing never shifts with the data.
 */
export function buildChoroplethProjection(
  geo: FeatureCollection<Geometry, { name?: string }>,
  targetWidth = 640,
): ChoroplethProjection {
  const box = computeBBox(geo);
  const midLat = (box.minLat + box.maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
  const geoW = (box.maxLon - box.minLon) * lonScale || 1;
  const geoH = box.maxLat - box.minLat || 1;
  const width = targetWidth;
  const height = (width * geoH) / geoW;
  const project = (lon: number, lat: number): [number, number] => {
    const x = (((lon - box.minLon) * lonScale) / geoW) * width;
    const y = ((box.maxLat - lat) / geoH) * height;
    return [x, y];
  };
  return { width, height, project };
}

function ringToPath(
  ring: number[][],
  project: (lon: number, lat: number) => [number, number],
): string {
  let d = "";
  ring.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d + "Z";
}

/** SVG path `d` string for a Polygon/MultiPolygon feature under a projection. */
export function featurePath(
  feature: Feature<Geometry, { name?: string }>,
  project: (lon: number, lat: number) => [number, number],
): string {
  const g = feature.geometry as
    | { type: string; coordinates: number[][][] | number[][][][] }
    | null;
  if (!g) return "";
  if (g.type === "Polygon") {
    return (g.coordinates as number[][][]).map((r) => ringToPath(r, project)).join("");
  }
  if (g.type === "MultiPolygon") {
    return (g.coordinates as number[][][][])
      .flatMap((poly) => poly.map((r) => ringToPath(r, project)))
      .join("");
  }
  return "";
}

/** Visual centroid (bbox centre) of a feature in projected pixel space. */
export function featureCenter(
  feature: Feature<Geometry, { name?: string }>,
  project: (lon: number, lat: number) => [number, number],
): [number, number] | null {
  const box: BBox = {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  };
  const g = feature.geometry as { coordinates?: unknown } | null;
  if (!g || !("coordinates" in g)) return null;
  extendBBoxFromCoords(g.coordinates, box);
  if (!Number.isFinite(box.minLon)) return null;
  const [x1, y1] = project(box.minLon, box.maxLat);
  const [x2, y2] = project(box.maxLon, box.minLat);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}
