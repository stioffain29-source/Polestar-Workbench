import {
  buildFuelHardNumbersFromMarket,
  resolveFuelRollingWindow,
  validateFuelHydration,
} from "../fuelReportAssembler";
import type { MarketPrice } from "@workspace/api-client-react";

const row = (overrides: Partial<MarketPrice>): MarketPrice => ({
  group: "fuel",
  key: "jet",
  label: "Jet fuel",
  value: 181.46,
  unit: "USD/bbl",
  change: "+6.1% 7d",
  asOf: "2026-09-16",
  source: "IATA / S&P Global Platts",
  benchmark: "Global jet fuel composite",
  trajectory: [
    { date: "2026-08-14", value: 158.91 },
    { date: "2026-08-21", value: 163.87 },
    { date: "2026-08-28", value: 156.85 },
    { date: "2026-09-04", value: 171.01 },
    { date: "2026-09-11", value: 181.46 },
  ],
  ...overrides,
});

describe("Fuel Watch canonical market assembly", () => {
  it("prefers newer IATA data over an older FRED jet row", () => {
    const hardNumbers = buildFuelHardNumbersFromMarket(
      [
        row({
          asOf: "2026-09-09",
          value: 4.34,
          unit: "USD/gal",
          source: "EIA / FRED",
          trajectory: [{ date: "2026-09-09", value: 4.34 }],
        }),
        row({}),
        { ...row({ key: "brent", label: "Brent crude", value: 80, unit: "USD/bbl" }) },
        { ...row({ key: "wti", label: "WTI crude", value: 76, unit: "USD/bbl" }) },
      ],
      "2026-09-16",
    );
    const prices = (hardNumbers.fastFacts as { prices: Array<Record<string, unknown>> }).prices;
    const jet = prices.find((price) => price.label === "Jet fuel");
    expect(jet).toMatchObject({
      value: 181.46,
      unit: "USD/bbl",
      source: "IATA / S&P Global Platts",
      asOf: "2026-09-16",
    });
    expect(hardNumbers.jetFuelTrajectory).toMatchObject({
      source: "IATA / S&P Global Platts",
      unit: "USD/bbl",
      period: "latest month",
    });
    expect((hardNumbers.jetFuelTrajectory as { points: unknown[] }).points).toHaveLength(5);
  });

  it("resolves a UTC rolling seven-day window", () => {
    expect(resolveFuelRollingWindow("2026-09-16")).toEqual({
      start: "2026-09-10",
      end: "2026-09-16",
    });
  });

  it("fails validation when source/unit or current jet date diverge", () => {
    const validation = validateFuelHydration(
      {
        fastFacts: {
          prices: [
            {
              label: "Jet fuel",
              value: 181.46,
              unit: "USD/bbl",
              source: "IATA / S&P Global Platts",
              asOf: "2026-09-16",
            },
          ],
        },
        jetFuelTrajectory: {
          source: "EIA / FRED",
          unit: "USD/gal",
          points: [{ date: "2026-09-16", value: 4.34 }],
        },
      },
      resolveFuelRollingWindow("2026-09-16"),
    );
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        "Jet fuel headline and trajectory sources differ.",
        "Jet fuel headline and trajectory units differ.",
      ]),
    );
  });
});