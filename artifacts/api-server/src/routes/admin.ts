import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { type IngestSummary } from "@workspace/ingest";
import { summarizeIngestFailures } from "../lib/ingestFailureSummary";
import {
  runIngestOnce,
  runReliefWebReportsOnce,
  runIccPiracyOnce,
  runMovementOnce,
  runGdeltStructuredOnce,
  runTapaPromoteOnce,
} from "../lib/ingestRunner";
import { backfillRelevance, backfillSeverity } from "../lib/migrations";

const router: IRouter = Router();

// In-process guard so two concurrent /admin/relevance-backfill calls (or a
// rapid double-click) can't both run the pool-bounded write pass at once and
// amplify pool pressure. backfillRelevance is idempotent, so this is a
// pool-hygiene guard, not a correctness lock; cross-instance runs are harmless
// (each instance has its own pool, and the work converges to the same result).
let relevanceBackfillRunning = false;
// Same pool-hygiene guard for the severity re-rate pass.
let severityBackfillRunning = false;

// Protected production ingestion trigger.
//
// Runs the exact same Flashpoint + Cargo Watch ingest code as the CLI
// scrapers and the automatic scheduler (via the shared runIngestOnce), but
// on demand from inside the running server process — which, in the
// deployment, is the only place DATABASE_URL points at the writable
// production primary. This lets production data be refreshed with a single
// authenticated request, on top of the automatic schedule.
//
// Protection: requires INGEST_ADMIN_TOKEN to be set in the environment.
// The caller must present it via `Authorization: Bearer <token>` or the
// `x-ingest-token` header. If the token is not configured, the route is
// disabled (503) so it can never run unauthenticated.
//
// Concurrency: runIngestOnce serialises with a cross-instance Postgres
// advisory lock — a second concurrent run gets 409.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function presentedToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth))
    return auth.replace(/^Bearer\s+/i, "").trim();
  const headerToken = req.header("x-ingest-token");
  if (headerToken) return headerToken.trim();
  return null;
}

function trimmedSummary(s: IngestSummary) {
  return {
    topic: s.topic,
    mode: s.mode,
    sourcesFetched: s.sourcesFetched,
    itemsConsidered: s.itemsConsidered,
    acceptedUnique: s.acceptedUnique,
    duplicateInDb: s.duplicateInDb,
    newToInsert: s.newToInsert,
    inserted: s.inserted,
    rejected: s.rejected,
    totalAfter: s.totalAfter,
    latestRecord: s.latestRecord,
    lastUpdated: s.lastUpdated,
    countryCoverage: s.countryCoverage,
    perFeed: s.perFeed,
  };
}

