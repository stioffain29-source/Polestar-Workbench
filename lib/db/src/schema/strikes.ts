import { pgTable, serial, text, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";

export const strikesTable = pgTable("strikes", {
  id: serial("id").primaryKey(),
  theatre: text("theatre").notNull(),
  country: text("country").notNull(),
  location: text("location"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  munition: text("munition").notNull(),
  targetCategory: text("target_category").notNull(),
  infrastructure: text("infrastructure").notNull(),
  casualties: integer("casualties"),
  source: text("source"),
  sourceUrl: text("source_url"),
  confidence: text("confidence").notNull(),
  summary: text("summary"),
  analystNotes: text("analyst_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Strike = typeof strikesTable.$inferSelect;
export type InsertStrike = typeof strikesTable.$inferInsert;
