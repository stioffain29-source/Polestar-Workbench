import {
  CPI_BAND_MAP_VERSION,
  buildSeededDimension,
  cpiScoreToRating,
  isCpiSeedable,
  parseCpiCsv,
  splitCsvLine,
} from "../../scripts/src/lib/cpiSeed";
import type { DataCentreRiskDimensionValue } from "@workspace/db/schema";

// Pins the INVERTED CPI → Polestar-tier band map v1. A HIGHER CPI score (less
// perceived corruption) maps to a LOWER risk rating. These thresholds are a
// published contract: changing one must bump CPI_BAND_MAP_VERSION and this test.

describe("cpiScoreToRating (band map v1, inverted)", () => {
  it("maps each band and its boundaries to the right tier", () => {
    expect(cpiScoreToRating(100)).toBe("Insignificant");
    expect(cpiScoreToRating(80)).toBe("Insignificant");
    expect(cpiScoreToRating(79)).toBe("Low");
    expect(cpiScoreToRating(60)).toBe("Low");
    expect(cpiScoreToRating(59)).toBe("Moderate");
    expect(cpiScoreToRating(40)).toBe("Moderate");
    expect(cpiScoreToRating(39)).toBe("High");
    expect(cpiScoreToRating(20)).toBe("High");
    expect(cpiScoreToRating(19)).toBe("Extreme");
    expect(cpiScoreToRating(0)).toBe("Extreme");
  });

  it("throws on an out-of-range or non-finite score rather than guessing", () => {
    expect(() => cpiScoreToRating(101)).toThrow(RangeError);
    expect(() => cpiScoreToRating(-1)).toThrow(RangeError);
    expect(() => cpiScoreToRating(Number.NaN)).toThrow(RangeError);
  });
});

describe("buildSeededDimension", () => {
  it("marks the seed provisional and cites the CPI year", () => {
    const dim = buildSeededDimension(34, 2024);
    expect(dim.rating).toBe("High");
    expect(dim.provisional).toBe(true);
    expect(dim.overridden).toBe(false);
    expect(dim.seededFrom).toBe("TI CPI 2024");
    expect(dim.source).toContain("2024");
    expect(dim.rationale).toContain("score 34");
    expect(dim.rationale).toContain(`v${CPI_BAND_MAP_VERSION}`);
    expect(dim.rationale).toMatch(/pending analyst review/i);
  });
});

describe("isCpiSeedable (never overwrite analyst work)", () => {
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
    expect(isCpiSeedable(undefined)).toBe(true);
    expect(isCpiSeedable(base({}))).toBe(true);
  });

  it("refreshes a prior CPI provisional seed", () => {
    expect(
      isCpiSeedable(
        base({ rating: "High", provisional: true, seededFrom: "TI CPI 2023" }),
      ),
    ).toBe(true);
  });

  it("never touches an overridden or analyst-written dimension", () => {
    expect(isCpiSeedable(base({ rating: "Low", overridden: true }))).toBe(false);
    expect(
      isCpiSeedable(base({ rating: "Moderate", rationale: "analyst view" })),
    ).toBe(false);
  });
});

describe("parseCpiCsv", () => {
  it("reads country + score and pins the year from a 'CPI score YYYY' header", () => {
    const csv = [
      "Country / Territory,ISO3,CPI score 2024,Rank",
      "Singapore,SGP,84,3",
      "Indonesia,IDN,34,115",
    ].join("\n");
    const parsed = parseCpiCsv(csv);
    expect(parsed.year).toBe(2024);
    expect(parsed.rows).toEqual([
      { country: "Singapore", score: 84 },
      { country: "Indonesia", score: 34 },
    ]);
  });

  it("honours quoted country names that embed commas", () => {
    expect(splitCsvLine('"Korea, North",PRK,12,170')).toEqual([
      "Korea, North",
      "PRK",
      "12",
      "170",
    ]);
    const csv = 'Country,Score 2024\n"Congo, Dem. Rep.",20';
    const parsed = parseCpiCsv(csv);
    expect(parsed.rows).toEqual([{ country: "Congo, Dem. Rep.", score: 20 }]);
  });

  it("skips rows with no country or a non-numeric score (no guessing)", () => {
    const csv = ["Country,Score", "Valid,55", ",40", "Bad,n/a"].join("\n");
    const parsed = parseCpiCsv(csv);
    expect(parsed.rows).toEqual([{ country: "Valid", score: 55 }]);
  });
});
