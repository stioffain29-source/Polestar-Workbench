import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { type IngestSummary } from "@workspace/ingest";
import { runIngestOnce } from "../lib/ingestRunner";

const router: IRouter = Router();

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
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
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
    req.log.warn("admin ingest called but INGEST_ADMIN_TOKEN is not configured");
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

    req.log.info(
      {
        flashpointInserted: result.flashpoint.inserted,
        cargoWatchInserted: result.cargoWatch.inserted,
        shippingInserted: result.shipping.inserted,
        energyInserted: result.energy.inserted,
        fertiliserInserted: result.fertiliser.inserted,
        fuelInserted: result.fuel.inserted,
        strikesInserted: result.strikes.inserted,
        durationMs: result.durationMs,
      },
      "admin ingest finished",
    );
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
        result.strikes.inserted,
      flashpoint: trimmedSummary(result.flashpoint),
      cargoWatch: trimmedSummary(result.cargoWatch),
      shipping: trimmedSummary(result.shipping),
      energy: trimmedSummary(result.energy),
      fertiliser: trimmedSummary(result.fertiliser),
      fuel: trimmedSummary(result.fuel),
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin ingest failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  }
});

export default router;
