import { runMaritimeMovementIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper for the live vessel-MOVEMENT (AIS) context ingest. All logic
// lives in @workspace/ingest so the API server runs the exact same code from
// the production runtime. CONTEXT ONLY — it writes the isolated
// maritime_movement store and never touches the incidents table.
//
// No-ops cleanly when AIS_API_KEY is unset. For PROD this must run INSIDE the
// deployment runtime (the workspace DATABASE_URL is a read-only dev DB).

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const summary = await runMaritimeMovementIngest({ commit });
  console.log(summary.logLines.join("\n"));
  if (summary.errors.length > 0) {
    console.error(summary.errors.join("\n"));
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
