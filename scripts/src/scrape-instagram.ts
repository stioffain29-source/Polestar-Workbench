import { runInstagramSourceIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All ingest logic lives in @workspace/ingest so the code is
// shared. Instagram (Papua / separatist) is a SOURCE PROVIDER ONLY: it reads an
// EXISTING Apify Instagram dataset/task, content-routes the public posts into the
// existing incident topics (Conflict / Flashpoint / ...) and inserts the new ones.
// Manual CLI, dry-run by default, NOT wired into the scheduler.
//
//   pnpm --filter @workspace/scripts run scrape:instagram -- --datasetId <id>
//   pnpm --filter @workspace/scripts run scrape:instagram -- --taskId <id> --commit
//   pnpm --filter @workspace/scripts run scrape:instagram -- --datasetId <id> --limit 200 --expectHandle acct1,acct2
//
// Reads APIFY_TOKEN from the environment (sent to Apify as a query param only —
// never logged or stored; scrubbed from every error). Exactly one of --datasetId
// or --taskId is required.

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === `--${name}`) return process.argv[i + 1];
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const datasetId = parseArg("datasetId");
  const taskId = parseArg("taskId");
  const limitRaw = parseArg("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const expectHandles = (parseArg("expectHandle") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (limitRaw && (limit === undefined || !Number.isFinite(limit) || limit <= 0)) {
    console.error(`Invalid --limit "${limitRaw}" (expected a positive integer).`);
    process.exit(1);
  }

  const summary = await runInstagramSourceIngest({
    commit,
    datasetId,
    taskId,
    limit,
    expectHandles,
  });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
