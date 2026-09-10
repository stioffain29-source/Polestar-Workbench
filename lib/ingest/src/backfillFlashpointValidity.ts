import { db, incidentsTable, incidentValidityAuditTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { FLASHPOINT_VALIDITY_VERSION, isTransientFlashpointValidityReason, validateFlashpointEvent } from "./flashpointValidity";
import { flashpointContentFingerprint } from "./flashpointFingerprint";

export type IncidentSnapshot = typeof incidentsTable.$inferSelect;
export const FLASHPOINT_VALIDITY_RETRY_MS = 5 * 60 * 1000;

export function isFlashpointBackfillCandidate(
  row: Pick<IncidentSnapshot, "topic" | "validityVersion" | "validityReason" | "validityEvaluatedAt">,
  now: Date,
): boolean {
  if (row.topic !== "flashpoint" && row.topic !== "protests") return false;
  if (row.validityVersion !== FLASHPOINT_VALIDITY_VERSION) return true;
  return isTransientFlashpointValidityReason(row.validityReason)
    && row.validityEvaluatedAt !== null
    && row.validityEvaluatedAt.getTime() <= now.getTime() - FLASHPOINT_VALIDITY_RETRY_MS;
}

const EVIDENCE_FIELDS = [
  "topic", "title", "displayTitle", "summary", "source", "sourceUrl",
  "country", "location", "occurredAt", "incidentDate",
] as const;

/** Null-safe in-memory equivalent of the SQL CAS evidence predicates. */
export function flashpointEvidenceSnapshotMatches(
  selected: IncidentSnapshot,
  current: IncidentSnapshot,
): boolean {
  return EVIDENCE_FIELDS.every((key) => {
    const left = selected[key];
    const right = current[key];
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
  });
}

export interface FlashpointBackfillDependencies {
  now: () => Date;
  selectCandidates: (limit: number, retryBefore: Date) => Promise<IncidentSnapshot[]>;
  validate: typeof validateFlashpointEvent;
  compareAndSet: (
    row: IncidentSnapshot,
    result: Awaited<ReturnType<typeof validateFlashpointEvent>>,
    evaluatedAt: Date,
  ) => Promise<boolean>;
  recordAudit: (
    row: IncidentSnapshot,
    result: Awaited<ReturnType<typeof validateFlashpointEvent>>,
    now: Date,
  ) => Promise<void>;
}

const defaultDependencies: FlashpointBackfillDependencies = {
  now: () => new Date(),
  selectCandidates: async (limit, retryBefore) => db.select().from(incidentsTable).where(and(
    inArray(incidentsTable.topic, ["flashpoint", "protests"]),
    or(
      isNull(incidentsTable.validityVersion),
      ne(incidentsTable.validityVersion, FLASHPOINT_VALIDITY_VERSION),
      and(
        eq(incidentsTable.validityVersion, FLASHPOINT_VALIDITY_VERSION),
        lte(incidentsTable.validityEvaluatedAt, retryBefore),
        sql`${incidentsTable.validityReason} ~* '(unavailable|http|timeout|failed|malformed|incoherent)'`,
      ),
    ),
  )).orderBy(desc(incidentsTable.occurredAt)).limit(limit),
  validate: validateFlashpointEvent,
  compareAndSet: async (row, result, evaluatedAt) => {
    const score = Math.min(result.confidence.event, result.confidence.classification, result.confidence.geography, result.confidence.date);
    const updated = await db.update(incidentsTable).set({
      validityStatus: result.verdict, validityScore: score, validityReason: result.reason,
      validityVersion: result.version, validityEvaluatedAt: evaluatedAt, validityGates: result,
    }).where(and(
      eq(incidentsTable.id, row.id),
      sql`${incidentsTable.topic} IS NOT DISTINCT FROM ${row.topic}`,
      sql`${incidentsTable.title} IS NOT DISTINCT FROM ${row.title}`,
      sql`${incidentsTable.displayTitle} IS NOT DISTINCT FROM ${row.displayTitle}`,
      sql`${incidentsTable.summary} IS NOT DISTINCT FROM ${row.summary}`,
      sql`${incidentsTable.source} IS NOT DISTINCT FROM ${row.source}`,
      sql`${incidentsTable.sourceUrl} IS NOT DISTINCT FROM ${row.sourceUrl}`,
      sql`${incidentsTable.country} IS NOT DISTINCT FROM ${row.country}`,
      sql`${incidentsTable.location} IS NOT DISTINCT FROM ${row.location}`,
      sql`${incidentsTable.occurredAt} IS NOT DISTINCT FROM ${row.occurredAt}`,
      sql`${incidentsTable.incidentDate} IS NOT DISTINCT FROM ${row.incidentDate}`,
    )).returning({ id: incidentsTable.id });
    return updated.length === 1;
  },
  recordAudit: async (row, result, now) => {
    await db.insert(incidentValidityAuditTable).values({
      title: row.title, summary: row.summary, source: row.source, sourceUrl: row.sourceUrl,
      feed: "bounded-backfill", verdict: result.verdict, reason: result.reason, gates: result,
      classifierVersion: result.version,
      contentFingerprint: flashpointContentFingerprint({
        topic: row.topic, title: row.title, displayTitle: row.displayTitle, summary: row.summary,
        source: row.source, sourceUrl: row.sourceUrl, country: row.country,
        location: row.location, occurredAt: row.occurredAt, incidentDate: row.incidentDate,
      }),
      retryAfter: isTransientFlashpointValidityReason(result.reason)
        ? new Date(now.getTime() + FLASHPOINT_VALIDITY_RETRY_MS)
        : null,
    });
  },
};

export async function backfillFlashpointValidity(
  limit = 100,
  dependencies: FlashpointBackfillDependencies = defaultDependencies,
): Promise<{ considered: number; updated: number }> {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const now = dependencies.now();
  const rows = await dependencies.selectCandidates(
    bounded,
    new Date(now.getTime() - FLASHPOINT_VALIDITY_RETRY_MS),
  );
  let updated = 0;
  for (let i = 0; i < rows.length; i += 4) {
    const results = await Promise.all(rows.slice(i, i + 4).map(async (row) => ({
      row,
       result: await dependencies.validate({
        title: row.title, summary: row.summary, source: row.source, sourceUrl: row.sourceUrl,
        assignedCountry: row.country, assignedLocation: row.location, publishedAt: row.occurredAt,
        candidateEventDate: row.incidentDate,
      }),
    })));
    for (const { row, result } of results) {
      const didUpdate = await dependencies.compareAndSet(row, result, now);
      await dependencies.recordAudit(row, result, now);
      if (didUpdate) updated++;
    }
  }
  return { considered: rows.length, updated };
}