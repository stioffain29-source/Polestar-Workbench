import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Public social-media protest WATCH items (KAMMI Pusat Instagram) —
// a CONTEXT source, modelled exactly on reliefweb_reports / maritime_movement.
//
// CRITICAL PRODUCT RULE: a social-watch item is NEVER an incident. It lives in
// its own table precisely so a mobilisation / "planned protest" post can never
// inflate any incident count (dashboard, topic monitors, reports). The ONLY
// path from this table into `incidents` is an explicit, gated PROMOTE action,
// and only for an item whose text/image confirms the protest is actually
// active. Once promoted, `promotedIncidentId` links the watch item back to the
// incident it created.
//
// PRIVACY: only PUBLIC posts are ever fetched. The ingest sanitises the stored
// caption and never persists phone numbers, personal-account identifiers,
// WhatsApp content or member-level data. No private groups.
//
// Dedup: reposts (the same Instagram graphic, or the same post re-fetched)
// collapse to a single row via the UNIQUE `dedup_key` (a content/image
// fingerprint). The ingest also de-duplicates within a run before writing.
export const socialWatchItemsTable = pgTable(
  "social_watch_items",
  {
    id: serial("id").primaryKey(),
    // Constant adapter source key ("social_watch"); part of the external-id
    // dedup so a future provider can share the table without id collisions.
    sourceName: text("source_name").notNull().default("social_watch"),
    // Platform the post came from: "instagram".
    platform: text("platform").notNull(),
    // Channel / account handle the post was read from, e.g. "kammi.pusat".
    channel: text("channel").notNull(),
    // Display actor / organiser, e.g. "KAMMI Pusat".
    actor: text("actor"),
    // Platform-native post id (used for idempotent re-fetch + source linking).
    externalId: text("external_id").notNull(),
    // When the post itself was published.
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // Extracted protest/event date (best-effort) parsed from the caption.
    eventDate: timestamp("event_date", { withTimezone: true }),
    // Raw extracted event time string (e.g. "13.00 WIB"); display only.
    eventTimeText: text("event_time_text"),
    // Sanitised caption / post text (phone numbers etc. stripped before store).
    caption: text("caption"),
    // Public image URL(s) attached to the post.
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    // Free-text location / venue, e.g. "Gedung DPR/MPR RI".
    location: text("location"),
    // City (defaults to Jakarta unless the post clearly states another city).
    city: text("city").notNull().default("Jakarta"),
    // Province when derivable, else null.
    province: text("province"),
    // Issue / campaign, e.g. "Indonesia Darurat".
    issue: text("issue"),
    // Derived status: planned | active | dispersed | cancelled | unclear.
    status: text("status").notNull().default("planned"),
    // Confidence: high (official organiser) | medium (aligned repost) | low.
    confidence: text("confidence").notNull().default("medium"),
    // Public source URL of the post.
    url: text("url").notNull(),
    // Fixed scope — these are Indonesia activism/protest items.
    country: text("country").notNull().default("Indonesia"),
    topic: text("topic").notNull().default("flashpoint"),
    // Guard that this row is supporting context, not an incident.
    classification: text("classification").notNull().default("context"),
    // Content/image fingerprint — UNIQUE so reposts collapse to one item.
    dedupKey: text("dedup_key").notNull(),
    // Watch-alert reasons detected on this item (location change, march route,
    // police cordon / dispersal / clash, movement from key venues, etc.).
    alertReasons: jsonb("alert_reasons").$type<string[]>().notNull().default([]),
    // True only when text/image confirms the protest is active — i.e. eligible
    // for promotion to an incident. Planned/mobilisation items are false.
    promotable: boolean("promotable").notNull().default(false),
    // Backlink to the incident this item was promoted into (null until promoted).
    promotedIncidentId: integer("promoted_incident_id"),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    // When this item was last successfully checked by the ingest.
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupUnique: uniqueIndex("social_watch_items_dedup_unique").on(t.dedupKey),
    byExternal: index("social_watch_items_external_idx").on(
      t.sourceName,
      t.externalId,
    ),
    byStatus: index("social_watch_items_status_idx").on(t.status),
    byPlatform: index("social_watch_items_platform_idx").on(t.platform),
    byPosted: index("social_watch_items_posted_idx").on(t.postedAt),
  }),
);

export type SocialWatchItem = typeof socialWatchItemsTable.$inferSelect;
export type InsertSocialWatchItem = typeof socialWatchItemsTable.$inferInsert;
