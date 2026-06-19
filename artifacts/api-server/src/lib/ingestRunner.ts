import { pool } from "@workspace/db";
import {
  runFlashpointIngest,
  runCargoWatchIngest,
  runShippingIngest,
  runEnergyIngest,
  runFertiliserIngest,
  runFuelIngest,
  runConflictIngest,
  runMarketPricesIngest,
  runMarketSnapshotIngest,
  runStrikesIngest,
  runTitleTranslation,
  runResolveGoogleNewsUrls,
  runReliefWebCorroboration,
  runReliefWebReportsIngest,
  runGdeltEnrich,
  type IngestSummary,
  type MarketPriceSummary,
  type MarketSnapshotSummary,
  type StrikesIngestSummary,
  type ReliefWebCorroborationSummary,
  type ReliefWebReportsSummary,
  type GdeltEnrichSummary,
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
      conflict: IngestSummary;
      marketPrices: MarketPriceSummary;
      marketSnapshot: MarketSnapshotSummary;
      strikes: StrikesIngestSummary;
      corroboration: ReliefWebCorroborationSummary;
      reliefwebReports: ReliefWebReportsSummary;
      gdeltEnrich: GdeltEnrichSummary;
    }
  | { ran: false; reason: "locked" };

export type ReliefWebReportsRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      reliefwebReports: ReliefWebReportsSummary;
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

function emptyIncidentIngest(
  topic: IngestSummary["topic"],
  err: unknown,
): IngestSummary {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    topic,
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
    countryCoverage: [],
    logLines: [`${topic} ingest failed: ${msg}`],
  };
}

async function runIncidentIngest(
  topic: IngestSummary["topic"],
  fn: () => Promise<IngestSummary>,
): Promise<IngestSummary> {
  try {
    return await fn();
  } catch (err) {
    logger.error({ err, topic }, "incident ingest failed");
    return emptyIncidentIngest(topic, err);
  }
}

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
    logLines: [
      `strikes ingest failed: ${err instanceof Error ? err.message : String(err)}`,
    ],
  };
}

function emptyMarketPrices(err: unknown): MarketPriceSummary {
  return {
    topic: "fuel_prices",
    mode: "commit",
    seriesFetched: 0,
    seriesErrors: [
      { id: "all", error: err instanceof Error ? err.message : String(err) },
    ],
    reportsConsidered: 0,
    reportsUpdated: 0,
    latest: { brent: null, wti: null, jet: null, asOf: null },
    logLines: [],
  };
}

function emptyCorroboration(err: unknown): ReliefWebCorroborationSummary {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    provider: "reliefweb",
    mode: "commit",
    incidentsConsidered: 0,
    countriesQueried: 0,
    reportsFetched: 0,
    linksInserted: 0,
    incidentsCorroborated: 0,
    fetchOk: false,
    errors: [msg],
    logLines: [`ReliefWeb corroboration failed: ${msg}`],
  };
}

function emptyReliefWebReports(err: unknown): ReliefWebReportsSummary {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    source: "reliefweb_reports",
    mode: "commit",
    configured: false,
    windowFrom: null,
    reportsFetched: 0,
    rejected: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestReportDate: null,
    countriesCovered: [],
    fetchOk: false,
    errors: [msg],
    logLines: [`ReliefWeb situational reports failed: ${msg}`],
  };
}

function emptyGdeltEnrich(err: unknown): GdeltEnrichSummary {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    provider: "gdelt",
    mode: "commit",
    enabled: true,
    ran: false,
    reason: "ok",
    incidentsConsidered: 0,
    countriesQueried: 0,
    incidentsMatched: 0,
    fieldsEnriched: 0,
    geoUpgraded: 0,
    severityRaised: 0,
    quSpent: 0,
    fetchOk: false,
    errors: [msg],
    logLines: [`GDELT enrichment failed: ${msg}`],
  };
}

