import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  incidentsTable,
  maritimeSemanticDecisionsTable,
  maritimeSemanticEvidenceTable,
  type Incident,
} from "@workspace/db";
import {
  MARITIME_SEMANTIC_VERSION,
} from "@workspace/relevance";
import { validateMaritimeEvent } from "./maritimeSemantic";
import {
  adjudicateMaritimeDevelopmentPair,
  MARITIME_DEVELOPMENT_VERSION,
  maritimeDevelopmentEventFromSemantic,
  resolveCanonicalMaritimeDevelopmentId,
} from "./maritimeDevelopment";

export const MARITIME_SEMANTIC_RETRY_MS = 5 * 60 * 1000;
export const MARITIME_SEMANTIC_MAX_TRANSIENT_ATTEMPTS = 3;

export type MaritimeIncidentSnapshot = Pick<
  Incident,
  | "id"
  | "topic"
  | "title"
  | "summary"
  | "source"
  | "sourceUrl"
  | "country"
  | "location"
  | "occurredAt"
  | "incidentDate"
>;

const CONTENT_FIELDS = [
  "topic",
  "title",
  "summary",
  "source",
  "sourceUrl",
  "country",
  "location",
  "occurredAt",
  "incidentDate",
] as const;

// Keep text columns and canonical UTC timestamps in a fixed order so the
// PostgreSQL and Node implementations are byte-for-byte identical. A date-only
// edit therefore invalidates an already-persisted semantic projection.
const FINGERPRINT_FIELDS = [
  "topic",
  "title",
  "summary",
  "source",
  "sourceUrl",
  "country",
  "location",
] as const;

export function maritimeContentFingerprint(row: MaritimeIncidentSnapshot): string {
  const content = [
    ...FINGERPRINT_FIELDS.map((field) => {
      const value = row[field];
      return String(value ?? "");
    }),
    canonicalUtcDate(row.occurredAt),
    canonicalUtcDate(row.incidentDate),
  ].join("\u001f");
  // PostgreSQL's built-in md5() is used by the candidate query below, so this
  // intentionally matches that digest rather than requiring pgcrypto.
  return createHash("md5").update(content).digest("hex");
}

function canonicalUtcDate(value: Date | null): string {
  if (!value) return "";
  // PostgreSQL canonicalizes timestamptz to UTC with millisecond precision in
  // the SQL expression below. Match that truncation before hashing.
  return new Date(value.getTime()).toISOString();
}

function canonicalUtcDateSql(column: unknown) {
  return sql`coalesce(
    to_char(
      date_trunc('milliseconds', ${column} AT TIME ZONE 'UTC'),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    ''
  )`;
}

export function isTransientMaritimeSemanticReason(
  reason: string | null | undefined,
): boolean {
  return /(unavailable|http|timeout|failed|malformed|incoherent)/i.test(
    reason ?? "",
  );
}

export function maritimeEvidenceSnapshotMatches(
  selected: MaritimeIncidentSnapshot,
  current: MaritimeIncidentSnapshot,
): boolean {
  return CONTENT_FIELDS.every((field) => {
    const left = selected[field];
    const right = current[field];
    if (left instanceof Date && right instanceof Date) {
      return left.getTime() === right.getTime();
    }
    return left === right;
  });
}

export interface MaritimeSemanticBackfillDependencies {
  now: () => Date;
  selectCandidates: (
    limit: number,
    retryBefore: Date,
  ) => Promise<MaritimeIncidentSnapshot[]>;
  validate: typeof validateMaritimeEvent;
  compareAndSet: (
    row: MaritimeIncidentSnapshot,
    result: Awaited<ReturnType<typeof validateMaritimeEvent>>,
    evaluatedAt: Date,
  ) => Promise<boolean>;
}

