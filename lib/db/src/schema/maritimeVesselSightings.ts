import { pgTable, integer, text, real, timestamp } from "drizzle-orm/pg-core";

// Per-vessel AIS sighting state, kept ACROSS sample windows so a vessel's
// transmission GAP can be measured. The live AIS receive stream
// (lib/ingest/src/maritimeMovement.ts) only ever shows vessels that ARE
// transmitting, so an "AIS-dark" vessel cannot be seen in a single live sample.
// Detecting one is inherently STATEFUL: remember where each vessel was last
// seen, then on a later run flag the ones that were recently loitering inside a
// theatre yet have since stopped transmitting.
//
// This table is the ONLY persistence the dark/gap detector needs. It is CONTEXT
// scaffolding — it is never an incident, never feeds an incident count, and a
// dark/gap flag is an INDICATOR only, never proof of hostile intent.
//
// One row per vessel (MMSI is the key). The row always reflects the LAST place
// the vessel was seen, so a vessel that legitimately moves to another theatre
// updates in place (and therefore cannot be mis-flagged as "dark" in the old
// one). Rows older than the lookback window are pruned each run.

export const maritimeVesselSightingTable = pgTable("maritime_vessel_sighting", {
  /** AIS MMSI — the unique vessel identifier, and the natural primary key. */
  mmsi: integer("mmsi").primaryKey(),
  /** Theatre the vessel was last seen in (one of AIS_THEATRES). */
  theatre: text("theatre").notNull(),
  /** When the vessel was last observed transmitting inside the theatre. */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  /** Last valid speed-over-ground (knots), used to tell loitering from transit. */
  lastSog: real("last_sog"),
  /** Last AIS navigational status code (1 = at anchor, 5 = moored, etc.). */
  lastNavStatus: integer("last_nav_status"),
  // Last known POSITION + identity for the live vessel map. All nullable and
  // additive: a sighting captured before these columns existed, or a sample
  // that carried no position/static frame, simply leaves them NULL — the map
  // plots only rows with a real latitude+longitude. These never feed an
  // incident count; movement remains CONTEXT only.
  /** Last reported latitude (decimal degrees) inside the theatre. */
  latitude: real("latitude"),
  /** Last reported longitude (decimal degrees) inside the theatre. */
  longitude: real("longitude"),
  /** Last valid course-over-ground (degrees), for the heading arrow. */
  lastCog: real("last_cog"),
  /** Vessel name from the AIS static frame (may be absent in a sample). */
  name: text("name"),
  /** AIS ship-type code (70-79 cargo, 80-89 tanker, etc.); null when unseen. */
  shipType: integer("ship_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MaritimeVesselSighting =
  typeof maritimeVesselSightingTable.$inferSelect;
export type InsertMaritimeVesselSighting =
  typeof maritimeVesselSightingTable.$inferInsert;
