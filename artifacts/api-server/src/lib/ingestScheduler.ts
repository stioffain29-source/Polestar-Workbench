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
//   INGEST_INTERVAL_HOURS    refresh cadence in hours (default 12)

const DEFAULT_INTERVAL_HOURS = 12;
const MS_PER_HOUR = 60 * 60 * 1000;

// One-time forced boot ingest, keyed to a code version. The boot catch-up is
// normally gated on data freshness so autoscale cold starts stay cheap — but
// that means a republish carrying NEW scraper/classifier logic does NOT refresh
// prod when the existing rows are still "fresh" (e.g. scraped <12h ago). The
// new rules then never reach prod until the data happens to age out. Bumping
// this version forces exactly ONE full ingest on the next boot, regardless of
// freshness, so a deploy that changes what the scrapers accept/reject takes
// effect immediately. The marker is stored in app_migration_markers keyed by
// version, so the forced run happens once per environment per version bump.
const INGEST_FORCE_VERSION = 1;

/**
 * True when the current INGEST_FORCE_VERSION has not yet run in this
 * environment (so the boot catch-up must force a full ingest once). Creates the
 * marker table if missing, mirroring the runtime-migration marker pattern.
 */
async function needsForcedIngest(): Promise<boolean> {
  const key = `ingest_force_v${INGEST_FORCE_VERSION}`;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_migration_markers (
      key text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const existing = await db.execute(sql`
    SELECT 1 FROM app_migration_markers WHERE key = ${key}
  `);
  return (existing.rowCount ?? 0) === 0;
}

/** Record that the forced ingest for the current version has run. */
async function markForcedIngestDone(): Promise<void> {
  const key = `ingest_force_v${INGEST_FORCE_VERSION}`;
  await db.execute(sql`
    INSERT INTO app_migration_markers (key) VALUES (${key})
    ON CONFLICT (key) DO NOTHING
  `);
}

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

// The scraper-fed land topics that have no `sources.last_success_at` heartbeat
// (only flashpoint stamps one). Each has its own live Google-News scraper now,
// so the boot catch-up must force a full run whenever ANY of them is stale —
// otherwise a fresh flashpoint heartbeat would wrongly suppress the catch-up
// while these sit weeks behind (exactly the "first boot after newly deploying
// the scraper" gap that already applied to shipping).
const SCRAPED_LAND_TOPICS = ["shipping", "energy", "fertiliser", "fuel"] as const;

/**
 * For each scraped land topic, hours since its newest inserted incident (or
 * null when it has none). Uses created_at (insertion time), mirroring the
 * shipping check. Returned per-topic so the boot gate can flag a single stale
 * topic even when the others are fresh.
 */
async function hoursSinceNewestPerLandTopic(): Promise<Record<string, number | null>> {
  const res = await db.execute(sql`
    SELECT topic, MAX(created_at) AS last
    FROM incidents
    WHERE topic IN ('shipping', 'energy', 'fertiliser', 'fuel')
    GROUP BY topic
  `);
  const rows = res.rows as Array<{ topic: string; last: Date | string | null }>;
  const out: Record<string, number | null> = {};
  for (const t of SCRAPED_LAND_TOPICS) out[t] = null;
  for (const r of rows) {
    out[r.topic] = r.last ? (Date.now() - new Date(r.last).getTime()) / MS_PER_HOUR : null;
  }
  return out;
}

/**
 * Run one full ingest. Returns true ONLY when a full run actually completed
 * (the advisory lock was acquired and no error was thrown). Returns false when
 * the run was skipped because another instance holds the lock, or when it
 * failed. Callers that must guarantee a real run (the forced boot ingest) gate
 * their bookkeeping on this so a skipped/failed run never counts as done.
 */
async function tick(reason: string): Promise<boolean> {
  try {
    const result = await runIngestOnce();
    if (!result.ran) {
      logger.info({ reason }, "scheduled ingest skipped (already running)");
      return false;
    }
    logger.info(
      {
        reason,
        flashpointInserted: result.flashpoint.inserted,
        cargoWatchInserted: result.cargoWatch.inserted,
        shippingInserted: result.shipping.inserted,
        energyInserted: result.energy.inserted,
        fertiliserInserted: result.fertiliser.inserted,
        fuelInserted: result.fuel.inserted,
        fuelReportsPriced: result.marketPrices.reportsUpdated,
        fuelPriceAsOf: result.marketPrices.latest.asOf,
        durationMs: result.durationMs,
        flashpointLatest: result.flashpoint.latestRecord,
      },
      "scheduled ingest finished",
    );
    return true;
  } catch (err) {
    logger.error({ err, reason }, "scheduled ingest failed");
    return false;
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

  // Delay the boot catch-up so the server can answer startup health probes
  // first. On a fresh deploy the data is stale, so the catch-up would otherwise
  // fire a full scrape during the exact window the deployer is probing for
  // readiness — heavy boot work can delay the health response past the probe
  // timeout and fail the promote step (seen on reserved-VM promote). A short
  // deferral keeps the event loop free until the VM is marked ready; the timer
  // is unref()'d so it never holds the process open on its own.
  const BOOT_INGEST_DELAY_MS = 60_000;

  // Boot catch-up: only scrape if data is already stale, so repeated cold
  // starts on autoscale stay cheap.
  const bootTimer = setTimeout(() => void (async () => {
    try {
      // A new deploy carrying changed scraper/classifier rules forces ONE full
      // ingest regardless of freshness, so the new rules reach prod immediately
      // instead of waiting for the existing rows to age past the interval.
      let forced = false;
      try {
        forced = await needsForcedIngest();
      } catch (err) {
        logger.error({ err }, "boot ingest: forced-version check failed");
      }
      if (forced) {
        logger.info(
          { forceVersion: INGEST_FORCE_VERSION },
          "boot ingest: forced run for new ingest version, refreshing now",
        );
        const ran = await tick("boot-forced");
        if (ran) {
          // Only record the marker when a full ingest actually completed. A
          // skipped run (another instance holds the lock) or a failed run must
          // NOT consume the one guaranteed refresh — a later boot retries.
          try {
            await markForcedIngestDone();
          } catch (err) {
            logger.error({ err }, "boot ingest: failed to record forced-version marker");
          }
        } else {
          logger.warn(
            { forceVersion: INGEST_FORCE_VERSION },
            "boot ingest: forced run did not complete (skipped or failed); will retry next boot",
          );
        }
        return;
      }
      const age = await hoursSinceLastIngest();
      const landAges = await hoursSinceNewestPerLandTopic();
      // A land topic is stale if it has no rows or its newest insert is older
      // than the interval. ANY stale land topic forces a full run.
      const staleLandTopics = SCRAPED_LAND_TOPICS.filter((t) => {
        const a = landAges[t];
        return a === null || a >= hours;
      });
      if (age === null || age >= hours || staleLandTopics.length > 0) {
        logger.info(
          {
            ageHours: age === null ? null : Math.round(age),
            landAgeHours: Object.fromEntries(
              SCRAPED_LAND_TOPICS.map((t) => [t, landAges[t] === null ? null : Math.round(landAges[t]!)]),
            ),
            staleLandTopics,
          },
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
  })(), BOOT_INGEST_DELAY_MS);
  bootTimer.unref();

  // Recurring refresh for warm/always-on processes. unref() so the timer never
  // blocks process shutdown (the server's listen handle keeps the process up).
  const timer = setInterval(() => void tick("interval"), hours * MS_PER_HOUR);
  timer.unref();

  logger.info({ intervalHours: hours }, "ingest scheduler started");
}
