import type { DataCentreRiskDimensionValue } from "@workspace/db/schema";
import {
  ratingFromBands,
  isSeedable,
  buildSeededDimension,
  buildNoteDimension,
  parseIndexCsv,
  parseNotesCsv,
  type RiskBand,
} from "../../scripts/src/lib/riskSeed";
import {
  getRiskSource,
  listRiskSources,
  RISK_SOURCE_IDS,
} from "../../scripts/src/lib/riskSourceRegistry";

const rating = (id: string) => {
  const s = getRiskSource(id);
  if (!s || s.kind !== "rating") throw new Error(`no rating source ${id}`);
  return s.valueToRating;
};

describe("ratingFromBands (generic)", () => {
  const bands: RiskBand[] = [
    { atLeast: 80, rating: "Insignificant" },
    { atLeast: 60, rating: "Low" },
    { atLeast: 40, rating: "Moderate" },
    { atLeast: 20, rating: "High" },
    { atLeast: 0, rating: "Extreme" },
  ];
  const scale = { min: 0, max: 100, label: "test" };

  it("picks the tier at each band boundary", () => {
    expect(ratingFromBands(80, bands, scale)).toBe("Insignificant");
    expect(ratingFromBands(79.9, bands, scale)).toBe("Low");
    expect(ratingFromBands(60, bands, scale)).toBe("Low");
    expect(ratingFromBands(40, bands, scale)).toBe("Moderate");
    expect(ratingFromBands(20, bands, scale)).toBe("High");
    expect(ratingFromBands(0, bands, scale)).toBe("Extreme");
  });

  it("throws on out-of-range / non-finite (never guesses)", () => {
    expect(() => ratingFromBands(101, bands, scale)).toThrow(RangeError);
    expect(() => ratingFromBands(-1, bands, scale)).toThrow(RangeError);
    expect(() => ratingFromBands(Number.NaN, bands, scale)).toThrow(RangeError);
  });
});

describe("registry band maps (pinned)", () => {
  it("WGI percentile is inverted (higher percentile = lower risk)", () => {
    const f = rating("wgi-regquality");
    expect(f(85)).toBe("Insignificant");
    expect(f(65)).toBe("Low");
    expect(f(45)).toBe("Moderate");
    expect(f(25)).toBe("High");
    expect(f(5)).toBe("Extreme");
    expect(rating("wgi-polstab")(90)).toBe("Insignificant");
    expect(() => f(120)).toThrow(RangeError);
  });

  it("ND-GAIN is inverted with its own thresholds", () => {
    const f = rating("nd-gain");
    expect(f(60)).toBe("Insignificant");
    expect(f(55)).toBe("Low");
    expect(f(45)).toBe("Moderate");
    expect(f(35)).toBe("High");
    expect(f(29)).toBe("Extreme");
  });

  it("WRI Aqueduct is direct on a 0–5 scale", () => {
    const f = rating("aqueduct");
    expect(f(4.5)).toBe("Extreme");
    expect(f(3)).toBe("High");
    expect(f(2)).toBe("Moderate");
    expect(f(1)).toBe("Low");
    expect(f(0.5)).toBe("Insignificant");
    expect(() => f(6)).toThrow(RangeError);
  });

  it("INFORM is direct on a 0–10 scale (hazard and conflict share it)", () => {
    for (const id of ["inform-hazard", "inform-conflict"]) {
      const f = rating(id);
      expect(f(7)).toBe("Extreme");
      expect(f(5.5)).toBe("High");
      expect(f(4)).toBe("Moderate");
      expect(f(2)).toBe("Low");
      expect(f(1)).toBe("Insignificant");
      expect(() => f(11)).toThrow(RangeError);
    }
  });

  it("WB Enterprise power is direct on a 0–100 % scale", () => {
    const f = rating("wb-enterprise-power");
    expect(f(85)).toBe("Extreme");
    expect(f(65)).toBe("High");
    expect(f(45)).toBe("Moderate");
    expect(f(25)).toBe("Low");
    expect(f(5)).toBe("Insignificant");
  });

  it("every registered source id resolves and lists its dimensions", () => {
    expect(RISK_SOURCE_IDS.length).toBe(listRiskSources().length);
    for (const s of listRiskSources()) {
      expect(s.dimensions.length).toBeGreaterThan(0);
      expect(getRiskSource(s.id)).toBe(s);
    }
  });
});

