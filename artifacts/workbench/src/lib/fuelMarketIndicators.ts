import { format, subDays } from "date-fns";
import { resolveReportWindow } from "./reportWindow";

export type FuelMarketDirection =
  | "rising"
  | "falling"
  | "broadly stable"
  | "unchanged";

/** One neutral band for every Fuel Watch market calculation. */
export const FUEL_MARKET_DIRECTION_NEUTRAL_PCT = 0.75;

export function fuelDirectionForPct(
  pct: number | null | undefined,
): FuelMarketDirection | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  if (pct === 0) return "unchanged";
  if (pct >= FUEL_MARKET_DIRECTION_NEUTRAL_PCT) return "rising";
  if (pct <= -FUEL_MARKET_DIRECTION_NEUTRAL_PCT) return "falling";
  return "broadly stable";
}

export type FuelMarketTemporalStatus =
  | "current-period"
  | "lagged"
  | "future"
  | "undated";

export type FuelMarketComparisonScope =
  | "reporting-period"
  | "lagged-reference"
  | "undated-reference"
  | "none";

export interface FuelMarketObservationInput {
  label: string;
  value: number | string;
  change?: string;
  unit?: string;
  asOf?: string;
  source?: string;
  /** Optional explicit comparison fields supported by newer ingest payloads. */
  referenceDate?: string;
  referenceValue?: number;
}

export interface DerivedFuelMarketIndicator {
  label: string;
  currentValue: number | string;
  currentDate: string | null;
  referenceValue: number | null;
  referenceDate: string | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  direction: FuelMarketDirection | null;
  unit: string | null;
  source: string | null;
  basis: "explicit-reference" | "change-string" | "trajectory" | "none";
  temporalStatus: FuelMarketTemporalStatus;
  comparisonScope: FuelMarketComparisonScope;
}

function isoDay(value: string | null | undefined): string | null {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function numberOf(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentageFromChange(change: string | undefined): number | null {
  const match = change?.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function inferredReferenceDate(change: string | undefined, currentDate: string | null): string | null {
  if (!change || !currentDate) return null;
  const amount = change.match(/\b(\d+)\s*(d|day|days|w|week|weeks)\b/i);
  if (!amount) return null;
  const date = new Date(`${currentDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const count = Number(amount[1]) * (/^w/i.test(amount[2]) ? 7 : 1);
  return format(subDays(date, count), "yyyy-MM-dd");
}

function temporalStatus(date: string | null, periodStart: string, periodEnd: string): FuelMarketTemporalStatus {
  if (!date) return "undated";
  if (date < periodStart) return "lagged";
  if (date > periodEnd) return "future";
  return "current-period";
}

/**
 * Derive a market indicator once, with dated current and reference evidence.
 * A trajectory uses its latest point as current and the earliest point inside
 * the report window as reference. Only when no such point exists does it use
 * the nearest older point, explicitly classed as a lagged reference.
 */
export function deriveFuelMarketIndicator(opts: {
  card: FuelMarketObservationInput;
  issueDate: string;
  trajectory?: { date: string; value: number }[];
}): DerivedFuelMarketIndicator {
  const { start, end } = resolveReportWindow("fuel", opts.issueDate);
  const periodStart = format(start, "yyyy-MM-dd");
  const periodEnd = format(end, "yyyy-MM-dd");
  const points = (opts.trajectory ?? [])
    .map((point) => ({ ...point, day: isoDay(point.date) }))
    .filter((point): point is typeof point & { day: string } => point.day !== null)
    .sort((a, b) => a.day.localeCompare(b.day));

  let currentValue: number | string = opts.card.value;
  let currentDate = isoDay(opts.card.asOf);
  let referenceValue = numberOf(opts.card.referenceValue);
  let referenceDate = isoDay(opts.card.referenceDate);
  let percentageChange: number | null = null;
  let basis: DerivedFuelMarketIndicator["basis"] = "none";

  if (points.length >= 2) {
    const latest = points[points.length - 1];
    const inPeriodReferences = points.filter(
      (point) => point !== latest && point.day >= periodStart && point.day <= periodEnd,
    );
    const reference = inPeriodReferences[0] ?? points.filter((point) => point.day < latest.day).at(-1);
    currentValue = latest.value;
    currentDate = latest.day;
    if (reference) {
      referenceValue = reference.value;
      referenceDate = reference.day;
      percentageChange =
        reference.value !== 0 ? ((latest.value - reference.value) / reference.value) * 100 : 0;
      basis = "trajectory";
    }
  } else if (referenceValue !== null) {
    const current = numberOf(currentValue);
    percentageChange =
      current !== null && referenceValue !== 0
        ? ((current - referenceValue) / referenceValue) * 100
        : null;
    basis = "explicit-reference";
  } else {
    percentageChange = percentageFromChange(opts.card.change);
    const current = numberOf(currentValue);
    if (current !== null && percentageChange !== null && percentageChange !== -100) {
      referenceValue = current / (1 + percentageChange / 100);
      referenceDate = referenceDate ?? inferredReferenceDate(opts.card.change, currentDate);
      basis = "change-string";
    }
  }

  const currentNumeric = numberOf(currentValue);
  const status = temporalStatus(currentDate, periodStart, periodEnd);
  const referenceStatus = temporalStatus(referenceDate, periodStart, periodEnd);
  const comparisonScope: FuelMarketComparisonScope =
    referenceValue === null
      ? "none"
      : !referenceDate
        ? "undated-reference"
        : status === "current-period" && referenceStatus === "current-period"
          ? "reporting-period"
          : "lagged-reference";

  return {
    label: opts.card.label,
    currentValue,
    currentDate,
    referenceValue,
    referenceDate,
    absoluteChange:
      currentNumeric !== null && referenceValue !== null
        ? currentNumeric - referenceValue
        : null,
    percentageChange,
    direction: fuelDirectionForPct(percentageChange),
    unit: opts.card.unit ?? null,
    source: opts.card.source ?? null,
    basis,
    temporalStatus: status,
    comparisonScope,
  };
}