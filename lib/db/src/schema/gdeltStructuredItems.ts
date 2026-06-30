import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// GDELT Cloud structured event layer — a pilot ADDITIVE structured-source.
//
// This stores GDELT Cloud v2 "events" and "stories" as STANDALONE structured
// context in their OWN table, mirroring reliefweb_reports / maritime_movement.
// It is DELIBERATELY isolated from the incidents pipeline:
//
//   CRITICAL PRODUCT RULE: these rows are NEVER incidents. They live in their
//   own table precisely so a GDELT event can never inflate any incident count,
//   never reach a report/PDF, and never touch the report editor. No incident-
//   counting surface reads this table. It is a read-only intelligence layer.
//
// `kind` is the row discriminator:
//   'event'  — an AI-coded event GDELT clustered. Events DRIVE the lanes.
//   'story'  — a clustered news story. Stored with lane=NULL (no fabrication):
//              GDELT does not lane-code stories, so we never guess one.
//
// Lanes (events only): Protests, Civil unrest and riots, Security incidents,
// Crime, Transport disruption. Anything GDELT returns that does not map to one
// of those lanes is dropped at ingest (never stored under a fabricated lane).
//
// Sub-buckets (Indonesia only): "Jakarta" when admin1/location matches Jakarta,
// "Indonesian Papua" when it matches Papua. NULL otherwise.
//
// Dedup is per (source_name, kind, external_id) — GDELT's own item id — so the
// daily pull is idempotent.
export const gdeltStructuredItemsTable = pgTable(
  "gdelt_structured_items",
  {
    id: serial("id").primaryKey(),
    // Adapter source key (constant "gdelt_cloud"); part of the dedup key so a
    // future second structured provider can share the table without collisions.
    sourceName: text("source_name").notNull().default("gdelt_cloud"),
    // Row discriminator: 'event' (drives lanes) or 'story' (lane always NULL).
    kind: text("kind").notNull(),
    // GDELT-native item id (the "id" field), e.g. "conflict_bce383eb".
    externalId: text("external_id").notNull(),

    title: text("title").notNull(),
    summary: text("summary"),
    url: text("url"),
    // For an event, the primary clustered story URL (primary_story_url).
    primaryStoryUrl: text("primary_story_url"),

    // GDELT's own date for the item (event_date / story_date).
    sourceDate: timestamp("source_date", { withTimezone: true }),
    // When GDELT first coded the item (coded_at).
    codedAt: timestamp("coded_at", { withTimezone: true }),
    // When GDELT last updated the item upstream (updated_at).
    upstreamUpdatedAt: timestamp("upstream_updated_at", { withTimezone: true }),

    // Geography, verbatim from GDELT's geo{} block.
    country: text("country"),
    region: text("region"),
    continent: text("continent"),
    admin1: text("admin1"),
    location: text("location"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    // GDELT taxonomy, verbatim.
    family: text("family"),
    category: text("category"),
    subcategory: text("subcategory"),
    domain: text("domain"),
    // GDELT event_code (e.g. "IN02" for cameoplus, or a hash for conflict).
    eventCode: text("event_code"),

    // OUR bucketing — derived from the verbatim taxonomy above, never fabricated.
    // lane is NULL for stories and for any event GDELT returns that maps to no
    // tracked lane (dropped before insert). sub_bucket is NULL unless the item
    // matched a tracked Indonesian sub-bucket.
    lane: text("lane"),
    subBucket: text("sub_bucket"),

    hasFatalities: boolean("has_fatalities"),
    fatalities: integer("fatalities"),
    imageUrl: text("image_url"),
    topLanguage: text("top_language"),

    // Raw structured blocks, kept verbatim for the read surface. No business
    // meaning is attached beyond display.
    actors: jsonb("actors").$type<unknown[]>().notNull().default([]),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    topArticles: jsonb("top_articles").$type<unknown[]>().notNull().default([]),
    // For stories: linked_events[]. For events: any story refs GDELT carries.
    linkedEvents: jsonb("linked_events").$type<unknown[]>().notNull().default([]),
    storyRefs: jsonb("story_refs").$type<unknown[]>().notNull().default([]),
    extras: jsonb("extras").$type<Record<string, unknown>>().notNull().default({}),

    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("gdelt_structured_items_source_kind_external_unique").on(
      t.sourceName,
      t.kind,
      t.externalId,
    ),
    bySourceDate: index("gdelt_structured_items_source_date_idx").on(t.sourceDate),
    byCountry: index("gdelt_structured_items_country_idx").on(t.country),
    byLane: index("gdelt_structured_items_lane_idx").on(t.lane),
    bySubBucket: index("gdelt_structured_items_sub_bucket_idx").on(t.subBucket),
  }),
);

export type GdeltStructuredItem = typeof gdeltStructuredItemsTable.$inferSelect;
export type InsertGdeltStructuredItem =
  typeof gdeltStructuredItemsTable.$inferInsert;
