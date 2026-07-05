import {
  GLOBAL_TOPIC_ALIASES,
  GLOBAL_EXTRA_ALIASES,
} from "@workspace/ingest";
import cargoScopeGeo from "../../artifacts/workbench/src/assets/cargoScopeCountries.geo.json";
import monitorExtrasGeo from "../../artifacts/workbench/src/assets/monitorChoroplethExtras.geo.json";
import worldExtrasGeo from "../../artifacts/workbench/src/assets/worldChoroplethExtras.geo.json";

// The energy / fuel / fertiliser monitors can attribute an incident to any
// country in GLOBAL_TOPIC_ALIASES (the region gazetteer plus the out-of-region
// "global market" gazetteer). Their world-scope choropleth shades the union of
// three bundled assets:
//   • cargoScopeCountries.geo.json  — APAC + Middle-East theatres
//   • monitorChoroplethExtras.geo.json — Nepal + West Papua
//   • worldChoroplethExtras.geo.json  — the out-of-region countries
// Adding a gazetteer canonical without a matching polygon would leave it silently
// unshaded on the map even though the country table lists it, breaking the
// strict map == table parity the product requires. These tests lock that.

// DB country spellings that differ from the choropleth polygon names. Mirrors
// CHOROPLETH_COUNTRY_ALIASES in CountryChoroplethMap.tsx (kept inline so this
// pure data test does not import the react-leaflet component).
const CHOROPLETH_COUNTRY_ALIASES: Record<string, string> = {
  "United Arab Emirates": "UAE",
};

function polygonNames(geo: unknown): string[] {
  return (geo as { features: Array<{ properties?: { name?: string } }> }).features.map(
    (f) => f.properties?.name ?? "",
  );
}

const worldExtraNames = polygonNames(worldExtrasGeo);
const worldScopeNames = [
  ...polygonNames(cargoScopeGeo),
  ...polygonNames(monitorExtrasGeo),
  ...worldExtraNames,
];
const worldScopeSet = new Set(worldScopeNames);

const globalExtraCanonicals = GLOBAL_EXTRA_ALIASES.map((a) => a.canonical);

describe("world-scope choropleth — polygon coverage", () => {
  it("has a matching polygon for every gazetteer canonical", () => {
    const missing = GLOBAL_TOPIC_ALIASES.map(
      (a) => CHOROPLETH_COUNTRY_ALIASES[a.canonical] ?? a.canonical,
    ).filter((name) => !worldScopeSet.has(name));
    expect(missing).toEqual([]);
  });
});

describe("worldChoroplethExtras.geo.json — out-of-region set", () => {
  it("contains exactly the out-of-region canonicals (no missing, no extra)", () => {
    expect([...worldExtraNames].sort()).toEqual([...globalExtraCanonicals].sort());
  });

  it("has no duplicate polygon names", () => {
    expect(new Set(worldExtraNames).size).toBe(worldExtraNames.length);
  });

  it("does not overlap the region assets (no double-drawn country)", () => {
    const regionNames = new Set([
      ...polygonNames(cargoScopeGeo),
      ...polygonNames(monitorExtrasGeo),
    ]);
    const overlap = worldExtraNames.filter((n) => regionNames.has(n));
    expect(overlap).toEqual([]);
  });
});
