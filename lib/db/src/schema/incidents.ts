import { pgTable, serial, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";

export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  country: text("country").notNull(),
  location: text("location"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  severity: text("severity").notNull(),
  confidence: text("confidence").notNull(),
  source: text("source"),
  sourceUrl: text("source_url"),
  analystNotes: text("analyst_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Incident = typeof incidentsTable.$inferSelect;
export type InsertIncident = typeof incidentsTable.$inferInsert;
