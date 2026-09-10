import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { incidentsTable } from "./incidents";

/**
 * Current semantic projection for a maritime article.  Every provider decision
 * is also appended to maritime_semantic_decisions for audit; this projection
 * exists to make list/report joins bounded and cheap.
 */
export const maritimeSemanticEvidenceTable = pgTable(
  "maritime_semantic_evidence",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidentsTable.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    verdict: text("verdict").notNull(),
    reason: text("reason").notNull(),
    eventOccurred: boolean("event_occurred"),
    eventClass: text("event_class"),
    commercialTargetValidated: boolean("commercial_target_validated")
      .notNull()
      .default(false),
    commercialTarget: text("commercial_target").notNull(),
    commercialTargetName: text("commercial_target_name"),
    commercialTargetEvidence: text("commercial_target_evidence"),
    physicalLocation: text("physical_location"),
    physicalLocationEvidence: text("physical_location_evidence"),
    country: text("country"),
    coastalState: text("coastal_state"),
    routeKind: text("route_kind").notNull().default("none"),
    routeName: text("route_name"),
    routeEvidence: text("route_evidence"),
    consequenceKind: text("consequence_kind").notNull().default("unknown"),
    consequenceStatus: text("consequence_status").notNull().default("none"),
    consequenceClaim: text("consequence_claim"),
    consequenceEvidenceQuote: text("consequence_evidence_quote"),
    consequenceConfidence: doublePrecision("consequence_confidence"),
    consequenceDescription: text("consequence_description"),
    consequenceEvidence: text("consequence_evidence"),
    commercialConsequenceStatus: text("commercial_consequence_status")
      .notNull()
      .default("none"),
    commercialConsequenceClaim: text("commercial_consequence_claim"),
    commercialConsequenceEvidenceQuote: text(
      "commercial_consequence_evidence_quote",
    ),
    commercialConsequenceConfidence: doublePrecision(
      "commercial_consequence_confidence",
    ),
    geopoliticalRelevant: boolean("geopolitical_relevant")
      .notNull()
      .default(false),
    geopoliticalClaim: text("geopolitical_claim"),
    geopoliticalEvidenceQuote: text("geopolitical_evidence_quote"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    /** Canonical relational development id; provider freeform keys stay in audit. */
    developmentKey: text("development_key"),
    contentFingerprint: text("content_fingerprint"),
    severity: text("severity"),
    severityJustification: text("severity_justification"),
    severityEvidenceQuote: text("severity_evidence_quote"),
    confidenceEvent: doublePrecision("confidence_event"),
    confidenceClassification: doublePrecision("confidence_classification"),
    confidenceCommercialTarget: doublePrecision("confidence_commercial_target"),
    confidenceGeography: doublePrecision("confidence_geography"),
    confidenceRoute: doublePrecision("confidence_route"),
    confidenceConsequence: doublePrecision("confidence_consequence"),
    confidenceDate: doublePrecision("confidence_date"),
    contradictions: jsonb("contradictions")
      .$type<string[]>()
      .notNull()
      .default([]),
    sourceQuotes: jsonb("source_quotes")
      .$type<Array<{ quote: string; claim: string }>>()
      .notNull()
      .default([]),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("maritime_semantic_evidence_incident_version_uq").on(
      table.incidentId,
      table.version,
    ),
    index("maritime_semantic_evidence_verdict_idx").on(
      table.verdict,
      table.eventClass,
      table.evaluatedAt,
    ),
    index("maritime_semantic_evidence_development_idx").on(
      table.developmentKey,
      table.eventDate,
    ),
  ],
);

/**
 * Append-only provider/analyst decision ledger.  A changed source fingerprint
 * produces a new decision row; no prior decision is overwritten.
 */
export const maritimeSemanticDecisionsTable = pgTable(
  "maritime_semantic_decisions",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidentsTable.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    verdict: text("verdict").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence")
      .$type<unknown>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("maritime_semantic_decisions_fingerprint_uq").on(
      table.incidentId,
      table.version,
      table.contentFingerprint,
    ),
    index("maritime_semantic_decisions_incident_idx").on(
      table.incidentId,
      table.createdAt,
    ),
  ],
);

export type MaritimeSemanticEvidenceRow =
  typeof maritimeSemanticEvidenceTable.$inferSelect;
export type InsertMaritimeSemanticEvidence =
  typeof maritimeSemanticEvidenceTable.$inferInsert;
export type MaritimeSemanticDecision =
  typeof maritimeSemanticDecisionsTable.$inferSelect;
export type InsertMaritimeSemanticDecision =
  typeof maritimeSemanticDecisionsTable.$inferInsert;