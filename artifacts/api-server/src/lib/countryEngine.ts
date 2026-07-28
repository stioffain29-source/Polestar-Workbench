import {
  db,
  incidentsTable,
  countryEngineEventsTable,
  countryEngineOverridesTable,
  countryEngineAuditTable,
  countryEngineRunsTable,
} from "@workspace/db";
import { and, gte, lte, or, ilike, eq, inArray, not, sql } from "drizzle-orm";
import { buildCanonicalEvents } from "@workspace/country-engine/engine";
import {
  getCountryEngineConfig,
  COUNTRY_ENGINE_CONFIGS,
} from "@workspace/country-engine/config";
import type {
  EngineSourceInput,
  EngineResult,
  AnalystEventOverride,
  CanonicalEvent,
  ExclusionReason,
  InclusionStatus,
  IssueCategory,
} from "@workspace/country-engine/types";
import { logger } from "./logger";

// The engine reads incidents from a rolling window. 120 days is wider than any
// report's 7-day rendering window so historical / retrospective coverage that
// arrives during the window (owner brief §6) is available for the engine's
// event-date resolution and dedupe, without scanning the whole table.
const LOOKBACK_DAYS = 120;

type IncidentRow = typeof incidentsTable.$inferSelect;

/** Coerce a drizzle timestamp (Date OR string at runtime) to an ISO string. */
function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return new Date(v).toISOString();
}

/**
 * Project an incident row into the engine's input shape. The engine NEVER reads
 * the incidents table directly — callers project rows into EngineSourceInput.
 * Drizzle timestamps can be strings at runtime, so every date is coerced with
 * new Date(v).toISOString().
 */
function projectRow(row: IncidentRow): EngineSourceInput {
  return {
    id: String(row.id),
    topic: row.topic,
    title: row.title,
    displayTitle: row.displayTitle ?? null,
    summary: row.summary ?? null,
    country: row.country ?? null,
    location: row.location ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    occurredAt: toIso(row.occurredAt) ?? new Date(0).toISOString(),
    incidentDate: toIso(row.incidentDate),
    province: row.province ?? null,
    category: row.category ?? null,
    severity: row.severity ?? null,
    source: row.source ?? null,
    sourceUrl: row.sourceUrl ?? null,
    fatalities: row.fatalities ?? null,
  };
}

