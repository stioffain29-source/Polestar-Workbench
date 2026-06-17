import { runResolveGoogleNewsUrls } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All logic lives in @workspace/ingest so the API server runs
// the exact same code from the production runtime. Resolves Google News RSS
// redirect links (incidents.source_url) to their real publisher URLs, stored
// additively on incidents.resolved_url, so the GDELT enrichment URL-match can
// fire. Use --commit to write; default is a dry-run. Optional --limit=<n>
// bounds how many unresolved redirect rows are scanned per run.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 2000;
  const summary = await runResolveGoogleNewsUrls({
    commit,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 2000,
  });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
