import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { incidentsTable } from "./incidents";

// External-source corroboration of an incident.
//
// The workbench's incidents are scraped from Google News feeds (single-source,
// auto-classified). This table attaches INDEPENDENT confirmation from an
// authoritative provider — currently ReliefWeb (UN OCHA) — when a published
// report covers the same country / timeframe / event as one of our incidents.
//
// It is a SEPARATE signal: it never overwrites the incident's `confidence`
// field or its prose. One incident can carry several corroborating references
// (many official agency updates can cover one event), so this is a child table
// keyed by incident_id. Uniqueness is per (incident, provider, external id) so
// re-running the corroboration pass is idempotent.
export const incidentCorroborationsTable = pgTable(
  "incident_corroborations",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidentsTable.id, { onDelete: "cascade" }),
    // Corroboration provider key, e.g. "reliefweb".
    provider: text("provider").notNull(),
    // Provider-native identifier for the corroborating report (ReliefWeb node id).
    externalId: text("external_id").notNull(),
    reportTitle: text("report_title").notNull(),
    // Publishing agency / source, e.g. "UN OCHA", "IFRC". Nullable when the
    // provider does not attribute a named source.
    sourceAgency: text("source_agency"),
    reportDate: timestamp("report_date", { withTimezone: true }),
    url: text("url").notNull(),
    // Conservative match score in [0,1] from the matching engine.
    matchScore: doublePrecision("match_score").notNull(),
    matchedAt: timestamp("matched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("incident_corroborations_unique").on(
      t.incidentId,
      t.provider,
      t.externalId,
    ),
    byIncident: index("incident_corroborations_incident_idx").on(t.incidentId),
  }),
);

export type IncidentCorroboration =
  typeof incidentCorroborationsTable.$inferSelect;
export type InsertIncidentCorroboration =
  typeof incidentCorroborationsTable.$inferInsert;
