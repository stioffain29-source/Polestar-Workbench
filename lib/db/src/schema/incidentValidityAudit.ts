import { pgTable, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const incidentValidityAuditTable = pgTable("incident_validity_audit", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary"),
  source: text("source"),
  sourceUrl: text("source_url"),
  feed: text("feed"),
  verdict: text("verdict").notNull(),
  reason: text("reason"),
  gates: jsonb("gates"),
  classifierVersion: text("classifier_version").notNull(),
  contentFingerprint: text("content_fingerprint"),
  retryAfter: timestamp("retry_after", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("incident_validity_audit_lookup_idx").on(
    table.sourceUrl,
    table.classifierVersion,
    table.contentFingerprint,
    table.createdAt,
  ),
]);