import { pool } from "@workspace/db";
import {
  runFlashpointIngest,
  runCargoWatchIngest,
  type IngestSummary,
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
    }
  | { ran: false; reason: "locked" };

/**
 * Run the Flashpoint + Cargo Watch ingest once, committing to the database.
 * Returns `{ ran: false, reason: "locked" }` if another ingest is already in
 * progress (anywhere). Never closes the shared pool — the long-lived server
 * must keep it open.
 */
export async function runIngestOnce(): Promise<IngestRunResult> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [INGEST_LOCK_KEY],
    );
    locked = lockRes.rows[0]?.locked === true;
    if (!locked) return { ran: false, reason: "locked" };

    const startedAt = new Date();
    // Sequential: both share the same DB pool and dedupe against the incidents
    // table; running them one after another mirrors scrape:prod.
    const flashpoint = await runFlashpointIngest({ commit: true });
    const cargoWatch = await runCargoWatchIngest({ commit: true });
    const finishedAt = new Date();

    return {
      ran: true,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      flashpoint,
      cargoWatch,
    };
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [INGEST_LOCK_KEY]);
      } catch (unlockErr) {
        logger.error(
          { err: unlockErr },
          "failed to release ingest advisory lock",
        );
      }
    }
    client.release();
  }
}
