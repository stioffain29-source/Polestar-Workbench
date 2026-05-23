import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const sourcesTable = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  topic: text("topic").notNull(),
  sourceType: text("source_type").notNull(),
  url: text("url"),
  status: text("status").notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  reliability: integer("reliability").notNull().default(3),
  manualReviewRequired: boolean("manual_review_required").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Source = typeof sourcesTable.$inferSelect;
export type InsertSource = typeof sourcesTable.$inferInsert;
