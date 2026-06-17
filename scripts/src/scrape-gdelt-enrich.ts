import { runGdeltEnrich } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All GDELT enrichment logic lives in @workspace/ingest so the
// API server can run the exact same code from the production runtime. The pass
// is self-throttled (cadence gate + hard QU cap) so a manual run is budget-safe.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const summary = await runGdeltEnrich({ commit });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
