import { buildCargoCountryIntensity } from "../../artifacts/workbench/src/lib/cargoReportChoropleth";
import { buildCargoCountryBreakdown } from "../../artifacts/workbench/src/lib/cargoNarratives";
import { cargoCountriesFor } from "../../artifacts/workbench/src/lib/cargoAnalysis";

// The Cargo Watch report shades a country-intensity choropleth ("Cargo Theft
// Map") alongside the "Country Risk Breakdown" table. The map builds its counts
// with buildCargoCountryIntensity and the table with buildCargoCountryBreakdown.
// Historically those used two different country-resolution paths (the map took
// only the FIRST country of a compound and normalised aliases; the table split
// the compound but skipped alias normalisation and text recovery), so a country
// could read one count in the table and a different shade on the map — a silent
// contradiction. Both now flow through the shared cargoCountriesFor() resolver.
//
// INTENDED RELATIONSHIP (enforced below): the map shades EVERY resolved country,
// while the table deliberately narrows to the RECURRING geographies (>=2 records)
// when there are enough of them, and caps at maxRows. So the table's country set
// is a SUBSET of the map's, and for every country present in BOTH the count is
// IDENTICAL. The two never disagree on a shared country's number.

interface Row {
  topic: string;
  title: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
}

function row(p: Partial<Row>): Row {
  return {
    topic: "cargo_watch",
    title: "",
    severity: "moderate",
    occurredAt: "2026-06-20",
    country: null,
    summary: null,
    ...p,
  };
}

function mapCounts(rows: Row[]): Map<string, number> {
  const intensity = buildCargoCountryIntensity(
    rows.map((r) => ({
      title: r.title,
      summary: r.summary ?? null,
      source: null,
      location: null,
      country: r.country ?? null,
      occurredAt: r.occurredAt,
    })),
  );
  const out = new Map<string, number>();
  for (const [country, v] of intensity) out.set(country, v.count);
  return out;
}

function tableCounts(rows: Row[]): Map<string, number> {
  const breakdown = buildCargoCountryBreakdown(rows, 50);
  const out = new Map<string, number>();
  for (const r of breakdown.rows) out.set(r.country, r.count);
  return out;
}

// A deliberately awkward but representative window: single-country rows, a
// compound "Indonesia; Malaysia" row, a West Papua province tag that must fold
// into Indonesia, a Dubai alias that must normalise to UAE, and an Unknown row
// whose in-scope country is recoverable from the text (Surabaya -> Indonesia).
const WINDOW: Row[] = [
  row({ title: "Container of electronics stolen from a depot", country: "Malaysia" }),
  row({ title: "Cargo lorry hijacked on the highway", country: "Thailand" }),
  row({ title: "Freight consignment looted from a warehouse", country: "Indonesia" }),
  row({ title: "Truck robbery of scrap iron near the border", country: "Indonesia; Malaysia" }),
  row({ title: "Depot raid on a cigarette consignment", country: "West Papua" }),
  row({ title: "Shipment pilfered at Jebel Ali container yard", country: "Dubai" }),
  row({
    title: "Warehouse godown break-in, cargo consignment stolen",
    country: "Unknown",
    summary: "The theft was reported in Surabaya overnight.",
  }),
];

describe("cargo report — map shades and Country Risk Breakdown counts agree", () => {
  it("the table's countries are a subset of the map's, with identical counts on every shared country", () => {
    const mapC = mapCounts(WINDOW);
    const tableC = tableCounts(WINDOW);
    // Every country in the table must be shaded on the map...
    for (const country of tableC.keys()) {
      expect(mapC.has(country)).toBe(true);
    }
    // ...and carry exactly the same count on both surfaces. This is the core
    // no-contradiction guarantee: a country never reads one number in the table
    // and a different shade on the map.
    for (const [country, count] of tableC) {
      expect(mapC.get(country)).toBe(count);
    }
  });

  it("counts every path that resolves to a country, on both surfaces", () => {
    const mapC = mapCounts(WINDOW);
    const tableC = tableCounts(WINDOW);
    // Indonesia rows: the plain "Indonesia" freight-loot, the "Indonesia;
    // Malaysia" compound, the West Papua fold, and the Surabaya recovery = 4.
    expect(mapC.get("Indonesia")).toBe(4);
    expect(tableC.get("Indonesia")).toBe(4);
    // Malaysia: the depot theft plus the compound row = 2.
    expect(mapC.get("Malaysia")).toBe(2);
    expect(tableC.get("Malaysia")).toBe(2);
    // UAE via the Dubai alias = 1 on the map. It is a singleton, so the table
    // narrows it out (recurring-geographies preference) — but the map still
    // carries it, and the table never contradicts it.
    expect(mapC.get("UAE")).toBe(1);
    expect(tableC.has("UAE")).toBe(false);
  });

  it("when every country recurs, the map and table country sets are equal", () => {
    // A window with no singletons: the recurring-preference and maxRows never
    // trim anything, so the two surfaces resolve the SAME country set outright.
    const evenWindow: Row[] = [
      row({ title: "Container theft at depot", country: "Malaysia" }),
      row({ title: "Cargo lorry hijacked", country: "Malaysia" }),
      row({ title: "Freight consignment looted", country: "Indonesia" }),
      row({ title: "Depot raid on cigarette consignment", country: "West Papua" }),
      row({ title: "Shipment pilfered at Jebel Ali yard", country: "Dubai" }),
      row({ title: "Container narcotics seizure", country: "UAE" }),
    ];
    const mapC = mapCounts(evenWindow);
    const tableC = tableCounts(evenWindow);
    expect(new Set(mapC.keys())).toEqual(new Set(tableC.keys()));
    for (const [country, count] of mapC) {
      expect(tableC.get(country)).toBe(count);
    }
    // Indonesia (plain + West Papua fold) = 2; Malaysia = 2; UAE (Dubai + UAE) = 2.
    expect(mapC.get("Indonesia")).toBe(2);
    expect(mapC.get("Malaysia")).toBe(2);
    expect(mapC.get("UAE")).toBe(2);
  });

  it("resolves the countries the way both surfaces count them", () => {
    // Compound row counts under EACH country.
    expect(cargoCountriesFor({ title: "x", country: "Indonesia; Malaysia" })).toEqual([
      "Indonesia",
      "Malaysia",
    ]);
    // West Papua folds into Indonesia (province, not a country).
    expect(cargoCountriesFor({ title: "x", country: "West Papua" })).toEqual(["Indonesia"]);
    // City alias normalises to its canonical country.
    expect(cargoCountriesFor({ title: "x", country: "Dubai" })).toEqual(["UAE"]);
    // De-duplicate within the row: "Indonesia; West Papua" is Indonesia once.
    expect(cargoCountriesFor({ title: "x", country: "Indonesia; West Papua" })).toEqual([
      "Indonesia",
    ]);
    // Unattributed row recovers a provable in-scope country from the text.
    expect(
      cargoCountriesFor({
        title: "Cargo consignment stolen",
        country: "Unknown",
        summary: "Reported in Surabaya overnight.",
      }),
    ).toEqual(["Indonesia"]);
    // Genuinely unattributed row resolves to nothing (counts nowhere).
    expect(cargoCountriesFor({ title: "Cargo stolen somewhere", country: "Unknown" })).toEqual([]);
  });
});
