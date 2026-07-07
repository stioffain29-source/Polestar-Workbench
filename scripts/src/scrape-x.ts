import { runXSearchIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All ingest logic lives in @workspace/ingest so the code is
// shared. X is a SOURCE PROVIDER ONLY, manual CLI, dry-run by default.
//
//   pnpm --filter @workspace/scripts run scrape:x
//   pnpm --filter @workspace/scripts run scrape:x -- --commit
//   pnpm --filter @workspace/scripts run scrape:x -- --query=conflict --max=50

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const queryArg = process.argv.find((a) => a.startsWith("--query="));
  const queryLabel = queryArg ? queryArg.slice("--query=".length) : undefined;
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const maxResults = maxArg ? Number(maxArg.slice("--max=".length)) : undefined;

  const summary = await runXSearchIngest({
    commit,
    queryLabel,
    maxResults: Number.isFinite(maxResults) ? maxResults : undefined,
  });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
