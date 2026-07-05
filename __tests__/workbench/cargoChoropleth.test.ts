import {
  COUNT_BANDS,
  countBandColor,
} from "../../artifacts/workbench/src/lib/cargoChoropleth";
import { IN_SCOPE_COUNTRIES } from "../../artifacts/workbench/src/lib/cargoAnalysis";
import cargoScopeCountriesGeo from "../../artifacts/workbench/src/assets/cargoScopeCountries.geo.json";

// The Cargo Watch choropleth relies on two pure pieces of logic that are easy
// to break silently as incident volume grows:
//  1. the count-to-colour band mapping (0 / 1–5 / 6–20 / 21–50 / 51–100 / 100+)
//  2. the requirement that every in-scope country name resolves to a polygon in
//     the bundled GeoJSON. Adding a country to IN_SCOPE_COUNTRIES without adding
//     its polygon would leave it silently unshaded even with incidents.
// These tests lock both.

describe("countBandColor — count-to-colour bands", () => {
  const [b1, b2, b3, b4, b5] = COUNT_BANDS;

  it("leaves zero incidents unshaded (null)", () => {
    expect(countBandColor(0)).toBeNull();
  });

  it("maps each band boundary to the correct colour", () => {
    // 1–5
    expect(countBandColor(1)).toBe(b1.color);
    expect(countBandColor(5)).toBe(b1.color);
    // 6–20
    expect(countBandColor(6)).toBe(b2.color);
    expect(countBandColor(20)).toBe(b2.color);
    // 21–50
    expect(countBandColor(21)).toBe(b3.color);
    expect(countBandColor(50)).toBe(b3.color);
    // 51–100
    expect(countBandColor(51)).toBe(b4.color);
    expect(countBandColor(100)).toBe(b4.color);
    // 100+ (101 and above)
    expect(countBandColor(101)).toBe(b5.color);
  });

  it("has bands ordered by ascending threshold", () => {
    for (let i = 1; i < COUNT_BANDS.length; i++) {
      expect(COUNT_BANDS[i].min).toBeGreaterThan(COUNT_BANDS[i - 1].min);
    }
  });
});

describe("cargoScopeCountries.geo.json — polygon coverage", () => {
  const features = (cargoScopeCountriesGeo as {
    features: Array<{ properties?: { name?: string } }>;
  }).features;
  const polygonNames = features.map((f) => f.properties?.name ?? "");

  it("has a matching polygon for every in-scope country", () => {
    const polygonSet = new Set(polygonNames);
    const missing = IN_SCOPE_COUNTRIES.filter((c) => !polygonSet.has(c));
    expect(missing).toEqual([]);
  });

  it("has no extra or mismatched polygon names", () => {
    const scopeSet = new Set(IN_SCOPE_COUNTRIES);
    const extra = polygonNames.filter((n) => !scopeSet.has(n));
    expect(extra).toEqual([]);
  });

  it("has no duplicate polygon names", () => {
    expect(new Set(polygonNames).size).toBe(polygonNames.length);
  });
});