const defaultDependencies: MaritimeSemanticBackfillDependencies = {
  now: () => new Date(),
  selectCandidates: async (limit, retryBefore) => {
    const fingerprint = sql`md5(
      concat_ws(
        E'\\x1f',
        coalesce(${incidentsTable.topic}, ''),
        coalesce(${incidentsTable.title}, ''),
        coalesce(${incidentsTable.summary}, ''),
        coalesce(${incidentsTable.source}, ''),
        coalesce(${incidentsTable.sourceUrl}, ''),
        coalesce(${incidentsTable.country}, ''),
         coalesce(${incidentsTable.location}, ''),
         ${canonicalUtcDateSql(incidentsTable.occurredAt)},
         ${canonicalUtcDateSql(incidentsTable.incidentDate)}
      )
    )`;
    const transientAttempts = sql<number>`(
      SELECT count(*)::int
        FROM maritime_semantic_decisions msd
       WHERE msd.incident_id = ${incidentsTable.id}
         AND msd.version = ${MARITIME_SEMANTIC_VERSION}
         AND msd.content_fingerprint = ${fingerprint}
    )`;
    return db
      .select({
        id: incidentsTable.id,
        topic: incidentsTable.topic,
        title: incidentsTable.title,
        summary: incidentsTable.summary,
        source: incidentsTable.source,
        sourceUrl: incidentsTable.sourceUrl,
        country: incidentsTable.country,
        location: incidentsTable.location,
        occurredAt: incidentsTable.occurredAt,
        incidentDate: incidentsTable.incidentDate,
      })
      .from(incidentsTable)
      .where(and(
        inArray(incidentsTable.topic, ["shipping", "maritime"]),
        sql`(
          NOT EXISTS (
            SELECT 1
              FROM maritime_semantic_evidence mse
             WHERE mse.incident_id = ${incidentsTable.id}
               AND mse.version = ${MARITIME_SEMANTIC_VERSION}
          )
          OR EXISTS (
            SELECT 1
              FROM maritime_semantic_evidence mse
             WHERE mse.incident_id = ${incidentsTable.id}
               AND mse.version = ${MARITIME_SEMANTIC_VERSION}
               AND (
                 mse.content_fingerprint IS DISTINCT FROM ${fingerprint}
                 OR (
                   mse.evaluated_at <= ${retryBefore}
                   AND mse.reason ~* '(unavailable|http|timeout|failed|malformed|incoherent)'
                    AND ${transientAttempts} < ${MARITIME_SEMANTIC_MAX_TRANSIENT_ATTEMPTS}
                 )
               )
          )
        )`,
      ))
      .orderBy(desc(incidentsTable.occurredAt))
      .limit(limit);
  },
  validate: validateMaritimeEvent,
  compareAndSet: async (row, result, evaluatedAt) => {
    const contentFingerprint = maritimeContentFingerprint(row);
    return db.transaction(async (tx) => {
      // Lock the source row for the complete CAS + append-only decision +
      // projection operation. A concurrent PATCH cannot commit between the
      // snapshot check and the semantic projection upsert.
      const [current] = await tx
        .select()
        .from(incidentsTable)
        .where(eq(incidentsTable.id, row.id))
        .for("update")
        .limit(1);
      if (!current || !maritimeEvidenceSnapshotMatches(row, current)) {
        return false;
      }
      const eventDate =
        result.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(result.eventDate)
          ? new Date(`${result.eventDate}T00:00:00.000Z`)
          : null;
      const currentEvent = maritimeDevelopmentEventFromSemantic(
        row.id,
        result,
        null,
        {
          title: row.title,
          summary: row.summary,
          source: row.source,
          sourceUrl: row.sourceUrl,
        },
      );
      const candidateRows = await tx
        .select({
          incidentId: maritimeSemanticEvidenceTable.incidentId,
          canonicalDevelopmentId: maritimeSemanticEvidenceTable.developmentKey,
          eventClass: maritimeSemanticEvidenceTable.eventClass,
          commercialTarget: maritimeSemanticEvidenceTable.commercialTarget,
          commercialTargetName: maritimeSemanticEvidenceTable.commercialTargetName,
          physicalLocation: maritimeSemanticEvidenceTable.physicalLocation,
          country: maritimeSemanticEvidenceTable.country,
          routeName: maritimeSemanticEvidenceTable.routeName,
          eventDate: maritimeSemanticEvidenceTable.eventDate,
          severity: maritimeSemanticEvidenceTable.severity,
          consequenceStatus: maritimeSemanticEvidenceTable.consequenceStatus,
          sourceQuotes: maritimeSemanticEvidenceTable.sourceQuotes,
          contentFingerprint: maritimeSemanticEvidenceTable.contentFingerprint,
          topic: incidentsTable.topic,
          title: incidentsTable.title,
          summary: incidentsTable.summary,
          source: incidentsTable.source,
          sourceUrl: incidentsTable.sourceUrl,
          incidentCountry: incidentsTable.country,
          location: incidentsTable.location,
          occurredAt: incidentsTable.occurredAt,
          incidentDate: incidentsTable.incidentDate,
        })
        .from(maritimeSemanticEvidenceTable)
        .innerJoin(
          incidentsTable,
          eq(incidentsTable.id, maritimeSemanticEvidenceTable.incidentId),
        )
        .where(and(
          inArray(incidentsTable.topic, ["shipping", "maritime"]),
          eq(maritimeSemanticEvidenceTable.version, MARITIME_SEMANTIC_VERSION),
          eq(maritimeSemanticEvidenceTable.verdict, "valid"),
          sql`${maritimeSemanticEvidenceTable.incidentId} <> ${row.id}`,
        ));
      const candidates = candidateRows
        .filter((candidate) => candidate.contentFingerprint === maritimeContentFingerprint({
          id: candidate.incidentId,
          topic: candidate.topic,
          title: candidate.title,
          summary: candidate.summary,
          source: candidate.source,
          sourceUrl: candidate.sourceUrl,
          country: candidate.incidentCountry,
          location: candidate.location,
          occurredAt: candidate.occurredAt,
          incidentDate: candidate.incidentDate,
        }))
        .map((candidate) => ({
          incidentId: candidate.incidentId,
          canonicalDevelopmentId:
            candidate.canonicalDevelopmentId?.startsWith(
              `${MARITIME_DEVELOPMENT_VERSION}:`,
            )
              ? candidate.canonicalDevelopmentId
              : null,
          eventClass: candidate.eventClass,
          commercialTarget: candidate.commercialTarget,
          commercialTargetName: candidate.commercialTargetName,
          physicalLocation: candidate.physicalLocation,
          country: candidate.country,
          routeName: candidate.routeName,
          eventDate: candidate.eventDate,
          severity: candidate.severity,
          consequenceStatus: candidate.consequenceStatus,
          title: candidate.title,
          summary: candidate.summary,
          source: candidate.source,
          sourceUrl: candidate.sourceUrl,
          sourceQuotes:
            Array.isArray(candidate.sourceQuotes)
              ? candidate.sourceQuotes.filter(
                  (quote): quote is { quote: string; claim: string } =>
                    Boolean(
                      quote &&
                      typeof quote === "object" &&
                      typeof (quote as { quote?: unknown }).quote === "string" &&
                      typeof (quote as { claim?: unknown }).claim === "string",
                    ),
                )
              : [],
        }));
      const canonical = await resolveCanonicalMaritimeDevelopmentId(
        currentEvent,
        candidates,
        adjudicateMaritimeDevelopmentPair,
      );
      const values = {
        incidentId: row.id,
        version: result.version,
        verdict: result.verdict,
        reason: result.reason,
        eventOccurred: result.eventOccurred,
        eventClass: result.eventClass,
        commercialTargetValidated: result.commercialTargetValidated,
        commercialTarget: result.commercialTarget,
        commercialTargetName: result.commercialTargetName,
        commercialTargetEvidence: result.commercialTargetEvidence,
        physicalLocation: result.physicalLocation,
        physicalLocationEvidence: result.physicalLocationEvidence,
        country: result.country,
        coastalState: result.coastalState,
        routeKind: result.routeRelationship.kind,
        routeName: result.routeRelationship.routeName,
        routeEvidence: result.routeRelationship.evidence,
        consequenceKind: result.routingConsequence.kind,
        consequenceStatus: result.routingConsequence.status,
        consequenceClaim: result.routingConsequence.claim,
        consequenceEvidenceQuote: result.routingConsequence.evidenceQuote,
        consequenceConfidence: result.routingConsequence.confidence,
        consequenceDescription: result.routingConsequence.description,
        consequenceEvidence: result.routingConsequence.evidence,
        commercialConsequenceStatus: result.commercialConsequence.status,
        commercialConsequenceClaim: result.commercialConsequence.claim,
        commercialConsequenceEvidenceQuote:
          result.commercialConsequence.evidenceQuote,
        commercialConsequenceConfidence: result.commercialConsequence.confidence,
        geopoliticalRelevant: result.geopolitical.relevant,
        geopoliticalClaim: result.geopolitical.claim,
        geopoliticalEvidenceQuote: result.geopolitical.evidenceQuote,
        eventDate,
        developmentKey: canonical.id,
        severity: result.severity,
        severityJustification: result.severityJustification,
        severityEvidenceQuote: result.severityEvidenceQuote,
        confidenceEvent: result.confidence.event,
        confidenceClassification: result.confidence.classification,
        confidenceCommercialTarget: result.confidence.commercialTarget,
        confidenceGeography: result.confidence.geography,
        confidenceRoute: result.confidence.routeRelationship,
        confidenceConsequence: result.confidence.consequence,
        confidenceDate: result.confidence.date,
        contradictions: result.contradictions,
        sourceQuotes: result.sourceQuotes,
        evidence: result.evidence,
        evaluatedAt,
        contentFingerprint,
      };
      await tx
        .insert(maritimeSemanticDecisionsTable)
        .values({
          incidentId: row.id,
          version: result.version,
          contentFingerprint,
          verdict: result.verdict,
          reason: result.reason,
          evidence: result,
          createdAt: evaluatedAt,
        })
        .onConflictDoNothing();
      if (canonical.mergedIncidentIds.length > 0) {
        await tx
          .update(maritimeSemanticEvidenceTable)
          .set({ developmentKey: canonical.id })
          .where(inArray(
            maritimeSemanticEvidenceTable.incidentId,
            canonical.mergedIncidentIds,
          ));
      }
      const updated = await tx
        .insert(maritimeSemanticEvidenceTable)
        .values(values)
        .onConflictDoUpdate({
          target: [
            maritimeSemanticEvidenceTable.incidentId,
            maritimeSemanticEvidenceTable.version,
          ],
          set: values,
        })
        .returning({ id: maritimeSemanticEvidenceTable.id });
      return updated.length === 1;
    });
  },
};

