import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Tracks one-time data migrations that must run exactly once per environment
// (e.g. a legacy-prose reset). Runtime migrations in the api-server check for
// a marker key before performing a destructive one-off, then insert the key so
// the operation never repeats and later analyst edits are preserved.
export const appMigrationMarkersTable = pgTable("app_migration_markers", {
  key: text("key").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppMigrationMarker = typeof appMigrationMarkersTable.$inferSelect;
export type InsertAppMigrationMarker = typeof appMigrationMarkersTable.$inferInsert;
