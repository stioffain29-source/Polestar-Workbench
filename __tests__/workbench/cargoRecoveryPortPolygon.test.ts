import {
  RECOVERY_PLACES,
  CARGO_PORT_GAZETTEER,
  cargoCountry,
  identifyCountry,
  type CargoIncidentLike,
} from "../../artifacts/workbench/src/lib/cargoAnalysis";
import { featureCountryName } from "../../artifacts/workbench/src/lib/cargoChoropleth";
import cargoScopeCountriesGeo from "../../artifacts/workbench/src/assets/cargoScopeCountries.geo.json";
import type { Feature, Geometry } from "geojson";

// Sibling of cargoAliasPolygon.test.ts. That suite guards the
// COUNTRY_ALIASES -> polygon path (the FIRST resolution branch of
// cargoCountry). But cargoCountry has a SECOND branch: when the source left a
// row unattributed (country null / "Unknown"), it recovers a canonical country
// from the incident text via recoverCargoCountryFromText (RECOVERY_PLACES
// gazetteer). The CARGO_PORT_GAZETTEER likewise emits canonical countries for
// port-named rows. If any of those country strings does not byte-match a
// polygon name in cargoScopeCountries.geo.json, a recovered incident silently
// fails to shade any country on the Cargo Watch map — the exact same silent
// drift the alias suite fixed, but for the recovery / port paths. These tests
// lock those paths.

const features = (cargoScopeCountriesGeo as {
  features: Array<Feature<Geometry, { name?: string }>>;
}).features;

const POLYGON_NAMES = new Set(
  features.map((f) => featureCountryName(f)).filter(Boolean),
);

describe("RECOVERY_PLACES -> polygon coverage", () => {
  it("maps every recoverable country to a shadeable polygon name", () => {
    // Every country recoverCargoCountryFromText can emit must be a polygon the
    // map can shade. A missing polygon (or a name that doesn't byte-match a
    // polygon's properties.name) would leave a text-recovered incident unshaded.
    const unshadeable = Array.from(
      new Set(RECOVERY_PLACES.map(([country]) => country)),
    ).filter(
      (canonical) => {
        const resolved = identifyCountry(canonical) ?? canonical;
        return !POLYGON_NAMES.has(resolved);
      },
    );
    expect(unshadeable).toEqual([]);
  });
});

describe("CARGO_PORT_GAZETTEER -> polygon coverage", () => {
  it("maps every port's country to a shadeable polygon name", () => {
    // Every port maps to its one canonical in-scope country. That country must
    // be a polygon the map can shade, or a port-recovered incident silently
    // misses the GeoJSON.
    const unshadeable = Array.from(
      new Set(CARGO_PORT_GAZETTEER.map((g) => g.country)),
    ).filter((country) => {
      const resolved = identifyCountry(country) ?? country;
      return !POLYGON_NAMES.has(resolved);
    });
    expect(unshadeable).toEqual([]);
  });
});

// Mirror the monitor map's aggregation: group incidents by cargoCountry(i) —
// the exact key the choropleth shades — then confirm unattributed,
// text-recoverable rows land on the expected polygon.
function mapCountsLikeMonitor(rows: CargoIncidentLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of rows) {
    const c = cargoCountry(i);
    if (!c) continue;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

describe("unattributed, text-recoverable incidents aggregate onto the expected polygon", () => {
  it("recovers city- and port-named rows onto their country polygon", () => {
    const rows: CargoIncidentLike[] = [
      // City token recovered via RECOVERY_PLACES.
      { title: "Cargo consignment stolen from a Surabaya warehouse", country: null },
      { title: "Freight looted from a depot in Bekasi", country: "Unknown" },
      // Port-area place name ("Tanjung Priok") recovered via RECOVERY_PLACES.
      { title: "Container narcotics seizure at Tanjung Priok", country: null },
      // Malaysian city token.
      { title: "Shipment pilfered near a depot in Klang", country: null },
    ];

    const counts = mapCountsLikeMonitor(rows);

    expect(counts.get("Indonesia")).toBe(3);
    expect(counts.get("Malaysia")).toBe(1);

    // Every aggregated key is a polygon the map can actually shade — no key
    // silently misses the GeoJSON.
    for (const key of counts.keys()) {
      expect(POLYGON_NAMES.has(key)).toBe(true);
    }
  });
});
