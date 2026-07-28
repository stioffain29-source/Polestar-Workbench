import {
  db,
  incidentsTable,
  countryEngineEventsTable,
  countryEngineOverridesTable,
  countryEngineAuditTable,
  countryEngineRunsTable,
} from "@workspace/db";
import { and, gte, or, ilike, eq, inArray, not } from "drizzle-orm";
import { buildCanonicalEvents } from "@workspace/country-engine/engine";
import { getCountryEngineConfig } from "@workspace/country-engine/config";
import type {
  EngineSourceInput,
  EngineResult,
  AnalystEventOverride,
  CanonicalEvent,
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
  const now = new Date();
  const events: CanonicalEvent[] = result.events;
  const seenIds = events.map((ev) => ev.eventId);
  for (const ev of events) {
    await db
      .insert(countryEngineEventsTable)
      .values({
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
      })
      .onConflictDoUpdate({
        target: [
          countryEngineEventsTable.countrySlug,
          countryEngineEventsTable.eventId,
        ],
        set: {
          payload: ev,
          inclusionStatus: ev.inclusionStatus,
          exclusionReason: ev.exclusionReason ?? null,
          duplicateGroupId: ev.duplicateGroupId ?? null,
          eventDate: eventDateColumn(ev),
          physicalCountry: ev.physicalCountry ?? null,
          severity: ev.severity ?? null,
          classificationConfidence: ev.classificationConfidence ?? null,
          updatedAt: now,
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
