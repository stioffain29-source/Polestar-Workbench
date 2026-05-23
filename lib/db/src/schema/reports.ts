import { pgTable, serial, text, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export type KpiCard = {
  label: string;
  value: string;
  accent?: string;
  context?: string;
};

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  countrySlug: text("country_slug"),
  status: text("status").notNull(),
  issueDate: date("issue_date").notNull(),
  situation: text("situation"),
  whatHappened: text("what_happened"),
  hardNumbers: jsonb("hard_numbers").$type<KpiCard[]>(),
  whatMatters: text("what_matters"),
  implications: text("implications"),
  polestarView: text("polestar_view"),
  watchNext: text("watch_next"),
  author: text("author"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
export type InsertReport = typeof reportsTable.$inferInsert;
