import { pool } from "@workspace/db";
import {
  runFlashpointIngest,
  runCargoWatchIngest,
  runShippingIngest,
  runEnergyIngest,
  runFertiliserIngest,
  runFuelIngest,
  runDataCentresIngest,
  runConflictIngest,
  runConflictClustering,
  runIndonesiaLocalIngest,
  runApacLocalIngest,
  runMarketPricesIngest,
  runMarketSnapshotIngest,
  runMaritimeMovementIngest,
  resolveAisKey,
  runStrikesIngest,
  runTitleTranslation,
  runResolveGoogleNewsUrls,
  runReliefWebCorroboration,
  runReliefWebReportsIngest,
  runIccPiracyIngest,
  emptyIccPiracySummary,
  runUkmtoIngest,
  emptyUkmtoIngestSummary,
  runCentcomIngest,
  emptyCentcomIngestSummary,
  runMaritimePartnerProductsIngest,
  emptyMaritimePartnerProductsIngestSummary,
  runKammiSourceIngest,
  emptyKammiSourceSummary,
  runFacebookOsintIngest,
  emptyFacebookOsintSummary,
  runGdeltEnrich,
  runGdeltStructuredIngest,
  emptyGdeltStructuredSummary,
  runGdeltPromote,
  emptyGdeltPromoteSummary,
  runSocialPromote,
  emptySocialPromoteSummary,
  runTapaPromote,
  emptyTapaPromoteSummary,
  runFacebookOsintReclassify,
  emptyFacebookOsintReclassifySummary,
  runXSearchIngest,
  emptyXSearchSummary,
  socialPromoteWarnThreshold,
  runPngExtractBackfill,
  runWestPapuaExtractBackfill,
  type IngestSummary,
  type MarketPriceSummary,
  type MarketSnapshotSummary,
  type MaritimeMovementSummary,
  type StrikesIngestSummary,
  type ReliefWebCorroborationSummary,
  type ReliefWebReportsSummary,
  type IccPiracySummary,
  type UkmtoIngestSummary,
  type CentcomIngestSummary,
  type MaritimePartnerProductsIngestSummary,
  type KammiSourceSummary,
  type FacebookOsintSummary,
  type GdeltEnrichSummary,
  type GdeltStructuredSummary,
  type GdeltPromoteSummary,
  type SocialPromoteSummary,
  type TapaPromoteSummary,
  type FacebookOsintReclassifySummary,
  type XSearchSummary,
  type TitleTranslationSummary,
} from "@workspace/ingest";
import { logger } from "./logger";
import { terminateAfterIngestLockLoss } from "./ingestLockSafety";
import { fencePriorIngestSessions } from "./ingestSessionFence";

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

// The parent ingest-process supervisor receives stage updates over IPC so a
// timeout names the exact stage it terminated. The lock holder itself has no
// Promise.race watchdog: rejecting a race does not cancel the losing promise,
// and releasing the lock while that promise can still write permits overlap.
function markIngestStage(stage: string): void {
  if (typeof process.send === "function") {
    process.send({ type: "stage", stage });
  }
}

// Social-promote regression alarm. The DB→DB social promote pass runs against
// the writable production DB on every boot/timer; with the tightened
// corroboration gate it should mint 0 (occasionally 1) incident per run. A run
// that promotes more than this many rows is treated as a possible regression
// (e.g. the gate weakened, or a burst of look-alike OSINT posts) and raises a
// WARN — an operational alarm mirroring the AIS-movement SLA monitor — so it is
// caught in the logs rather than only when someone spots a bad incident on the
// live site. Override with SOCIAL_PROMOTE_WARN_THRESHOLD; tune, don't disable.
// The same threshold also drives the Source Health "needs review" amber signal
// (integrationStatus.socialPromoteStatus), so it is resolved from one shared
// helper in @workspace/ingest to keep the log alarm and the panel in lockstep.

// Minimal logger shape the reporter needs — lets tests pass a stub.
type PromoteAlarmLogger = {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
};

/**
 * Log the social-promote result and raise the regression WARN when this run
 * minted more than `SOCIAL_PROMOTE_WARN_THRESHOLD` incidents. Extracted from the
 * runner so the threshold branch is unit-testable in isolation (it is otherwise
 * buried inside the multi-minute `runIngestOnce` chain). Returns whether the
 * alarm fired and the threshold used, for the test's benefit; the runner ignores
 * the return value.
 */
