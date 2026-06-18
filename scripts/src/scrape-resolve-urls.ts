import { runResolveGoogleNewsUrls } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Thin CLI wrapper. All logic lives in @workspace/ingest so the API server runs
// the exact same code from the production runtime. Resolves Google News RSS
// redirect links (incidents.source_url) to their real publisher URLs, stored
// additively on incidents.resolved_url, so consumers (GDELT enrichment + the
// workbench UI links) get clean publisher URLs. Covers ALL news topics, with a
// fair round-robin so no high-volume topic starves the smaller ones in a
// bounded run. Use --commit to write; default is a dry-run. Optional
// --limit=<n> bounds how many unresolved redirect rows are scanned per run;
// optional --topics=a,b,c restricts to a specific topic set; optional
// --concurrency=<n> sets how many redirects are resolved in parallel (raise it
// for a one-time bulk historical backfill; the default suits the in-ingest pass).

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 2000;
  const topicsArg = process.argv.find((a) => a.startsWith("--topics="));
  const topics = topicsArg
    ? topicsArg
        .split("=")[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  const concurrencyArg = process.argv.find((a) =>
    a.startsWith("--concurrency="),
  );
  const concurrency = concurrencyArg
    ? Number(concurrencyArg.split("=")[1])
    : undefined;
  const summary = await runResolveGoogleNewsUrls({
    commit,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 2000,
    topics,
    concurrency:
      concurrency && Number.isFinite(concurrency) && concurrency > 0
        ? concurrency
        : undefined,
  });
  console.log(summary.logLines.join("\n"));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
