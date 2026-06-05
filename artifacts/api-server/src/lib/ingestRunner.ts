import { pool } from "@workspace/db";
import {
  runFlashpointIngest,
  runCargoWatchIngest,
  runShippingIngest,
  runEnergyIngest,
  runFertiliserIngest,
  runFuelIngest,
  runMarketPricesIngest,
  runMarketSnapshotIngest,
  runStrikesIngest,
  type IngestSummary,
  type MarketPriceSummary,
  type MarketSnapshotSummary,
  type StrikesIngestSummary,
} from "@workspace/ingest";
import { logger } from "./logger";

// Shared ingest runner used by BOTH the manual admin trigger
// (routes/admin.ts) and the automatic scheduler (lib/ingestScheduler.ts) so
// every path runs identical code under the same concurrency guarantees.
//
// Concurrency: serialised with a Postgres session-level advisory lock held on
// a dedicated pooled connection for the duration of the run. Unlike an
// in-memory flag, this holds across ALL autoscale instances — a second
// concurrent run (same instance or another) is skipped with ran=false. Because
// only one ingest can run at a time globally, the in-application
// read-then-insert dedupe in @workspace/ingest cannot race against a parallel
// writer.

// Arbitrary but stable advisory-lock key ("Pole" in hex). Must match across
// every instance so they contend on the same lock.
const INGEST_LOCK_KEY = 0x506f6c65;

export type IngestRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      flashpoint: IngestSummary;
      cargoWatch: IngestSummary;
      shipping: IngestSummary;
      energy: IngestSummary;
      fertiliser: IngestSummary;
      fuel: IngestSummary;
      marketPrices: MarketPriceSummary;
      marketSnapshot: MarketSnapshotSummary;
      strikes: StrikesIngestSummary;
    }
  | { ran: false; reason: "locked" };

export type MarketPricesRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      marketPrices: MarketPriceSummary;
    }
  | { ran: false; reason: "locked" };

export type StrikesRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      strikes: StrikesIngestSummary;
    }
  | { ran: false; reason: "locked" };

function emptyStrikes(err: unknown): StrikesIngestSummary {
  return {
    mode: "commit",
    sourcesFetched: 0,
    itemsConsidered: 0,
    acceptedRaw: 0,
    acceptedUnique: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    rejected: 0,
    totalAfter: null,
    latestRecord: null,
    lastUpdated: null,
    perFeed: [],
    byTheatre: [],
    byCountry: [],
    logLines: [`strikes ingest failed: ${err instanceof Error ? err.message : String(err)}`],
  };
}

function emptyMarketPrices(err: unknown): MarketPriceSummary {
  return {
    topic: "fuel_prices",
    mode: "commit",
    seriesFetched: 0,
    seriesErrors: [{ id: "all", error: err instanceof Error ? err.message : String(err) }],
    reportsConsidered: 0,
    reportsUpdated: 0,
    latest: { brent: null, wti: null, jet: null, asOf: null },
    logLines: [],
  };
}

function emptyMarketSnapshot(err: unknown): MarketSnapshotSummary {
  return {
    mode: "commit",
    upserted: 0,
    considered: 0,
    errors: [{ key: "all", error: err instanceof Error ? err.message : String(err) }],
    rows: [],
    logLines: [`market snapshot ingest failed: ${err instanceof Error ? err.message : String(err)}`],
  };
}

/**
 * Run `fn` while holding the cross-instance advisory lock on a dedicated pooled
 * connection. Returns `{ ran: false, reason: "locked" }` when another ingest
 * (anywhere) already holds the lock. Never closes the shared pool — the
 * long-lived server must keep it open.
 */
async function withIngestLock<T>(
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false; reason: "locked" }> {
  const client = await pool.connect();
  let locked = false;
  // The lock client is checked OUT of the pool and held mostly-idle for the
  // whole (multi-minute) ingest, so pool.on("error") does NOT cover it. If the
  // backend terminates this connection mid-run ("terminating connection due to
  // administrator command", failover, idle timeout) the Client emits 'error';
  // with no listener that is an uncaught exception that crashes the process.
  // Attach a listener so it stays contained: the in-flight query rejects and
  // propagates to the caller's try/catch, and we skip the unlock on a dead
  // connection (Postgres already released the session lock when it dropped).
  let clientBroken = false;
  client.on("error", (err) => {
    clientBroken = true;
    logger.error({ err }, "ingest lock connection error (terminated mid-run)");
  });
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [INGEST_LOCK_KEY],
    );
    locked = lockRes.rows[0]?.locked === true;
    if (!locked) return { ran: false, reason: "locked" };
    const value = await fn();
    return { ran: true, value };
  } finally {
    if (locked && !clientBroken) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [INGEST_LOCK_KEY]);
      } catch (unlockErr) {
        // Unlock failing usually means the connection broke between the run and
        // here — treat it as broken so we destroy rather than recycle it.
        clientBroken = true;
        logger.error(
          { err: unlockErr },
          "failed to release ingest advisory lock",
        );
      }
    }
    // release(true) destroys a broken connection instead of returning it to the
    // pool, so a poisoned client is never handed to the next caller.
    client.release(clientBroken ? true : undefined);
  }
}

