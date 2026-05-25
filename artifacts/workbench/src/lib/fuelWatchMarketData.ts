// Fuel Watch market-data model.
//
// Single source of truth consumed by BOTH the preview and the PDF
// exporter. Wraps the existing parser + Fast Facts builder so the two
// renderers cannot drift on what data they have or what they say is
// missing.
//
// The shape intentionally exposes:
//   * fastFactsCards  — the ordered cards rendered in Fast Facts
//   * jetFuelSeries   — series for the Jet Fuel Price Trajectory chart
//   * jetFuelLabel    — accurate benchmark name (never assumes Singapore)
//   * dataStatus      — explicit "present"/"missing" flags
//   * warnings        — short strings to surface to the reader
//
// dataStatus + warnings are what stops the report behaving as if a
// missing jet fuel benchmark is acceptable: the renderer shows a
// clear note rather than a silent gap.

import type { TopicFastFactsIncident } from "./topicFastFacts";
import {
  computeFuelHardNumbers,
  fuelHasNoPriceIndicators,
  FUEL_NO_PRICE_NOTE,
  type FuelHardNumberCard,
} from "./fuelHardNumbers";
import {
  parseFuelHardNumbers,
  getFuelJetFuelTrajectory,
  jetFuelBenchmarkLabel,
  type JetFuelPricePoint,
  type ParsedFuelHardNumbers,
} from "./jetFuelTrajectory";

export type FuelDataPresence = "present" | "missing";
export type JetFuelPresence = "snapshot" | "trajectory" | "missing";

export interface FuelWatchDataStatus {
  prices: FuelDataPresence;
  jetFuel: JetFuelPresence;
}

export interface FuelWatchMarketData {
  fastFactsCards: FuelHardNumberCard[];
  jetFuelSeries: JetFuelPricePoint[] | null;
  jetFuelLabel: string;
  parsed: ParsedFuelHardNumbers;
  dataStatus: FuelWatchDataStatus;
  /** Short notes for the renderer to surface, in order. */
  warnings: string[];
}

export const FUEL_JET_MISSING_NOTE =
  "Jet fuel data has not been loaded for this reporting cycle.";

export interface BuildFuelWatchMarketDataOpts {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  hardNumbersRaw?: unknown;
}

export function buildFuelWatchMarketData(
  opts: BuildFuelWatchMarketDataOpts,
): FuelWatchMarketData {
  const parsed = parseFuelHardNumbers(opts.hardNumbersRaw);
  const fastFactsCards = computeFuelHardNumbers({
    issueDate: opts.issueDate,
    incidents: opts.incidents,
    hardNumbersRaw: opts.hardNumbersRaw,
  });
  const jetFuelSeries = getFuelJetFuelTrajectory(opts.hardNumbersRaw);
  const jetFuelLabel = jetFuelBenchmarkLabel(opts.hardNumbersRaw);

  const dataStatus: FuelWatchDataStatus = {
    prices: fuelHasNoPriceIndicators(opts.hardNumbersRaw) ? "missing" : "present",
    jetFuel:
      parsed.jetFuel?.latestValue !== undefined
        ? "snapshot"
        : jetFuelSeries
          ? "trajectory"
          : "missing",
  };

  const warnings: string[] = [];
  if (dataStatus.prices === "missing") warnings.push(FUEL_NO_PRICE_NOTE);
  if (dataStatus.jetFuel === "missing") warnings.push(FUEL_JET_MISSING_NOTE);

  return { fastFactsCards, jetFuelSeries, jetFuelLabel, parsed, dataStatus, warnings };
}

/**
 * Canonical sample payload for the Fuel Watch hardNumbers jsonb.
 * Surfaced by the editor's "Load sample" button so authors have a
 * concrete, copy-pasteable starting point. Numbers are illustrative.
 */
export const FUEL_MARKET_DATA_SAMPLE = {
  fastFacts: {
    prices: [
      { label: "Brent crude", value: 109.26, unit: "USD/bbl", change: "+7.9% 7d", asOf: "2026-05-15", source: "Manual" },
      { label: "WTI crude", value: 101.02, unit: "USD/bbl", change: "+10.5% 7d", asOf: "2026-05-15", source: "Manual" },
      { label: "Jet fuel", benchmark: "US Gulf Coast kerosene-type jet fuel", value: 4.152, unit: "USD/gal", change: "+2.5% 7d", asOf: "2026-05-15", source: "EIA / FRED" },
    ],
    supply: [
      { label: "Fuel shortages / rationing", value: 5, unit: "events", note: "reporting window" },
    ],
    policy: [
      { label: "Subsidy / levy moves", value: 1, unit: "policy event", note: "reporting window" },
    ],
    routes: [
      { label: "Fuel-relevant chokepoint pressure", value: 15, unit: "records", note: "Hormuz / route disruption" },
    ],
  },
  jetFuelTrajectory: {
    benchmark: "US Gulf Coast kerosene-type jet fuel",
    source: "EIA / FRED",
    unit: "USD/gal",
    period: "last 30 days",
    points: [
      { date: "2026-04-17", value: 3.709 },
      { date: "2026-04-24", value: 3.906 },
      { date: "2026-05-01", value: 4.160 },
      { date: "2026-05-08", value: 4.049 },
      { date: "2026-05-15", value: 4.152 },
    ],
  },
} as const;

/**
 * Validate a hardNumbers payload from the editor. Returns the parsed
 * object (when valid) or a list of human-readable error messages.
 * The check is intentionally lenient about shape (we accept legacy
 * payloads too) and strict about basic types so the editor can surface
 * useful feedback before saving.
 */
export function validateFuelHardNumbersJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  const errors: string[] = [];
  if (value !== null && typeof value !== "object") {
    errors.push("Top-level value must be an object, array, or null.");
    return { ok: false, errors };
  }
  // Parse with the tolerant parser. If the resulting object is empty
  // AND the input was a non-empty object, the payload didn't carry
  // any recognised fields — surface that as a soft warning.
  const parsed = parseFuelHardNumbers(value);
  const hasAny =
    parsed.prices.length > 0 ||
    parsed.supply.length > 0 ||
    parsed.policy.length > 0 ||
    parsed.routes.length > 0 ||
    parsed.legacyCards.length > 0 ||
    parsed.jetFuel !== undefined ||
    parsed.jetFuelTrajectory.points.length > 0;
  if (!hasAny) {
    errors.push(
      "Payload parses as JSON but carries no recognised fields. Expected one of: fastFacts, prices, supply, policy, routes, jetFuel, jetFuelTrajectory, cards.",
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
