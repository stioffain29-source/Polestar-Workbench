import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ICC CCS / IMB Piracy Reporting Centre — maritime piracy & armed-robbery events.
//
// A STANDALONE maritime-security source distinct from the news-scraped
// `incidents` table and from the AIS `maritime_movement` context table. The ICC
// International Maritime Bureau (IMB) publishes the year's reported piracy and
// armed-robbery-at-sea events on its public live piracy map; this table mirrors
// the CURRENT-YEAR map only.
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents. They live in their own
// table precisely so they can NEVER inflate any incident / crime / protest /
// conflict count. No incident-counting surface reads this table. Maritime
// security enriches the Shipping Watch assessment; it does not drive any count.
//
// Dedup is per (source_name, event_key). `eventKey` is the IMB-native incident
// number (e.g. "001-26") when present, else a stable content hash of the
// narrative+date+location, so the pass is idempotent even when an event arrives
// without a usable reference number.
export const maritimeSecurityEventsTable = pgTable(
  "maritime_security_events",
  {
    id: serial("id").primaryKey(),
    // Adapter source key (constant "icc_imb"); part of the dedup key so a future
    // second maritime-security provider can share the table without collisions.
    sourceName: text("source_name").notNull().default("icc_imb"),
    // Stable idempotency key: the IMB incident number, else "hash:<contentHash>".
    eventKey: text("event_key").notNull(),
    // IMB-native incident reference, e.g. "001-26" (the "-26" suffix is the year).
    incidentNumber: text("incident_number"),
    // Normalised maritime-security classification. One of: Boarded, Attempted
    // Boarding, Armed Robbery, Fired Upon, Hijacking, Suspicious Vessel,
    // Unknown Maritime Security Incident. NEVER a generic incident topic.
    incidentType: text("incident_type")
      .notNull()
      .default("Unknown Maritime Security Incident"),
    // Raw ICC category label(s) from the source map (e.g. "Boarded").
    categoryRaw: text("category_raw"),
    // Short display label (the incident number, or a derived label).
    title: text("title").notNull(),
    // Cleaned narrative (the IMB "Sitrep" description, without the date/posn head).
    narrative: text("narrative"),
    // Full raw sitrep text as published (untrusted upstream string, clipped).
    rawSitrep: text("raw_sitrep"),
    // Waters / anchorage / port name parsed from the sitrep, when present.
    locationName: text("location_name"),
    // Country / coastal-state attribution parsed from the sitrep, when present.
    country: text("country"),
    // Decimal-degree coordinates. From the source marker when present, else
    // parsed from the IMB position text; null when neither is usable.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    // The IMB position string verbatim, e.g. "13:45.72N – 120:59.59E".
    rawPositionText: text("raw_position_text"),
    // Coordinate provenance: "exact_reported" (from the map/IMB position),
    // "estimated" (derived/approximate), or "missing".
    coordinateQuality: text("coordinate_quality").notNull().default("missing"),
    // Event date parsed from the sitrep (DD.MM.YYYY head), when present.
    incidentDate: timestamp("incident_date", { withTimezone: true }),
    // Calendar year the event belongs to (current-year-only ingest tag).
    year: integer("year"),
    // Link back to the source map page.
    sourceUrl: text("source_url"),
    // Guard classification — always "maritime_security" (never "incident").
    classification: text("classification").notNull().default("maritime_security"),
    // Content hash used for the fallback dedup when no incident number exists.
    contentHash: text("content_hash"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("maritime_security_events_source_key_unique").on(
      t.sourceName,
      t.eventKey,
    ),
    byDate: index("maritime_security_events_date_idx").on(t.incidentDate),
    byCountry: index("maritime_security_events_country_idx").on(t.country),
    byYear: index("maritime_security_events_year_idx").on(t.year),
  }),
);

export type MaritimeSecurityEvent =
  typeof maritimeSecurityEventsTable.$inferSelect;
export type InsertMaritimeSecurityEvent =
  typeof maritimeSecurityEventsTable.$inferInsert;
