import type {
  DbPortsCoverage,
  DbPortsHistory,
  DbPortsItem,
  DbPortsParameters,
} from "@workspace/db-ports";
import {
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const dbPortsEditionsTable = pgTable(
  "db_ports_editions",
  {
    id: serial("id").primaryKey(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    overview: text("overview").notNull().default(""),
    status: text("status", {
      enum: ["draft", "in_review", "approved"],
    })
      .notNull()
      .default("draft"),
    revision: integer("revision").notNull().default(1),
    items: jsonb("items")
      .$type<DbPortsItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Retained only so historical pilot entries are not destroyed. The report
    // no longer reads or writes this column.
    worklog: jsonb("worklog")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    parameters: jsonb("parameters")
      .$type<DbPortsParameters | null>()
      .default(sql`NULL`),
    coverage: jsonb("coverage")
      .$type<DbPortsCoverage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    history: jsonb("history")
      .$type<DbPortsHistory[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    uniqueIndex("db_ports_editions_end_date_unique").on(table.endDate),
  ],
);

export type DbPortsEditionRow = typeof dbPortsEditionsTable.$inferSelect;
export type InsertDbPortsEditionRow = typeof dbPortsEditionsTable.$inferInsert;