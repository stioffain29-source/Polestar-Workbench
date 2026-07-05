import {
  COUNTRY_ALIASES,
  cargoCountry,
  identifyCountry,
  type CargoIncidentLike,
} from "../../artifacts/workbench/src/lib/cargoAnalysis";
import { featureCountryName } from "../../artifacts/workbench/src/lib/cargoChoropleth";
import cargoScopeCountriesGeo from "../../artifacts/workbench/src/assets/cargoScopeCountries.geo.json";
import type { Feature, Geometry } from "geojson";

// The Cargo Watch map (pages/CargoWatch.tsx) shades a country's polygon by
// aggregating incidents under `cargoCountry(i)` and then matching that name
// EXACTLY against a polygon's `properties.name` via featureCountryName. Before
// the map counts them, city / sub-region tags are folded into a canonical
// country through COUNTRY_ALIASES / identifyCountry (e.g. "Dubai" -> "UAE",
// "Hong Kong" -> "China"). If an alias maps to a country name that has NO
// polygon — or a name that does not exactly match a polygon's properties.name —
// those incidents silently fail to shade any country, even though the country
// IS in scope. The existing cargoChoropleth suite guards IN_SCOPE_COUNTRIES,
// but nothing guards the alias -> polygon path. These tests lock it.

const features = (cargoScopeCountriesGeo as {
  features: Array<Feature<Geometry, { name?: string }>>;
}).features;

const POLYGON_NAMES = new Set(
  features.map((f) => featureCountryName(f)).filter(Boolean),
);

describe("COUNTRY_ALIASES -> polygon coverage", () => {
  it("maps every canonical alias target to a shadeable polygon name", () => {
    // Every value COUNTRY_ALIASES can produce must be a polygon the map can
    // shade. A missing polygon (or a name that doesn't byte-match a polygon's
    // properties.name) would leave a city-tagged incident unshaded.
    const unshadeable = Array.from(new Set(Object.values(COUNTRY_ALIASES))).filter(
      (canonical) => !POLYGON_NAMES.has(canonical),
    );
    expect(unshadeable).toEqual([]);
  });

  it("normalises every alias KEY through identifyCountry onto a polygon", () => {
    // identifyCountry is the exact entry point the map uses (via cargoCountry).
    // Feeding each raw alias key through it must land on a polygon name.
    const dropped = Object.keys(COUNTRY_ALIASES).filter((alias) => {
      const resolved = identifyCountry(alias);
      return !resolved || !POLYGON_NAMES.has(resolved);
    });
    expect(dropped).toEqual([]);
  });
});

// Mirror the monitor map's aggregation: group incidents by cargoCountry(i) —
// the exact key the choropleth shades — then confirm each key is a real polygon
// and the counts land on the expected country.
function mapCountsLikeMonitor(rows: CargoIncidentLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of rows) {
    const c = cargoCountry(i);
    if (!c) continue;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

describe("city-tagged incidents aggregate onto the expected polygon", () => {
  it("folds Dubai/Abu Dhabi/Jebel Ali onto the UAE polygon and Hong Kong onto China", () => {
    const rows: CargoIncidentLike[] = [
      { title: "Shipment pilfered at a container yard", country: "Dubai" },
      { title: "Cargo consignment stolen from a warehouse", country: "Abu Dhabi" },
      { title: "Freight looted from a depot", country: "Jebel Ali" },
      { title: "Container narcotics seizure at the terminal", country: "Hong Kong" },
    ];

    const counts = mapCountsLikeMonitor(rows);

    // Three UAE cities fold onto one shadeable polygon.
    expect(counts.get("UAE")).toBe(3);
    // Hong Kong folds onto China.
    expect(counts.get("China")).toBe(1);

    // Every aggregated key is a polygon the map can actually shade — no key
    // silently misses the GeoJSON.
    for (const key of counts.keys()) {
      expect(POLYGON_NAMES.has(key)).toBe(true);
    }
    // The city names themselves must never appear as shading keys.
    expect(counts.has("Dubai")).toBe(false);
    expect(counts.has("Hong Kong")).toBe(false);
  });
});