describe("isSeedable (never overwrite analyst work)", () => {
  const base = (
    over: Partial<DataCentreRiskDimensionValue>,
  ): DataCentreRiskDimensionValue => ({
    rating: null,
    rationale: "",
    source: "",
    analystNote: "",
    provisional: false,
    overridden: false,
    seededFrom: null,
    ...over,
  });

  it("seeds an absent or empty dimension", () => {
    expect(isSeedable(undefined, "WGI RegQuality")).toBe(true);
    expect(isSeedable(base({}), "WGI RegQuality")).toBe(true);
  });

  it("refreshes a prior provisional seed from the SAME source only", () => {
    const prior = base({
      rating: "High",
      provisional: true,
      seededFrom: "WGI RegQuality 2022",
    });
    expect(isSeedable(prior, "WGI RegQuality")).toBe(true);
    // A different source must NOT overwrite another source's provisional seed.
    expect(isSeedable(prior, "ND-GAIN")).toBe(false);
  });

  it("never touches a locked dimension", () => {
    expect(
      isSeedable(base({ rating: "Low", locked: true }), "WGI RegQuality"),
    ).toBe(false);
    // Locked beats a matching prior seed.
    expect(
      isSeedable(
        base({
          rating: "High",
          provisional: true,
          seededFrom: "WGI RegQuality 2022",
          locked: true,
        }),
        "WGI RegQuality",
      ),
    ).toBe(false);
  });

  it("never touches an overridden or analyst-written dimension", () => {
    expect(
      isSeedable(base({ rating: "Low", overridden: true }), "WGI RegQuality"),
    ).toBe(false);
    expect(
      isSeedable(
        base({ rating: "Moderate", rationale: "analyst view" }),
        "WGI RegQuality",
      ),
    ).toBe(false);
  });
});

describe("buildSeededDimension / buildNoteDimension provenance", () => {
  it("stamps a rated provisional seed with full provenance", () => {
    const d = buildSeededDimension({
      rating: "Moderate",
      rationale: "seeded",
      source: "WGI 2023",
      seededFrom: "WGI RegQuality 2023",
      sourceDate: "2023",
      confidence: "High",
    });
    expect(d.rating).toBe("Moderate");
    expect(d.provisional).toBe(true);
    expect(d.overridden).toBe(false);
    expect(d.locked).toBe(false);
    expect(d.lastReviewed).toBeNull();
    expect(d.sourceDate).toBe("2023");
    expect(d.confidence).toBe("High");
  });

  it("note-only seed asserts no rating", () => {
    const d = buildNoteDimension({
      rationale: "regime note",
      source: "DLA Piper 2024",
      seededFrom: "DLA Piper 2024",
      sourceDate: "2024",
      confidence: "Medium",
    });
    expect(d.rating).toBeNull();
    expect(d.provisional).toBe(true);
    expect(d.confidence).toBe("Medium");
  });
});

describe("parseIndexCsv / parseNotesCsv", () => {
  it("reads a country + value column and pins the year from the header", () => {
    const csv = [
      "Country,Percentile 2023",
      "Singapore,92",
      "Indonesia,45",
      ",40",
      "Bad,n/a",
    ].join("\n");
    const parsed = parseIndexCsv(csv, {
      valueHeader: /percentile/i,
      yearFromValueHeader: true,
    });
    expect(parsed.year).toBe(2023);
    expect(parsed.rows).toEqual([
      { country: "Singapore", value: 92 },
      { country: "Indonesia", value: 45 },
    ]);
  });

  it("reads a country + note column (note-only source)", () => {
    const csv = [
      "Country,Regime",
      "Indonesia,Localisation required for public data",
      "Singapore,No general localisation",
      "Blank,",
    ].join("\n");
    const parsed = parseNotesCsv(csv, { noteHeader: /regime/i });
    expect(parsed.rows).toEqual([
      { country: "Indonesia", note: "Localisation required for public data" },
      { country: "Singapore", note: "No general localisation" },
    ]);
  });
});
