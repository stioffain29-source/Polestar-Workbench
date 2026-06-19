import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ReliefWeb (UN OCHA) situational / humanitarian reports — a CONTEXT source.
//
// This is DISTINCT from `incident_corroborations`. That table attaches official
// corroborating LINKS to an existing scraped incident (a per-incident child
// signal). This table stores ReliefWeb reports as STANDALONE supporting context
// — official situation reports, assessments and updates for the APAC countries
// we monitor — so analysts can lean on UN OCHA reporting when writing the
// Conflict Watch and country reports.
//
// CRITICAL: these rows are NOT incidents and live in their own table precisely
// so they can NEVER inflate the incident counts. ReliefWeb enriches the
// assessment; it does not drive the count. No surface that counts incidents
// reads this table.
//
// Dedup is per (source_name, external_id) — the ReliefWeb report id — so the
// 6-hourly pass is idempotent. A second, in-application fallback dedup on
// (source_name, url) catches the rare case where the same report URL arrives
// under a changed id.
export const reliefwebReportsTable = pgTable(
  "reliefweb_reports",
  {
    id: serial("id").primaryKey(),
    // Adapter source key (constant "reliefweb"); part of the dedup key so a
    // future second context provider can share the table without id collisions.
    sourceName: text("source_name").notNull().default("reliefweb"),
    // ReliefWeb-native report id (the "id" field).
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    // Short headline summary (headline.summary) when present, else a clipped
    // lead of the body.
    summary: text("summary"),
    // Full report body text (markdown stripped to plain text).
    body: text("body"),
    url: text("url").notNull(),
    // Publishing organisation / agency, e.g. "UN OCHA", "IFRC" (source.name).
    sourceOrg: text("source_org"),
    // Primary country (primary_country.name) for the headline display.
    country: text("country"),
    // Full list of associated countries (country[].name).
    countries: jsonb("countries").$type<string[]>().notNull().default([]),
    // Report publication date (date.created).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Original document date (date.original) when it differs from created.
    originalDate: timestamp("original_date", { withTimezone: true }),
    // Raw category labels (format / theme / disaster_type names) joined for
    // display; kept verbatim, no business meaning attached.
    categoryRaw: text("category_raw"),
    // Adapter classification — always "context" here (never "event"), a guard
    // that this row is supporting context, not an incident.
    sourceType: text("source_type").notNull().default("humanitarian_report"),
    classification: text("classification").notNull().default("context"),
    // Lightweight confidence label derived from the publishing org.
    confidence: text("confidence").notNull().default("medium"),
    // Internal classification tags (lowercased keywords) for filtering.
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("reliefweb_reports_source_external_unique").on(
      t.sourceName,
      t.externalId,
    ),
    byUrl: index("reliefweb_reports_url_idx").on(t.sourceName, t.url),
    byCountry: index("reliefweb_reports_country_idx").on(t.country),
    byPublished: index("reliefweb_reports_published_idx").on(t.publishedAt),
  }),
);

export type ReliefWebReport = typeof reliefwebReportsTable.$inferSelect;
export type InsertReliefWebReport = typeof reliefwebReportsTable.$inferInsert;
