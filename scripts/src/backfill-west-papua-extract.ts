import { runWestPapuaExtractBackfill } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. The extraction logic lives in @workspace/ingest so the same
// code runs from the API-server boot migration against the writable prod DB.
//
//   pnpm --filter @workspace/scripts run backfill:west-papua-extract            # dry-run
//   pnpm --filter @workspace/scripts run backfill:west-papua-extract -- --commit
//   ... -- --commit --limit=500

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  const summary = await runWestPapuaExtractBackfill({ commit, limit });
  console.log(summary.logLines.join("\n"));
  if (summary.samples.length > 0) {
    console.log("\n=== Samples ===");
    for (const s of summary.samples)
      console.log(
        `  #${s.id} [${s.province ?? "—"}] ${s.category}${s.incidentDate ? ` (occurred ${s.incidentDate.slice(0, 10)})` : ""} — ${s.title}`,
      );
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
