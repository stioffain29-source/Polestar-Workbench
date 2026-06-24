import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const sourcesTable = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  topic: text("topic").notNull(),
  sourceType: text("source_type").notNull(),
  url: text("url"),
  status: text("status").notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  // Number of CONSECUTIVE failed ingest runs for this feed. A successful run
  // resets it to 0; the Source Health pipeline only escalates a feed to
  // "failing" once this crosses the escalation threshold, so a single transient
  // timeout never flips a healthy feed into the Action Required panel.
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  reliability: integer("reliability").notNull().default(3),
  manualReviewRequired: boolean("manual_review_required").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // --- Source registry (analyst-classifiable, descriptive metadata) ---------
  // How the feed is collected (e.g. "Google News RSS", "API", "manual"),
  // how often, the source language, and the geography it covers. All nullable
  // and additive: a row with none set simply reads "—" on the registry — the
  // pipeline never fabricates coverage it cannot verify.
  scrapeMethod: text("scrape_method"),
  scrapeFrequency: text("scrape_frequency"),
  language: text("language"),
  locationCovered: text("location_covered"),
  // --- Scrape-health telemetry (machine-written, LAST-RUN snapshots) --------
  // The funnel the most recent ingest run actually observed for this feed:
  // items collected (found) -> retained (accepted in-scope) -> rejected. These
  // are LAST-RUN counts, overwritten each run (never cumulative), so they stay
  // honest and self-correcting. `lastRelevantItemAt` stamps the last run that
  // genuinely retained an in-scope item (never set on a failed or zero-retained
  // run). `failureReason` is a coarse failure category, distinct from the raw
  // `errorMessage` blob. All nullable — a feed that never reported telemetry
  // reads "—", not 0.
  lastRelevantItemAt: timestamp("last_relevant_item_at", { withTimezone: true }),
  itemsCollected: integer("items_collected"),
  itemsRetained: integer("items_retained"),
  itemsRejected: integer("items_rejected"),
  failureReason: text("failure_reason"),
});

export type Source = typeof sourcesTable.$inferSelect;
export type InsertSource = typeof sourcesTable.$inferInsert;