export function reportSocialPromoteResult(
  log: PromoteAlarmLogger,
  summary: SocialPromoteSummary,
): { warned: boolean; threshold: number } {
  const promotePayload = {
    unpromotedConsidered: summary.unpromotedConsidered,
    newToInsert: summary.newToInsert,
    inserted: summary.inserted,
    totalAfter: summary.totalAfter,
    byTopic: summary.byTopic,
    bySource: summary.bySource,
    // Name exactly which incidents this run minted (marker + ids) so a
    // questionable auto-created incident is queryable straight from the logs,
    // without a DB dump.
    minted: summary.minted,
  };
  log.info(promotePayload, "Social promote pass complete");
  // Regression alarm (mirrors the AIS-movement SLA monitor): under the
  // tightened corroboration gate this pass should mint 0 (rarely 1) rows.
  // Promoting more than the threshold on a single run is the early signal that
  // the gate has regressed or a look-alike OSINT burst slipped through —
  // surface it as a WARN so it is caught in prod logs.
  const threshold = socialPromoteWarnThreshold();
  if (summary.inserted > threshold) {
    log.warn(
      { ...promotePayload, threshold },
      "Social promote pass minted an unexpectedly high number of incidents — possible regression",
    );
    return { warned: true, threshold };
  }
  return { warned: false, threshold };
}

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
      dataCentres: IngestSummary;
      conflict: IngestSummary;
      indonesiaLocal: IngestSummary;
      apacLocal: IngestSummary;
      marketPrices: MarketPriceSummary;
      marketSnapshot: MarketSnapshotSummary;
      maritimeMovement: MaritimeMovementSummary;
      strikes: StrikesIngestSummary;
      corroboration: ReliefWebCorroborationSummary;
      reliefwebReports: ReliefWebReportsSummary;
      iccPiracy: IccPiracySummary;
      ukmtoOfficial: UkmtoIngestSummary;
      centcomOfficial: CentcomIngestSummary;
      partnerOfficial: MaritimePartnerProductsIngestSummary;
      kammiSource: KammiSourceSummary;
      facebookOsint: FacebookOsintSummary;
      socialPromote: SocialPromoteSummary;
      gdeltEnrich: GdeltEnrichSummary;
      gdeltStructured: GdeltStructuredSummary;
      gdeltPromote: GdeltPromoteSummary;
    }
  | { ran: false; reason: "locked" };

export type GdeltStructuredRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      gdeltStructured: GdeltStructuredSummary;
      gdeltPromote: GdeltPromoteSummary;
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

export type TapaPromoteRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      tapaPromote: TapaPromoteSummary;
    }
  | { ran: false; reason: "locked" };

export type FacebookOsintReclassifyRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      reclassify: FacebookOsintReclassifySummary;
    }
  | { ran: false; reason: "locked" };

export type XSearchRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      xSearch: XSearchSummary;
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

export type IccPiracyRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      iccPiracy: IccPiracySummary;
    }
  | { ran: false; reason: "locked" };

export type CentcomOfficialRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      centcomOfficial: CentcomIngestSummary;
    }
  | { ran: false; reason: "locked" };

export type UkmtoOfficialRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      ukmtoOfficial: UkmtoIngestSummary;
    }
  | { ran: false; reason: "locked" };

export type PartnerOfficialRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      partnerOfficial: MaritimePartnerProductsIngestSummary;
    }
  | { ran: false; reason: "locked" };

export type MovementRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      maritimeMovement: MaritimeMovementSummary;
    }
  | { ran: false; reason: "locked" };

export type TitleTranslationRunResult =
  | {
      ran: true;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      titleTranslation: TitleTranslationSummary;
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

function emptyIccPiracy(err: unknown): IccPiracySummary {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    source: "icc_imb",
    mode: "commit",
    year: new Date().getUTCFullYear(),
    markersFetched: 0,
    rejected: 0,
    currentYear: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestEventDate: null,
    countriesCovered: [],
    byType: {},
    fetchOk: false,
    errors: [msg],
    logLines: [`ICC piracy ingest failed: ${msg}`],
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

function emptyGdeltPromote(err: unknown): GdeltPromoteSummary {
  const base = emptyGdeltPromoteSummary();
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    mode: "commit",
    errors: [msg],
    logLines: [`GDELT promote pass failed: ${msg}`],
  };
}

function emptySocialPromote(err: unknown): SocialPromoteSummary {
  const base = emptySocialPromoteSummary("commit");
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    errors: [msg],
    logLines: [`social promote pass failed: ${msg}`],
  };
}

function emptyTapaPromote(err: unknown): TapaPromoteSummary {
  const base = emptyTapaPromoteSummary();
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    mode: "commit",
    errors: [msg],
    logLines: [`TAPA promote pass failed: ${msg}`],
  };
}

function emptyXSearch(err: unknown): XSearchSummary {
  const base = emptyXSearchSummary();
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    mode: "commit",
    errors: [msg],
    logLines: [`X search ingest failed: ${msg}`],
  };
}

function emptyGdeltStructured(err: unknown): GdeltStructuredSummary {
  const base = emptyGdeltStructuredSummary();
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    mode: "commit",
    fetchOk: false,
    errors: [msg],
    logLines: [`GDELT structured ingest failed: ${msg}`],
  };
}

function emptyKammiSource(err: unknown): KammiSourceSummary {
  const base = emptyKammiSourceSummary();
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    mode: "commit",
    fetchOk: false,
    errors: [msg],
    logLines: [`KAMMI source ingest failed: ${msg}`],
  };
}

function emptyFacebookOsint(err: unknown): FacebookOsintSummary {
  const base = emptyFacebookOsintSummary();
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ...base,
    mode: "commit",
    fetchOk: false,
    error: msg,
    errors: [msg],
    logLines: [`facebook-osint ingest failed: ${msg}`],
  };
}