export async function backfillMaritimeSemantic(
  limit = 100,
  dependencies: MaritimeSemanticBackfillDependencies = defaultDependencies,
): Promise<{ considered: number; updated: number }> {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const now = dependencies.now();
  const rows = await dependencies.selectCandidates(
    bounded,
    new Date(now.getTime() - MARITIME_SEMANTIC_RETRY_MS),
  );
  let updated = 0;
  // Four concurrent provider requests is enough to converge history without
  // making semantic validation a startup/readiness dependency.
  for (let offset = 0; offset < rows.length; offset += 4) {
    const results = await Promise.all(
      rows.slice(offset, offset + 4).map(async (row) => ({
        row,
        result: await dependencies.validate({
          title: row.title,
          summary: row.summary,
          source: row.source,
          sourceUrl: row.sourceUrl,
          assignedCountry: row.country,
          assignedLocation: row.location,
          publishedAt: row.occurredAt,
          candidateEventDate: row.incidentDate,
        }),
      })),
    );
    for (const { row, result } of results) {
      if (await dependencies.compareAndSet(row, result, now)) updated++;
    }
  }
  return { considered: rows.length, updated };
}

/** Persist one freshly validated row through the same CAS + append-only path. */
export async function persistMaritimeSemanticEvidence(
  row: MaritimeIncidentSnapshot,
  result: Awaited<ReturnType<typeof validateMaritimeEvent>>,
  evaluatedAt = new Date(),
): Promise<boolean> {
  return defaultDependencies.compareAndSet(row, result, evaluatedAt);
}
