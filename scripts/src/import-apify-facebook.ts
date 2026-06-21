import {
  fetchApifyDatasetItems,
  normaliseFacebookPost,
  persistFacebookPosts,
  type RawFacebookPost,
} from "@workspace/ingest";
import { pool } from "@workspace/db";

// Manual Apify Facebook dataset importer.
//
// Pulls the items of an EXISTING Apify dataset (the output of a previously-run
// Facebook scraper actor — no new actor run, no charge) and stores the in-scope,
// credibility-scored posts as supporting CONTEXT in `social_raw`, via the SHARED
// persistFacebookPosts pipeline. It therefore runs the EXACT same scope / dedup /
// credibility logic as the live engine. It NEVER writes incidents (only the
// gated, server-re-derived promote action does) and never touches incident
// ingest, reports or PDFs.
//
// Usage:
//   pnpm --filter @workspace/scripts run import:apify-facebook -- \
//     --datasetId <APIFY_DATASET_ID> [--limit N] [--commit]
//
// Reads APIFY_TOKEN from the environment (sent to Apify as a query param only —
// never logged or stored; scrubbed from every error). Dry-run by default; pass
// --commit to write.

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
  const limitRaw = parseArg("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  if (!datasetId) {
    console.error(
      "Missing --datasetId. Usage: import:apify-facebook -- --datasetId <id> [--limit N] [--commit]",
    );
    process.exit(1);
  }
  if (limitRaw && (limit === undefined || !Number.isFinite(limit) || limit <= 0)) {
    console.error(`Invalid --limit "${limitRaw}" (expected a positive integer).`);
    process.exit(1);
  }

  const token = process.env.APIFY_TOKEN ?? "";
  if (!token) {
    console.error("APIFY_TOKEN is not set — cannot fetch the Apify dataset.");
    process.exit(1);
  }

  const log = (s: string) => console.log(s);
  log(
    `import-apify-facebook — mode=${commit ? "COMMIT" : "DRY-RUN"} dataset=${datasetId}${
      limit ? ` limit=${limit}` : ""
    }`,
  );

  const raw = await fetchApifyDatasetItems(token, datasetId, { limit, log });
  log(`  fetched ${raw.length} dataset item(s)`);

  const posts: RawFacebookPost[] = [];
  for (const item of raw) {
    const norm = normaliseFacebookPost(item);
    if (norm) posts.push(norm);
  }
  log(
    `  normalised ${posts.length} post(s) (dropped ${
      raw.length - posts.length
    } unusable)`,
  );

  const result = await persistFacebookPosts(posts, {
    commit,
    defaultSourceTier: "osint",
    defaultPageHandle: "apify-import",
    defaultPageName: "Apify dataset import",
    resolveActor: () => `apify-dataset:${datasetId}`,
    log,
  });

  log(
    [
      "  summary:",
      `in-scope=${result.inScope}`,
      `security=${result.securityRelevant}`,
      `credible=${result.credible}`,
      `promotable=${result.promotable}`,
      `flagged=${result.reviewFlagged}`,
      `dup-in-db=${result.duplicateInDb}`,
      `new=${result.newToInsert}`,
      `inserted=${result.inserted}`,
      `table-total=${result.totalAfter}`,
    ].join(" "),
  );
  if (!commit) log("  DRY-RUN — re-run with --commit to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