function emptyMaritimeMovement(err: unknown): MaritimeMovementSummary {
  const m = err instanceof Error ? err.message : String(err);
  return {
    provider: (process.env.AIS_PROVIDER?.trim() || "aisstream").toLowerCase(),
    mode: "commit",
    configured: resolveAisKey().length > 0,
    enabled: true,
    ran: false,
    reason: "fetch_failed",
    collectSeconds: 0,
    messagesReceived: 0,
    vesselsSeen: 0,
    theatresWritten: 0,
    rowsInserted: 0,
    perTheatre: [],
    registry: {
      configured: !!process.env.VESSEL_REGISTRY_API_KEY?.trim(),
      enabled: (process.env.VESSEL_REGISTRY_ENABLED?.trim() || "true") !== "false",
      lookups: 0,
      resolved: 0,
    },
    fetchOk: false,
    errors: [m],
    logLines: [`maritime movement ingest failed: ${m}`],
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
    terminateAfterIngestLockLoss(err, logger);
  });
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [INGEST_LOCK_KEY],
    );
    locked = lockRes.rows[0]?.locked === true;
    if (!locked) return { ran: false, reason: "locked" };
    markIngestStage("(run start)");
    markIngestStage("(fencing prior ingest sessions)");
    const fencedSessions = await fencePriorIngestSessions(client);
    if (fencedSessions > 0) {
      logger.warn(
        { fencedSessions },
        "terminated prior ingest worker database sessions before successor run",
      );
    }
    return { ran: true, value: await fn() };
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
      markIngestStage("runStrikesIngest");
      strikes = await runStrikesIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "strikes ingest failed");
      strikes = emptyStrikes(err);
    }
    // ICC CCS / IMB maritime piracy & armed-robbery events. Like strikes it
    // writes its OWN isolated table (maritime_security_events) and shares NOTHING
    // with the incidents dedupe below — these rows are NEVER incidents and can
    // never inflate any count. Runs early (alongside strikes) so an autoscale
    // teardown is least likely to drop it, and isolated in its own try so an
    // ICC/Cloudflare outage can never fail the rest of the chain.
    let iccPiracy: IccPiracySummary;
    try {
      markIngestStage("runIccPiracyIngest");
      iccPiracy = await runIccPiracyIngest({ commit: true });
      logger.info(
        {
          markersFetched: iccPiracy.markersFetched,
          currentYear: iccPiracy.currentYear,
          inserted: iccPiracy.inserted,
          totalAfter: iccPiracy.totalAfter,
          fetchOk: iccPiracy.fetchOk,
        },
        "ICC piracy pass complete",
      );
    } catch (err) {
      logger.error({ err }, "ICC piracy ingest failed");
      iccPiracy = emptyIccPiracy(err);
    }
    // M1.5 official UKMTO + CENTCOM scaffolds — write ONLY to
    // official_military_maritime_sources (Phase 2 parser) and Source Health.
    // NEVER spot_reports. Isolated try/catch so scaffold failures cannot abort
    // the wider ingest chain.
    let ukmtoOfficial: UkmtoIngestSummary;
    try {
      markIngestStage("runUkmtoIngest");
      ukmtoOfficial = await runUkmtoIngest({ commit: true });
      logger.info(
        {
          ran: ukmtoOfficial.ran,
          disabled: ukmtoOfficial.disabled,
          inserted: ukmtoOfficial.inserted,
          itemsFetched: ukmtoOfficial.itemsFetched,
          pdfExtracted: ukmtoOfficial.pdfExtracted,
        },
        "UKMTO official ingest complete",
      );
    } catch (err) {
      logger.error({ err }, "UKMTO official ingest scaffold failed");
      ukmtoOfficial = emptyUkmtoIngestSummary(err);
    }
    let centcomOfficial: CentcomIngestSummary;
    try {
      markIngestStage("runCentcomIngest");
      centcomOfficial = await runCentcomIngest({ commit: true });
      logger.info(
        {
          ran: centcomOfficial.ran,
          disabled: centcomOfficial.disabled,
          inserted: centcomOfficial.inserted,
          itemsFetched: centcomOfficial.itemsFetched,
        },
        "CENTCOM official ingest complete",
      );
    } catch (err) {
      logger.error({ err }, "CENTCOM official ingest scaffold failed");
      centcomOfficial = emptyCentcomIngestSummary(err);
    }
    let partnerOfficial: MaritimePartnerProductsIngestSummary;
    try {
      markIngestStage("runMaritimePartnerProductsIngest");
      partnerOfficial = await runMaritimePartnerProductsIngest({ commit: true });
      logger.info(
        {
          ran: partnerOfficial.ran,
          disabled: partnerOfficial.disabled,
          inserted: partnerOfficial.inserted,
          itemsFetched: partnerOfficial.itemsFetched,
          pdfExtracted: partnerOfficial.pdfExtracted,
          jmicInserted: partnerOfficial.providers.jmic.inserted,
          cmfInserted: partnerOfficial.providers.cmf.inserted,
        },
        "Partner official ingest complete",
      );
    } catch (err) {
      logger.error({ err }, "Partner official ingest failed");
      partnerOfficial = emptyMaritimePartnerProductsIngestSummary(err);
    }
    // Normalise non-English incident headlines (e.g. Bahasa Indonesia from the
    // West Papua feeds) into clean English advisory titles. Runs EARLY — next to
    // strikes and ICC piracy, BEFORE the multi-minute scraper chain — for the
    // SAME reason those were moved first: on an autoscale deployment the instance
    // can be torn down before a long chain finishes, and a late step is the most
    // likely casualty (this pass used to run at the END and was repeatedly killed
    // before it ran, leaving foreign headlines untranslated in prod). It is
    // idempotent and converges across runs (it only selects rows whose
    // display_title is still NULL), so running it first reliably drains the
    // existing backlog; THIS run's freshly-scraped foreign rows are picked up on
    // the next boot. Isolated in its own try so an LLM/network failure can never
    // fail the incident ingest — it just leaves display_title null and the UI
    // falls back to the original title.
    try {
      markIngestStage("runTitleTranslation");
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
    // Sequential: these share the same DB pool and dedupe against the incidents
    // table; running them one after another mirrors scrape:prod. Each is isolated
    // in its own try so a DB or unexpected failure in one topic can never abort
    // the rest of the chain (mirrors strikes / market prices below).
    markIngestStage("runIncidentIngest:flashpoint");
    const flashpoint = await runIncidentIngest("flashpoint", () =>
      runFlashpointIngest({ commit: true }),
    );
    markIngestStage("runIncidentIngest:cargo_watch");
    const cargoWatch = await runIncidentIngest("cargo_watch", () =>
      runCargoWatchIngest({ commit: true }),
    );
    markIngestStage("runIncidentIngest:shipping");
    const shipping = await runIncidentIngest("shipping", () =>
      runShippingIngest({ commit: true }),
    );
    markIngestStage("runIncidentIngest:energy");
    const energy = await runIncidentIngest("energy", () =>
      runEnergyIngest({ commit: true }),
    );
    markIngestStage("runIncidentIngest:fertiliser");
    const fertiliser = await runIncidentIngest("fertiliser", () =>
      runFertiliserIngest({ commit: true }),
    );
    markIngestStage("runIncidentIngest:fuel");
    const fuel = await runIncidentIngest("fuel", () =>
      runFuelIngest({ commit: true }),
    );
    // Data-centre coverage — a world-scope market topic (operational disruption
    // + build-out / planning risk). Its analyst-maintained facility REGISTRY is
    // a SEPARATE table and never touched here; this pass only writes news
    // incidents under topic=data_centres.
    markIngestStage("runIncidentIngest:data_centres");
    const dataCentres = await runIncidentIngest("data_centres", () =>
      runDataCentresIngest({ commit: true }),
    );
    // War / armed conflict / insurgency / armed crime — a SEPARATE topic from
    // flashpoint (which stays activism / protests / strikes / civil disorder).
    markIngestStage("runIncidentIngest:conflict");
    const conflict = await runIncidentIngest("conflict", () =>
      runConflictIngest({ commit: true }),
    );
    // Server-side LLM same-event clustering over the conflict window. Stamps
    // incidents.event_cluster_key so the monitor + report can collapse the same
    // real event syndicated under different headlines. Idempotent (only fills
    // NULL keys) and isolated so a failure can never fail the incident ingest.
    // Kill-switch: CONFLICT_CLUSTER_ENABLED=false (LLM-gated — no-ops when the
    // AI integration is unset). No incident is ever created, removed or
    // re-scored by this pass; it only groups existing rows.
    if (process.env.CONFLICT_CLUSTER_ENABLED !== "false") {
      try {
        markIngestStage("runConflictClustering");
        const cluster = await runConflictClustering({ commit: true });
        for (const line of cluster.logLines) logger.info({ pass: "conflict-cluster" }, line);
      } catch (err) {
        logger.error({ err }, "conflict clustering pass failed (non-fatal)");
      }
    }
    // Broad Bahasa-first local coverage for the Indonesia + Jakarta country
    // briefs (unrest, crime, natural hazard, fire, haze, transport, government,
    // labour, terrorism). Runs BEFORE the West Papua extract backfill below so
    // any rows this pass diverts to "West Papua" get structured this same run.
    markIngestStage("runIncidentIngest:indonesia_local");
    const indonesiaLocal = await runIncidentIngest("indonesia_local", () =>
      runIndonesiaLocalIngest({ commit: true }),
    );
    // Curated DIRECT-outlet RSS (not Google News) across the six tracked APAC
    // territories. Classified/scored across protest, crime, terrorism, civil
    // unrest, transport disruption and security incidents; West Papua rows are
    // diverted to their own tag (never Indonesia) by the Papua-first aliases.
    markIngestStage("runIncidentIngest:apac_local");
    const apacLocal = await runIncidentIngest("apac_local", () =>
      runApacLocalIngest({ commit: true }),
    );
    // PNG per-incident structured extraction. The PNG country brief reads
    // province / category / business_impact / incident_date STRAIGHT from the
    // incidents API (the client no longer recomputes them), but only the
    // flashpoint ingest fills those columns inline — the brief also aggregates
    // protests / conflict / cargo_watch / fuel rows tagged to Papua New Guinea.
    // This onlyNull pass fills any PNG-tagged row this run inserted that still
    // has no extraction, applying the IDENTICAL shared rulebook. PNG-SCOPED
    // (rows must carry the PNG country tag) so it never leaks onto other
    // countries; idempotent + converging (a filled row is never re-touched).
    // Isolated in its own try so an error can never fail the incident ingest.
    try {
      markIngestStage("runPngExtractBackfill");
      const png = await runPngExtractBackfill({ commit: true, onlyNull: true });
      logger.info(
        {
          candidates: png.candidates,
          updated: png.updated,
          provinceFilled: png.provinceFilled,
        },
        "PNG per-incident extraction pass complete",
      );
    } catch (err) {
      logger.error({ err }, "PNG per-incident extraction pass failed");
    }
    // West Papua per-incident structured extraction — the SAME pattern as PNG
    // for the Indonesian-Papua country brief. Scoped to rows whose country tag
    // contains "papua" but NOT "papua new guinea" (cross-border rows keep their
    // PNG enrichment). Idempotent + converging onlyNull pass; isolated in its
    // own try so a failure can never fail the incident ingest.
    try {
      markIngestStage("runWestPapuaExtractBackfill");
      const wp = await runWestPapuaExtractBackfill({ commit: true, onlyNull: true });
      logger.info(
        {
          candidates: wp.candidates,
          updated: wp.updated,
          provinceFilled: wp.provinceFilled,
        },
        "West Papua per-incident extraction pass complete",
      );
    } catch (err) {
      logger.error({ err }, "West Papua per-incident extraction pass failed");
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
      markIngestStage("runResolveGoogleNewsUrls");
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
      markIngestStage("runMarketPricesIngest");
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
      markIngestStage("runMarketSnapshotIngest");
      marketSnapshot = await runMarketSnapshotIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "market snapshot ingest failed");
      marketSnapshot = emptyMarketSnapshot(err);
    }
    // Live vessel-MOVEMENT (AIS) context. Writes ONLY the isolated
    // maritime_movement store — CONTEXT ONLY, it never touches the incidents
    // table and can never inflate a confirmed-incident count. No-ops cleanly
    // when AIS_API_KEY is unset (the board degrades to "movement data
    // unavailable"). Isolated in its own try so a provider/WebSocket failure can
    // never fail the incident ingest.
    let maritimeMovement: MaritimeMovementSummary;
    try {
      markIngestStage("runMaritimeMovementIngest");
      maritimeMovement = await runMaritimeMovementIngest({ commit: true });
      logger.info(
        {
          ran: maritimeMovement.ran,
          reason: maritimeMovement.reason,
          vesselsSeen: maritimeMovement.vesselsSeen,
          theatresWritten: maritimeMovement.theatresWritten,
          rowsInserted: maritimeMovement.rowsInserted,
        },
        "maritime movement (AIS) pass complete",
      );
    } catch (err) {
      logger.error({ err }, "maritime movement (AIS) pass failed");
      maritimeMovement = emptyMaritimeMovement(err);
    }
    // ReliefWeb (UN OCHA) corroboration. Cross-checks the incidents just
    // scraped (and a bounded back-fill of older rows) against UN OCHA's
    // ReliefWeb reports and attaches official corroborating references — a
    // SEPARATE signal that never overwrites confidence. Runs LAST so the
    // newest incidents already exist; isolated in its own try so a ReliefWeb
    // outage can never fail the incident ingest.
    let corroboration: ReliefWebCorroborationSummary;
    try {
      markIngestStage("runReliefWebCorroboration");
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
      markIngestStage("runReliefWebReportsIngest");
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
    // KAMMI Pusat source provider (Instagram). Translates public posts to
    // English, content-routes them into EXISTING incident topics (Flashpoint /
    // Protests & Civil Unrest), relevance-gates, dedupes and inserts the new
    // ones — KAMMI is "just another news source", so slop is discarded at the
    // router and a genuine protest lands in the relevant feed. No-ops cleanly
    // when Instagram is not configured/enabled. Isolated in its own try so a
    // scraper/network failure can never fail the wider ingest.
    let kammiSource: KammiSourceSummary;
    try {
      markIngestStage("runKammiSourceIngest");
      kammiSource = await runKammiSourceIngest({ commit: true });
      logger.info(
        {
          active: kammiSource.active,
          fetched: kammiSource.fetched,
          routable: kammiSource.routable,
          inserted: kammiSource.inserted,
          byTopic: kammiSource.byTopic,
        },
        "KAMMI source pass complete",
      );
    } catch (err) {
      logger.error({ err }, "KAMMI source pass failed");
      kammiSource = emptyKammiSource(err);
    }
    // Facebook OSINT (Papua/PNG). Writes ONLY the isolated social_raw store —
    // CONTEXT ONLY, these rows are NEVER incidents and can never inflate any
    // incident count (the only path into incidents is the explicit, gated,
    // server-re-derived promote action). No-ops cleanly + reports
    // "not_configured" when FACEBOOK_API_KEY is unset. Isolated in its own try
    // so an Apify/network failure can never fail the wider ingest.
    let facebookOsint: FacebookOsintSummary;
    try {
      markIngestStage("runFacebookOsintIngest");
      facebookOsint = await runFacebookOsintIngest({ commit: true });
      logger.info(
        {
          active: facebookOsint.active,
          fetched: facebookOsint.fetched,
          inScope: facebookOsint.inScope,
          promotable: facebookOsint.promotable,
          inserted: facebookOsint.inserted,
          totalAfter: facebookOsint.totalAfter,
        },
        "Facebook OSINT (Papua/PNG) pass complete",
      );
    } catch (err) {
      logger.error({ err }, "Facebook OSINT (Papua/PNG) pass failed");
      facebookOsint = emptyFacebookOsint(err);
    }
    // Social promote pass. Reads the LOCAL social_raw rows the Facebook OSINT
    // pass above just refreshed (0 external calls) and promotes eligible,
    // not-yet-promoted rows into real incidents — the DB→DB bridge from the
    // isolated social CONTEXT table into the incident pipeline, mirroring the
    // GDELT/TAPA promote passes. The runner re-derives eligibility server-side
    // and rolls back on a claim race, so it can neither trust request input nor
    // double-promote. Isolated in its own try so a failure here can never fail
    // the wider ingest.
    let socialPromote: SocialPromoteSummary;
    try {
      markIngestStage("runSocialPromote");
      socialPromote = await runSocialPromote({ commit: true });
      reportSocialPromoteResult(logger, socialPromote);
    } catch (err) {
      logger.error({ err }, "Social promote pass failed");
      socialPromote = emptySocialPromote(err);
    }
    // GDELT precision enrichment. ADDITIVE — attaches structured ACLED-style
    // fields (precise sub-national geo, fatality counts, named actors, event
    // coding, AI confidence) onto EXISTING flashpoint rows; never replaces the
    // keyword feed. Self-throttled (cadence gate + hard QU cap) so it no-ops on
    // most runs and stays inside the free GDELT budget. Runs LAST and isolated
    // in its own try so a GDELT outage or budget cap can never fail the ingest.
    let gdeltEnrich: GdeltEnrichSummary;
    try {
      markIngestStage("runGdeltEnrich");
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
    // GDELT Cloud structured event layer. A SEPARATE, ADDITIVE structured source
    // from the gdeltEnrich pass above: it does a daily broad pull of GDELT Cloud
    // v2 events + stories for the monitored APAC countries into its OWN isolated
    // table (gdelt_structured_items) as standalone CONTEXT. These rows are NEVER
    // incidents — the module never imports/writes the incidents table, so it can
    // never inflate any count or reach a report/PDF. Self-throttled (cadence gate
    // + hard QU cap) so it no-ops on most runs and stays inside the free GDELT
    // budget; no-ops cleanly when unconfigured. Runs LAST and isolated in its own
    // try so a GDELT outage or budget cap can never fail the wider ingest.
    let gdeltStructured: GdeltStructuredSummary;
    try {
      markIngestStage("runGdeltStructuredIngest");
      gdeltStructured = await runGdeltStructuredIngest({ commit: true });
      logger.info(
        {
          ran: gdeltStructured.ran,
          reason: gdeltStructured.reason,
          eventsFetched: gdeltStructured.eventsFetched,
          storiesFetched: gdeltStructured.storiesFetched,
          inserted: gdeltStructured.inserted,
          totalAfter: gdeltStructured.totalAfter,
          quSpent: gdeltStructured.quSpent,
          fetchOk: gdeltStructured.fetchOk,
        },
        "GDELT structured event layer pass complete",
      );
    } catch (err) {
      logger.error({ err }, "GDELT structured event layer pass failed");
      gdeltStructured = emptyGdeltStructured(err);
    }
    // GDELT Cloud promote pass. Reads the LOCAL gdelt_structured_items table the
    // structured pass above just refreshed (0 GDELT query-units) and promotes
    // lane-bearing EVENTS into real flashpoint/conflict incidents. This bridges
    // the structured layer into the incident pipeline (the old "never an
    // incident" isolation was revoked by the owner). Idempotent via the
    // gdelt_cloud:<id> analyst-notes marker; isolated try so a failure here can
    // never fail the wider ingest.
    let gdeltPromote: GdeltPromoteSummary;
    try {
      markIngestStage("runGdeltPromote");
      gdeltPromote = await runGdeltPromote({ commit: true });
      logger.info(
        {
          inserted: gdeltPromote.inserted,
          promotable: gdeltPromote.promotable,
          totalAfter: gdeltPromote.totalAfter,
          byTopic: gdeltPromote.byTopic,
        },
        "GDELT promote pass complete",
      );
    } catch (err) {
      logger.error({ err }, "GDELT promote pass failed");
      gdeltPromote = emptyGdeltPromote(err);
    }
    // Translate again AFTER every incident-producing stage. The early pass
    // above is still required to drain an existing backlog before a long run,
    // but it cannot see rows inserted later in this same run. Without this
    // post-ingest pass, a completed admin/manual ingest can publish fresh
    // Bahasa headlines with display_title=NULL and leave them visible until
    // the next scheduled translation cycle (up to 12 hours). Keep this pass
    // inside the same advisory lock so a successful full ingest does not
    // return until its newest translatable incident titles have been handled.
    // Translation failure remains non-fatal and leaves the original title for
    // a later convergent retry.
    try {
      markIngestStage("runPostIngestTitleTranslation");
      const titles = await runTitleTranslation({ commit: true });
      logger.info(
        {
          translated: titles.translated,
          candidates: titles.candidates,
          failed: titles.failed,
          skipped: titles.skipped,
        },
        "post-ingest title translation pass complete",
      );
    } catch (err) {
      logger.error({ err }, "post-ingest title translation pass failed");
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
      dataCentres,
      conflict,
      indonesiaLocal,
      apacLocal,
      marketPrices,
      marketSnapshot,
      maritimeMovement,
      strikes,
      corroboration,
      reliefwebReports,
      iccPiracy,
      ukmtoOfficial,
      centcomOfficial,
      partnerOfficial,
      kammiSource,
      facebookOsint,
      socialPromote,
      gdeltEnrich,
      gdeltStructured,
      gdeltPromote,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the GDELT Cloud structured event-layer ingest, committing to the
 * database. Used by the manual admin trigger so an operator can refresh the
 * structured context layer WITHOUT re-running the full multi-minute incident
 * chain. These rows are NEVER incidents and live in their own isolated table,
 * so they can never inflate any count. The pass is self-throttled (cadence gate
 * + hard QU cap) so a manual trigger inside the cadence window no-ops and spends
 * zero QU. Shares the same advisory lock so it can never collide with a full run.
 */
export async function runGdeltStructuredOnce(): Promise<GdeltStructuredRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let gdeltStructured: GdeltStructuredSummary;
    try {
      gdeltStructured = await runGdeltStructuredIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "GDELT structured event layer ingest failed");
      gdeltStructured = emptyGdeltStructured(err);
    }
    // Promote the freshly-refreshed structured events into incidents (0 QU;
    // reads the local table). Kept in its own try so a promote failure never
    // fails the structured refresh.
    let gdeltPromote: GdeltPromoteSummary;
    try {
      gdeltPromote = await runGdeltPromote({ commit: true });
    } catch (err) {
      logger.error({ err }, "GDELT promote pass failed");
      gdeltPromote = emptyGdeltPromote(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      gdeltStructured,
      gdeltPromote,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the offline TAPA Data Explorer → Cargo Watch promote pass. Reads the
 * SAVED local HTML pages (no scrape, no network, no cookies) and promotes each
 * row into a cargo_watch incident, deduped by an idempotency marker so re-runs
 * never double-insert. Deliberately NOT part of the recurring scheduler — it is
 * an operator-triggered offline import. Shares the same advisory lock so it can
 * never collide with a full run. Pass commit=false for a dry-run.
 */
export async function runTapaPromoteOnce(
  opts: { commit?: boolean } = {},
): Promise<TapaPromoteRunResult> {
  const commit = opts.commit ?? true;
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let tapaPromote: TapaPromoteSummary;
    try {
      tapaPromote = await runTapaPromote({ commit });
    } catch (err) {
      logger.error({ err }, "TAPA promote pass failed");
      tapaPromote = emptyTapaPromote(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      tapaPromote,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the Facebook OSINT reclassify + translate pass once. A free, DB-only
 * maintenance pass over the isolated `facebook_osint` context rows: it translates
 * non-English captions into English (`caption_en`) and re-runs the security-event
 * guard, demoting community-chatter rows mis-filed under a real security category
 * (un-promoting any incident they had spawned). Deliberately NOT part of the
 * recurring scheduler — an operator-triggered, reviewed maintenance path. Shares
 * the same advisory lock so it can never collide with a full run. Dry-run unless
 * commit=true.
 */
export async function runFacebookOsintReclassifyOnce(
  opts: { commit?: boolean; maxTranslations?: number } = {},
): Promise<FacebookOsintReclassifyRunResult> {
  const commit = opts.commit ?? false;
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let reclassify: FacebookOsintReclassifySummary;
    try {
      reclassify = await runFacebookOsintReclassify({
        commit,
        maxTranslations: opts.maxTranslations,
      });
    } catch (err) {
      logger.error({ err }, "Facebook OSINT reclassify pass failed");
      reclassify = emptyFacebookOsintReclassifySummary(
        commit ? "commit" : "dry-run",
      );
      reclassify.errors.push(err instanceof Error ? err.message : String(err));
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      reclassify,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the X (Twitter) recent-search source provider once. Fetches recent
 * posts, routes them into existing incident topics, relevance-gates, dedupes
 * (x_search: marker + fuzzy key + URL) and — with commit=true — inserts the new
 * rows into `incidents`. Deliberately NOT part of the recurring scheduler — it
 * is an operator-triggered, reviewed promote path. Shares the same advisory
 * lock so it can never collide with a full run. Pass commit=false for a dry-run.
 */
export async function runXSearchOnce(
  opts: { commit?: boolean; queryLabel?: string; maxResults?: number } = {},
): Promise<XSearchRunResult> {
  const commit = opts.commit ?? false;
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let xSearch: XSearchSummary;
    try {
      xSearch = await runXSearchIngest({
        commit,
        queryLabel: opts.queryLabel,
        maxResults: opts.maxResults,
      });
    } catch (err) {
      logger.error({ err }, "X search ingest failed");
      xSearch = emptyXSearch(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      xSearch,
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

/**
 * Run ONLY the ICC CCS / IMB maritime-security ingest, committing to the
 * database. Used by the manual admin trigger so an operator can refresh the
 * piracy & armed-robbery feed WITHOUT re-running the full multi-minute incident
 * chain. Shares the same advisory lock so it can never collide with a full run.
 */
export async function runIccPiracyOnce(): Promise<IccPiracyRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let iccPiracy: IccPiracySummary;
    try {
      iccPiracy = await runIccPiracyIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "ICC piracy ingest failed");
      iccPiracy = emptyIccPiracy(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      iccPiracy,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the live AIS maritime-movement ingest, committing to the database.
 *
 * Movement (the "Live Fleet Intelligence" board) sits at the very END of the
 * full incident chain, which is a multi-minute, unowned background task. On an
 * autoscale deployment the instance is routinely torn down before the chain
 * reaches the movement step, so the live vessel sample never lands in prod and
 * the board stays stuck on the last manual snapshot. Mirroring the proven
 * strikes pattern, this gives movement its OWN fast, early boot run that
 * completes inside the cold-start warm window — the Datalastic path is a
 * handful of HTTP GETs, so it finishes in seconds. Shares the same advisory
 * lock so it can never collide with a full run.
 */
export async function runMovementOnce(): Promise<MovementRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let maritimeMovement: MaritimeMovementSummary;
    try {
      maritimeMovement = await runMaritimeMovementIngest({ commit: true });
    } catch (err) {
      logger.error({ err }, "maritime movement ingest failed");
      maritimeMovement = emptyMaritimeMovement(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      maritimeMovement,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the CENTCOM official press-release ingest. Supports dry-run
 * (commit=false) for operator validation before writing rows. Shares the same
 * advisory lock so it can never collide with a full run.
 */
export async function runCentcomOfficialOnce(
  opts: { commit?: boolean } = {},
): Promise<CentcomOfficialRunResult> {
  const commit = opts.commit ?? false;
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let centcomOfficial: CentcomIngestSummary;
    try {
      centcomOfficial = await runCentcomIngest({ commit });
    } catch (err) {
      logger.error({ err }, "CENTCOM official ingest failed");
      centcomOfficial = emptyCentcomIngestSummary(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      centcomOfficial,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the UKMTO official products ingest. Supports dry-run
 * (commit=false) for operator validation before writing rows. Shares the same
 * advisory lock so it can never collide with a full run.
 */
export async function runUkmtoOfficialOnce(
  opts: { commit?: boolean } = {},
): Promise<UkmtoOfficialRunResult> {
  const commit = opts.commit ?? false;
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let ukmtoOfficial: UkmtoIngestSummary;
    try {
      ukmtoOfficial = await runUkmtoIngest({ commit });
    } catch (err) {
      logger.error({ err }, "UKMTO official ingest failed");
      ukmtoOfficial = emptyUkmtoIngestSummary(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ukmtoOfficial,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the JMIC / CMF partner product ingest. Supports dry-run
 * (commit=false) for operator validation before writing rows.
 */
export async function runPartnerOfficialOnce(
  opts: { commit?: boolean } = {},
): Promise<PartnerOfficialRunResult> {
  const commit = opts.commit ?? false;
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let partnerOfficial: MaritimePartnerProductsIngestSummary;
    try {
      partnerOfficial = await runMaritimePartnerProductsIngest({ commit });
    } catch (err) {
      logger.error({ err }, "Partner official ingest failed");
      partnerOfficial = emptyMaritimePartnerProductsIngestSummary(err);
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      partnerOfficial,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}

/**
 * Run ONLY the foreign-headline title-translation pass, committing to the
 * database.
 *
 * Translation (display_title) also runs inside the full incident chain, but
 * only AFTER the strikes and ICC-piracy passes — on an autoscale deployment the
 * instance is routinely torn down before the chain reaches it, so foreign
 * (Bahasa / non-Latin) headlines never get an English display_title in prod and
 * reports render the raw original title (observed: prod had no title-translate
 * log line at all). Mirroring the proven strikes/movement pattern, this gives
 * translation its OWN fast, early boot run that lands inside the cold-start warm
 * window. The pass is idempotent and converges (each committed row leaves the
 * candidate set) and commits per row, so a torn-down run still persists what it
 * finished and the next boot drains the rest. It self-skips when no OpenAI key
 * is configured. Shares the same advisory lock so it can never collide with a
 * full run.
 */
export async function runTitleTranslationOnce(): Promise<TitleTranslationRunResult> {
  const res = await withIngestLock(async () => {
    const startedAt = new Date();
    let titleTranslation: TitleTranslationSummary;
    try {
      titleTranslation = await runTitleTranslation({ commit: true });
    } catch (err) {
      logger.error({ err }, "title translation failed");
      titleTranslation = {
        candidates: 0,
        translated: 0,
        failed: 0,
        skipped: false,
        logLines: [
          `title-translate failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
    const finishedAt = new Date();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      titleTranslation,
    };
  });
  if (!res.ran) return res;
  return { ran: true, ...res.value };
}
