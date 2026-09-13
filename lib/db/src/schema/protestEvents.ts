import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Forward-looking public protest schedule context.
 *
 * This is intentionally a standalone table.  Nothing in the protest schedule
 * collector reads from or writes to incidents: a planned mobilisation is not
 * an incident and must never affect incident counts or reports.
 */
export const protestEventsTable = pgTable(
  "protest_events",
  {
    id: serial("id").primaryKey(),
    sourceName: text("source_name").notNull().default("protest_schedule"),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    eventDate: timestamp("event_date", { withTimezone: true }),
    country: text("country").notNull(),
    city: text("city"),
    venue: text("venue"),
    eventType: text("event_type"),
    issue: text("issue"),
    organiser: text("organiser"),
    description: text("description"),
    startTime: text("start_time"),
    attendance: integer("attendance"),
    disruptionPotential: text("disruption_potential"),
    confidence: text("confidence").notNull().default("Low"),
    status: text("status").notNull().default("Possible"),
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    searchCompletedAt: timestamp("search_completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dedupKey: text("dedup_key").notNull(),
  },
  (t) => ({
    dedupUnique: uniqueIndex("protest_events_dedup_unique").on(t.dedupKey),
    eventDateIdx: index("protest_events_event_date_idx").on(t.eventDate),
    countryCityIdx: index("protest_events_country_city_idx").on(
      t.country,
      t.city,
    ),
    statusIdx: index("protest_events_status_idx").on(t.status),
  }),
);

export type ProtestEvent = typeof protestEventsTable.$inferSelect;
export type InsertProtestEvent = typeof protestEventsTable.$inferInsert;