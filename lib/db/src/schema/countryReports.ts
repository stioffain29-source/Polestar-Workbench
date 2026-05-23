import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { KpiCard } from "./reports";

export const countryReportsTable = pgTable("country_reports", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  overview: text("overview"),
  trendSummary: text("trend_summary"),
  implications: text("implications"),
  keyNumbers: jsonb("key_numbers").$type<KpiCard[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CountryReport = typeof countryReportsTable.$inferSelect;
export type InsertCountryReport = typeof countryReportsTable.$inferInsert;
