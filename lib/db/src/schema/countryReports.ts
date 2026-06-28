import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { KpiCard } from "./reports";

/**
 * One analyst-attached photograph on a country report. Stored as a resized data
 * URL (no object storage configured) so it rasterises reliably into the
 * DOM-rendered PDF with no CORS. Array order is the display order. Caption,
 * source, credit and context are optional analyst-supplied metadata rendered
 * alongside the image at its chosen placement slot.
 */
export interface CountryReportPhoto {
  dataUrl: string;
  caption?: string;
  source?: string;
  credit?: string;
  context?: string;
}

export const countryReportsTable = pgTable("country_reports", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  overview: text("overview"),
  trendSummary: text("trend_summary"),
  implications: text("implications"),
  keyNumbers: jsonb("key_numbers").$type<KpiCard[]>(),

  // Durable analyst layout controls (NOT part of the AI prose fingerprint cache,
  // so changing placement never invalidates or regenerates the narrative).
  // Where the incident map sits relative to the written brief.
  mapPlacement: text("map_placement"),
  // Where the analyst photo block sits relative to the written brief.
  photoPlacement: text("photo_placement"),
  // Analyst-attached photographs (resized data URLs + optional metadata).
  reportPhotos: jsonb("report_photos")
    .$type<CountryReportPhoto[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CountryReport = typeof countryReportsTable.$inferSelect;
export type InsertCountryReport = typeof countryReportsTable.$inferInsert;
