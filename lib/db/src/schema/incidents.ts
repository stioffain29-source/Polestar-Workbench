import { pgTable, serial, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";

export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  // Clean English advisory title produced at ingest for non-English source
  // headlines (e.g. Bahasa Indonesia from Jubi.id). Nullable: English rows and
  // not-yet-processed rows leave it null and the UI falls back to the original
  // `title`. The original headline is ALWAYS preserved in `title`.
  displayTitle: text("display_title"),
  summary: text("summary").notNull(),
  country: text("country").notNull(),
  location: text("location"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  severity: text("severity").notNull(),
  confidence: text("confidence").notNull(),
  source: text("source"),
  sourceUrl: text("source_url"),
  analystNotes: text("analyst_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Persisted relevance verdict (see @workspace/relevance). Nullable so
  // legacy rows read fail-open until the boot backfill evaluates them.
  relevanceStatus: text("relevance_status"),
  relevanceScore: doublePrecision("relevance_score"),
  relevanceReason: text("relevance_reason"),
  relevanceVersion: text("relevance_version"),
  relevanceEvaluatedAt: timestamp("relevance_evaluated_at", { withTimezone: true }),
  // Last time the ReliefWeb corroboration pass examined this incident. Nullable
  // = never checked. Drives the bounded back-match: the pass re-checks recent
  // rows (official sitreps lag the news) and back-fills never-checked older rows
  // a batch at a time, stamping this so it converges across runs rather than
  // re-querying every un-corroborated row forever.
  corroborationCheckedAt: timestamp("corroboration_checked_at", { withTimezone: true }),
});

export type Incident = typeof incidentsTable.$inferSelect;
export type InsertIncident = typeof incidentsTable.$inferInsert;
