import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Singleton completion marker for the dedicated forward-looking search. */
export const protestScheduleStateTable = pgTable("protest_schedule_state", {
  key: text("key").primaryKey(),
  searchCompletedAt: timestamp("search_completed_at", { withTimezone: true }),
});

export type ProtestScheduleState = typeof protestScheduleStateTable.$inferSelect;