function emptyMarketSnapshot(err: unknown): MarketSnapshotSummary {
  return {
    mode: "commit",
    upserted: 0,
    considered: 0,
    errors: [
      { key: "all", error: err instanceof Error ? err.message : String(err) },
    ],
    rows: [],
    logLines: [
      `market snapshot ingest failed: ${err instanceof Error ? err.message : String(err)}`,
    ],
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
    // table; running them one after another mirrors scrape:prod. Each is isolated
    // in its own try so a DB or unexpected failure in one topic can never abort
    // the rest of the chain (mirrors strikes / market prices below).
    const flashpoint = await runIncidentIngest("flashpoint", () =>
      runFlashpointIngest({ commit: true }),
    );
    const cargoWatch = await runIncidentIngest("cargo_watch", () =>
      runCargoWatchIngest({ commit: true }),
    );
    const shipping = await runIncidentIngest("shipping", () =>
      runShippingIngest({ commit: true }),
    );
    const energy = await runIncidentIngest("energy", () =>
      runEnergyIngest({ commit: true }),
    );
    const fertiliser = await runIncidentIngest("fertiliser", () =>
      runFertiliserIngest({ commit: true }),
    );
    const fuel = await runIncidentIngest("fuel", () =>
      runFuelIngest({ commit: true }),
    );
    // War / armed conflict / insurgency / armed crime — a SEPARATE topic from
    // flashpoint (which stays activism / protests / strikes / civil disorder).
    const conflict = await runIncidentIngest("conflict", () =>
      runConflictIngest({ commit: true }),
    );
    // Normalise non-English incident headlines (e.g. Bahasa Indonesia from the
    // West Papua feeds) into clean English advisory titles AFTER the scrapers
    // have written this run's rows. Isolated in its own try so an LLM/network
    // failure can never fail the incident ingest — it just leaves display_title
    // null and the UI falls back to the original title. Idempotent + bounded, so
    // it converges across runs rather than re-translating settled rows.
    try {
      const titles = await runTitleTranslation({ commit: true });
      logger.info(
        {
          translated: titles.translated,
          candidates: titles.candidates,
          failed: titles.failed,
          skipped: titles.skipped,
        },
        "title translation pass complete",
      );
    } catch (err) {
      logger.error({ err }, "title translation pass failed");
    }
    // Resolve Google News RSS redirect links (incidents.source_url) to their
    // real publisher URLs, stored additively on incidents.resolved_url. This
    // lets the GDELT enrichment URL-match (which runs LAST, below) compare a
    // real article URL against GDELT's resolved source_urls[] instead of an
    // opaque news.google.com redirect that can never match, and gives the
    // workbench UI clean publisher links. Covers ALL news topics with a fair
    // round-robin (no high-volume topic starves the smaller ones). Bounded +
    // converging like the title-translation pass, and isolated in its own try so
    // a network failure can never fail the incident ingest.
    //
    // The per-run budget is set well above the count of rows a single scrape
    // adds so each run resolves THIS run's new redirects AND chips away at the
    // historical backlog of older unresolved rows (~7k at one point). The WHERE
    // only ever returns rows that still need resolving (redirect source_url +
    // NULL resolved_url), so a settled row is never re-scanned and the work
    // strictly converges across runs. Kept modest enough that the pass stays a
    // small fraction of the ingest chain (and avoids tripping Google's
    // egress-IP rate limit). A faster one-time historical drain is the CLI
    // `scrape:resolve-urls --commit --limit=<large> --concurrency=<n>` (see
    // replit.md) — for prod it must run inside the deployment runtime.
    try {
      const urls = await runResolveGoogleNewsUrls({ commit: true, limit: 300 });
      logger.info(
        {
          resolved: urls.resolved,
          candidates: urls.candidates,
          failed: urls.failed,
          byTopic: urls.byTopic,
        },
        "google news url resolution pass complete",
      );
    } catch (err) {
      logger.error({ err }, "google news url resolution pass failed");
    }
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
    // ReliefWeb (UN OCHA) corroboration. Cross-checks the incidents just
    // scraped (and a bounded back-fill of older rows) against UN OCHA's
    // ReliefWeb reports and attaches official corroborating references — a
    // SEPARATE signal that never overwrites confidence. Runs LAST so the
    // newest incidents already exist; isolated in its own try so a ReliefWeb
    // outage can never fail the incident ingest.
    let corroboration: ReliefWebCorroborationSummary;
    try {
      corroboration = await runReliefWebCorroboration({ commit: true });
      logger.info(
        {
          incidentsConsidered: corroboration.incidentsConsidered,
          linksInserted: corroboration.linksInserted,
          incidentsCorroborated: corroboration.incidentsCorroborated,
          countriesQueried: corroboration.countriesQueried,
        },
        "ReliefWeb corroboration pass complete",
      );
    } catch (err) {
      logger.error({ err }, "ReliefWeb corroboration pass failed");
      corroboration = emptyCorroboration(err);
    }
    // ReliefWeb (UN OCHA) situational reports — a SEPARATE context pass from the
    // corroboration above. Pulls UN OCHA reports for the monitored APAC
    // countries into the standalone reliefweb_reports table as supporting
    // CONTEXT (never as incidents, so it can never inflate any count). Isolated
    // in its own try so a ReliefWeb outage can never fail the wider ingest.
    let reliefwebReports: ReliefWebReportsSummary;
    try {
      reliefwebReports = await runReliefWebReportsIngest({ commit: true });
      logger.info(
        {
          configured: reliefwebReports.configured,
          reportsFetched: reliefwebReports.reportsFetched,
          inserted: reliefwebReports.inserted,
          totalAfter: reliefwebReports.totalAfter,
          fetchOk: reliefwebReports.fetchOk,
        },
        "ReliefWeb situational reports pass complete",
      );
    } catch (err) {
      logger.error({ err }, "ReliefWeb situational reports pass failed");
      reliefwebReports = emptyReliefWebReports(err);
    }
    // GDELT precision enrichment. ADDITIVE — attaches structured ACLED-style
    // fields (precise sub-national geo, fatality counts, named actors, event
    // coding, AI confidence) onto EXISTING flashpoint rows; never replaces the
    // keyword feed. Self-throttled (cadence gate + hard QU cap) so it no-ops on
    // most runs and stays inside the free GDELT budget. Runs LAST and isolated
    // in its own try so a GDELT outage or budget cap can never fail the ingest.
    let gdeltEnrich: GdeltEnrichSummary;
    try {
      gdeltEnrich = await runGdeltEnrich({ commit: true });
      logger.info(
        {
          ran: gdeltEnrich.ran,
          reason: gdeltEnrich.reason,
          incidentsMatched: gdeltEnrich.incidentsMatched,
          countriesQueried: gdeltEnrich.countriesQueried,
          quSpent: gdeltEnrich.quSpent,
        },
        "GDELT enrichment pass complete",
      );
    } catch (err) {
      logger.error({ err }, "GDELT enrichment pass failed");
      gdeltEnrich = emptyGdeltEnrich(err);
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
      conflict,
      marketPrices,
      marketSnapshot,
      strikes,
      corroboration,
      reliefwebReports,
      gdeltEnrich,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the ReliefWeb situational-reports context ingest, committing to the
 * database. Used by the manual admin trigger so an operator can refresh UN OCHA
 * context without re-running the full multi-minute incident chain. Shares the
 * same advisory lock so it can never collide with a full run.
 */
export async function runReliefWebReportsOnce(): Promise<ReliefWebReportsRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let reliefwebReports: ReliefWebReportsSummary;
    try {
      reliefwebReports = await runReliefWebReportsIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "ReliefWeb situational reports ingest failed");
      reliefwebReports = emptyReliefWebReports(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      reliefwebReports,
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
