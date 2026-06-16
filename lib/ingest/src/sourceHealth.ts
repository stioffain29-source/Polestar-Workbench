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
// Status is only ever "operational" (the feed responded, OR a single transient
// failure that has not yet crossed the escalation threshold) or "failing" (the
// fetch threw on enough CONSECUTIVE runs to be a sustained outage). The other
// enum states (stale/blocked/delayed/not_configured) are reserved for manual
// analyst classification — the auto pipeline never fabricates them.

// Number of CONSECUTIVE failed ingest runs a feed must accumulate before it is
// escalated from "operational" to "failing".
//
// A single transient Google-News timeout (already retried with backoff inside
// fetchFeed) must NOT flip a healthy feed to "failing" and park it in the red
// Action Required panel until the next run — on an autoscale deployment that run
// can be hours away, so a self-healing blip would masquerade as a hard outage
// and erode trust in the panel. Only a feed that fails this many runs in a row
// is treated as a genuine, sustained outage worth an operator's attention.
export const FAILURE_ESCALATION_THRESHOLD = 3;

export interface FeedHealth {
  /** Stable display name; the upsert key is (name, topic). */
  name: string;
  url: string;
  /** True when the feed fetch succeeded (even if it returned zero items). */
  ok: boolean;
  error?: string | null;
}

/**
 * Upsert one source row per feed, keyed on (name, topic).
 *
 * A successful fetch stamps last_success_at, clears the error and resets the
 * consecutive-failure counter to 0.
 *
 * A failed fetch stamps last_failure_at and increments the counter. While the
 * counter is below FAILURE_ESCALATION_THRESHOLD the feed STAYS "operational"
 * (a quiet transient state recorded in error_message) so a momentary blip never
 * reaches the Action Required panel; once it crosses the threshold the feed
 * escalates to "failing" with its real error so a genuine outage is visible.
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
      const [existing] = await db
        .select({
          id: sourcesTable.id,
          consecutiveFailures: sourcesTable.consecutiveFailures,
        })
        .from(sourcesTable)
        .where(and(eq(sourcesTable.name, f.name), eq(sourcesTable.topic, topic)));

      // Analyst-facing metadata is only written when the caller supplies it.
      const meta = {
        ...(opts.reliability !== undefined ? { reliability: opts.reliability } : {}),
        ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
      };

      let healthFields: {
        url: string;
        sourceType: string;
        status: string;
        errorMessage: string | null;
        consecutiveFailures: number;
        lastSuccessAt?: Date;
        lastFailureAt?: Date;
      };

      if (f.ok) {
        // A successful fetch clears the error and the failure streak. Do NOT
        // touch last_failure_at — leaving it lets the UI see "recovered" (latest
        // success newer than latest failure).
        healthFields = {
          url: f.url,
          sourceType,
          status: "operational",
          errorMessage: null,
          consecutiveFailures: 0,
          lastSuccessAt: now,
        };
      } else {
        const next = (existing?.consecutiveFailures ?? 0) + 1;
        const escalate = next >= FAILURE_ESCALATION_THRESHOLD;
        const rawError = (f.error ?? "Feed fetch failed").slice(0, 500);
        // Below the threshold the feed STAYS operational so a transient blip
        // never reaches Action Required; the error is still recorded with a
        // quiet "retrying" note so the table shows the feed self-healing.
        healthFields = {
          url: f.url,
          sourceType,
          status: escalate ? "failing" : "operational",
          errorMessage: escalate
            ? rawError
            : `Transient fetch issue (failed ${next}x, retrying next run): ${rawError}`.slice(
                0,
                500,
              ),
          consecutiveFailures: next,
          lastFailureAt: now,
        };
      }

      if (existing) {
        await db
          .update(sourcesTable)
          .set({ ...healthFields, ...meta })
          .where(eq(sourcesTable.id, existing.id));
      } else {
        await db.insert(sourcesTable).values({
          name: f.name,
          topic,
          manualReviewRequired: false,
          lastSuccessAt: f.ok ? now : null,
          lastFailureAt: f.ok ? null : now,
          ...healthFields,
          ...meta,
        });
      }
    }
  } catch {
    // Health telemetry is best-effort — never let it fail the ingest run.
  }
}
