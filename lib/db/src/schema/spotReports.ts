import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  doublePrecision,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One entry in a spot report's export history. Appended every time the
 * analyst exports the report (PDF, Word, or plain-text copy block).
 */
export interface SpotReportExportEntry {
  format: "pdf" | "docx" | "text";
  exportedAt: string;
  exportedBy?: string;
}

/**
 * Standalone, analyst-led, incident-triggered Spot Report. Deliberately kept
 * separate from the scheduled `reports` table (Fuel/Shipping/Cargo/Flashpoint/
 * Country/Strikes) — Spot Reports are fast, breaking-event products an analyst
 * generates from one or more incidents (or manually).
 *
 * Most narrative/location fields are nullable so a draft can be saved while
 * still incomplete; the pre-export quality check (not the DB) enforces which
 * fields must be present before a client-facing export.
 */
export const spotReportsTable = pgTable("spot_reports", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // draft | final
  status: text("status").notNull().default("draft"),

  // Report issuance date-time and the underlying incident date-time.
  reportDate: timestamp("report_date", { withTimezone: true }).notNull().defaultNow(),
  incidentDate: timestamp("incident_date", { withTimezone: true }),

  // Granular location + coordinates.
  country: text("country"),
  province: text("province"),
  city: text("city"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),

  category: text("category"),
  // Five-tier vocabulary: insignificant | low | moderate | high | extreme.
  severity: text("severity"),

  // Narrative sections (analyst-written; no AI prose).
  bluf: text("bluf"),
  incidentDetails: text("incident_details"),
  currentSituation: text("current_situation"),
  operationalImpact: text("operational_impact"),
  assessment: text("assessment"),
  // 24-72h outlook.
  outlook: text("outlook"),
  recommendedActions: text("recommended_actions"),
  analystNotes: text("analyst_notes"),

  // Internal-only confidence: low | medium | high.
  confidenceLevel: text("confidence_level"),
  // Internal source notes. Hidden from client exports unless the flag below is on.
  internalSourceNotes: text("internal_source_notes"),
  showSourcesInExport: boolean("show_sources_in_export").notNull().default(false),

  // Linked incident IDs (one or several related incidents).
  linkedIncidentIds: jsonb("linked_incident_ids")
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Optional incident map.
  mapEnabled: boolean("map_enabled").notNull().default(false),
  affectedRadiusKm: doublePrecision("affected_radius_km"),

  // Analyst-entered authorship (NOT authenticated identity — workbench is public).
  createdBy: text("created_by"),

  exportHistory: jsonb("export_history")
    .$type<SpotReportExportEntry[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SpotReport = typeof spotReportsTable.$inferSelect;
export type InsertSpotReport = typeof spotReportsTable.$inferInsert;
