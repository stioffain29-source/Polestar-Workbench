import { backfillFlashpointValidity } from "@workspace/ingest";
import { logger } from "./logger";

type Backfill = typeof backfillFlashpointValidity;

export interface FlashpointValidityConvergenceResult {
  considered: number;
  updated: number;
  batches: number;
  complete: boolean;
}

/**
 * Advances stale Flashpoint semantic decisions newest-first without waiting for
 * the full multi-topic ingest. The row ceiling keeps each boot bounded; another
 * boot resumes from the next stale row.
 */
export async function convergeFlashpointValidity(
  maxRows = 400,
  batchSize = 20,
  backfill: Backfill = backfillFlashpointValidity,
): Promise<FlashpointValidityConvergenceResult> {
  const boundedMax = Math.max(1, Math.min(500, Math.trunc(maxRows)));
  const boundedBatch = Math.max(1, Math.min(100, Math.trunc(batchSize)));
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
      { batch: batches, requested, ...result, consideredTotal: considered, updatedTotal: updated },
      "flashpoint semantic convergence batch finished",
    );
    if (result.considered < requested) {
      complete = true;
      break;
    }
  }

  return { considered, updated, batches, complete };
}