/** Denormalised event_date column value (ISO string → Date, else null). */
function eventDateColumn(ev: CanonicalEvent): Date | null {
  if (!ev.eventDate) return null;
  const d = new Date(ev.eventDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Load the persisted analyst overrides for a country as an array of
 * AnalystEventOverride, ready to pass to buildCanonicalEvents.
 */
async function loadOverrides(slug: string): Promise<AnalystEventOverride[]> {
  const rows = await db
    .select()
    .from(countryEngineOverridesTable)
    .where(eq(countryEngineOverridesTable.countrySlug, slug));
  return rows.map((r) => r.override);
}

/**
 * Run the shared country-report engine for one country slug.
 *
 * Loads the country's incidents from the last 120 days (using the same
 * countryLike accepted-token superset filter the incidents route builds),
 * projects them to EngineSourceInput, applies persisted analyst overrides, runs
 * buildCanonicalEvents, then persists the result: upserts every canonical event
 * into country_engine_events, deletes rows for the slug no longer present, and
 * records a country_engine_runs row with the run stats. Returns the EngineResult.
 */
export async function runCountryEngine(slug: string): Promise<EngineResult> {
  const config = getCountryEngineConfig(slug);

  // Accepted-token superset pre-filter: an OR of case-insensitive substring
  // matches on the (semicolon-compound) `country` field, one per accepted
  // token. LIKE metacharacters are stripped so a stray token cannot widen the
  // pattern (mirrors routes/incidents.ts countryLike).
  const tokens = config.acceptedTokens
    .map((t) => t.trim().replace(/[%_\\]/g, ""))
    .filter(Boolean);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
  const conditions = [gte(incidentsTable.occurredAt, since)];
  if (tokens.length > 0) {
    conditions.push(
      or(...tokens.map((t) => ilike(incidentsTable.country, `%${t}%`)))!,
    );
  }
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(and(...conditions));

  const inputs = rows.map(projectRow);
  const overrides = await loadOverrides(slug);
  const result = buildCanonicalEvents(inputs, config, overrides);

  // Persist: upsert every event, delete rows no longer present, record the run.
  // Upserts are BATCHED (chunks of 200) — at review-queue scale (10k+ events per
  // country) one-row-at-a-time round trips made reprocess runs take minutes.
  const now = new Date();
  const events: CanonicalEvent[] = result.events;
  const seenIds = events.map((ev) => ev.eventId);
  const CHUNK = 200;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    await db
      .insert(countryEngineEventsTable)
      .values(
        chunk.map((ev) => ({
          countrySlug: slug,
          eventId: ev.eventId,
          payload: ev,
          inclusionStatus: ev.inclusionStatus,
          exclusionReason: ev.exclusionReason ?? null,
          duplicateGroupId: ev.duplicateGroupId ?? null,
          eventDate: eventDateColumn(ev),
          physicalCountry: ev.physicalCountry ?? null,
          severity: ev.severity ?? null,
          classificationConfidence: ev.classificationConfidence ?? null,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          countryEngineEventsTable.countrySlug,
          countryEngineEventsTable.eventId,
        ],
        set: {
          payload: sql`excluded.payload`,
          inclusionStatus: sql`excluded.inclusion_status`,
          exclusionReason: sql`excluded.exclusion_reason`,
          duplicateGroupId: sql`excluded.duplicate_group_id`,
          eventDate: sql`excluded.event_date`,
          physicalCountry: sql`excluded.physical_country`,
          severity: sql`excluded.severity`,
          classificationConfidence: sql`excluded.classification_confidence`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  // Delete rows for this slug no longer present in the latest run.
  if (seenIds.length > 0) {
    await db
      .delete(countryEngineEventsTable)
      .where(
        and(
          eq(countryEngineEventsTable.countrySlug, slug),
          not(inArray(countryEngineEventsTable.eventId, seenIds)),
        ),
      );
  } else {
    await db
      .delete(countryEngineEventsTable)
      .where(eq(countryEngineEventsTable.countrySlug, slug));
  }

  await db.insert(countryEngineRunsTable).values({
    countrySlug: slug,
    ranAt: now,
    stats: {
      ...result.stats,
      eventsTotal: result.events.length,
      included: result.included.length,
      // Pre-publication gate failure summary (owner brief §33/§37). The engine
      // does not yet surface per-check failures here; record an empty summary
      // so the shape is stable and admin surfaces can extend it.
      gateFailures: [],
    },
  });

  logger.info(
    { slug, ...result.stats, eventsTotal: result.events.length },
    "runCountryEngine: persisted engine result",
  );
  return result;
}

/**
 * Re-run the engine for EVERY registered country slug. Used after each
 * scheduled ingest so freshly-ingested incidents (and any rule changes already
 * live in the process) propagate to the persisted review queues without
 * waiting for a boot or an analyst-triggered reprocess. Each slug is wrapped
 * in its own try/catch so one country's failure never blocks the rest.
 */
export async function runCountryEngineAll(
  reason: string,
): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  for (const slug of Object.keys(COUNTRY_ENGINE_CONFIGS)) {
    try {
      await runCountryEngine(slug);
      ok.push(slug);
      // Yield between heavy CPU-bound slugs so queued requests get serviced.
      await new Promise((r) => setImmediate(r));
    } catch (err) {
      failed.push(slug);
      logger.error(
        { err, slug, reason },
        "runCountryEngineAll: engine run failed for country (continuing)",
      );
    }
  }
  logger.info({ reason, ok, failed }, "runCountryEngineAll: finished");
  return { ok, failed };
}

/**
 * Apply an analyst override on top of engine output (owner brief §37): upsert
 * the override, write an audit row, then re-run the engine so the persisted
 * events reflect the correction. Returns the updated EngineResult.
 */
export async function applyOverride(
  slug: string,
  override: AnalystEventOverride,
  actor: string | null,
): Promise<EngineResult> {
  const now = new Date();
  await db
    .insert(countryEngineOverridesTable)
    .values({
      countrySlug: slug,
      eventId: override.eventId,
      override,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        countryEngineOverridesTable.countrySlug,
        countryEngineOverridesTable.eventId,
      ],
      set: { override, updatedAt: now },
    });

  await db.insert(countryEngineAuditTable).values({
    countrySlug: slug,
    eventId: override.eventId,
    action: "override",
    detail: override,
    actor: actor ?? null,
    createdAt: now,
  });

  return runCountryEngine(slug);
}

// ---------------------------------------------------------------------------
// Bulk triage (review-queue scale). The §7 confidence gate holds mid-confidence
// records for review; at 10k+ held rows per country, one-event overrides are
// unworkable. applyBulkOverride selects matching persisted events via the
// denormalised review-queue columns, upserts one AnalystEventOverride per
// match (merged over any existing override so prior corrections survive),
// writes ONE audit row describing the whole action, and re-runs the engine
// ONCE so persisted events reflect the change.
// ---------------------------------------------------------------------------

export interface BulkOverrideFilter {
  /** Which status to select from. Defaults to "held" (the review queue). */
  inclusionStatus?: InclusionStatus;
  issueCategory?: IssueCategory;
  exclusionReason?: ExclusionReason;
  /** Inclusive event-date bounds (ISO date or datetime). Undated events never
   * match a date-bounded filter. */
  dateFrom?: string;
  dateTo?: string;
  /** Inclusive classification-confidence band (0-100). */
  minConfidence?: number;
  maxConfidence?: number;
}

export interface BulkOverrideSet {
  inclusionStatus: Extract<InclusionStatus, "included" | "excluded">;
  exclusionReason?: ExclusionReason | null;
}

export interface BulkOverrideSample {
  eventId: string;
  eventTitle: string;
  issueCategory: string;
  eventDate: string | null;
}

export interface BulkOverrideResult {
  matched: number;
  applied: number;
  dryRun: boolean;
  sample: BulkOverrideSample[];
  stats: Record<string, unknown> | null;
}

const BULK_SAMPLE_SIZE = 20;
// Audit detail keeps at most this many event ids — enough to trace what a bulk
// action touched without writing a multi-megabyte jsonb row.
const BULK_AUDIT_ID_CAP = 500;

export async function applyBulkOverride(
  slug: string,
  filter: BulkOverrideFilter,
  set: BulkOverrideSet,
  actor: string | null,
  dryRun: boolean,
): Promise<BulkOverrideResult> {
  const conditions = [
    eq(countryEngineEventsTable.countrySlug, slug),
    eq(
      countryEngineEventsTable.inclusionStatus,
      filter.inclusionStatus ?? "held",
    ),
  ];
  if (filter.issueCategory) {
    conditions.push(
      sql`${countryEngineEventsTable.payload}->>'issueCategory' = ${filter.issueCategory}`,
    );
  }
  if (filter.exclusionReason) {
    conditions.push(
      eq(countryEngineEventsTable.exclusionReason, filter.exclusionReason),
    );
  }
  if (filter.dateFrom) {
    conditions.push(
      gte(countryEngineEventsTable.eventDate, new Date(filter.dateFrom)),
    );
  }
  if (filter.dateTo) {
    conditions.push(
      lte(countryEngineEventsTable.eventDate, new Date(filter.dateTo)),
    );
  }
  if (filter.minConfidence != null) {
    conditions.push(
      gte(countryEngineEventsTable.classificationConfidence, filter.minConfidence),
    );
  }
  if (filter.maxConfidence != null) {
    conditions.push(
      lte(countryEngineEventsTable.classificationConfidence, filter.maxConfidence),
    );
  }

  const rows = await db
    .select({
      eventId: countryEngineEventsTable.eventId,
      payload: countryEngineEventsTable.payload,
    })
    .from(countryEngineEventsTable)
    .where(and(...conditions));

  const sample: BulkOverrideSample[] = rows
    .slice(0, BULK_SAMPLE_SIZE)
    .map((r) => ({
      eventId: r.eventId,
      eventTitle: r.payload.eventTitle,
      issueCategory: r.payload.issueCategory,
      eventDate: r.payload.eventDate ?? null,
    }));

  if (dryRun || rows.length === 0) {
    return {
      matched: rows.length,
      applied: 0,
      dryRun,
      sample,
      stats: null,
    };
  }

  // Merge the bulk set over any existing override so prior per-event
  // corrections (category, date, severity, …) survive the bulk action.
  const eventIds = rows.map((r) => r.eventId);
  const existing = new Map<string, AnalystEventOverride>();
  const LOOKUP_CHUNK = 1000;
  for (let i = 0; i < eventIds.length; i += LOOKUP_CHUNK) {
    const chunkIds = eventIds.slice(i, i + LOOKUP_CHUNK);
    const prior = await db
      .select()
      .from(countryEngineOverridesTable)
      .where(
        and(
          eq(countryEngineOverridesTable.countrySlug, slug),
          inArray(countryEngineOverridesTable.eventId, chunkIds),
        ),
      );
    for (const row of prior) existing.set(row.eventId, row.override);
  }

  const now = new Date();
  const overrides: AnalystEventOverride[] = eventIds.map((eventId) => ({
    ...(existing.get(eventId) ?? {}),
    eventId,
    inclusionStatus: set.inclusionStatus,
    exclusionReason:
      set.inclusionStatus === "included" ? null : set.exclusionReason ?? null,
  }));

  const CHUNK = 200;
  for (let i = 0; i < overrides.length; i += CHUNK) {
    const chunk = overrides.slice(i, i + CHUNK);
    await db
      .insert(countryEngineOverridesTable)
      .values(
        chunk.map((override) => ({
          countrySlug: slug,
          eventId: override.eventId,
          override,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          countryEngineOverridesTable.countrySlug,
          countryEngineOverridesTable.eventId,
        ],
        set: {
          override: sql`excluded.override`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  // ONE audit row for the whole bulk action (§37: all manual changes recorded).
  await db.insert(countryEngineAuditTable).values({
    countrySlug: slug,
    eventId: null,
    action: "bulk_override",
    detail: {
      filter,
      set,
      matched: rows.length,
      eventIds: eventIds.slice(0, BULK_AUDIT_ID_CAP),
      eventIdsTruncated: eventIds.length > BULK_AUDIT_ID_CAP,
    },
    actor: actor ?? null,
    createdAt: now,
  });

  const result = await runCountryEngine(slug);
  logger.info(
    { slug, matched: rows.length, set },
    "applyBulkOverride: applied bulk triage",
  );
  return {
    matched: rows.length,
    applied: rows.length,
    dryRun: false,
    sample,
    stats: {
      ...result.stats,
      eventsTotal: result.events.length,
      included: result.included.length,
    },
  };
}
