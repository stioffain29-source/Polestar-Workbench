import { pgTable, serial, text, timestamp, jsonb, date } from "drizzle-orm/pg-core";

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
  situation: text("situation"),
  whatHappened: text("what_happened"),
  hardNumbers: jsonb("hard_numbers").$type<FuelHardNumbers>(),
  whatMatters: text("what_matters"),
  implications: text("implications"),
  polestarView: text("polestar_view"),
  watchNext: text("watch_next"),
  author: text("author"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
export type InsertReport = typeof reportsTable.$inferInsert;
