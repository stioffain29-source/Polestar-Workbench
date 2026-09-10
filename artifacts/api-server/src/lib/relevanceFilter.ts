import { incidentsTable, maritimeSemanticEvidenceTable } from "@workspace/db";
import { displayableIncidentTitleCondition } from "@workspace/ingest/titleTranslate";
import {
  FLASHPOINT_ACCEPTED_EVENT_TYPES,
  FLASHPOINT_CONFIDENCE_THRESHOLDS,
  FLASHPOINT_VALIDITY_VERSION,
  MARITIME_COMMERCIAL_EVENT_CLASSES,
  MARITIME_VALIDATED_COMMERCIAL_TARGETS,
  MARITIME_SEMANTIC_VERSION,
  validateFlashpointSemanticContract,
  type FlashpointSemanticGates,
} from "@workspace/relevance";
import { and, eq, notInArray, or, sql, type SQL } from "drizzle-orm";

function currentMaritimeContentFingerprintSql(): SQL {
  const canonicalDate = (column: unknown) => sql`
    coalesce(
      to_char(
        date_trunc('milliseconds', ${column} AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      ''
    )`;
  return sql`md5(concat_ws(
    ${"\u001f"},
    coalesce(${incidentsTable.topic}, ''),
    coalesce(${incidentsTable.title}, ''),
    coalesce(${incidentsTable.summary}, ''),
    coalesce(${incidentsTable.source}, ''),
    coalesce(${incidentsTable.sourceUrl}, ''),
    coalesce(${incidentsTable.country}, ''),
    coalesce(${incidentsTable.location}, ''),
    ${canonicalDate(incidentsTable.occurredAt)},
    ${canonicalDate(incidentsTable.incidentDate)}
  ))`;
}

/** Requires a projection for the current source snapshot, not merely any v2 row. */
export function currentMaritimeSemanticProjectionCondition(): SQL {
  return and(
    eq(maritimeSemanticEvidenceTable.version, MARITIME_SEMANTIC_VERSION),
    sql`${maritimeSemanticEvidenceTable.contentFingerprint} =
      ${currentMaritimeContentFingerprintSql()}`,
  )!;
}

/**
 * Default server-side relevance gate for incident reads. Fail closed: only rows
 * the shared @workspace/relevance engine explicitly marked 'relevant' appear.
 * NULL/unevaluated records are not incidents until classification proves they
 * are, so geography, source membership or ingestion alone can never surface
 * one. Maritime review rows remain readable for analyst resolution; callers
 * that calculate validated maritime totals additionally apply
 * validatedMaritimeIncidentCondition().
 */
export function defaultRelevanceCondition(): SQL {
  const gates = incidentsTable.validityGates;
  const acceptedEventTypes = sql.join(
    FLASHPOINT_ACCEPTED_EVENT_TYPES.map((eventType) => sql`${eventType}`),
    sql`, `,
  );
  // Deliberately validate JSON values here rather than trusting the denormalised
  // status/version columns. Every cast is behind a JSON-type CASE guard, so a
  // malformed legacy/provider payload fails closed instead of aborting a read.
  const nonBlankString = (key: string): SQL => sql`
    CASE WHEN jsonb_typeof(${gates}->${key}) = 'string'
      THEN btrim(${gates}->>${key}) <> ''
      ELSE false
    END`;
  const confidenceInRange = (
    key: keyof typeof FLASHPOINT_CONFIDENCE_THRESHOLDS,
  ): SQL => sql`
    CASE WHEN jsonb_typeof(${gates}->'confidence'->${key}) = 'number'
      THEN ((${gates}->'confidence'->>${key})::numeric
        BETWEEN ${FLASHPOINT_CONFIDENCE_THRESHOLDS[key]} AND 1)
      ELSE false
    END`;
  // Full Gregorian YYYY-MM-DD validation without date casts (and therefore
  // without cast errors). The leap-year branch implements divisible-by-4,
  // except centuries unless divisible by 400.
  const validDate = sql`
    CASE WHEN jsonb_typeof(${gates}->'eventDate') = 'string'
      THEN substring(${gates}->>'eventDate', 1, 4) <> '0000'
        AND (${gates}->>'eventDate') ~
          '^(?:[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$'
      ELSE false
    END`;
  return and(
    eq(incidentsTable.relevanceStatus, "relevant"),
    or(
      notInArray(incidentsTable.topic, ["flashpoint", "protests"]),
      and(
        eq(incidentsTable.validityStatus, "valid"),
        eq(incidentsTable.validityVersion, FLASHPOINT_VALIDITY_VERSION),
        sql`jsonb_typeof(${gates}) = 'object'`,
        sql`${gates}->>'version' = ${FLASHPOINT_VALIDITY_VERSION}`,
        sql`${gates}->>'verdict' = 'valid'`,
        sql`${gates}->'eventOccurred' = 'true'::jsonb`,
        nonBlankString("actor"),
        nonBlankString("activity"),
        nonBlankString("physicalLocation"),
        nonBlankString("country"),
        sql`CASE WHEN jsonb_typeof(${gates}->'eventType') = 'string'
          THEN ${gates}->>'eventType' IN (${acceptedEventTypes})
          ELSE false END`,
        validDate,
        sql`CASE WHEN jsonb_typeof(${gates}->'currentness') = 'string'
          THEN ${gates}->>'currentness' IN ('current', 'future')
          ELSE false END`,
        sql`${gates}->'assignedCountrySupported' = 'true'::jsonb`,
        sql`CASE WHEN jsonb_typeof(${gates}->'contradictions') = 'array'
          THEN jsonb_array_length(${gates}->'contradictions') = 0
          ELSE false END`,
        sql`jsonb_typeof(${gates}->'confidence') = 'object'`,
        confidenceInRange("event"),
        confidenceInRange("classification"),
        confidenceInRange("geography"),
        confidenceInRange("date"),
      ),
    ),
    displayableIncidentTitleCondition(),
  )!;
}

