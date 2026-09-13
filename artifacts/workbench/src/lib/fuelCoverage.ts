import { addDays, format, parseISO } from "date-fns";
import type {
  FuelCanonicalFacts,
  FuelSeverity,
} from "./fuelCanonicalFacts";
import { deriveIncidentCountry } from "./shippingCountry";

export interface FuelCoverageSeverityCounts {
  Insignificant: number;
  Low: number;
  Moderate: number;
  High: number;
  Extreme: number;
}

export interface FuelCoverageCountry {
  country: string;
  /** Number of distinct, evidence-family-deduplicated developments. */
  count: number;
  /** Highest severity among this country's canonical developments. */
  highestSeverity: FuelSeverity | null;
  severityDistribution: FuelCoverageSeverityCounts;
}

export interface FuelCoverageDay {
  date: string;
  label: string;
  count: number;
}

export interface FuelCoverageSummary {
  /** One row per canonical evidence family, not one row per source article. */
  totalDistinctDevelopments: number;
  activeCountries: number;
  severityDistribution: FuelCoverageSeverityCounts;
  dailyTrend: FuelCoverageDay[];
  /** Sorted by distinct-development count, not by impact. */
  affectedCountries: FuelCoverageCountry[];
  /** Developments omitted from the country table because geography is unresolved. */
  unattributedDevelopmentCount: number;
  /** Canonical report window, retained for a visible coverage note. */
  reportingPeriod: { start: string; end: string };
}

const SEVERITIES: readonly FuelSeverity[] = [
  "Insignificant",
  "Low",
  "Moderate",
  "High",
  "Extreme",
];

const SEVERITY_RANK: Record<FuelSeverity, number> = {
  Insignificant: 1,
  Low: 2,
  Moderate: 3,
  High: 4,
  Extreme: 5,
};
function emptySeverityCounts(): FuelCoverageSeverityCounts {
  return {
    Insignificant: 0,
    Low: 0,
    Moderate: 0,
    High: 0,
    Extreme: 0,
  };
}

function dateOnly(value: string): string | null {
  const match = (value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function dateLabel(value: string): string {
  try {
    const parsed = parseISO(value);
    return Number.isNaN(parsed.getTime()) ? value : format(parsed, "dd MMM");
  } catch {
    return value;
  }
}

function reportingPeriodDates(start: string, end: string): string[] {
  const first = parseISO(start);
  const last = parseISO(end);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || first > last) {
    return [];
  }

  const dates: string[] = [];
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    dates.push(format(cursor, "yyyy-MM-dd"));
  }
  return dates;
}

/**
 * Build the compact Fuel Watch coverage model from the canonical qualifying
 * set. `canonicalFacts.qualifyingIncidents` contains one record per evidence
 * family; its members are deliberately not counted here, so syndicated,
 * commentary and follow-on coverage cannot inflate development totals.
 *
 * This is intentionally a pure projection. It does not re-run the relevance
 * predicate or the weekly window, and it never reads the raw incident array.
 * The publication boundary has already applied those gates before it creates
 * FuelCanonicalFacts.
 */
export function buildFuelCoverageSummary(
  canonicalFacts: FuelCanonicalFacts,
): FuelCoverageSummary {
  const incidents = canonicalFacts.qualifyingIncidents;
  const severityDistribution = emptySeverityCounts();
  const daily = new Map<string, number>();
  const countries = new Map<string, FuelCoverageCountry>();

  for (const incident of incidents) {
    severityDistribution[incident.severity] += 1;

    const date = dateOnly(incident.occurredAt) ?? incident.date;
    if (date) daily.set(date, (daily.get(date) ?? 0) + 1);

    const country =
      incident.country?.trim() ||
      deriveIncidentCountry({
        country: incident.raw.country,
        location: incident.raw.location,
        title: incident.raw.title,
        summary: incident.raw.summary,
      });
    if (!country) continue;
    const row =
      countries.get(country) ??
      {
        country,
        count: 0,
        highestSeverity: null,
        severityDistribution: emptySeverityCounts(),
      };
    row.count += 1;
    row.severityDistribution[incident.severity] += 1;
    if (
      !row.highestSeverity ||
      SEVERITY_RANK[incident.severity] > SEVERITY_RANK[row.highestSeverity]
    ) {
      row.highestSeverity = incident.severity;
    }
    countries.set(country, row);
  }

  const periodDates = reportingPeriodDates(
    canonicalFacts.reportingPeriod.start,
    canonicalFacts.reportingPeriod.end,
  );
  const dailyTrend = (periodDates.length > 0
    ? periodDates.map((date) => [date, daily.get(date) ?? 0] as const)
    : [...daily.entries()].sort(([a], [b]) => a.localeCompare(b))
  ).map(([date, count]) => ({ date, label: dateLabel(date), count }));

  // A country table contains countries only. Try the shared text/location
  // resolver above, then omit still-unresolved geography instead of presenting
  // "Unattributed" as though it were a country.
  const attributedCountries = [...countries.values()]
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  const attributedDevelopmentCount = attributedCountries.reduce(
    (sum, row) => sum + row.count,
    0,
  );

  return {
    totalDistinctDevelopments: canonicalFacts.evidenceFamilies.length,
    activeCountries: attributedCountries.length,
    severityDistribution,
    dailyTrend,
    affectedCountries: attributedCountries,
    unattributedDevelopmentCount:
      canonicalFacts.evidenceFamilies.length - attributedDevelopmentCount,
    reportingPeriod: {
      start: canonicalFacts.reportingPeriod.start,
      end: canonicalFacts.reportingPeriod.end,
    },
  };
}

// Short alias for consumers that already have a canonical facts object and
// prefer the noun used by the rendered section.
export const buildFuelCoverage = buildFuelCoverageSummary;

export { SEVERITIES as FUEL_COVERAGE_SEVERITIES };