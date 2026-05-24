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
 * Container for the report.hardNumbers jsonb column. Fuel Watch uses
 * `jetFuelTrajectory` to drive the Jet Fuel Price Trajectory chart.
 * Both fields are optional so legacy reports with null hardNumbers
 * stay valid, and reports that only carry cards stay valid too.
 */
export type FuelHardNumbers = {
  cards?: KpiCard[];
  jetFuelTrajectory?: JetFuelPricePoint[];
  jetFuelBenchmarkLabel?: string;
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
