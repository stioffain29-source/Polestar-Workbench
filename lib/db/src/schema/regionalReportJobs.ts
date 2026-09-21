import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { reportsTable } from "./reports";

export const regionalReportJobsTable = pgTable("regional_report_jobs", {
  id: uuid("id").primaryKey(),
  topic: text("topic").notNull(),
  issueDate: date("issue_date").notNull(),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  reportId: integer("report_id").references(() => reportsTable.id, {
    onDelete: "set null",
  }),
  error: text("error"),
  runToken: uuid("run_token"),
  attempt: integer("attempt").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RegionalReportJobRow = typeof regionalReportJobsTable.$inferSelect;
export type InsertRegionalReportJob = typeof regionalReportJobsTable.$inferInsert;