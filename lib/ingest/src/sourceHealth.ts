import { db, sourcesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// Live per-feed Source Health telemetry.
//
// Every topic ingest (flashpoint already does this via its scraper; energy /
// fertiliser / fuel / shipping / cargo_watch / strikes now do too) reports the
// REAL success/failure of each feed it actually polls into the `sources` table.
// This is what replaces the old dead placeholder rows on the Source Health
// page — every catalogued source is now a feed the pipeline genuinely monitors.
//
// Status is only ever "operational" (the feed responded) or "failing" (the
// fetch threw). The other enum states (stale/blocked/delayed/not_configured)
// are reserved for manual analyst classification — the auto pipeline never
// fabricates them.

export interface FeedHealth {
  /** Stable display name; the upsert key is (name, topic). */
  name: string;
  url: string;
  /** True when the feed fetch succeeded (even if it returned zero items). */
  ok: boolean;
  error?: string | null;
}

/**
 * Upsert one source row per feed, keyed on (name, topic). A successful fetch
 * stamps last_success_at and clears the error; a failed fetch stamps
 * last_failure_at and records the error message.
 *
 * Telemetry must never break ingestion, so the whole operation is wrapped: any
 * DB error is swallowed (the incident/price insert is the critical path, this
 * is only the health side-channel).
 */
export async function recordSourceHealth(
  topic: string,
  feeds: FeedHealth[],
  opts: { sourceType?: string; reliability?: number; notes?: string } = {},
): Promise<void> {
  const now = new Date();
  const sourceType = opts.sourceType ?? "rss";
  try {
    for (const f of feeds) {
      if (!f.name) continue;
      const status = f.ok ? "operational" : "failing";
      const errorMessage = f.ok ? null : (f.error ?? "Feed fetch failed").slice(0, 500);
      const [existing] = await db
        .select({ id: sourcesTable.id })
        .from(sourcesTable)
        .where(and(eq(sourcesTable.name, f.name), eq(sourcesTable.topic, topic)));

      if (existing) {
        await db
          .update(sourcesTable)
          .set({
            url: f.url,
            sourceType,
            status,
            errorMessage,
            ...(f.ok ? { lastSuccessAt: now } : { lastFailureAt: now }),
            ...(opts.reliability !== undefined ? { reliability: opts.reliability } : {}),
            ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
          })
          .where(eq(sourcesTable.id, existing.id));
      } else {
        await db.insert(sourcesTable).values({
          name: f.name,
          topic,
          sourceType,
          url: f.url,
          status,
          errorMessage,
          lastSuccessAt: f.ok ? now : null,
          lastFailureAt: f.ok ? null : now,
          manualReviewRequired: false,
          ...(opts.reliability !== undefined ? { reliability: opts.reliability } : {}),
          ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
        });
      }
    }
  } catch {
    // Health telemetry is best-effort — never let it fail the ingest run.
  }
}
