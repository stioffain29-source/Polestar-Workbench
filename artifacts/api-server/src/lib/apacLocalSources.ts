import { db, incidentsTable, sourcesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import type {
  ApacLocalFeedHealth,
  ApacLocalSample,
  ApacLocalSourceHealth,
} from "@workspace/api-zod";
import { logger } from "./logger";

// ===========================================================================
// APAC Local (direct-outlet RSS) Source Health.
//
// A focused board for the `apac_local` topic: curated DIRECT outlet RSS feeds
// (NOT Google News) across the six tracked APAC territories. It surfaces, per
// feed, the REAL per-feed `sources` telemetry the ingest self-registers
// (status, last successful/failed pull, items retained this run, error), plus
// the total number of `apac_local` incidents and five most-recent sample rows.
//
// Everything is driven by REAL signals only — the `sources` rows the ingest
// writes and the `incidents` it produced. The probe never throws: each part
// degrades to an empty/zero result so the parent status endpoint stays healthy.
// ===========================================================================

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Per-feed health rows written by the ingest for topic='apac_local'. */
async function feedHealth(): Promise<ApacLocalFeedHealth[]> {
  try {
    const rows = await db
      .select({
        name: sourcesTable.name,
        status: sourcesTable.status,
        lastSuccessAt: sourcesTable.lastSuccessAt,
        lastFailureAt: sourcesTable.lastFailureAt,
        itemsRetained: sourcesTable.itemsRetained,
        errorMessage: sourcesTable.errorMessage,
        scrapeMethod: sourcesTable.scrapeMethod,
      })
      .from(sourcesTable)
      .where(eq(sourcesTable.topic, "apac_local"))
      .orderBy(sourcesTable.name);
    return rows.map((r) => ({
      name: r.name,
      status: r.status,
      lastSuccessAt: iso(r.lastSuccessAt),
      lastFailureAt: iso(r.lastFailureAt),
      itemsRetained: r.itemsRetained ?? null,
      errorMessage: r.errorMessage ?? null,
      scrapeMethod: r.scrapeMethod ?? null,
    }));
  } catch (err) {
    logger.warn({ err: msg(err) }, "apac_local feed health query failed");
    return [];
  }
}

/** Total apac_local incidents produced by the ingest. */
async function totalIncidents(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(eq(incidentsTable.topic, "apac_local"));
    return row?.n ?? 0;
  } catch (err) {
    logger.warn({ err: msg(err) }, "apac_local incident count query failed");
    return 0;
  }
}

/** Five most-recent apac_local incidents as verification samples. */
async function samples(): Promise<ApacLocalSample[]> {
  try {
    const rows = await db
      .select({
        title: incidentsTable.title,
        displayTitle: incidentsTable.displayTitle,
        country: incidentsTable.country,
        occurredAt: incidentsTable.occurredAt,
        source: incidentsTable.source,
        sourceUrl: incidentsTable.sourceUrl,
      })
      .from(incidentsTable)
      .where(eq(incidentsTable.topic, "apac_local"))
      .orderBy(desc(incidentsTable.occurredAt))
      .limit(5);
    return rows.map((r) => ({
      title: r.displayTitle ?? r.title,
      country: r.country,
      occurredAt: iso(r.occurredAt),
      source: r.source ?? null,
      sourceUrl: r.sourceUrl ?? null,
    }));
  } catch (err) {
    logger.warn({ err: msg(err) }, "apac_local sample query failed");
    return [];
  }
}

export async function getApacLocalSourceHealth(): Promise<ApacLocalSourceHealth> {
  const [feeds, total, sampleRows] = await Promise.all([
    feedHealth(),
    totalIncidents(),
    samples(),
  ]);
  return { feeds, totalIncidents: total, samples: sampleRows };
}
