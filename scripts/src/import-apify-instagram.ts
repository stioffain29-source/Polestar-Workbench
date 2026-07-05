import {
  fetchApifyDatasetItems,
  resolveApifyTaskOrActorLatestDataset,
  normaliseInstagramPost,
  persistInstagramKammiPosts,
  runSocialPromote,
  type RawInstagramPost,
} from "@workspace/ingest";
import { pool } from "@workspace/db";

// Manual Apify Instagram (KAMMI watch) dataset importer.
//
// Pulls the items of an EXISTING Apify dataset (the output of a previously-run
// Instagram scraper actor/task — no new actor run, no charge) and stores the
// posts in `social_raw` via the SHARED persistInstagramKammiPosts pipeline,
// then runs the DB→DB promote pass (runSocialPromote). Instagram rows are
// hard-stamped non-credible at collection, so a row can promote ONLY when the
// promote pass finds a real news incident that now corroborates it; otherwise
// it stays context-only. With --commit both the import and the promote pass
// write; dry-run reports what each WOULD do.
//
// Two source selectors (exactly one required):
//   --datasetId <id>   import a specific dataset directly.
//   --taskId <id>      import the LATEST SUCCEEDED run of an Apify actor-TASK,
//                      resolving its dataset WITHOUT starting a new run (falls
//                      back to the backing actor's last SUCCEEDED run when the
//                      task itself has no task-runs).
//
// Usage:
//   pnpm --filter @workspace/scripts run import:apify-instagram -- \
//     (--datasetId <id> | --taskId <id>) [--limit N] [--commit]
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
  const datasetIdArg = parseArg("datasetId");
  const taskId = parseArg("taskId");
  const limitRaw = parseArg("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  // KAMMI focus guard (see filter below). Default to the KAMMI Pusat account so a
  // reused backing actor can never file unrelated posts as KAMMI/Indonesia.
  const anyHandle = process.argv.includes("--any-handle");
  const expectHandle = anyHandle
    ? null
    : (parseArg("expectHandle") ?? "kammi.pusat");

  if (!datasetIdArg && !taskId) {
    console.error(
      "Missing source. Usage: import:apify-instagram -- (--datasetId <id> | --taskId <id>) [--limit N] [--commit]",
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
    log(
      `import-apify-instagram — resolving latest SUCCEEDED run of task ${taskId}`,
    );
    const resolved = await resolveApifyTaskOrActorLatestDataset(token, taskId, {
      log,
    });
    if (!resolved) {
      console.error(
        `Task ${taskId} has no SUCCEEDED run with a dataset yet — run the task first.`,
      );
      process.exit(1);
    }
    datasetId = resolved;
  }

  log(
    `import-apify-instagram — mode=${commit ? "COMMIT" : "DRY-RUN"} dataset=${datasetId}${
      limit ? ` limit=${limit}` : ""
    }`,
  );

  const raw = await fetchApifyDatasetItems(token, datasetId!, { limit, log });
  log(`  fetched ${raw.length} dataset item(s)`);

  let posts: RawInstagramPost[] = [];
  for (const item of raw) {
    const norm = normaliseInstagramPost(item);
    if (norm) posts.push(norm);
  }
  log(
    `  normalised ${posts.length} post(s) (dropped ${
      raw.length - posts.length
    } unusable)`,
  );

  // KAMMI focus guard: --taskId resolves the BACKING actor's latest SUCCEEDED run
  // (the task has no task-runs), so if that actor is ever reused for a different
  // Instagram target the resolved dataset could be unrelated. Keep only the
  // expected owner handle so off-account posts can never be filed as KAMMI /
  // Indonesia context. Override with --expectHandle <h>; disable with --any-handle.
  if (expectHandle) {
    const want = expectHandle.replace(/^@/, "").toLowerCase();
    const before = posts.length;
    posts = posts.filter((p) => (p.ownerUsername ?? "").toLowerCase() === want);
    const dropped = before - posts.length;
    if (dropped > 0) {
      log(`  handle guard: kept @${want}, dropped ${dropped} off-account post(s)`);
    }
    if (before > 0 && posts.length === 0) {
      console.error(
        `Handle guard: none of the ${before} fetched post(s) are @${want}. The resolved dataset is likely a different Instagram target — pass --expectHandle <handle> or --any-handle to override.`,
      );
      process.exit(1);
    }
  }

  const result = await persistInstagramKammiPosts(posts, {
    commit,
    resolveActor: () =>
      taskId ? `apify-task:${taskId}` : `apify-dataset:${datasetId}`,
    log,
  });

  log(
    [
      "  summary:",
      `considered=${result.considered}`,
      `protest-relevant=${result.protestRelevant}`,
      `dup-in-db=${result.duplicateInDb}`,
      `new=${result.newToInsert}`,
      `inserted=${result.inserted}`,
      `table-total=${result.totalAfter}`,
    ].join(" "),
  );

  // Promote eligible rows into real incidents (DB→DB; re-derives eligibility +
  // live corroboration from the stored rows). Honours the same --commit flag.
  log("import-apify-instagram — running social→incident promote pass");
  const promote = await runSocialPromote({ commit, log });
  log(
    [
      "  promote:",
      `considered=${promote.unpromotedConsidered}`,
      `new=${promote.newToInsert}`,
      `inserted=${promote.inserted}`,
      `duplicate=${promote.skippedDuplicate}`,
      `not-credible=${promote.skippedNotCredible}`,
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
