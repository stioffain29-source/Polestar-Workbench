import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runIngestOnce, runMarketPricesOnce } from "./ingestRunner";
import { logger } from "./logger";

// Automatic ingestion scheduler.
//
// The data pipeline was freezing because nothing ever triggered the scrapers —
// the DB just sat at whenever someone last ran them by hand. This module makes
// the API server refresh the live topics (flashpoint + cargo_watch) by itself:
//
//   * On boot it runs a catch-up ingest IF the data is stale beyond the
//     interval. This is what keeps an autoscale deployment fresh: every cold
//     start that finds stale data refreshes it. The freshness guard keeps
//     frequent cold starts cheap (no scrape when data is already current).
//   * While the process stays warm (dev, or a reserved-VM / always-on
//     deployment) a recurring timer runs the ingest every INGEST_INTERVAL_HOURS.
//
// All runs go through runIngestOnce(), so they share the cross-instance
// advisory lock and never collide.
//
// Config:
//   INGEST_SCHEDULE_ENABLED  set to "false" to disable entirely (default on)
//   INGEST_INTERVAL_HOURS    refresh cadence in hours (default 6)

const DEFAULT_INTERVAL_HOURS = 6;
const MS_PER_HOUR = 60 * 60 * 1000;

function intervalHours(): number {
  const raw = process.env["INGEST_INTERVAL_HOURS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS;
}

/**
 * Hours since the scrapers last RAN successfully, or null when they have never
 * run. Gates on sources.last_success_at (a run heartbeat the flashpoint scraper
 * stamps on every committed run) rather than the newest incident's created_at.
 *
 * Why: in a quiet news period a scrape can succeed but insert 0 new rows. If we
 * gated on the newest record, that timestamp would never advance, so every
 * autoscale cold start past the interval would re-scrape forever. The heartbeat
 * advances whenever a run completes, so a recent run correctly suppresses the
 * next cold-start catch-up even when there was nothing new to insert.
 */
async function hoursSinceLastIngest(): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT MAX(last_success_at) AS last
    FROM sources
    WHERE topic IN ('flashpoint', 'cargo_watch')
  `);
  const row = res.rows[0] as { last: Date | string | null } | undefined;
  if (!row?.last) return null;
  return (Date.now() - new Date(row.last).getTime()) / MS_PER_HOUR;
}

async function tick(reason: string): Promise<void> {
  try {
    const result = await runIngestOnce();
    if (!result.ran) {
      logger.info({ reason }, "scheduled ingest skipped (already running)");
      return;
    }
    logger.info(
      {
        reason,
        flashpointInserted: result.flashpoint.inserted,
        cargoWatchInserted: result.cargoWatch.inserted,
        fuelReportsPriced: result.marketPrices.reportsUpdated,
        fuelPriceAsOf: result.marketPrices.latest.asOf,
        durationMs: result.durationMs,
        flashpointLatest: result.flashpoint.latestRecord,
      },
      "scheduled ingest finished",
    );
  } catch (err) {
    logger.error({ err, reason }, "scheduled ingest failed");
  }
}

/**
 * Run ONLY the fuel-price ingest (no incident scrape). Used when incidents are
 * already fresh but a fuel report is missing prices, so a flaky FRED fetch gets
 * retried on the next cold start instead of being skipped forever.
 */
async function priceTick(reason: string): Promise<void> {
  try {
    const result = await runMarketPricesOnce();
    if (!result.ran) {
      logger.info({ reason }, "price top-up skipped (already running)");
      return;
    }
    logger.info(
      {
        reason,
        fuelReportsPriced: result.marketPrices.reportsUpdated,
        fuelPriceAsOf: result.marketPrices.latest.asOf,
        seriesErrors: result.marketPrices.seriesErrors,
        durationMs: result.durationMs,
      },
      "price top-up finished",
    );
  } catch (err) {
    logger.error({ err, reason }, "price top-up failed");
  }
}

/**
 * Start the automatic ingest scheduler. Safe to call once at server startup.
 * Returns immediately; all work happens in the background.
 */
export function startIngestScheduler(): void {
  if (process.env["INGEST_SCHEDULE_ENABLED"] === "false") {
    logger.info("ingest scheduler disabled (INGEST_SCHEDULE_ENABLED=false)");
    return;
  }

  const hours = intervalHours();

  // Boot catch-up: only scrape if data is already stale, so repeated cold
  // starts on autoscale stay cheap.
  void (async () => {
    try {
      const age = await hoursSinceLastIngest();
      if (age === null || age >= hours) {
        logger.info(
          { ageHours: age === null ? null : Math.round(age) },
          "boot ingest: data stale, running catch-up",
        );
        await tick("boot");
        return;
      }
      // Incidents are fresh, so skip the expensive scrape. But the fuel-price
      // feed is cheap (a few small FRED CSVs, ~0.5s) and the live report must
      // always show the LATEST prices — never a week-old snapshot. So refresh
      // prices on every boot. This also self-heals an earlier flaky FRED failure
      // (which used to leave prices permanently empty when incidents stayed
      // fresh). Runs under the same advisory lock as the full ingest.
      logger.info(
        { ageHours: Math.round(age) },
        "boot ingest: incidents fresh, refreshing live fuel prices",
      );
      await priceTick("boot-prices");
    } catch (err) {
      logger.error({ err }, "boot ingest freshness check failed");
    }
  })();

  // Recurring refresh for warm/always-on processes. unref() so the timer never
  // blocks process shutdown (the server's listen handle keeps the process up).
  const timer = setInterval(() => void tick("interval"), hours * MS_PER_HOUR);
  timer.unref();

  logger.info({ intervalHours: hours }, "ingest scheduler started");
}
