import { incidentsTable } from "@workspace/db";
import { isNull, ne, or, type SQL } from "drizzle-orm";

/**
 * Default server-side relevance gate for incident reads. Excludes rows the
 * shared @workspace/relevance engine marked 'irrelevant'; rows with a NULL
 * status (not yet backfilled) fail OPEN so nothing disappears mid-rollout.
 * This is the single choke point that keeps every read surface (topic pages,
 * incidents list, map, timeline, dashboard counts) clean.
 */
export function defaultRelevanceCondition(): SQL {
  return or(
    isNull(incidentsTable.relevanceStatus),
    ne(incidentsTable.relevanceStatus, "irrelevant"),
  )!;
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
