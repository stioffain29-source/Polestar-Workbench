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
import type {
  SpotReportExportEntry,
  SpotMapMarker,
  SpotReportPhoto,
} from "./spotReports";

/**
 * One manually-entered data point on a Special Report chart. Special Reports do
 * NOT compute charts from live data — the analyst types each label/value pair by
 * hand — so the stored shape is deliberately tiny. An optional colour lets a bar
 * carry a severity tint; when absent it falls back to the brand Electric Blue.
 */
export interface SpecialReportChartPoint {
  label: string;
  value: number;
  color?: string;
}

/**
 * One analyst-built horizontal bar chart on a Special Report. Rendered as
 * card-native HTML/div bars (recharts SVG mangles under html2canvas), so the
 * on-screen preview and the DOM-rasterised PDF are byte-identical. Points are
 * drawn in array order and scaled against the largest value.
 */
export interface SpecialReportChart {
  title?: string;
  unit?: string;
  points: SpecialReportChartPoint[];
}

/**
 * One block in a Special Report's free-form BODY. The analyst composes the body
 * from an ordered list of these — adding, removing and reordering freely — so
 * nothing about the layout is fixed. A flat optional shape (rather than a
 * discriminated union) keeps the OpenAPI/Orval/zod codegen simple; the `type`
 * field selects which optional fields are meaningful:
 *  - "heading"   → `text` (a section title)
 *  - "text"      → `body`  (free prose; blank lines split paragraphs)
 *  - "bullets"   → `body`  (one bullet per line)
 *  - "chart"     → `chart` (a manually-entered HTML/div bar chart)
 *  - "image"     → `dataUrl` + optional `caption` (an inline figure)
 *  - "map"       → singleton reference; draws the report's incident map + points
 *  - "incidents" → singleton reference; the linked Reference Incidents table
 */
export type SpecialReportBlockType =
  | "heading"
  | "text"
  | "bullets"
  | "chart"
  | "image"
  | "map"
  | "incidents";

export interface SpecialReportBlock {
  /** Stable client-generated id — react keys and reorder identity. */
  id: string;
  type: SpecialReportBlockType;
  text?: string;
  body?: string;
  chart?: SpecialReportChart;
  dataUrl?: string;
  caption?: string;
}

/**
 * Standalone, analyst-led, multi-domain Special Report. A lean one-off product
 * built on the same foundation as the Spot Report (kept in its OWN table so the
 * two never entangle), with three additions: a CHOSEN FRONT COVER (a library
 * pick OR a custom upload), manually-entered charts, and the same photos/map.
 *
 * Most narrative/location fields are nullable so a draft can be saved while
 * still incomplete; the pre-export quality check (not the DB) enforces which
 * fields must be present before a client-facing export.
 */
export const specialReportsTable = pgTable("special_reports", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // draft | final
  status: text("status").notNull().default("draft"),

  // Report issuance date-time and the underlying event date-time.
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

  // Chosen front cover. Exactly one is used at render time (custom upload wins):
  //  - coverImageKey     — a key into the workbench cover library, resolved to an
  //                        imported asset URL client-side (build-hashed URLs are
  //                        not stored, so a key survives rebuilds).
  //  - coverImageDataUrl — a custom-uploaded, resized JPEG data URL.
  coverImageKey: text("cover_image_key"),
  coverImageDataUrl: text("cover_image_data_url"),

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

  // Analyst-placed extra markers beyond the primary lat/long and linked
  // incidents — each its own coordinate with an optional label and severity.
  mapPoints: jsonb("map_points")
    .$type<SpotMapMarker[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Analyst-built manually-entered charts, rendered as HTML/div bar charts.
  charts: jsonb("charts")
    .$type<SpecialReportChart[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Analyst-attached photographs (resized data URLs + optional captions),
  // rendered after the Incident Details section on screen and in the PDF.
  photos: jsonb("photos")
    .$type<SpotReportPhoto[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Free-form ordered report BODY. When non-empty, the preview + PDF render
  // these blocks in order (headings, prose, bullets, charts, inline images,
  // plus singleton map / reference-incidents blocks drawn from the report-level
  // fields). When empty (legacy rows saved before the block model), the renderer
  // synthesises a default block list from the fixed narrative columns below, so
  // old reports render unchanged. New saves write blocks and null the legacy
  // narrative columns.
  blocks: jsonb("blocks")
    .$type<SpecialReportBlock[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Analyst-entered authorship (NOT authenticated identity).
  createdBy: text("created_by"),

  exportHistory: jsonb("export_history")
    .$type<SpotReportExportEntry[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SpecialReport = typeof specialReportsTable.$inferSelect;
export type InsertSpecialReport = typeof specialReportsTable.$inferInsert;
