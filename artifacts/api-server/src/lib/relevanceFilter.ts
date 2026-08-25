import { incidentsTable } from "@workspace/db";
import { eq, type SQL } from "drizzle-orm";

/**
 * Default server-side relevance gate for incident reads. Fail closed: only rows
 * the shared @workspace/relevance engine explicitly marked 'relevant' appear.
 * NULL/unevaluated records are not incidents until classification proves they
 * are, so geography, source membership or ingestion alone can never surface one.
 * This is the single choke point that keeps every read surface (topic pages,
 * incidents list, map, timeline, dashboard counts) clean.
 */
export function defaultRelevanceCondition(): SQL {
  return eq(incidentsTable.relevanceStatus, "relevant");
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
