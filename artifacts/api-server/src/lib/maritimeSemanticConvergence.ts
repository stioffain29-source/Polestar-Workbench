import {
  backfillMaritimeSemantic,
  isMaritimeSemanticProviderConfigured,
} from "@workspace/ingest";
import { pool } from "@workspace/db";
import { logger } from "./logger";

type Backfill = typeof backfillMaritimeSemantic;

export interface MaritimeSemanticConvergenceResult {
  considered: number;
  updated: number;
  batches: number;
  complete: boolean;
}

const ADVISORY_LOCK_KEY = "polestar:maritime-semantic-convergence";
let inProcessRun: Promise<MaritimeSemanticConvergenceResult> | undefined;

const skippedResult = (): MaritimeSemanticConvergenceResult => ({
  considered: 0,
  updated: 0,
  batches: 0,
  complete: true,
});

async function withCrossProcessLock<T>(
  work: () => Promise<T>,
  useLock: boolean,
): Promise<T | null> {
  if (!useLock) return work();
  const client = await pool.connect();
  let acquired = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    acquired = Boolean(result.rows[0]?.locked);
    if (!acquired) return null;
    return await work();
  } finally {
    if (acquired) {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
          ADVISORY_LOCK_KEY,
        ])
        .catch(() => undefined);
    }
    client.release();
  }
}

async function runConvergence(
  maxRows: number,
  batchSize: number,
  backfill: Backfill,
): Promise<MaritimeSemanticConvergenceResult> {
  // Ingest still records needs_review for newly inserted rows, but historical
  // convergence must not churn when no semantic provider is configured.
  if (!isMaritimeSemanticProviderConfigured() && backfill === backfillMaritimeSemantic) {
    return skippedResult();
  }
  const boundedMax = Math.max(1, Math.min(500, Math.trunc(maxRows)));
  const boundedBatch = Math.max(1, Math.min(100, Math.trunc(batchSize)));
  const locked = await withCrossProcessLock(
    async () => {
      let considered = 0;
      let updated = 0;
      let batches = 0;
      let complete = false;
      while (considered < boundedMax) {
        const requested = Math.min(boundedBatch, boundedMax - considered);
        const result = await backfill(requested);
        batches++;
        considered += result.considered;
        updated += result.updated;
        logger.info(
          {
            batch: batches,
            requested,
            ...result,
            consideredTotal: considered,
            updatedTotal: updated,
          },
          "maritime semantic convergence batch finished",
        );
        if (result.considered < requested) {
          complete = true;
          break;
        }
      }
      return { considered, updated, batches, complete };
    },
    backfill === backfillMaritimeSemantic,
  );
  return locked ?? skippedResult();
}

/**
 * Bounded newest-first convergence.  It is deliberately independent of HTTP
 * readiness: callers may run a small boot batch and continue in the
 * background, while each scheduled invocation has a hard row ceiling.
 */
export async function convergeMaritimeSemantic(
  maxRows = 400,
  batchSize = 20,
  backfill: Backfill = backfillMaritimeSemantic,
): Promise<MaritimeSemanticConvergenceResult> {
  if (inProcessRun) return inProcessRun;
  inProcessRun = runConvergence(maxRows, batchSize, backfill).finally(() => {
    inProcessRun = undefined;
  });
  return inProcessRun;
}

export function startMaritimeSemanticConvergence(): () => void {
  const rawMinutes = Number(process.env.MARITIME_SEMANTIC_INTERVAL_MINUTES ?? 30);
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0
    ? Math.max(5, rawMinutes)
    : 30;
  const timer = setInterval(() => {
    void convergeMaritimeSemantic(100).catch((error) => {
      logger.error({ err: error }, "scheduled maritime semantic convergence failed");
    });
  }, minutes * 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
