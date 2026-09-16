import { addDays, format, parseISO } from "date-fns";
import type {
  FuelCanonicalFacts,
} from "./fuelCanonicalFacts";
import { deriveIncidentCountry } from "./shippingCountry";

export type FuelOperationalSeverity = "S1" | "S2" | "S3" | "S4" | "S5";
export type FuelCoverageSeverityCounts = Record<FuelOperationalSeverity, number>;

export const FUEL_OPERATIONAL_SEVERITY_LABELS: Record<FuelOperationalSeverity, string> = {
  S1: "Limited",
  S2: "Material",
  S3: "Serious",
  S4: "Major",
  S5: "Critical",
};

export interface FuelCoverageCountry {
  country: string;
  /** Number of distinct, evidence-family-deduplicated developments. */
  count: number;
  /** Highest fuel-operational severity among this country's developments. */
  highestSeverity: FuelOperationalSeverity | null;
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

const SEVERITIES: readonly FuelOperationalSeverity[] = ["S1", "S2", "S3", "S4", "S5"];

const SEVERITY_RANK: Record<FuelOperationalSeverity, number> = {
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 5,
};
function emptySeverityCounts(): FuelCoverageSeverityCounts {
  return { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
}

/**
 * Fuel severity measures the confirmed operational or market effect of a
 * development. It is deliberately independent of both the source incident's
 * generic severity label and the report's forward-looking risk rating.
 */
export function assessFuelOperationalSeverity(
  incident: FuelCanonicalFacts["qualifyingIncidents"][number],
): FuelOperationalSeverity {
  const text = `${incident.title} ${incident.raw.summary ?? ""}`.toLowerCase();
  const international = /\b(?:international|global|multiple countries|multi-market|european customers?|european refiners?|cross-border)\b/.test(text);
  const sustained = /\b(?:sustained|prolonged|indefinite|weeks?|months?|strategic-scale)\b/.test(text);
  if (international && sustained
      && /\b(?:supply cut|shipments? (?:halted|suspended|cancelled)|critical shortage|exports? (?:halted|suspended))\b/.test(text)) {
    return "S5";
  }
  if (
    /\b(?:pipeline|refinery|terminal|export route|port)\b/.test(text)
    && /\b(?:offline|shut(?:down)?|closed|closure|major damage|destroyed|outage)\b/.test(text)
    || /\b(?:cancelled|canceled|delayed|suspended|halted)\b.{0,60}\b(?:cargoes?|shipments?|loadings?|exports?)\b/.test(text)
    || /\b(?:cargoes?|shipments?|loadings?|exports?)\b.{0,60}\b(?:cancelled|canceled|delayed|suspended|halted)\b/.test(text)
  ) {
    return "S4";
  }
  if (
    /\b(?:significant|rationing|shortage|supply constraint|output loss|production cut|price surge|prices? (?:rose|jumped|surged))\b/.test(text)
    || /\b(?:fuel|crude|diesel|petrol|gasoline|jet fuel)\b.{0,60}\b(?:disruption|tightness|unavailable)\b/.test(text)
  ) {
    return "S3";
  }
  if (/\b(?:delay|disruption|allocation|price increase|duty|subsidy|tender|replacement barrels?)\b/.test(text)) {
    return "S2";
  }
  return "S1";
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
    const operationalSeverity = assessFuelOperationalSeverity(incident);
    severityDistribution[operationalSeverity] += 1;

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
    row.severityDistribution[operationalSeverity] += 1;
    if (
      !row.highestSeverity ||
      SEVERITY_RANK[operationalSeverity] > SEVERITY_RANK[row.highestSeverity]
    ) {
      row.highestSeverity = operationalSeverity;
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