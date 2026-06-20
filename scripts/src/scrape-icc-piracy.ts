import { runIccPiracyIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All ICC CCS / IMB maritime-security logic lives in
// @workspace/ingest so the API server can run the exact same code from the
// production runtime. This pass pulls the current-year piracy & armed-robbery
// events from the ICC live-piracy map into the standalone
// maritime_security_events table — it NEVER writes incidents, so it can never
// inflate any count.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const summary = await runIccPiracyIngest({ commit });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
