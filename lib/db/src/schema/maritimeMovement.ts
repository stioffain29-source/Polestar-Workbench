import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// Maritime vessel-MOVEMENT context snapshots (AIS-derived traffic). This is
// CONTEXT only — it is NEVER an incident and can never create one. AIS "dark" /
// gap activity is an INDICATOR, never evidence of hostile intent on its own.
//
// Rows arrive from the live AIS ingest (lib/ingest/src/maritimeMovement.ts,
// source_name contains "ais") when AIS_API_KEY is configured, AND/OR from an
// admin-token-gated MANUAL upload (POST /api/admin/maritime-movement) from a
// licensed provider. When the table is empty every surface degrades cleanly to
// "movement data unavailable" — it never fabricates traffic.
//
// One row per snapshot (theatre + data_as_of); history is kept (we never
// overwrite), and the read endpoints surface the latest snapshot per theatre.
// All count fields are nullable: a provider may report only a partial picture,
// and a missing count must read as "not reported", never as zero traffic.

export const maritimeMovementTable = pgTable("maritime_movement", {
  id: serial("id").primaryKey(),
  /** Theatre / region the snapshot covers, e.g. "Strait of Hormuz". */
  theatre: text("theatre").notNull(),
  /** Finer chokepoint label when distinct from the theatre. Nullable. */
  chokepoint: text("chokepoint"),
  /** The "as of" timestamp of the snapshot (the provider's observation time). */
  dataAsOf: timestamp("data_as_of", { withTimezone: true }).notNull(),
  /** Vessel counts — all nullable ("not reported" when absent, never zero). */
  totalVessels: integer("total_vessels"),
  inboundCount: integer("inbound_count"),
  outboundCount: integer("outbound_count"),
  tankersCount: integer("tankers_count"),
  bulkCarriersCount: integer("bulk_carriers_count"),
  containerCount: integer("container_count"),
  lngLpgCount: integer("lng_lpg_count"),
  anchoredOrWaitingCount: integer("anchored_or_waiting_count"),
  aisVisibleCount: integer("ais_visible_count"),
  /** AIS dark / gap activity is an INDICATOR, never an incident, and never
   *  evidence of hostile intent on its own. */
  aisDarkOrGapCount: integer("ais_dark_or_gap_count"),
  /** Human-readable change vs the trailing 7-day baseline, e.g. "+12% 7d". */
  changeVs7DayBaseline: text("change_vs_7_day_baseline"),
  notes: text("notes"),
  /** Assessment confidence for this snapshot: "low" | "medium" | "high". */
  confidence: text("confidence").notNull().default("medium"),
  /** Provider attribution — required so every figure is sourced. */
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  /** Raw uploaded payload kept verbatim for provenance / audit. */
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MaritimeMovement = typeof maritimeMovementTable.$inferSelect;
export type InsertMaritimeMovement = typeof maritimeMovementTable.$inferInsert;