/**
 * Count/report boundary for maritime rows.  Review rows remain retrievable
 * through the incident API (with maritimeSemantic.verdict=needs_review), but
 * cannot inflate validated incident totals until the relational projection
 * proves a discrete event.  Commercial event classes and
 * military/naval/drone context require a validated commercial target before
 * they enter those totals.
 */
export function validatedMaritimeIncidentCondition(): SQL {
  const targetRequiredClasses = sql.join(
    [
      ...MARITIME_COMMERCIAL_EVENT_CLASSES,
      "naval_activity",
      "military_naval_activity",
      "military_exercise",
      "drone_activity",
    ].map((eventClass) => sql`${eventClass}`),
    sql`, `,
  );
  const validatedTargets = sql.join(
    MARITIME_VALIDATED_COMMERCIAL_TARGETS.map((target) => sql`${target}`),
    sql`, `,
  );
  return or(
    notInArray(incidentsTable.topic, ["shipping", "maritime"]),
    sql`EXISTS (
      SELECT 1
        FROM ${maritimeSemanticEvidenceTable}
       WHERE ${maritimeSemanticEvidenceTable.incidentId} = ${incidentsTable.id}
          AND ${currentMaritimeSemanticProjectionCondition()}
         AND ${maritimeSemanticEvidenceTable.verdict} = 'valid'
         AND ${maritimeSemanticEvidenceTable.eventOccurred} = true
         AND ${maritimeSemanticEvidenceTable.eventClass} IS NOT NULL
         AND ${maritimeSemanticEvidenceTable.eventClass} <> 'non_event'
         AND (
            ${maritimeSemanticEvidenceTable.eventClass} NOT IN (${targetRequiredClasses})
            OR (
              ${maritimeSemanticEvidenceTable.commercialTargetValidated} = true
              AND ${maritimeSemanticEvidenceTable.commercialTarget} IN (${validatedTargets})
              AND ${maritimeSemanticEvidenceTable.commercialTargetEvidence} IS NOT NULL
              AND btrim(${maritimeSemanticEvidenceTable.commercialTargetEvidence}) <> ''
            )
         )
    )`,
  )!;
}

/** Executable value-level mirror of the SQL boundary, used by non-SQL callers
 * and contract tests. Keep this deliberately delegated to the shared contract. */
export function flashpointValidityValuesEligible(row: {
  validityStatus: unknown;
  validityVersion: unknown;
  validityGates: unknown;
}): boolean {
  if (
    row.validityStatus !== "valid"
    || row.validityVersion !== FLASHPOINT_VALIDITY_VERSION
    || !row.validityGates
    || typeof row.validityGates !== "object"
    || Array.isArray(row.validityGates)
  ) return false;
  return validateFlashpointSemanticContract(
    row.validityGates as FlashpointSemanticGates,
  ).valid;
}

/**
 * Admin/raw escape hatch: `?includeIrrelevant=true` returns unfiltered rows
 * for review tooling. Read directly off the query bag so no codegen change
 * is needed; the typed client never sends it.
 */
export function wantsRaw(query: Record<string, unknown>): boolean {
  const v = query.includeIrrelevant;
  const s = Array.isArray(v) ? v[0] : v;
  return s === "true" || s === "1";
}