/**
 * Run the Flashpoint + Cargo Watch incident ingest AND the fuel-market price
 * ingest once, committing to the database. Returns
 * `{ ran: false, reason: "locked" }` if another ingest is already in progress
 * (anywhere).
 */
export async function runIngestOnce(): Promise<IngestRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    // Strikes ingest runs FIRST, deliberately. This whole chain is launched as
    // an UNOWNED background task on boot (lib/ingestScheduler.ts), and on an
    // autoscale deployment the instance can be torn down before a multi-minute
    // chain finishes. Whatever runs LAST is the most likely casualty — and the
    // strikes table was the one that had been frozen with no live source, so it
    // is the highest-value step to capture first. It writes its OWN table and
    // shares nothing with the incidents dedupe below, so ordering it first is
    // safe. Isolated in its own try so a feed/parse failure can never fail the
    // rest of the chain — it just reports the error in its summary.
    let strikes: StrikesIngestSummary;
    try {
      strikes = await runStrikesIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "strikes ingest failed");
      strikes = emptyStrikes(err);
    }
    // Sequential: these share the same DB pool and dedupe against the incidents
    // table; running them one after another mirrors scrape:prod.
    const flashpoint = await runFlashpointIngest({ commit: true });
    const cargoWatch = await runCargoWatchIngest({ commit: true });
    const shipping = await runShippingIngest({ commit: true });
    const energy = await runEnergyIngest({ commit: true });
    const fertiliser = await runFertiliserIngest({ commit: true });
    const fuel = await runFuelIngest({ commit: true });
    // Live fuel-market prices (FRED). Isolated in its own try so a FRED outage
    // can never fail the incident ingest — it just reports the error.
    let marketPrices: MarketPriceSummary;
    try {
      marketPrices = await runMarketPricesIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "market price ingest failed");
      marketPrices = emptyMarketPrices(err);
    }
    // Live commodity-price SNAPSHOTS for the Fuel/Energy/Fertiliser monitors.
    // Isolated in its own try so a FRED/Yahoo/World Bank outage can never fail
    // the incident ingest — a failed series just leaves its prior row untouched.
    let marketSnapshot: MarketSnapshotSummary;
    try {
      marketSnapshot = await runMarketSnapshotIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "market snapshot ingest failed");
      marketSnapshot = emptyMarketSnapshot(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      flashpoint,
      cargoWatch,
      shipping,
      energy,
      fertiliser,
      fuel,
      marketPrices,
      marketSnapshot,
      strikes,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the fuel-market price ingest (FRED), committing to the database.
 * Used by the scheduler's boot top-up so a report missing prices gets re-priced
 * on a cold start WITHOUT re-running the expensive incident scrape. Shares the
 * same advisory lock so it can never collide with a full run.
 */
export async function runMarketPricesOnce(): Promise<MarketPricesRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let marketPrices: MarketPriceSummary;
    try {
      marketPrices = await runMarketPricesIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "market price ingest failed");
      marketPrices = emptyMarketPrices(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      marketPrices,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the Missile Strike Tracker ingest, committing to the database.
 *
 * The strikes table had been frozen with no live source, so its one-time
 * backfill is the highest-value catch-up. The full incident chain is a
 * multi-minute, unowned background task that an autoscale instance can be torn
 * down mid-way, so we give strikes its OWN fast, early boot run that completes
 * long before the instance idles out — instead of leaving it stranded at the
 * end of the long chain. Shares the same advisory lock so it can never collide
 * with a full run.
 */
export async function runStrikesOnce(): Promise<StrikesRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let strikes: StrikesIngestSummary;
    try {
      strikes = await runStrikesIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "strikes ingest failed");
      strikes = emptyStrikes(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      strikes,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}
