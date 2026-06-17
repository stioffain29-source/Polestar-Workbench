import { pgTable, serial, text, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";

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
  // Real publisher URL resolved from a Google News RSS redirect link (see
  // @workspace/ingest googleNewsUrl.ts). Most flashpoint feeds are Google News
  // aggregators, so `source_url` is an opaque news.google.com/rss/articles/...
  // redirect; this additive, nullable column holds the underlying article URL
  // so the GDELT enrichment URL-match can fire. Nullable: not-yet-resolved /
  // already-direct rows leave it null and every consumer falls back to
  // `source_url`. The original `source_url` is never mutated.
  resolvedUrl: text("resolved_url"),
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
  // ---------------------------------------------------------------------------
  // GDELT precision-enrichment layer (additive — see @workspace/ingest
  // gdeltEnrich.ts). A low-cadence GDELT Conflict-Events pull cross-matches the
  // keyword-scraped flashpoint rows and attaches the STRUCTURED, ACLED-style
  // fields the keyword scraper cannot produce. All nullable: a row only carries
  // these when GDELT matched it; every surface falls back to the base fields
  // when absent. The keyword feed is NEVER replaced — GDELT only enriches.
  // ---------------------------------------------------------------------------
  // Confirmed fatality count from GDELT's AI-coded event (0+). Null = GDELT
  // reported no count / no match. Feeds severity scoring (a fatal protest reads
  // Extreme even when the headline carried no casualty word).
  fatalities: integer("fatalities"),
  // Named actor pair ("Protesters / Police"), GDELT actor1 / actor2.
  actors: text("actors"),
  // ACLED event_type (Protests / Riots) and finer sub_event_type.
  gdeltEventType: text("gdelt_event_type"),
  gdeltSubEventType: text("gdelt_sub_event_type"),
  // GDELT AI coding confidence 0..1 for the matched event.
  gdeltConfidence: doublePrecision("gdelt_confidence"),
  // Last time the GDELT enrichment pass EXAMINED this incident (matched or
  // not). Nullable = never checked. Drives the bounded, low-cadence back-match
  // exactly like corroborationCheckedAt: the pass only re-checks rows it has
  // not seen within the cadence interval, so QU usage stays inside the free
  // budget and the pass converges across runs.
  gdeltEnrichedAt: timestamp("gdelt_enriched_at", { withTimezone: true }),
});

export type Incident = typeof incidentsTable.$inferSelect;
export type InsertIncident = typeof incidentsTable.$inferInsert;
