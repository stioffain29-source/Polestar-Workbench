// Committing runner for conflict same-event clustering against the LIVE DB.
//
// This is the SAME pass the api-server scheduler runs inside runIngestOnce, but
// exposed as a standalone CLI so it can (a) backfill event_cluster_key on rows
// that already exist and (b) run inside the scrape:prod scheduled deployment,
// which otherwise scrapes every topic but never clusters — leaving syndicated
// conflict copies un-collapsed in the monitor + report.
//
// Dry-run by default (no writes); pass --commit to stamp keys. Idempotent:
// only NULL keys are filled, so re-runs never re-key or duplicate.
//
//   pnpm --filter @workspace/scripts run cluster:conflict              # dry-run
//   pnpm --filter @workspace/scripts run cluster:conflict -- --commit  # write
//   (optional: WINDOW_DAYS=14)

import { runConflictClustering } from "@workspace/ingest";
import { pool } from "@workspace/db";

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const windowDays = Number(process.env.WINDOW_DAYS || "14");
  // MAX_PAIRS raises the LLM candidate cap (default 2000) for a one-off backlog
  // clear over a wide window; unset keeps the recurring-run default.
  const maxPairs = Number(process.env.MAX_PAIRS || "0") || undefined;
  // Runs OUTSIDE the runIngestOnce advisory lock. Safe: the stamp is a per-row
  // UPDATE ... WHERE event_cluster_key IS NULL (first writer wins, settled keys
  // never rewritten), so a concurrent scheduler pass can at worst under-merge
  // (mandated-safe, display-inert) — never corrupt or double-stamp.
  const summary = await runConflictClustering({ commit, windowDays, maxPairs });
  for (const line of summary.logLines) console.log(line);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
