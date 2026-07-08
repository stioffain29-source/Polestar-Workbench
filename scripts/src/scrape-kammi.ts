import { runKammiSourceIngest } from "@workspace/ingest";
import { pool } from "@workspace/db";

// KAMMI Pusat Instagram — SOURCE PROVIDER CLI (manual, dry-run by default).
//
// KAMMI is "just another news source", exactly like the X and Instagram (Papua)
// source providers. This CLI pulls PUBLIC posts from KAMMI Pusat's official
// Instagram account via the paid Apify scraper, PII-scrubs each caption,
// translates the Bahasa Indonesia text to English, content-routes it into an
// EXISTING incident topic, relevance-gates it, dedupes it and (only with
// --commit) inserts the new rows into the shared `incidents` table. A genuine
// KAMMI protest lands directly in the relevant news feed (Flashpoint / Protests
// & Civil Unrest); slop is discarded at the router. There is NO separate review
// queue or context table.
//
// Usage:
//   pnpm --filter @workspace/scripts run scrape:kammi              (dry-run)
//   pnpm --filter @workspace/scripts run scrape:kammi -- --commit  (write)
//   optional: --limit=<n> / --max=<n> to cap dataset items pulled.
//
// Reads INSTAGRAM_API_KEY (or the APIFY_TOKEN fallback) from the environment —
// sent to Apify as a query param only, never logged or stored. No-ops cleanly
// when unset or when KAMMI_ENABLED / INSTAGRAM_ENABLED is off. Dry-run by
// default; pass --commit to write.

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
  const limitRaw = parseArg("limit") ?? parseArg("max");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  if (
    limitRaw &&
    (limit === undefined || !Number.isFinite(limit) || limit <= 0)
  ) {
    console.error(
      `Invalid --limit "${limitRaw}" (expected a positive integer).`,
    );
    process.exit(1);
  }

  const summary = await runKammiSourceIngest({
    commit,
    limit,
    log: (s) => console.log(s),
  });

  console.log(
    [
      "kammi:",
      `mode=${summary.mode}`,
      `active=${summary.active}`,
      `fetchOk=${summary.fetchOk}`,
      `fetched=${summary.fetched}`,
      `routable=${summary.routable}`,
      `new=${summary.newToInsert}`,
      `inserted=${summary.inserted}`,
    ].join(" "),
  );
  if (summary.byTopic.length > 0) {
    console.log(
      "  by topic: " + summary.byTopic.map(([t, n]) => `${t}=${n}`).join(" "),
    );
  }
  if (summary.errors.length > 0) {
    console.error("  errors: " + summary.errors.join(" | "));
    process.exitCode = 1;
  }
  if (!commit) console.log("  DRY-RUN — re-run with --commit to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
