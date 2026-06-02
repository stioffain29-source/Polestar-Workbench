import { runCargoCountryBackfill } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. Recovery logic lives in @workspace/ingest so the same code
// can run from the API server runtime against the writable prod DB if needed.
//
//   pnpm --filter @workspace/scripts run backfill:cargo-country            # dry-run
//   pnpm --filter @workspace/scripts run backfill:cargo-country -- --commit
//   ... -- --commit --limit=60 --after-id=1234   # chunked forward cursor

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const afterArg = process.argv.find((a) => a.startsWith("--after-id="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  const afterId = afterArg ? Number(afterArg.slice("--after-id=".length)) : undefined;
  const summary = await runCargoCountryBackfill({ commit, limit, afterId });
  console.log(summary.logLines.join("\n"));
  if (summary.recoveredSamples.length > 0) {
    console.log("\n=== Recovered samples ===");
    for (const s of summary.recoveredSamples)
      console.log(`  #${s.id} [${s.country}] ${s.title}  — ${s.reason}`);
  }
  if (summary.leftSamples.length > 0) {
    console.log("\n=== Left untouched (samples) ===");
    for (const s of summary.leftSamples) console.log(`  #${s.id} ${s.reason} — ${s.title}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
