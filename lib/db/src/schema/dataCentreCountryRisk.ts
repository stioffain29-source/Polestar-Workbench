import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Per-country DATA-CENTRE RISK FRAMEWORK.
//
// One row per country carries an analyst-maintained risk assessment across a
// FIXED set of 16 dimensions. Each dimension's assessment can be auto-SEEDED
// from a cited public index (e.g. Transparency International CPI for corruption
// / transparency) and then refined or overridden by the analyst.
//
// STRICT no-fabrication: a dimension with no rating reads "not reported" — it is
// NEVER guessed. Seeded ratings carry `provisional: true` (rendered as an amber
// badge) until the analyst reviews and saves, which clears the flag. Every
// rating carries a `source` citation and an optional analyst note.
//
// This table is ISOLATED context: it never touches incidents and can never
// inflate any incident count.

// The Polestar five-tier risk scale. `null` = "not reported" (never invented).
export const DATA_CENTRE_RISK_RATINGS = [
  "Insignificant",
  "Low",
  "Moderate",
  "High",
  "Extreme",
] as const;
export type DataCentreRiskRating = (typeof DATA_CENTRE_RISK_RATINGS)[number];

// The 16 FIXED risk dimensions. `key` is the stable jsonb property (never
// change once shipped); `label` is the display string. Any new dimension is a
// code change in lockstep with the OpenAPI `DataCentreCountryRisk.dimensions`
// named properties.
export const DATA_CENTRE_RISK_DIMENSIONS = [
  { key: "regulatoryEnvironment", label: "Regulatory environment" },
  { key: "planningPermitting", label: "Planning and permitting risk" },
  { key: "corruption", label: "Corruption" },
  { key: "transparency", label: "Transparency" },
  { key: "politicalStability", label: "Political stability" },
  { key: "gridPowerStability", label: "Grid and power stability" },
  { key: "utilityWaterSupply", label: "Utility and water supply" },
  { key: "waterStress", label: "Water stress" },
  {
    key: "subseaConnectivity",
    label: "Subsea cable and connectivity resilience",
  },
  {
    key: "dataLocalisation",
    label: "Data localisation and data protection laws",
  },
  { key: "landRealEstate", label: "Land and real estate constraints" },
  { key: "environmentalClimate", label: "Environmental and climate exposure" },
  { key: "naturalHazard", label: "Natural hazard exposure" },
  { key: "securityCivilUnrest", label: "Security and civil unrest risk" },
  { key: "labourSkills", label: "Labour and skills availability" },
  { key: "taxIncentives", label: "Tax, incentives and investment environment" },
] as const;
export type DataCentreRiskDimensionKey =
  (typeof DATA_CENTRE_RISK_DIMENSIONS)[number]["key"];

// One dimension's assessment. `rating` null = "not reported". `provisional` is
// true for an unreviewed seeded rating; `overridden` is true once the analyst
// has manually set the rating away from any seed. `seededFrom` records the
// public-index provenance (e.g. "TI CPI 2024") when the value was auto-seeded.
export type DataCentreRiskDimensionValue = {
  rating: DataCentreRiskRating | null;
  rationale: string;
  source: string;
  analystNote: string;
  provisional: boolean;
  overridden: boolean;
  seededFrom: string | null;
};

// The dimensions object. A missing key reads "not reported"; the editor always
// renders all 16, so absent keys are simply un-assessed.
export type DataCentreRiskDimensions = Partial<
  Record<DataCentreRiskDimensionKey, DataCentreRiskDimensionValue>
>;

export const dataCentreCountryRiskTable = pgTable(
  "data_centre_country_risk",
  {
    id: serial("id").primaryKey(),

    // Free-text country, normalised on write (trimmed). Uniqueness is enforced
    // case-insensitively via the lower(country) unique index below so the same
    // country cannot be assessed twice under differing case.
    country: text("country").notNull(),

    // The 16-dimension assessment map (see DataCentreRiskDimensions).
    dimensions: jsonb("dimensions")
      .$type<DataCentreRiskDimensions>()
      .notNull()
      .default({}),

    // Optional analyst-written overall summary for the country.
    overallNote: text("overall_note"),

    // Analyst-entered authorship (NOT authenticated identity).
    createdBy: text("created_by"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byCountryLower: uniqueIndex(
      "data_centre_country_risk_country_lower_idx",
    ).on(sql`lower(${t.country})`),
  }),
);

export type DataCentreCountryRiskRow =
  typeof dataCentreCountryRiskTable.$inferSelect;
export type InsertDataCentreCountryRisk =
  typeof dataCentreCountryRiskTable.$inferInsert;
