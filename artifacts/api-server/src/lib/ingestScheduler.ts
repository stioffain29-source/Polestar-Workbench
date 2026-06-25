import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  summarizeIngestFailures,
  summarizeMarketPriceFailures,
  summarizeStrikesFailures,
} from "./ingestFailureSummary";
import {
  runIngestOnce,
  runMarketPricesOnce,
  runMovementOnce,
  runStrikesOnce,
} from "./ingestRunner";
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

// Freshness SLA for the live AIS ship-movement board, in days. Mirrors
// FRESH_DAYS in lib/maritimeSources.ts: the board flips from "live" to "stale"
// once its newest snapshot ages past this window. The boot/interval catch-up
// targets the much shorter INGEST_INTERVAL_HOURS so movement is normally
// refreshed long before this SLA; a breach here means the refresh path is not
// actually keeping up (e.g. a persistently-failing AIS fetch, or an autoscale
// app that never cold-starts), and is logged at WARN as an operational alert.
const MOVEMENT_FRESH_DAYS = 14;

// One-time forced boot ingest, keyed to a code version. The boot catch-up is
// normally gated on data freshness so autoscale cold starts stay cheap — but
// that means a republish carrying NEW scraper/classifier logic does NOT refresh
// prod when the existing rows are still "fresh" (e.g. scraped <12h ago). The
// new rules then never reach prod until the data happens to age out. Bumping
// this version forces exactly ONE full ingest on the next boot, regardless of
// freshness, so a deploy that changes what the scrapers accept/reject takes
// effect immediately. The marker is stored in app_migration_markers keyed by
// version, so the forced run happens once per environment per version bump.
const INGEST_FORCE_VERSION = 19;

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
const SCRAPED_LAND_TOPICS = [
  "shipping",
  "energy",
  "fertiliser",
  "fuel",
  "conflict",
  "indonesia_local",
] as const;

/**
 * For each scraped land topic, hours since its newest inserted incident (or
 * null when it has none). Uses created_at (insertion time), mirroring the
 * shipping check. Returned per-topic so the boot gate can flag a single stale
 * topic even when the others are fresh.
 */
async function hoursSinceNewestPerLandTopic(): Promise<
  Record<string, number | null>
> {
  const res = await db.execute(sql`
    SELECT topic, MAX(created_at) AS last
    FROM incidents
    WHERE topic IN ('shipping', 'energy', 'fertiliser', 'fuel', 'conflict', 'indonesia_local')
    GROUP BY topic
  `);
  const rows = res.rows as Array<{ topic: string; last: Date | string | null }>;
  const out: Record<string, number | null> = {};
  for (const t of SCRAPED_LAND_TOPICS) out[t] = null;
  for (const r of rows) {
    out[r.topic] = r.last
      ? (Date.now() - new Date(r.last).getTime()) / MS_PER_HOUR
      : null;
  }
  return out;
}

/**
 * Hours since the newest inserted strike (or null when the strikes table is
 * empty). The Missile Strike Tracker lives in its own table with no
 * sources.last_success_at heartbeat, so — like the scraped land topics — the
 * boot gate must force a full run whenever it is stale, otherwise a fresh
 * flashpoint heartbeat would wrongly suppress the catch-up while strikes sit
 * weeks behind.
 */
async function hoursSinceNewestStrike(): Promise<number | null> {
  const res = await db.execute(
    sql`SELECT MAX(created_at) AS last FROM strikes`,
  );
  const row = res.rows[0] as { last: Date | string | null } | undefined;
  if (!row?.last) return null;
  return (Date.now() - new Date(row.last).getTime()) / MS_PER_HOUR;
}

/**
 * True when the live AIS movement feed is BOTH keyed and not switched off. Only
 * then does maritime-movement staleness justify forcing a boot catch-up: with
 * no AIS key (or AIS_ENABLED=false) the maritime_movement table is permanently
 * empty by design, so gating on its freshness would force a full scrape on
 * every cold start for no benefit. Mirrors the aisEnv() logic in
 * lib/maritimeSources.ts (key present AND not falsey).
 */
function aisMovementActive(): boolean {
  const keyed = (process.env["AIS_API_KEY"]?.trim().length ?? 0) > 0;
  const v = process.env["AIS_ENABLED"]?.trim().toLowerCase();
  const off = v === "false" || v === "0" || v === "off" || v === "no";
  return keyed && !off;
}

