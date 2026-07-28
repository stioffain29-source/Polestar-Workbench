import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import type {
  CanonicalEvent,
  AnalystEventOverride,
} from "@workspace/country-engine/types";

/**
 * Persisted canonical events produced by the shared country-report engine
 * (@workspace/country-engine). One row per (country_slug, event_id). The full
 * CanonicalEvent lives in `payload`; the flat columns are a denormalised copy
 * of the fields the review queue / admin controls filter and sort on (owner
 * brief §7, §37) so the admin interface can query without deserialising every
 * payload. `runCountryEngine` is the sole writer — it upserts every event the
 * latest run produced and deletes rows no longer present for the slug.
 */
export const countryEngineEventsTable = pgTable(
  "country_engine_events",
  {
    id: serial("id").primaryKey(),
    countrySlug: text("country_slug").notNull(),
    eventId: text("event_id").notNull(),
    // The full CanonicalEvent (authoritative — reports read from here).
    payload: jsonb("payload").$type<CanonicalEvent>().notNull(),
    // Denormalised review-queue columns (mirrors payload fields).
    inclusionStatus: text("inclusion_status").notNull(),
    exclusionReason: text("exclusion_reason"),
    duplicateGroupId: text("duplicate_group_id"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    physicalCountry: text("physical_country"),
    severity: text("severity"),
    classificationConfidence: integer("classification_confidence"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    countryEvent: unique("country_engine_events_country_event").on(
      t.countrySlug,
      t.eventId,
    ),
  }),
);

/**
 * Analyst overrides applied on top of engine output (owner brief §37). One row
 * per (country_slug, event_id); `override` is the full AnalystEventOverride.
 * `runCountryEngine` loads these and feeds them to buildCanonicalEvents so a
 * manual correction survives every re-run and every reprocess.
 */
export const countryEngineOverridesTable = pgTable(
  "country_engine_overrides",
  {
    id: serial("id").primaryKey(),
    countrySlug: text("country_slug").notNull(),
    eventId: text("event_id").notNull(),
    override: jsonb("override").$type<AnalystEventOverride>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    countryEvent: unique("country_engine_overrides_country_event").on(
      t.countrySlug,
      t.eventId,
    ),
  }),
);

/**
 * Append-only audit log of every manual analyst change and reprocess run
 * (owner brief §37: "All manual changes must be recorded in an audit log").
 * `action` is a short verb (e.g. "override", "reprocess"); `detail` carries
 * the applied override / run stats; `actor` is the presenting principal.
 */
export const countryEngineAuditTable = pgTable("country_engine_audit", {
  id: serial("id").primaryKey(),
  countrySlug: text("country_slug").notNull(),
  eventId: text("event_id"),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per engine run for a country (owner brief §35 reprocessing). `stats`
 * carries EngineResult.stats plus a pre-publication gate failure summary. The
 * engine route returns the latest run's stats so the admin interface can show
 * the reprocess outcome (owner brief §37: failed quality checks).
 */
export const countryEngineRunsTable = pgTable("country_engine_runs", {
  id: serial("id").primaryKey(),
  countrySlug: text("country_slug").notNull(),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull(),
});

export type CountryEngineEvent = typeof countryEngineEventsTable.$inferSelect;
export type InsertCountryEngineEvent =
  typeof countryEngineEventsTable.$inferInsert;
export type CountryEngineOverride =
  typeof countryEngineOverridesTable.$inferSelect;
export type InsertCountryEngineOverride =
  typeof countryEngineOverridesTable.$inferInsert;
export type CountryEngineAudit = typeof countryEngineAuditTable.$inferSelect;
export type InsertCountryEngineAudit =
  typeof countryEngineAuditTable.$inferInsert;
export type CountryEngineRun = typeof countryEngineRunsTable.$inferSelect;
export type InsertCountryEngineRun = typeof countryEngineRunsTable.$inferInsert;
