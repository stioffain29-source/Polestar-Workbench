import { runReliefWebReportsIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All ReliefWeb situational-context logic lives in
// @workspace/ingest so the API server can run the exact same code from the
// production runtime. This pass pulls UN OCHA reports into the standalone
// reliefweb_reports table as supporting CONTEXT — it never writes incidents,
// so it can never inflate any count.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const summary = await runReliefWebReportsIngest({ commit });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
