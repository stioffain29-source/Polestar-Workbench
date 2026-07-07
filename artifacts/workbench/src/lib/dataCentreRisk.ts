import type {
  DataCentreCountryRisk,
  DataCentreCountryRiskDimensions,
  DataCentreRiskDimension,
} from "@workspace/api-client-react";

// Display metadata for the per-country DATA-CENTRE RISK FRAMEWORK.
//
// The 16 dimension KEYS below MUST stay in lockstep with the OpenAPI
// `DataCentreCountryRiskDimensions` named properties and the Drizzle
// `DATA_CENTRE_RISK_DIMENSIONS` vocab in `lib/db`. We redefine label + order
// here rather than import from `@workspace/db` because that schema module pulls
// in drizzle/pg and must never be bundled into the browser.
//
// STRICT no-fabrication: a dimension with no rating reads "not reported" — it is
// never invented. `provisional` marks an unreviewed auto-seeded rating (amber).

export const DATA_CENTRE_RISK_DIMENSIONS = [
  { key: "regulatoryEnvironment", label: "Regulatory environment" },
  { key: "planningPermitting", label: "Planning and permitting risk" },
  { key: "corruption", label: "Corruption" },
  { key: "transparency", label: "Transparency" },
  { key: "politicalStability", label: "Political stability" },
  { key: "gridPowerStability", label: "Grid and power stability" },
  { key: "utilityWaterSupply", label: "Utility and water supply" },
  { key: "waterStress", label: "Water stress" },
  { key: "subseaConnectivity", label: "Subsea cable and connectivity resilience" },
  { key: "dataLocalisation", label: "Data localisation and data protection laws" },
  { key: "landRealEstate", label: "Land and real estate constraints" },
  { key: "environmentalClimate", label: "Environmental and climate exposure" },
  { key: "naturalHazard", label: "Natural hazard exposure" },
  { key: "securityCivilUnrest", label: "Security and civil unrest risk" },
  { key: "labourSkills", label: "Labour and skills availability" },
  { key: "taxIncentives", label: "Tax, incentives and investment environment" },
] as const;

export type DataCentreRiskDimensionKey =
  (typeof DATA_CENTRE_RISK_DIMENSIONS)[number]["key"];

export const RISK_RATINGS = [
  "Insignificant",
  "Low",
  "Moderate",
  "High",
  "Extreme",
] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];

// Brand five-tier ramp (mirrors SPOT_SEV_COLOR): petrol #1B6B7A is reserved for
// Insignificant only and subdued red #A33232 for Extreme only.
export const RISK_RATING_COLOR: Record<RiskRating, string> = {
  Insignificant: "#1B6B7A",
  Low: "#6FB872",
  Moderate: "#E67E22",
  High: "#C0392B",
  Extreme: "#A33232",
};
export const RISK_RATING_TEXT = "#FFFFFF";

// True when a dimension carries any analyst-entered content (so it is not
// simply "not reported").
export function dimensionHasContent(
  d: DataCentreRiskDimension | undefined,
): boolean {
  if (!d) return false;
  return Boolean(
    d.rating ||
      d.rationale?.trim() ||
      d.source?.trim() ||
      d.analystNote?.trim(),
  );
}

// The rated dimensions of a country risk row, in fixed order, keeping only
// those with an actual rating (used by the compact read strip).
export function ratedDimensions(
  risk: Pick<DataCentreCountryRisk, "dimensions">,
): Array<{ key: DataCentreRiskDimensionKey; label: string; value: DataCentreRiskDimension }> {
  const out: Array<{
    key: DataCentreRiskDimensionKey;
    label: string;
    value: DataCentreRiskDimension;
  }> = [];
  for (const { key, label } of DATA_CENTRE_RISK_DIMENSIONS) {
    const value = (risk.dimensions as DataCentreCountryRiskDimensions)[key];
    if (value && value.rating) out.push({ key, label, value });
  }
  return out;
}

export function provisionalCount(
  risk: Pick<DataCentreCountryRisk, "dimensions">,
): number {
  let n = 0;
  for (const { key } of DATA_CENTRE_RISK_DIMENSIONS) {
    const value = (risk.dimensions as DataCentreCountryRiskDimensions)[key];
    if (value && value.rating && value.provisional) n += 1;
  }
  return n;
}
