import { pgTable, serial, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Durable evidence for the daily tracker quality refresh.
 *
 * Three tables, deliberately separate:
 *  - `daily_quality_runs`    one row per attempt (scheduled, boot catch-up or manual)
 *  - `daily_quality_targets` one row per covered tracker within a run
 *  - `daily_quality_findings` one row per evidence-linked exclusion or review item
 *
 * A run is an ATTEMPT, not a success. `finishedAt` is set when the run stops
 * for any reason; only `status = 'completed'` advances the successful-completion
 * clock that `nextDueAt` is measured from. A skipped or failed run must never
 * make the product look freshly checked.
 */
export const dailyQualityRunsTable = pgTable("daily_quality_runs", {
  id: text("id").primaryKey(),
  // "schedule" | "boot-catchup" | "manual"
  trigger: text("trigger").notNull(),
  // "running" | "completed" | "failed" | "interrupted"
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  // The due time this attempt was claiming. Persisted so a late run is visibly
  // late rather than silently re-baselined to its own start time.
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  error: text("error"),
  checkedCount: integer("checked_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  startedIdx: index("daily_quality_runs_started_idx").on(t.startedAt),
  statusIdx: index("daily_quality_runs_status_idx").on(t.status),
}));

/**
 * Per-tracker result. Every covered tracker gets a row for every run, so a
 * tracker that was never reached is visibly `skipped` rather than absent —
 * missing coverage must never read as a pass.
 */
export const dailyQualityTargetsTable = pgTable("daily_quality_targets", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  targetKey: text("target_key").notNull(),
  label: text("label").notNull(),
  // "incidents" | "strikes" | "market" | "maritime" | "report"
  kind: text("kind").notNull(),
  // See DailyQualityOutcome. A successful check that found nothing new is
  // "no_new_records", which is NOT the same as "source_failed" /
  // "provider_disabled" / "no_collector" / "skipped" / "incomplete".
  outcome: text("outcome").notNull(),
  detail: text("detail"),
  checkedCount: integer("checked_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  // Resumable progress: the highest incident id already swept for this target.
  // An interrupted run resumes from here instead of restarting the batch.
  cursor: integer("cursor"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  runTargetIdx: uniqueIndex("daily_quality_targets_run_target_idx").on(t.runId, t.targetKey),
}));

/**
 * Evidence-linked finding. Every definite exclusion and every ambiguous review
 * item records the affected record, its source link, the reason, the rule
 * version that decided it and the before/after decision, so an exclusion is
 * always recoverable and auditable. Nothing here deletes a source record.
 */
export const dailyQualityFindingsTable = pgTable("daily_quality_findings", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  targetKey: text("target_key").notNull(),
  incidentId: integer("incident_id"),
  // "excluded" | "review"
  kind: text("kind").notNull(),
  // Which check produced it: "sports_noise" | "relevance" | "geography" |
  // "event_date" | "duplicate" | "unsupported"
  checkName: text("check_name").notNull(),
  reason: text("reason").notNull(),
  title: text("title"),
  sourceUrl: text("source_url"),
  ruleVersion: text("rule_version"),
  beforeStatus: text("before_status"),
  afterStatus: text("after_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runIdx: index("daily_quality_findings_run_idx").on(t.runId),
  incidentIdx: index("daily_quality_findings_incident_idx").on(t.incidentId),
}));

export type DailyQualityRun = typeof dailyQualityRunsTable.$inferSelect;
export type InsertDailyQualityRun = typeof dailyQualityRunsTable.$inferInsert;
export type DailyQualityTarget = typeof dailyQualityTargetsTable.$inferSelect;
export type InsertDailyQualityTarget = typeof dailyQualityTargetsTable.$inferInsert;
export type DailyQualityFinding = typeof dailyQualityFindingsTable.$inferSelect;
export type InsertDailyQualityFinding = typeof dailyQualityFindingsTable.$inferInsert;
