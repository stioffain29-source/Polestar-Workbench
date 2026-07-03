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
// Status is usually "operational" (the feed responded, OR a single transient
// failure that has not yet crossed the escalation threshold) or "failing" (the
// fetch threw on enough CONSECUTIVE runs to be a sustained outage). It can also
// be "stale" when a feed FETCHES fine but its DATA has stopped advancing past
// its expected publication cadence (a silent freeze — e.g. the version-stamped
// World Bank fertiliser workbook still returns HTTP 200 but no new month); this
// is set deterministically by the ingest engine via FeedHealth.stale, never
// fabricated. The remaining enum states (blocked/delayed/not_configured beyond
// the optional-integration path) stay reserved for manual analyst classification.

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
  /**
   * True when the feed FETCHED successfully (ok) but its DATA is materially
   * behind its expected publication cadence — a silent freeze (e.g. a monthly
   * workbook that still returns HTTP 200 but stopped advancing to new months).
   * Recorded as the "stale" status so it surfaces on Source Health / Action
   * Required, distinct from a fetch failure. Only honoured when `ok` is true.
   */
  stale?: boolean;
  /** Human-readable explanation shown when `stale` is set. */
  staleReason?: string | null;
  // --- Optional per-run scrape-health telemetry (LAST-RUN snapshots) --------
  // The funnel this run observed for the feed. Supplied only by engines that
  // genuinely count it (e.g. cargo); when omitted the column is left untouched,
  // so a feed that never reports telemetry reads "—" rather than a fake 0.
  /** Items the feed returned this run (the raw "found" count). */
  collected?: number;
  /** Items retained as in-scope this run (the "accepted" count). */
  retained?: number;
  /** Items rejected as out-of-scope this run. */
  rejected?: number;
  /**
   * Coarse failure CATEGORY (e.g. "timeout", "blocked_upstream", "fetch_error"),
   * distinct from the raw `error` blob. Use categorizeFeedFailure() to derive it.
   */
  failureReason?: string | null;
  // --- Optional per-feed registry metadata ---------------------------------
  /** Source language (e.g. "English", "Indonesian"). Only when genuinely known. */
  language?: string | null;
  /** Geography the feed covers. Only when derived from an explicit feed group. */
  locationCovered?: string | null;
}

