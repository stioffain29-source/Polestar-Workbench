// One-shot generator for the out-of-region ("global market") choropleth
// polygons used by the energy / fuel / fertiliser world-scope monitor maps.
//
// The region monitors already ship curated polygons (cargoScopeCountries.geo.json
// for the APAC + Middle-East theatres, monitorChoroplethExtras.geo.json for Nepal
// and West Papua). The world scope reuses ALL of those and adds ONLY the
// out-of-region countries the global gazetteer (GLOBAL_EXTRA_ALIASES) can attribute
// — every one is a large land mass present in Natural Earth 110m, so map == table
// parity holds without hand-drawing polygons.
//
// Source: `world-atlas` (Natural Earth 1:110m admin-0). Polygon names are
// normalised to the app-canonical spellings so `featureCountryName` shades them.
//
// Regenerate with: pnpm --filter @workspace/scripts run gen:world-choropleth
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { GLOBAL_EXTRA_ALIASES } from "@workspace/ingest";

interface GeoFeature {
  type: "Feature";
  properties: { name?: string } | null;
  geometry: unknown;
}
interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

const require = createRequire(import.meta.url);
const worldAtlas = require("world-atlas/countries-110m.json") as {
  objects: { countries: unknown };
};

// Natural Earth 110m display name -> app-canonical polygon name. Only the
// spellings that differ from our canonical set need an entry; everything else
// matches directly.
const NE_TO_APP: Record<string, string> = {
  "United States of America": "United States",
};

// Source of truth for which out-of-region countries to include. The coverage
// test (worldChoropleth.test.ts) re-asserts this against the live gazetteer, so
// adding a GLOBAL_EXTRA canonical without a polygon fails CI.
const INCLUDE = new Set(GLOBAL_EXTRA_ALIASES.map((a) => a.canonical));

// Natural Earth stores some countries (Russia) UNSPLIT across the antimeridian:
// a single ring holds points near +180 AND near -180. Leaflet then renders that
// ring as a full-width horizontal band across the map whenever the country is
// shaded (e.g. the energy world map, which paints Russia). Unwrap each crossing
// ring by shifting its western-hemisphere points +360 so the ring stays
// contiguous east of +180 (Chukotka -170 -> +190) and never spans the map. Only
// rings that GENUINELY cross (a point >170 AND a point <-170) are touched, so
// ordinary western-hemisphere countries (Canada, the US, Cuba) are untouched.
type Ring = number[][];
function unwrapAntimeridian(geometry: unknown): unknown {
  const g = geometry as { type?: string; coordinates?: unknown };
  const fixRing = (ring: Ring): Ring => {
    let hasEast = false;
    let hasWest = false;
    for (const p of ring) {
      if (p[0] > 170) hasEast = true;
      if (p[0] < -170) hasWest = true;
    }
    if (!(hasEast && hasWest)) return ring;
    return ring.map((p) => [p[0] < 0 ? p[0] + 360 : p[0], p[1]]);
  };
  if (g?.type === "Polygon") {
    return { ...g, coordinates: (g.coordinates as Ring[]).map(fixRing) };
  }
  if (g?.type === "MultiPolygon") {
    return {
      ...g,
      coordinates: (g.coordinates as Ring[][]).map((poly) => poly.map(fixRing)),
    };
  }
  return geometry;
}

const fc = feature(
  worldAtlas as never,
  worldAtlas.objects.countries as never,
) as unknown as GeoFeatureCollection;

const features: GeoFeature[] = fc.features
  .map((f: GeoFeature) => {
    const ne = String(f.properties?.name ?? "");
    return { name: NE_TO_APP[ne] ?? ne, geometry: f.geometry };
  })
  .filter((x: { name: string; geometry: unknown }) => INCLUDE.has(x.name))
  .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
  .map(
    (x: { name: string; geometry: unknown }): GeoFeature => ({
      type: "Feature",
      properties: { name: x.name },
      geometry: unwrapAntimeridian(x.geometry),
    }),
  );

const got = new Set(features.map((f) => f.properties?.name ?? ""));
const missing = [...INCLUDE].filter((c) => !got.has(c));
if (missing.length > 0) {
  throw new Error(
    `world-atlas has no 110m polygon for: ${missing.join(", ")}. ` +
      "Add a NE_TO_APP mapping or a curated polygon.",
  );
}

const out: GeoFeatureCollection = { type: "FeatureCollection", features };

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/workbench/src/assets/worldChoroplethExtras.geo.json",
);
writeFileSync(outPath, `${JSON.stringify(out)}\n`);
console.log(`Wrote ${features.length} out-of-region polygons to ${outPath}`);
console.log(`Countries: ${[...got].sort().join(", ")}`);
