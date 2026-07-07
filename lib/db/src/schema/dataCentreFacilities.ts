import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
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

// Per-field enrichment provenance. When a supervised, provider-agnostic
// enrichment run writes an operational field (status / facilityType /
// capacityMw / itLoadMw) from an external source, it records WHICH source and
// WHICH value it wrote here, keyed by the enriched field name. This satisfies
// the "store the source reference against every updated field" rule and lets
// re-runs stay idempotent (a field is never re-imposed if the exact same value
// was already imported once — respecting any later analyst override).
export interface EnrichmentFieldSource {
  // Provider display name, e.g. "Baxtel". Never a secret / key.
  provider: string;
  // The source's own reference for this fact (URL or record id) if it supplies
  // one; null when the source carries no per-record reference.
  sourceRef: string | null;
  // The "as of" date the source stated for this fact, verbatim; null if none.
  asOf: string | null;
  // The exact value written to the column (string for status/type, number for
  // capacity). Used as the idempotency marker for re-runs.
  value: string | number;
}
export type EnrichmentSources = Record<string, EnrichmentFieldSource>;

// The four operational fields the supervised enrichment run may WRITE — and that
// an analyst may therefore LOCK. Mirrors ENRICHABLE_FIELDS in the enrichment
// engine; it is duplicated here (rather than imported) to avoid a dependency
// cycle, since `lib/ingest` imports `lib/db`, not the other way round.
export const ENRICHABLE_FACILITY_FIELDS = [
  "status",
  "facilityType",
  "capacityMw",
  "itLoadMw",
] as const;
export type EnrichableFacilityField =
  (typeof ENRICHABLE_FACILITY_FIELDS)[number];

// Per-field ANALYST LOCK. When an analyst manually corrects one of the four
// enrichable fields, the owner-gated PATCH route stamps that field here so a
// later enrichment import can NEVER overwrite the corrected value (the engine's
// differ skips any locked field). Set ONLY by the PATCH route (an analyst
// action) — the enrichment engine never writes locks. The analyst can clear a
// lock (unlock toggle) to let future imports flow into that field again.
export type EnrichmentLocks = Partial<
  Record<EnrichableFacilityField, { lockedAt: string }>
>;

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

    // Per-field enrichment provenance (see EnrichmentSources). Nullable — only
    // set when a supervised enrichment run writes an operational field from an
    // external source. Never touched by manual analyst edits.
    enrichmentSources: jsonb("enrichment_sources").$type<EnrichmentSources>(),

    // Per-field analyst LOCK (see EnrichmentLocks). Nullable — set by the PATCH
    // route when an analyst manually corrects an enrichable field so no later
    // import overwrites it. The enrichment engine never writes this column.
    enrichmentLocks: jsonb("enrichment_locks").$type<EnrichmentLocks>(),

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
