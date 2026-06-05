import { runMarketSnapshotIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper for the live commodity-price SNAPSHOT ingest (Fuel / Energy /
// Fertiliser monitors). All logic lives in @workspace/ingest so the API server
// can run the exact same code from the production runtime.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const summary = await runMarketSnapshotIngest({ commit });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
