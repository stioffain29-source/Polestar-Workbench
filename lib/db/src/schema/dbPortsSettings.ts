import type { DbPortsParameters, DbPortsSource, DbPortsWatchTarget } from "@workspace/db-ports";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const dbPortsSettingsTable = pgTable("db_ports_settings", {
  id: integer("id").primaryKey().default(1),
  revision: integer("revision").notNull().default(1),
  sources: jsonb("sources")
    .$type<DbPortsSource[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  watchlist: jsonb("watchlist")
    .$type<DbPortsWatchTarget[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  notes: text("notes").notNull().default(""),
  defaults: jsonb("defaults")
    .$type<DbPortsParameters | null>()
    .default(sql`NULL`),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export type DbPortsSettingsRow = typeof dbPortsSettingsTable.$inferSelect;
export type InsertDbPortsSettingsRow = typeof dbPortsSettingsTable.$inferInsert;