router.post("/admin/ingest", async (req: Request, res: Response) => {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin ingest called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "ingestion_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    req.log.info("admin ingest started");
    const result = await runIngestOnce();
    if (!result.ran) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }

    const failures = summarizeIngestFailures(result);
    const logPayload = {
      flashpointInserted: result.flashpoint.inserted,
      cargoWatchInserted: result.cargoWatch.inserted,
      shippingInserted: result.shipping.inserted,
      energyInserted: result.energy.inserted,
      fertiliserInserted: result.fertiliser.inserted,
      fuelInserted: result.fuel.inserted,
      dataCentresInserted: result.dataCentres.inserted,
      indonesiaLocalInserted: result.indonesiaLocal.inserted,
      apacLocalInserted: result.apacLocal.inserted,
      strikesInserted: result.strikes.inserted,
      durationMs: result.durationMs,
      ingestFailures: failures,
    };
    if (failures.hadFailures) {
      req.log.warn(logPayload, "admin ingest finished with failures");
    } else {
      req.log.info(logPayload, "admin ingest finished");
    }
    res.json({
      ok: true,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.durationMs,
      totalInserted:
        result.flashpoint.inserted +
        result.cargoWatch.inserted +
        result.shipping.inserted +
        result.energy.inserted +
        result.fertiliser.inserted +
        result.fuel.inserted +
        result.dataCentres.inserted +
        result.indonesiaLocal.inserted +
        result.apacLocal.inserted +
        result.strikes.inserted,
      flashpoint: trimmedSummary(result.flashpoint),
      cargoWatch: trimmedSummary(result.cargoWatch),
      shipping: trimmedSummary(result.shipping),
      energy: trimmedSummary(result.energy),
      fertiliser: trimmedSummary(result.fertiliser),
      fuel: trimmedSummary(result.fuel),
      dataCentres: trimmedSummary(result.dataCentres),
      indonesiaLocal: trimmedSummary(result.indonesiaLocal),
      apacLocal: trimmedSummary(result.apacLocal),
      strikes: {
        mode: result.strikes.mode,
        sourcesFetched: result.strikes.sourcesFetched,
        itemsConsidered: result.strikes.itemsConsidered,
        acceptedUnique: result.strikes.acceptedUnique,
        duplicateInDb: result.strikes.duplicateInDb,
        newToInsert: result.strikes.newToInsert,
        inserted: result.strikes.inserted,
        rejected: result.strikes.rejected,
        totalAfter: result.strikes.totalAfter,
        latestRecord: result.strikes.latestRecord,
        lastUpdated: result.strikes.lastUpdated,
        byTheatre: result.strikes.byTheatre,
        byCountry: result.strikes.byCountry,
        perFeed: result.strikes.perFeed,
      },
      marketPrices: {
        seriesFetched: result.marketPrices.seriesFetched,
        seriesErrors: result.marketPrices.seriesErrors,
        reportsConsidered: result.marketPrices.reportsConsidered,
        reportsUpdated: result.marketPrices.reportsUpdated,
        latest: result.marketPrices.latest,
      },
      marketSnapshot: {
        upserted: result.marketSnapshot.upserted,
        considered: result.marketSnapshot.considered,
        errors: result.marketSnapshot.errors,
      },
      failures,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin ingest failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

// Protected manual trigger for ONLY the ReliefWeb situational-context pass.
//
// Same token gate + concurrency guarantees as /admin/ingest (shares the cross-
// instance advisory lock via runReliefWebReportsOnce), but refreshes UN OCHA
// context WITHOUT re-running the full multi-minute incident chain. A no-op when
// RELIEFWEB_APPNAME is not set to an approved value — it returns the summary
// with configured=false so the caller can see why nothing was fetched.
router.post("/admin/reliefweb-reports", async (req: Request, res: Response) => {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin reliefweb-reports called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "ingestion_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    req.log.info("admin reliefweb-reports started");
    const result = await runReliefWebReportsOnce();
    if (!result.ran) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }
    const r = result.reliefwebReports;
    req.log.info(
      {
        configured: r.configured,
        reportsFetched: r.reportsFetched,
        inserted: r.inserted,
        totalAfter: r.totalAfter,
        fetchOk: r.fetchOk,
        durationMs: result.durationMs,
      },
      "admin reliefweb-reports finished",
    );
    res.json({
      ok: true,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.durationMs,
      reliefwebReports: {
        configured: r.configured,
        windowFrom: r.windowFrom,
        reportsFetched: r.reportsFetched,
        rejected: r.rejected,
        duplicateInDb: r.duplicateInDb,
        newToInsert: r.newToInsert,
        inserted: r.inserted,
        totalAfter: r.totalAfter,
        latestReportDate: r.latestReportDate,
        countriesCovered: r.countriesCovered,
        fetchOk: r.fetchOk,
        errors: r.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin reliefweb-reports failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

// Protected manual trigger for ONLY the ICC CCS / IMB maritime-security pass.
//
// Same token gate + concurrency guarantees as /admin/ingest (shares the cross-
// instance advisory lock via runIccPiracyOnce), but refreshes the piracy &
// armed-robbery feed WITHOUT re-running the full multi-minute incident chain.
// These rows are NEVER incidents and can never inflate any count.
router.post("/admin/icc-piracy", async (req: Request, res: Response) => {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin icc-piracy called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "ingestion_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    req.log.info("admin icc-piracy started");
    const result = await runIccPiracyOnce();
    if (!result.ran) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }
    const r = result.iccPiracy;
    req.log.info(
      {
        markersFetched: r.markersFetched,
        currentYear: r.currentYear,
        inserted: r.inserted,
        totalAfter: r.totalAfter,
        fetchOk: r.fetchOk,
        durationMs: result.durationMs,
      },
      "admin icc-piracy finished",
    );
    res.json({
      ok: true,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.durationMs,
      iccPiracy: {
        year: r.year,
        markersFetched: r.markersFetched,
        rejected: r.rejected,
        currentYear: r.currentYear,
        duplicateInDb: r.duplicateInDb,
        newToInsert: r.newToInsert,
        inserted: r.inserted,
        totalAfter: r.totalAfter,
        latestEventDate: r.latestEventDate,
        countriesCovered: r.countriesCovered,
        byType: r.byType,
        fetchOk: r.fetchOk,
        errors: r.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin icc-piracy failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

// Protected manual trigger for ONLY the GDELT Cloud structured event layer.
//
// Same token gate + concurrency guarantees as /admin/ingest (shares the cross-
// instance advisory lock via runGdeltStructuredOnce), but refreshes the
// structured GDELT context layer WITHOUT re-running the full multi-minute
// incident chain. These rows are NEVER incidents — they live in their own
// isolated table and can never inflate any count or reach a report/PDF. The
// pass self-throttles (cadence gate + hard QU cap), so a trigger inside the
// cadence window no-ops and spends zero QU; the returned summary's `reason`
// field ("cadence" | "no-api-key" | "disabled" | "ok") explains what happened.
router.post("/admin/gdelt-structured", async (req: Request, res: Response) => {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin gdelt-structured called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "ingestion_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    req.log.info("admin gdelt-structured started");
    const result = await runGdeltStructuredOnce();
    if (!result.ran) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }
    const g = result.gdeltStructured;
    req.log.info(
      {
        configured: g.configured,
        enabled: g.enabled,
        ran: g.ran,
        reason: g.reason,
        eventsFetched: g.eventsFetched,
        storiesFetched: g.storiesFetched,
        inserted: g.inserted,
        totalAfter: g.totalAfter,
        quSpent: g.quSpent,
        fetchOk: g.fetchOk,
        durationMs: result.durationMs,
      },
      "admin gdelt-structured finished",
    );
    res.json({
      ok: true,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.durationMs,
      gdeltStructured: {
        configured: g.configured,
        enabled: g.enabled,
        ran: g.ran,
        reason: g.reason,
        windowFrom: g.windowFrom,
        windowTo: g.windowTo,
        countriesQueried: g.countriesQueried,
        eventsFetched: g.eventsFetched,
        storiesFetched: g.storiesFetched,
        eventsDropped: g.eventsDropped,
        rejected: g.rejected,
        newToInsert: g.newToInsert,
        inserted: g.inserted,
        totalAfter: g.totalAfter,
        latestSourceDate: g.latestSourceDate,
        quSpent: g.quSpent,
        fetchOk: g.fetchOk,
        errors: g.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin gdelt-structured failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

// Offline TAPA Data Explorer → Cargo Watch promote. Reads the SAVED local HTML
// pages (no scrape / no network / no cookies) and promotes each row into a
// cargo_watch incident, deduped by an idempotency marker so re-runs never
// double-insert. Append ?mode=dry-run to preview counts without writing.
router.post("/admin/tapa-promote", async (req: Request, res: Response) => {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin tapa-promote called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "ingestion_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const dryRun = req.query["mode"] === "dry-run";
    req.log.info({ dryRun }, "admin tapa-promote started");
    const result = await runTapaPromoteOnce({ commit: !dryRun });
    if (!result.ran) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }
    const t = result.tapaPromote;
    req.log.info(
      {
        mode: t.mode,
        reason: t.reason,
        htmlDir: t.htmlDir,
        filesParsed: t.filesParsed,
        rowsParsed: t.rowsParsed,
        promotable: t.promotable,
        duplicateMarker: t.duplicateMarker,
        newToInsert: t.newToInsert,
        inserted: t.inserted,
        totalAfter: t.totalAfter,
        durationMs: result.durationMs,
      },
      "admin tapa-promote finished",
    );
    res.json({
      ok: true,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.durationMs,
      tapaPromote: {
        mode: t.mode,
        reason: t.reason,
        htmlDir: t.htmlDir,
        filesParsed: t.filesParsed,
        eurUsdRate: t.eurUsdRate,
        rowsParsed: t.rowsParsed,
        promotable: t.promotable,
        skippedNoDate: t.skippedNoDate,
        skippedNoCountry: t.skippedNoCountry,
        duplicateMarker: t.duplicateMarker,
        newToInsert: t.newToInsert,
        inserted: t.inserted,
        bySeverity: t.bySeverity,
        byCountry: t.byCountry,
        totalAfter: t.totalAfter,
        errors: t.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin tapa-promote failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

// Movement-only refresh (the "Live Fleet Intelligence" / ship-movement board).
//
// Runs ONLY runMaritimeMovementIngest (live AIS positions per chokepoint +
// the vessel-registry cargo-class pass) via the shared runMovementOnce. This is
// the fast, deterministic way to repopulate every tracked chokepoint from
// inside the deployment runtime — the boot scheduler does the same on a cold
// start, but on autoscale that boot window is unreliable, so this lets an
// operator force a full movement refresh in a single request and verify it.
//
// Same token gate + advisory lock as /admin/ingest.
router.post("/admin/movement", async (req: Request, res: Response) => {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin movement called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "ingestion_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    req.log.info("admin movement started");
    const result = await runMovementOnce();
    if (!result.ran) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }
    const mm = result.maritimeMovement;
    req.log.info(
      {
        provider: mm.provider,
        theatresWritten: mm.theatresWritten,
        vesselsSeen: mm.vesselsSeen,
        durationMs: result.durationMs,
      },
      "admin movement finished",
    );
    res.json({
      ok: true,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.durationMs,
      provider: mm.provider,
      theatresWritten: mm.theatresWritten,
      vesselsSeen: mm.vesselsSeen,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin movement failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

// Relevance re-evaluation (data hygiene).
//
// Re-runs the relevance classifier over every incident whose stored rule
// version differs from the current RELEVANCE_RULE_VERSION, marking off-scope
// rows 'irrelevant' so they drop from the read surfaces. This normally runs on
// boot, but on autoscale the boot window is unreliable (a slow run was being
// torn down mid-pass, leaving most rows stale); this forces it to completion in
// a single request. Idempotent and safe to re-run.
//
// Same token gate as /admin/ingest.
router.post(
  "/admin/relevance-backfill",
  async (req: Request, res: Response) => {
    const expected = process.env["INGEST_ADMIN_TOKEN"];
    if (!expected) {
      req.log.warn(
        "admin relevance-backfill called but INGEST_ADMIN_TOKEN is not configured",
      );
      res.status(503).json({
        error: "ingestion_disabled",
        message: "INGEST_ADMIN_TOKEN is not configured on the server.",
      });
      return;
    }

    const presented = presentedToken(req);
    if (!presented || !safeEqual(presented, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (relevanceBackfillRunning) {
      res.status(409).json({ error: "backfill_in_progress" });
      return;
    }

    relevanceBackfillRunning = true;
    try {
      req.log.info("admin relevance-backfill started");
      const result = await backfillRelevance();
      req.log.info(
        { updated: result.updated, version: result.version },
        "admin relevance-backfill finished",
      );
      res.json({ ok: true, updated: result.updated, version: result.version });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "admin relevance-backfill failed");
      if (!res.headersSent) {
        res
          .status(500)
          .json({ ok: false, error: "ingestion_failed", message });
      }
    } finally {
      relevanceBackfillRunning = false;
    }
  },
);

// Severity re-rate (data hygiene).
//
// Re-runs classifySeverity over every machine-provenance incident
// (auto-scraped / legacy) and rewrites the stored severity when it differs from
// the current rules, applying the GDELT fatality floor via maxSeverity. Severity
// is otherwise written once at ingest, so a classifier change (reserving Extreme
// for mass casualties; confirmed killing => High) does not reach historical
// rows. The boot path is marker-gated and runs once per rule revision, but on
// CPU-throttled autoscale boots that pass is unreliable; this forces it to
// completion in a single request. Idempotent and safe to re-run; analyst-edited
// rows are never touched.
//
// Same token gate as /admin/ingest.
router.post(
  "/admin/severity-backfill",
  async (req: Request, res: Response) => {
    const expected = process.env["INGEST_ADMIN_TOKEN"];
    if (!expected) {
      req.log.warn(
        "admin severity-backfill called but INGEST_ADMIN_TOKEN is not configured",
      );
      res.status(503).json({
        error: "ingestion_disabled",
        message: "INGEST_ADMIN_TOKEN is not configured on the server.",
      });
      return;
    }

    const presented = presentedToken(req);
    if (!presented || !safeEqual(presented, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (severityBackfillRunning) {
      res.status(409).json({ error: "backfill_in_progress" });
      return;
    }

    severityBackfillRunning = true;
    try {
      req.log.info("admin severity-backfill started");
      const result = await backfillSeverity();
      req.log.info(
        {
          scanned: result.scanned,
          updated: result.updated,
          upgraded: result.upgraded,
          downgraded: result.downgraded,
        },
        "admin severity-backfill finished",
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "admin severity-backfill failed");
      if (!res.headersSent) {
        res
          .status(500)
          .json({ ok: false, error: "ingestion_failed", message });
      }
    } finally {
      severityBackfillRunning = false;
    }
  },
);

export default router;
