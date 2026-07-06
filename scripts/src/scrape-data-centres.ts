import { runDataCentresIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All ingest logic lives in @workspace/ingest so the
// API server can run the exact same code from the production runtime.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const filterArg = process.argv.find((a) => a.startsWith("--filter="));
  const titleFilter = filterArg ? filterArg.slice("--filter=".length) : null;
  const summary = await runDataCentresIngest({ commit, titleFilter });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