/**
 * Hours since the newest AIS-fed maritime_movement snapshot (or null when none
 * exist). The ship-movement board flips to "stale" once its newest snapshot
 * ages past the 14-day freshness window (lib/maritimeSources.ts). Movement
 * refreshes ONLY inside a full ingest (runIngestOnce → runMaritimeMovementIngest),
 * so — like strikes and the scraped land topics — the boot catch-up must treat a
 * stale movement table as a reason to run. Without this an intermittently-failing
 * AIS pass lets the board drift stale even while incidents stay fresh (which on
 * its own only does the cheap price top-up, never the full ingest). Scoped to
 * source_name ILIKE '%ais%' so a one-off manual upload never suppresses the
 * live-feed catch-up.
 */
async function hoursSinceNewestMovement(): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT MAX(data_as_of) AS last
    FROM maritime_movement
    WHERE source_name ILIKE '%ais%'
  `);
  const row = res.rows[0] as { last: Date | string | null } | undefined;
  if (!row?.last) return null;
  return (Date.now() - new Date(row.last).getTime()) / MS_PER_HOUR;
}

/**
 * The AIS collection provider now active. Mirrors the useDatalastic decision in
 * lib/ingest/src/maritimeMovement.ts: the PAID Datalastic key (registry layer)
 * doubles as the satellite collection source — when it is present and not
 * switched off it drives collection (real Middle-East coverage), otherwise the
 * free terrestrial aisstream feed does.
 */
function activeMovementProviderIsDatalastic(): boolean {
  const key = process.env.VESSEL_REGISTRY_API_KEY?.trim() ?? "";
  const enabled = (process.env.VESSEL_REGISTRY_ENABLED?.trim() || "true").toLowerCase();
  const provider = (
    process.env.VESSEL_REGISTRY_PROVIDER?.trim() || "datalastic"
  ).toLowerCase();
  const off = enabled === "false" || enabled === "0" || enabled === "off" || enabled === "no";
  return key.length > 0 && !off && provider === "datalastic";
}

/**
 * True when SOME live vessel-movement feed is active — either the terrestrial
 * aisstream feed (AIS_API_KEY) or the Datalastic satellite feed (the registry
 * key, which doubles as the collection source). The movement collector in
 * lib/ingest/src/maritimeMovement.ts runs whenever EITHER is configured, so the
 * scheduler's freshness/SLA logic must use the same OR — keying only on
 * AIS_API_KEY would skip movement refresh on a Datalastic-only deployment (or
 * one with AIS_ENABLED=false) even though the collector would still populate it.
 */
function movementFeedActive(): boolean {
  return aisMovementActive() || activeMovementProviderIsDatalastic();
}

/**
 * True when the newest AIS movement snapshot was written by a DIFFERENT provider
 * than the one now active (e.g. prod still holds terrestrial aisstream rows but
 * the deployment has since switched to the Datalastic satellite feed). Such rows
 * can be TIME-fresh yet coverage-wrong — aisstream cannot see the Middle-East
 * straits, so Hormuz/Bab el-Mandeb/Gulf of Aden/Red Sea read empty — and the
 * time-based freshness gate alone would wrongly treat them as fresh and skip the
 * catch-up. Forcing a refresh on a provider switch repopulates every chokepoint
 * from the active feed. Returns false when there are no rows yet (the normal
 * staleness path already forces the initial population).
 */
async function movementProviderMismatch(): Promise<boolean> {
  if (!movementFeedActive()) return false;
  const res = await db.execute(sql`
    SELECT source_name
    FROM maritime_movement
    WHERE source_name ILIKE '%ais%'
    ORDER BY data_as_of DESC
    LIMIT 1
  `);
  const row = res.rows[0] as { source_name: string | null } | undefined;
  if (!row?.source_name) return false;
  const newestIsDatalastic = row.source_name.toLowerCase().includes("datalastic");
  return newestIsDatalastic !== activeMovementProviderIsDatalastic();
}

/**
 * Hours since the newest stored ICC maritime-security event (or null when the
 * table is empty). Like strikes and the scraped land topics, ICC piracy events
 * refresh ONLY inside a full ingest (runIngestOnce → runIccPiracyIngest), so a
 * stale-but-populated table should force a boot catch-up. IMPORTANT: unlike the
 * land topics, an EMPTY table (null) is NOT treated as a trigger — the ICC live
 * map sits behind Cloudflare and routinely blocks datacenter egress, so a never-
 * populated table would otherwise force a full scrape on every cold start for no
 * benefit. Initial population rides the forced-version bump and the regular
 * incident-staleness catch-up (which runs the full chain, ICC included). Uses
 * created_at (insertion heartbeat) so a quiet reporting week does not look stale.
 */
async function hoursSinceNewestMaritimeSecurity(): Promise<number | null> {
  const res = await db.execute(
    sql`SELECT MAX(created_at) AS last FROM maritime_security_events`,
  );
  const row = res.rows[0] as { last: Date | string | null } | undefined;
  if (!row?.last) return null;
  return (Date.now() - new Date(row.last).getTime()) / MS_PER_HOUR;
}

/**
 * True when the KAMMI social-watch ingest is active — i.e. at least one platform
 * is both configured (key/handle present) and not switched off. Mirrors
 * isSocialWatchActive() in lib/ingest/src/socialWatch.ts so the scheduler gates
 * on the SAME condition the collector uses: when no platform is active the
 * social_watch_items table is empty by design, so gating on its freshness would
 * force a needless scrape on every cold start.
 */
function socialWatchActive(): boolean {
  if (process.env["SOCIAL_WATCH_ENABLED"]?.trim().toLowerCase() === "false")
    return false;
  const off = (v: string | undefined): boolean => {
    const s = v?.trim().toLowerCase();
    return s === "false" || s === "0" || s === "off" || s === "no";
  };
  const igKeyed = (process.env["INSTAGRAM_API_KEY"]?.trim().length ?? 0) > 0;
  const igActive = igKeyed && !off(process.env["INSTAGRAM_ENABLED"]);
  // Telegram uses the free public web view: active unless explicitly disabled.
  const tgActive = !off(process.env["TELEGRAM_ENABLED"]);
  return igActive || tgActive;
}

/**
 * Hours since the newest stored KAMMI social-watch item (or null when the table
 * is empty). Social-watch items refresh ONLY inside a full ingest (runIngestOnce
 * → runSocialWatchIngest), so — like strikes, the land topics and AIS movement —
 * a stale-but-populated table should force a boot catch-up. Uses created_at
 * (insertion heartbeat) so a quiet protest week does not look stale. Only
 * considered when socialWatchActive(); an empty table is otherwise not a trigger.
 */
async function hoursSinceNewestSocialWatch(): Promise<number | null> {
  const res = await db.execute(
    sql`SELECT MAX(created_at) AS last FROM social_watch_items`,
  );
  const row = res.rows[0] as { last: Date | string | null } | undefined;
  if (!row?.last) return null;
  return (Date.now() - new Date(row.last).getTime()) / MS_PER_HOUR;
}

/**
 * True when the Facebook OSINT ingest is active — i.e. a key is present and the
 * source is not switched off. Mirrors isFacebookOsintActive() in
 * lib/ingest/src/facebookOsint.ts so the scheduler gates on the SAME condition
 * the collector uses: when unconfigured the social_raw table is empty by design,
 * so gating on its freshness would force a needless scrape on every cold start.
 */
function facebookOsintActive(): boolean {
  const v = process.env["FACEBOOK_OSINT_ENABLED"]?.trim().toLowerCase();
  const off = v === "false" || v === "0" || v === "off" || v === "no";
  if (off) return false;
  return (process.env["FACEBOOK_API_KEY"]?.trim().length ?? 0) > 0;
}

/**
 * Hours since the newest stored Facebook OSINT item (or null when the table is
 * empty). social_raw refreshes ONLY inside a full ingest (runIngestOnce →
 * runFacebookOsintIngest), so — like strikes, the land topics, AIS movement and
 * KAMMI social-watch — a stale-but-populated table should force a boot catch-up.
 * Uses created_at (insertion heartbeat) so a quiet posting week does not look
 * stale. Only considered when facebookOsintActive().
 */
async function hoursSinceNewestSocialRaw(): Promise<number | null> {
  const res = await db.execute(
    sql`SELECT MAX(created_at) AS last FROM social_raw`,
  );
  const row = res.rows[0] as { last: Date | string | null } | undefined;
  if (!row?.last) return null;
  return (Date.now() - new Date(row.last).getTime()) / MS_PER_HOUR;
}

/**
 * Operational SLA monitor for the live AIS ship-movement board. Emits a WARN
 * (an alert hook for log-based monitoring) when AIS is keyed+enabled but the
 * newest movement snapshot has aged past the MOVEMENT_FRESH_DAYS window, i.e.
 * the refresh path is no longer keeping the board fresh. Stays silent (no
 * alarm) when AIS is unconfigured — absence is not an outage. Never throws; a
 * probe failure is logged and swallowed so it can never disturb the caller.
 *
 * This is what turns "keep the board fresh" into something verifiable: a stale
 * board surfaces as a discrete, queryable log line in production rather than
 * being noticed only when an analyst opens Source Health.
 */
async function monitorMovementFreshness(reason: string): Promise<void> {
  if (!movementFeedActive()) return;
  let ageHours: number | null;
  try {
    ageHours = await hoursSinceNewestMovement();
  } catch (err) {
    logger.error({ err, reason }, "movement freshness probe failed");
    return;
  }
  const freshDays = MOVEMENT_FRESH_DAYS;
  if (ageHours === null) {
    logger.warn(
      { reason, freshDays },
      "AIS movement: no live snapshot recorded yet — ship-movement board reads unavailable",
    );
    return;
  }
  if (ageHours >= freshDays * 24) {
    logger.warn(
      { reason, movementAgeHours: Math.round(ageHours), freshDays },
      "AIS movement STALE beyond freshness window — ship-movement board is out of SLA",
    );
  } else {
    logger.info(
      { reason, movementAgeHours: Math.round(ageHours), freshDays },
      "AIS movement freshness within SLA",
    );
  }
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
    const failures = summarizeIngestFailures(result);
    const payload = {
      reason,
      flashpointInserted: result.flashpoint.inserted,
      cargoWatchInserted: result.cargoWatch.inserted,
      shippingInserted: result.shipping.inserted,
      energyInserted: result.energy.inserted,
      fertiliserInserted: result.fertiliser.inserted,
      fuelInserted: result.fuel.inserted,
      conflictInserted: result.conflict.inserted,
      strikesInserted: result.strikes.inserted,
      fuelReportsPriced: result.marketPrices.reportsUpdated,
      fuelPriceAsOf: result.marketPrices.latest.asOf,
      marketSnapshotUpserted: result.marketSnapshot.upserted,
      durationMs: result.durationMs,
      flashpointLatest: result.flashpoint.latestRecord,
      ingestFailures: failures,
    };
    if (failures.hadFailures) {
      logger.warn(payload, "scheduled ingest finished with failures");
    } else {
      logger.info(payload, "scheduled ingest finished");
    }
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
    const failures = summarizeMarketPriceFailures(result.marketPrices);
    const payload = {
      reason,
      fuelReportsPriced: result.marketPrices.reportsUpdated,
      fuelPriceAsOf: result.marketPrices.latest.asOf,
      durationMs: result.durationMs,
      ingestFailures: failures,
    };
    if (failures.hadFailures) {
      logger.warn(payload, "price top-up finished with failures");
    } else {
      logger.info(payload, "price top-up finished");
    }
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

  // EARLY, strikes-only boot run. The Missile Strike Tracker had been frozen
  // with no live source, so its backfill is the highest-value catch-up — but it
  // sat at the END of a multi-minute chain that an autoscale instance kept
  // tearing down before it ran (observed in prod: the forced run started but
  // never finished, strikes stayed frozen). This fires MUCH sooner than the
  // full chain (so it lands while the cold-start request burst is still keeping
  // the instance warm) and runs ONLY strikes (fast: a handful of feeds), so it
  // completes well before the instance idles out. It shares the same advisory
  // lock as the full ingest, so it can never collide with the chain below.
  // Gated on strikes staleness so warm/repeat cold starts stay cheap. unref()'d
  // so it never holds the process open on its own.
  const STRIKES_BOOT_DELAY_MS = 8_000;
  const strikesTimer = setTimeout(
    () =>
      void (async () => {
        // Strikes sub-run (if/else, never an early return, so the movement
        // sub-run below always follows regardless of strikes freshness).
        try {
          const strikeAge = await hoursSinceNewestStrike();
          if (strikeAge !== null && strikeAge < hours) {
            logger.info(
              { strikeAgeHours: Math.round(strikeAge) },
              "boot strikes: tracker fresh, skipping early strikes run",
            );
          } else {
            logger.info(
              {
                strikeAgeHours:
                  strikeAge === null ? null : Math.round(strikeAge),
              },
              "boot strikes: tracker stale, running early strikes-only ingest",
            );
            const result = await runStrikesOnce();
            if (!result.ran) {
              logger.info(
                "boot strikes: skipped (full ingest already running)",
              );
            } else {
              const failures = summarizeStrikesFailures(result.strikes);
              const payload = {
                strikesInserted: result.strikes.inserted,
                strikesLatest: result.strikes.latestRecord,
                byTheatre: result.strikes.byTheatre,
                durationMs: result.durationMs,
                ingestFailures: failures,
              };
              if (failures.hadFailures) {
                logger.warn(
                  payload,
                  "boot strikes: early strikes-only ingest finished with failures",
                );
              } else {
                logger.info(
                  payload,
                  "boot strikes: early strikes-only ingest finished",
                );
              }
            }
          }
        } catch (err) {
          logger.error(
            { err },
            "boot strikes: early strikes-only ingest failed",
          );
        }

        // EARLY movement-only run, SEQUENCED after strikes so the two never
        // contend for the shared advisory lock. Live AIS movement (the "Live
        // Fleet Intelligence" board) otherwise refreshes ONLY at the very END
        // of the multi-minute full chain, which an autoscale instance routinely
        // tears down first — so in prod the board stayed frozen on the last
        // manual snapshot (terrestrial aisstream saw Singapore only; every
        // Middle-East strait, incl. Hormuz, read empty). This fast
        // Datalastic-satellite run repopulates every chokepoint inside the
        // cold-start warm window. Gated on movement staleness OR a provider
        // switch (time-fresh aisstream rows are coverage-wrong once the
        // deployment moves to the satellite feed), and skipped entirely when no
        // movement feed is configured.
        try {
          if (!movementFeedActive()) {
            logger.info(
              "boot movement: no live AIS feed configured, skipping early movement run",
            );
          } else {
            const movementAge = await hoursSinceNewestMovement();
            const providerSwitched = await movementProviderMismatch();
            const movementStale =
              movementAge === null ||
              movementAge >= hours ||
              providerSwitched;
            if (!movementStale) {
              logger.info(
                { movementAgeHours: Math.round(movementAge!) },
                "boot movement: board fresh, skipping early movement run",
              );
            } else {
              logger.info(
                {
                  movementAgeHours:
                    movementAge === null ? null : Math.round(movementAge),
                  providerSwitched,
                },
                "boot movement: board stale/provider-switched, running early movement-only ingest",
              );
              const result = await runMovementOnce();
              if (!result.ran) {
                logger.info(
                  "boot movement: skipped (full ingest already running)",
                );
              } else {
                const mm = result.maritimeMovement;
                logger.info(
                  {
                    provider: mm.provider,
                    theatresWritten: mm.theatresWritten,
                    vesselsSeen: mm.vesselsSeen,
                    rowsInserted: mm.rowsInserted,
                    perTheatre: mm.perTheatre,
                    durationMs: result.durationMs,
                  },
                  "boot movement: early movement-only ingest finished",
                );
              }
            }
          }
        } catch (err) {
          logger.error(
            { err },
            "boot movement: early movement-only ingest failed",
          );
        }
      })(),
    STRIKES_BOOT_DELAY_MS,
  );
  strikesTimer.unref();

  // Boot catch-up: only scrape if data is already stale, so repeated cold
  // starts on autoscale stay cheap.
  const bootTimer = setTimeout(
    () =>
      void (async () => {
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
                logger.error(
                  { err },
                  "boot ingest: failed to record forced-version marker",
                );
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
          const strikeAge = await hoursSinceNewestStrike();
          // A land topic is stale if it has no rows or its newest insert is older
          // than the interval. ANY stale land topic forces a full run.
          const staleLandTopics = SCRAPED_LAND_TOPICS.filter((t) => {
            const a = landAges[t];
            return a === null || a >= hours;
          });
          // Strikes live in their own table (no heartbeat), so check it the same way.
          const strikesStale = strikeAge === null || strikeAge >= hours;
          // Live AIS ship-movement context also refreshes ONLY inside a full
          // ingest. Treat a stale movement table as a reason to run so the
          // Shipping Watch board stays within its 14-day freshness window even
          // when incidents are fresh (which alone skips the full ingest). Only
          // considered when SOME movement feed (aisstream or Datalastic) is
          // active — otherwise the table is empty by design and gating on it
          // would force a needless scrape on every cold start.
          const aisActive = movementFeedActive();
          const movementAge = aisActive
            ? await hoursSinceNewestMovement()
            : null;
          // A provider switch (e.g. terrestrial aisstream → Datalastic satellite)
          // leaves the existing rows TIME-fresh but coverage-wrong, so force a
          // catch-up to repopulate every chokepoint from the now-active feed even
          // when the time-based gate below would treat them as fresh.
          const movementProviderSwitched = await movementProviderMismatch();
          const movementStale =
            aisActive &&
            (movementAge === null ||
              movementAge >= hours ||
              movementProviderSwitched);
          // ICC maritime-security events also refresh ONLY inside a full ingest.
          // Force a catch-up when the table is POPULATED but stale; an empty
          // table is deliberately NOT a trigger (the ICC map routinely blocks
          // datacenter egress, so gating on emptiness would re-scrape every cold
          // start). Initial population rides the forced-version bump + the
          // incident-staleness catch-up.
          const maritimeSecurityAge = await hoursSinceNewestMaritimeSecurity();
          const maritimeSecurityStale =
            maritimeSecurityAge !== null && maritimeSecurityAge >= hours;
          // KAMMI social-watch context also refreshes ONLY inside a full ingest.
          // Treat a stale table as a reason to run, but ONLY when a platform is
          // active — otherwise the table is empty by design and gating on it
          // would force a needless scrape on every cold start. An empty table
          // while active IS a trigger (initial population) since the free
          // Telegram web view is normally reachable.
          const socialActive = socialWatchActive();
          const socialWatchAge = socialActive
            ? await hoursSinceNewestSocialWatch()
            : null;
          const socialWatchStale =
            socialActive && (socialWatchAge === null || socialWatchAge >= hours);
          // Facebook OSINT (social_raw) also refreshes ONLY inside a full
          // ingest. Same shape as KAMMI social-watch: a stale table is a reason
          // to run, but ONLY when the source is active — otherwise the table is
          // empty by design and gating on it would force a needless scrape on
          // every cold start. An empty table while active IS a trigger (initial
          // population).
          const fbOsintActive = facebookOsintActive();
          const socialRawAge = fbOsintActive
            ? await hoursSinceNewestSocialRaw()
            : null;
          const socialRawStale =
            fbOsintActive && (socialRawAge === null || socialRawAge >= hours);
          // A movement table already past the 14-day SLA at boot means the
          // refresh path fell behind (the catch-up below restores it, but the
          // breach itself is worth an alert in production).
          if (
            aisActive &&
            movementAge !== null &&
            movementAge >= MOVEMENT_FRESH_DAYS * 24
          ) {
            logger.warn(
              {
                movementAgeHours: Math.round(movementAge),
                freshDays: MOVEMENT_FRESH_DAYS,
              },
              "boot ingest: AIS movement past freshness SLA — forcing catch-up to restore it",
            );
          }
          if (
            age === null ||
            age >= hours ||
            staleLandTopics.length > 0 ||
            strikesStale ||
            movementStale ||
            maritimeSecurityStale ||
            socialWatchStale ||
            socialRawStale
          ) {
            logger.info(
              {
                ageHours: age === null ? null : Math.round(age),
                landAgeHours: Object.fromEntries(
                  SCRAPED_LAND_TOPICS.map((t) => [
                    t,
                    landAges[t] === null ? null : Math.round(landAges[t]!),
                  ]),
                ),
                staleLandTopics,
                strikeAgeHours:
                  strikeAge === null ? null : Math.round(strikeAge),
                strikesStale,
                movementAgeHours:
                  movementAge === null ? null : Math.round(movementAge),
                movementStale,
                movementProviderSwitched,
                maritimeSecurityAgeHours:
                  maritimeSecurityAge === null
                    ? null
                    : Math.round(maritimeSecurityAge),
                maritimeSecurityStale,
                socialWatchAgeHours:
                  socialWatchAge === null ? null : Math.round(socialWatchAge),
                socialWatchStale,
                socialRawAgeHours:
                  socialRawAge === null ? null : Math.round(socialRawAge),
                socialRawStale,
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
      })(),
    BOOT_INGEST_DELAY_MS,
  );
  bootTimer.unref();

  // Recurring refresh for warm/always-on processes. unref() so the timer never
  // blocks process shutdown (the server's listen handle keeps the process up).
  const timer = setInterval(
    () =>
      void (async () => {
        await tick("interval");
        await monitorMovementFreshness("interval");
      })(),
    hours * MS_PER_HOUR,
  );
  timer.unref();

  logger.info({ intervalHours: hours }, "ingest scheduler started");
}
