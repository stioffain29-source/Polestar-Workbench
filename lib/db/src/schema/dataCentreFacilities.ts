import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Analyst-maintained Data Centre facility REGISTRY.
//
// A curated, analyst-owned catalogue of data-centre facilities the desk
// tracks for build-out, planning and operational risk. It is DELIBERATELY
// separate from the `incidents` pipeline:
//
//   CRITICAL PRODUCT RULE: a registry facility is NEVER an incident. It lives
//   in its own table so a tracked facility can never inflate any incident
//   count (dashboard, topic monitors, reports). The only relationship to the
//   incident stream is an OPTIONAL back-link (`linkedIncidentId`) an analyst
//   sets to associate a facility with a specific reported event.
//
// STRICT no-fabrication: every narrative / capacity field is nullable and reads
// "not reported" on the surfaces when empty. The desk fills what it can verify.
//
// The `status` and `planningRisk` columns are constrained to the fixed
// vocabularies below (enforced at the API layer, not the DB, so a future
// vocabulary extension is a code change, not a migration). A dedicated
// `statusChanged` flag plus `previousStatus` / `statusChangedAt` records the
// most recent status transition so the monitor can highlight recent movers.

// Facility lifecycle status — fixed vocabulary. Order is lifecycle order.
export const DATA_CENTRE_STATUSES = [
  "Operational",
  "Under construction",
  "Approved",
  "Proposed",
  "Planning submitted",
  "Planning refused",
  "Delayed",
  "Suspended",
  "Cancelled",
  "Unknown",
] as const;
export type DataCentreStatus = (typeof DATA_CENTRE_STATUSES)[number];

// Planning / build-out risk — fixed vocabulary.
export const DATA_CENTRE_PLANNING_RISKS = [
  "No known issue",
  "Planning pending",
  "Environmental review",
  "Water constraint",
  "Power constraint",
  "Community opposition",
  "Legal challenge",
  "Political scrutiny",
  "Permit refused",
  "Moratorium",
  "Unknown",
] as const;
export type DataCentrePlanningRisk = (typeof DATA_CENTRE_PLANNING_RISKS)[number];

// Facility type — fixed vocabulary. NEVER inferred from geography or operator;
// defaults to "Unknown / not reported" unless a source clearly states the type.
export const DATA_CENTRE_TYPES = [
  "Hyperscale",
  "Colocation",
  "Enterprise",
  "Edge",
  "Cloud region",
  "Carrier hotel",
  "Unknown / not reported",
] as const;
export type DataCentreType = (typeof DATA_CENTRE_TYPES)[number];

export const dataCentreFacilitiesTable = pgTable(
  "data_centre_facilities",
  {
    id: serial("id").primaryKey(),
    // Facility name (e.g. "Jakarta JK1"). Required — the one field the desk
    // always knows.
    name: text("name").notNull(),
    // Operator / owner company (e.g. "Princeton Digital Group"). Nullable.
    operator: text("operator"),

    // Geography. Country is required so the facility maps to a choropleth
    // country; the rest are nullable and read "not reported" when blank.
    country: text("country").notNull(),
    region: text("region"),
    city: text("city"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    // Constrained lifecycle status (see DATA_CENTRE_STATUSES). Defaults Unknown.
    status: text("status").notNull().default("Unknown"),
    // Constrained planning / build-out risk (see DATA_CENTRE_PLANNING_RISKS).
    planningRisk: text("planning_risk").notNull().default("Unknown"),

    // Constrained facility type (see DATA_CENTRE_TYPES). Defaults to
    // "Unknown / not reported"; never inferred from geography or operator.
    facilityType: text("facility_type")
      .notNull()
      .default("Unknown / not reported"),

    // Capacity figures (megawatts). Nullable — read "not reported" when blank.
    capacityMw: doublePrecision("capacity_mw"),
    itLoadMw: doublePrecision("it_load_mw"),

    // Lifecycle dates (nullable).
    announcedDate: timestamp("announced_date", { withTimezone: true }),
    expectedOnlineDate: timestamp("expected_online_date", { withTimezone: true }),
    commissionedDate: timestamp("commissioned_date", { withTimezone: true }),

    // Free-text analyst notes + a source URL for the facility record.
    notes: text("notes"),
    sourceUrl: text("source_url"),

    // OPTIONAL back-link to a single incident this facility is associated with.
    // Null for the vast majority of rows; setting it never creates or removes an
    // incident, it is purely an analyst-drawn association.
    linkedIncidentId: integer("linked_incident_id"),

    // Status-transition tracking. `statusChanged` is set true when the status is
    // updated to a different value; `previousStatus` records what it moved from
    // and `statusChangedAt` when. Lets the monitor surface recent movers.
    statusChanged: boolean("status_changed").notNull().default(false),
    previousStatus: text("previous_status"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),

    // Analyst-entered authorship (NOT authenticated identity).
    createdBy: text("created_by"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byCountry: index("data_centre_facilities_country_idx").on(t.country),
    byStatus: index("data_centre_facilities_status_idx").on(t.status),
    byLinkedIncident: index("data_centre_facilities_linked_incident_idx").on(
      t.linkedIncidentId,
    ),
  }),
);

export type DataCentreFacility = typeof dataCentreFacilitiesTable.$inferSelect;
export type InsertDataCentreFacility =
  typeof dataCentreFacilitiesTable.$inferInsert;
