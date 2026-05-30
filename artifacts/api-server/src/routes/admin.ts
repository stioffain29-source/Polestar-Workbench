import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { runFlashpointIngest, runCargoWatchIngest, type IngestSummary } from "@workspace/ingest";

const router: IRouter = Router();

// Protected production ingestion trigger.
//
// Runs the exact same Flashpoint + Cargo Watch ingest code as the CLI
// scrapers, but from inside the running server process — which, in the
// deployment, is the only place DATABASE_URL points at the writable
// production primary. This lets production data be refreshed with a single
// authenticated request, without a scheduled deployment.
//
// Protection: requires INGEST_ADMIN_TOKEN to be set in the environment.
// The caller must present it via `Authorization: Bearer <token>` or the
// `x-ingest-token` header. If the token is not configured, the route is
// disabled (503) so it can never run unauthenticated.
//
// Concurrency: serialised with a Postgres session-level advisory lock held
// on a dedicated pooled connection for the duration of the run. Unlike an
// in-memory flag, this holds across ALL autoscale instances — a second
// concurrent request (same instance or another) gets 409. Because only one
// ingest can run at a time globally, the in-application read-then-insert
// dedupe in @workspace/ingest cannot race against a parallel writer.

// Arbitrary but stable advisory-lock key ("Pole" in hex). Must match across
// every instance so they contend on the same lock.
const INGEST_LOCK_KEY = 0x506f6c65;

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

  // Dedicated connection so the session-level advisory lock is held by ONE
  // connection for the whole run and released on that same connection.
  const client = await pool.connect();
  let locked = false;
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [INGEST_LOCK_KEY],
    );
    locked = lockRes.rows[0]?.locked === true;
    if (!locked) {
      res.status(409).json({ error: "ingestion_in_progress" });
      return;
    }

    const startedAt = new Date();
    req.log.info("admin ingest started");

    // Sequential: both share the same DB pool and dedupe against the
    // incidents table; running them one after another mirrors scrape:prod.
    const flashpoint = await runFlashpointIngest({ commit: true });
    const cargoWatch = await runCargoWatchIngest({ commit: true });
    const finishedAt = new Date();
    req.log.info(
      {
        flashpointInserted: flashpoint.inserted,
        cargoWatchInserted: cargoWatch.inserted,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
      "admin ingest finished",
    );
    res.json({
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      totalInserted: flashpoint.inserted + cargoWatch.inserted,
      flashpoint: trimmedSummary(flashpoint),
      cargoWatch: trimmedSummary(cargoWatch),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "admin ingest failed");
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "ingestion_failed", message });
    }
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [INGEST_LOCK_KEY]);
      } catch (unlockErr) {
        req.log.error({ err: unlockErr }, "failed to release ingest advisory lock");
      }
    }
    client.release();
  }
});

export default router;
