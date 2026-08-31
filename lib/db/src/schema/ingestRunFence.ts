import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Database epoch used to reject writes from stale ingest workers.
 *
 * The singleton boolean is the primary key; application code only ever writes
 * the `true` row. Do not add a bare `CHECK (singleton)` constraint here:
 * publish-time schema introspection can serialize that PostgreSQL shorthand as
 * the invalid nested expression `CHECK (CHECK (singleton))`.
 */
export const ingestRunFenceTable = pgTable("ingest_run_fence", {
  singleton: boolean("singleton").primaryKey().default(true),
  activeRunId: text("active_run_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});