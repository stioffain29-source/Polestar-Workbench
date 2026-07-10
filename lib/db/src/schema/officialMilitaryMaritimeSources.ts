import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// M1.5 — Primary Military and Maritime official sources (CENTCOM, UKMTO, JMIC,
// CMF, …). A STANDALONE official-source table distinct from the news-scraped
// `incidents` table and from other context tables (`reliefweb_reports`,
// `maritime_security_events`, `social_raw`).
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents. They live in their own
// table precisely so they can NEVER inflate any incident / crime / protest /
// conflict count. No incident-counting surface reads this table. Official
// sources may feed Watches, raise analyst flags, and support evidence packs;
// they must NOT automatically create Spot Reports.
//
// Dedup is per (source_name, external_id) — the provider-native id (CENTCOM
// article id, UKMTO warning number, partner product id). A secondary index on
// (source_name, source_url) supports URL-based fallback dedup when the same
// document arrives under a changed id.
export const officialMilitaryMaritimeSourcesTable = pgTable(
  "official_military_maritime_sources",
  {
    id: serial("id").primaryKey(),
    // Adapter source key: "centcom" | "ukmto" | "jmic" | "cmf" | …
    sourceName: text("source_name").notNull(),
    // Provider-native stable id (article id, warning number, product id).
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sourceUrl: text("source_url").notNull(),
    // Full body text when available; nullable in Phase 1 (listing-only ingest).
    bodyText: text("body_text"),
    // Guard classification — always official-source vocabulary, NEVER "incident".
    classification: text("classification")
      .notNull()
      .default("official_military_maritime"),
    // P1-D2 analyst flags (auto-assigned at ingest; never create Spot Reports).
    flagSignificantIncident: boolean("flag_significant_incident")
      .notNull()
      .default(false),
    flagEscalationIndicator: boolean("flag_escalation_indicator")
      .notNull()
      .default(false),
    flagMaritimeDisruption: boolean("flag_maritime_disruption")
      .notNull()
      .default(false),
    flagEvidenceAvailable: boolean("flag_evidence_available")
      .notNull()
      .default(false),
    flagPossibleSpotReport: boolean("flag_possible_spot_report")
      .notNull()
      .default(false),
    // P1-D3 dual-watch routing — primary topic plus supplemental watch tags.
    primaryWatch: text("primary_watch"),
    watchTags: jsonb("watch_tags").$type<string[]>().notNull().default([]),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
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
    unique: uniqueIndex("official_military_maritime_sources_source_external_unique").on(
      t.sourceName,
      t.externalId,
    ),
    byUrl: index("official_military_maritime_sources_url_idx").on(
      t.sourceName,
      t.sourceUrl,
    ),
    byPublished: index("official_military_maritime_sources_published_idx").on(
      t.publishedAt,
    ),
    byPrimaryWatch: index("official_military_maritime_sources_primary_watch_idx").on(
      t.primaryWatch,
    ),
    byPossibleSpotReport: index(
      "official_military_maritime_sources_possible_spot_report_idx",
    ).on(t.flagPossibleSpotReport),
  }),
);

export type OfficialMilitaryMaritimeSource =
  typeof officialMilitaryMaritimeSourcesTable.$inferSelect;
export type InsertOfficialMilitaryMaritimeSource =
  typeof officialMilitaryMaritimeSourcesTable.$inferInsert;
