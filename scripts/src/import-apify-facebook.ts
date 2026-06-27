import {
  fetchApifyDatasetItems,
  resolveApifyTaskLatestDataset,
  normaliseFacebookPost,
  persistFacebookPosts,
  type RawFacebookPost,
} from "@workspace/ingest";
import { pool } from "@workspace/db";

// Manual Apify Facebook dataset importer.
//
// Pulls the items of an EXISTING Apify dataset (the output of a previously-run
// Facebook scraper actor/task — no new actor run, no charge) and stores the
// classified, credibility-scored posts as supporting CONTEXT in `social_raw`,
// via the SHARED persistFacebookPosts pipeline. It NEVER writes incidents (only
// the gated, server-re-derived promote action does) and never touches incident
// ingest, reports or PDFs.
//
// Two source selectors (exactly one required):
//   --datasetId <id>   import a specific dataset directly.
//   --taskId <id>      import the latest SUCCEEDED run of an Apify actor-TASK
//                      (resolves its defaultDatasetId — still no new run).
//
// Two classification scopes:
//   (default)  SCOPED — keep only in-theatre (PNG / Indonesian-Papua) posts,
//              identical to the live ingest engine.
//   --broad    BROAD — additionally store every other text post as multi-country
//              CONTEXT (country "Unknown", never security-relevant / promotable).
//
// Usage:
//   pnpm --filter @workspace/scripts run import:apify-facebook -- \
//     (--datasetId <id> | --taskId <id>) [--broad] [--limit N] [--commit]
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

/**
 * Derive a stable per-group/page handle from the source URL (preferred) or the
 * group/page display name, so broad multi-group rows carry their real origin
 * instead of a single shared "apify-import" handle.
 */
function deriveHandle(pageUrl: string | null, pageName: string | null): string {
  if (pageUrl) {
    try {
      const segs = new URL(pageUrl).pathname.split("/").filter(Boolean);
      const gi = segs.indexOf("groups");
      const slug = gi >= 0 ? segs[gi + 1] : segs[0];
      if (slug) return slug.slice(0, 80);
    } catch {
      // fall through to the name-based slug
    }
  }
  if (pageName) {
    const slug = pageName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    if (slug) return slug;
  }
  return "apify-import";
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const broad = process.argv.includes("--broad");
  const datasetIdArg = parseArg("datasetId");
  const taskId = parseArg("taskId");
  const limitRaw = parseArg("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  if (!datasetIdArg && !taskId) {
    console.error(
      "Missing source. Usage: import:apify-facebook -- (--datasetId <id> | --taskId <id>) [--broad] [--limit N] [--commit]",
    );
    process.exit(1);
  }
  if (datasetIdArg && taskId) {
    console.error("Pass only one of --datasetId or --taskId, not both.");
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

  // Resolve the dataset id (directly, or from the task's latest SUCCEEDED run).
  let datasetId = datasetIdArg;
  if (!datasetId && taskId) {
    log(`import-apify-facebook — resolving latest SUCCEEDED run of task ${taskId}`);
    const resolved = await resolveApifyTaskLatestDataset(token, taskId, { log });
    if (!resolved) {
      console.error(
        `Task ${taskId} has no SUCCEEDED run with a dataset yet — run the task first.`,
      );
      process.exit(1);
    }
    datasetId = resolved;
  }

  log(
    `import-apify-facebook — mode=${commit ? "COMMIT" : "DRY-RUN"} scope=${
      broad ? "BROAD" : "SCOPED"
    } dataset=${datasetId}${limit ? ` limit=${limit}` : ""}`,
  );

  const raw = await fetchApifyDatasetItems(token, datasetId!, { limit, log });
  log(`  fetched ${raw.length} dataset item(s)`);

  const posts: RawFacebookPost[] = [];
  for (const item of raw) {
    const norm = normaliseFacebookPost(item);
    if (!norm) continue;
    // Stamp a per-group origin so broad multi-group rows keep their real source.
    norm.pageHandle = deriveHandle(norm.pageUrl ?? null, norm.pageName ?? null);
    posts.push(norm);
  }
  log(
    `  normalised ${posts.length} post(s) (dropped ${
      raw.length - posts.length
    } unusable)`,
  );

  const result = await persistFacebookPosts(posts, {
    commit,
    mode: broad ? "broad" : "scoped",
    defaultSourceTier: "osint",
    defaultPageHandle: "apify-import",
    defaultPageName: "Apify dataset import",
    resolveActor: () =>
      taskId ? `apify-task:${taskId}` : `apify-dataset:${datasetId}`,
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
