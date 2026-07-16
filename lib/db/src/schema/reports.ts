import { pgTable, serial, text, timestamp, jsonb, date } from "drizzle-orm/pg-core";

/**
 * Durable analyst curation of a topic report — hide canonical sections,
 * exclude relevance-passing window incidents, and DEMOTE-ONLY severity
 * corrections. Same shape and semantics as the country brief's
 * CountryReportSectionOverrides. Nullable/additive; NOT part of any prose
 * cache key.
 */
export interface ReportSectionOverrides {
  hiddenSections?: string[];
  excludedIncidentIds?: string[];
  severityDemotions?: Record<string, string>;
}

export type KpiCard = {
  label: string;
  value: string;
  accent?: string;
  context?: string;
};

/** Jet fuel benchmark price point. See openapi.yaml JetFuelPricePoint. */
export type JetFuelPricePoint = {
  date: string;
  value: number;
  unit?: string;
  label?: string;
  annotation?: string;
};

/**
 * A single fuel-market card (Fast Facts). See OpenAPI FuelDataCard.
 * `value` is intentionally `number | string` so authors can store
 * either a numeric benchmark (formatted at render time) or a
 * pre-formatted string for human-curated cards.
 */
export type FuelDataCard = {
  label: string;
  value: number | string;
  unit?: string;
  change?: string;
  asOf?: string;
  source?: string;
  note?: string;
  /** Optional benchmark name. Appended to the label by the renderer. */
  benchmark?: string;
};

/** Headline jet fuel snapshot. See OpenAPI JetFuelSnapshot. */
export type JetFuelSnapshot = {
  benchmark?: string;
  source?: string;
  unit?: string;
  latestValue?: number;
  asOf?: string;
  change?: string;
};

/** Jet fuel trajectory container. Accepts both the v1 bare array and
 *  the v2 named container — see OpenAPI JetFuelTrajectory. */
export type JetFuelTrajectory =
  | JetFuelPricePoint[]
  | {
      benchmark?: string;
      source?: string;
      unit?: string;
      period?: string;
      points: JetFuelPricePoint[];
    };

/** Optional wrapper for Fast Facts. See OpenAPI FuelFastFacts. */
export type FuelFastFacts = {
  prices?: FuelDataCard[];
  supply?: FuelDataCard[];
  policy?: FuelDataCard[];
  routes?: FuelDataCard[];
};

/**
 * Container for the report.hardNumbers jsonb column. All fields are
 * optional so legacy reports (null, KpiCard[], or `{cards:[...]}` only)
 * stay valid. Fuel Watch reports use the v2 fields below.
 */
export type FuelHardNumbers = {
  cards?: KpiCard[];
  jetFuelTrajectory?: JetFuelTrajectory;
  jetFuelBenchmarkLabel?: string;
  fastFacts?: FuelFastFacts;
  prices?: FuelDataCard[];
  supply?: FuelDataCard[];
  policy?: FuelDataCard[];
  routes?: FuelDataCard[];
  jetFuel?: JetFuelSnapshot;
};

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  countrySlug: text("country_slug"),
  status: text("status").notNull(),
  issueDate: date("issue_date").notNull(),
  // Analyst-set risk rating (five-tier vocabulary). Optional: left null the
  // card pull falls back to the rating computed from the report's scoped
  // incidents, then to the prose heuristic. See cardAutofill.reportToCard.
  riskRating: text("risk_rating"),
  executiveSummary: text("executive_summary"),
  situation: text("situation"),
  whatHappened: text("what_happened"),
  hardNumbers: jsonb("hard_numbers").$type<FuelHardNumbers>(),
  whatMatters: text("what_matters"),
  implications: text("implications"),
  polestarView: text("polestar_view"),
  watchNext: text("watch_next"),
  // Flashpoint/protests data-driven "reads" — editable analyst overrides.
  // Blank/NULL falls back to the dataset-generated read so the on-screen
  // preview, the in-app PDF and the headless PDF stay identical and no prose
  // is fabricated. See FlashpointReportPreview / exportFlashpointReportPdf.
  activismRead: text("activism_read"),
  civilUnrestRead: text("civil_unrest_read"),
  forecastRead: text("forecast_read"),
  regionalCountryRead: text("regional_country_read"),
  // Topic-specific data-driven "reads" — editable analyst overrides with the
  // SAME semantics as the flashpoint reads above: blank/NULL falls back to the
  // dataset-generated read so the on-screen preview, the in-app PDF and the
  // headless PDF stay identical and no prose is fabricated. regionalCountryRead
  // (above) is REUSED for shipping "Regional & Country View" + cargo
  // "Regional Read" (a report row is always a single topic, so no collision).
  // Shipping:
  chokepointRouteRead: text("chokepoint_route_read"),
  vesselPiracyRead: text("vessel_piracy_read"),
  commercialImpactRead: text("commercial_impact_read"),
  maritimeSecurityRead: text("maritime_security_read"),
  // Cargo Watch:
  cargoSecurityRead: text("cargo_security_read"),
  logisticsHubRead: text("logistics_hub_read"),
  // Fuel:
  fuelMarketRead: text("fuel_market_read"),
  fuelOperationalRead: text("fuel_operational_read"),
  fuelRegionalHighlights: text("fuel_regional_highlights"),
  // Conflict: single Other Watched Theatres read + a per-theatre map keyed by
  // the activity-area theatre name (Record<theatre, override>).
  conflictOtherWatchedRead: text("conflict_other_watched_read"),
  conflictAreaReads: jsonb("conflict_area_reads").$type<Record<string, string>>(),
  // Durable analyst curation (hidden sections, excluded window incidents,
  // demote-only severity corrections). Nullable/additive.
  sectionOverrides: jsonb("section_overrides").$type<ReportSectionOverrides>(),
  author: text("author"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
export type InsertReport = typeof reportsTable.$inferInsert;