// Map a raw feed-fetch error into a coarse, non-fabricating failure CATEGORY for
// the Source Health registry. Returns null for an empty/absent error (nothing
// failed). Never invents causality beyond what the error text states; an
// unrecognised error falls back to the generic "fetch_error" (the fetch did
// genuinely throw), with the raw text still surfaced separately in error_message.
export function categorizeFeedFailure(
  error: string | null | undefined,
): string | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (/timed out|timeout|etimedout/.test(e)) return "timeout";
  if (/\b403\b|forbidden|blocked|captcha|cloudflare|access denied/.test(e))
    return "blocked_upstream";
  if (/\b401\b|unauthor|credential|api key|token/.test(e)) return "auth_error";
  if (/\b404\b|not found|\b410\b|gone/.test(e)) return "not_found";
  if (/\b5\d{2}\b|server error|bad gateway|unavailable/.test(e))
    return "upstream_error";
  if (/parse|invalid xml|malformed|unexpected token|syntax/.test(e))
    return "parse_error";
  if (/econn|enotfound|network|socket|dns|getaddrinfo|fetch failed/.test(e))
    return "fetch_error";
  return "fetch_error";
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
  opts: {
    sourceType?: string;
    reliability?: number;
    notes?: string;
    /**
     * When true the feed is an OPTIONAL integration that is not configured
     * (e.g. ReliefWeb without an approved appname). It is recorded as
     * "not_configured" — a distinct, non-alarming state — rather than
     * "operational" (misleading: it is doing nothing) or "failing" (misleading:
     * nothing is broken, it is simply switched off). Timestamps and the failure
     * streak are cleared so it never reads as a recovered or escalating feed.
     */
    notConfigured?: boolean;
    /**
     * When true the feed is an OPTIONAL integration that is configured but has
     * never successfully returned data yet (e.g. ReliefWeb with an as-yet
     * unapproved appname, or an upstream that blocks this server's egress IP).
     * A failure in that state is "pending validation" — NOT a broken feed — so
     * it is recorded as the non-alarming "pending" status and kept out of the
     * red Action Required panel and the dashboard failing-sources count. Once
     * the feed has succeeded at least once, a later failure escalates normally.
     */
    pending?: boolean;
    /**
     * Call-wide registry metadata applied to every feed in this batch: how the
     * feed is collected ("Google News RSS", "API", …) and how often. Written
     * only when supplied; otherwise the column is left untouched so a prior
     * analyst classification persists. Never fabricated.
     */
    scrapeMethod?: string;
    scrapeFrequency?: string;
  } = {},
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
          lastSuccessAt: sourcesTable.lastSuccessAt,
        })
        .from(sourcesTable)
        .where(and(eq(sourcesTable.name, f.name), eq(sourcesTable.topic, topic)));

      // Analyst-facing metadata + registry descriptors are only written when the
      // caller supplies them; an omitted field is left untouched so a prior
      // analyst classification (or a value another run set) persists.
      const meta = {
        ...(opts.reliability !== undefined ? { reliability: opts.reliability } : {}),
        ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
        ...(opts.scrapeMethod !== undefined ? { scrapeMethod: opts.scrapeMethod } : {}),
        ...(opts.scrapeFrequency !== undefined
          ? { scrapeFrequency: opts.scrapeFrequency }
          : {}),
        ...(f.language !== undefined ? { language: f.language } : {}),
        ...(f.locationCovered !== undefined
          ? { locationCovered: f.locationCovered }
          : {}),
      };

      // LAST-RUN funnel counts, written only when the engine actually supplied
      // them. Same for all status branches; an omitted count leaves the column
      // untouched (reads "—") rather than writing a fake 0.
      const runCounts = {
        ...(f.collected !== undefined ? { itemsCollected: f.collected } : {}),
        ...(f.retained !== undefined ? { itemsRetained: f.retained } : {}),
        ...(f.rejected !== undefined ? { itemsRejected: f.rejected } : {}),
      };

      // Per-run telemetry that DOES depend on the outcome: a successful run that
      // retained an in-scope item stamps last_relevant_item_at and clears the
      // failure category; a failed run records the coarse failure category but
      // never invents a relevant-item timestamp. Assigned per status branch.
      let telemetry: {
        itemsCollected?: number;
        itemsRetained?: number;
        itemsRejected?: number;
        lastRelevantItemAt?: Date;
        failureReason?: string | null;
      } = {};

      let healthFields: {
        url: string;
        sourceType: string;
        status: string;
        errorMessage: string | null;
        consecutiveFailures: number;
        lastSuccessAt?: Date | null;
        lastFailureAt?: Date | null;
      };

      if (opts.notConfigured) {
        // Optional integration switched off / not provisioned. Clear the
        // success+failure timestamps so the UI shows neither "recovered" nor an
        // escalating outage — just "not configured".
        healthFields = {
          url: f.url,
          sourceType,
          status: "not_configured",
          errorMessage: (f.error ?? "Integration not configured").slice(0, 500),
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
        };
      } else if (f.ok && f.stale) {
        // The feed FETCHED fine (reachable, HTTP 200, parseable) but its latest
        // DATA is materially behind its expected publication cadence — a silent
        // freeze. Record the honest "stale" status so it surfaces on Source
        // Health and Action Required instead of hiding behind a green
        // "operational". The fetch itself succeeded, so stamp last_success_at
        // and reset the failure streak; a later run whose data has advanced
        // falls into the plain f.ok branch and clears it back to operational.
        healthFields = {
          url: f.url,
          sourceType,
          status: "stale",
          errorMessage: (f.staleReason ?? "Feed data is stale (stopped advancing).").slice(0, 500),
          consecutiveFailures: 0,
          lastSuccessAt: now,
        };
        telemetry = {
          ...runCounts,
          failureReason: "stale_data",
        };
      } else if (f.ok) {
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
        // Clear the coarse failure category and, ONLY when this run genuinely
        // retained an in-scope item, stamp last_relevant_item_at. A successful
        // run that retained nothing leaves the prior stamp untouched (the feed
        // is healthy but had no relevant item this run — not a fabrication).
        telemetry = {
          ...runCounts,
          failureReason: null,
          ...((f.retained ?? 0) > 0 ? { lastRelevantItemAt: now } : {}),
        };
      } else if (opts.pending && !existing?.lastSuccessAt) {
        // Configured but never validated end-to-end yet, and this run failed.
        // Record it as the non-alarming "pending" state (awaiting approval /
        // network validation) rather than escalating to "failing": it stays out
        // of the red Action Required panel and the dashboard failing count, and
        // the streak is reset so it never reads as "retrying".
        healthFields = {
          url: f.url,
          sourceType,
          status: "pending",
          errorMessage: (f.error ?? "Awaiting validation").slice(0, 500),
          consecutiveFailures: 0,
          lastFailureAt: now,
        };
        // A failed run records its coarse failure category (when supplied) but
        // never stamps a relevant-item timestamp.
        telemetry = {
          ...runCounts,
          ...(f.failureReason !== undefined ? { failureReason: f.failureReason } : {}),
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
        // A failed run records its coarse failure category (when supplied) but
        // never stamps a relevant-item timestamp.
        telemetry = {
          ...runCounts,
          ...(f.failureReason !== undefined ? { failureReason: f.failureReason } : {}),
        };
      }

      if (existing) {
        await db
          .update(sourcesTable)
          .set({ ...healthFields, ...meta, ...telemetry })
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
          ...telemetry,
        });
      }
    }
  } catch {
    // Health telemetry is best-effort — never let it fail the ingest run.
  }
}
