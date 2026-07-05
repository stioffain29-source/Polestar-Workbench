import { runSocialPromote } from "@workspace/ingest";
import { pool } from "@workspace/db";

// Standalone social OSINT → incidents promote pass.
//
// Runs the DB→DB promote pass (`runSocialPromote`) over the already-collected
// `social_raw` rows: eligible rows (security-relevant AND credible / live-
// corroborated, not a duplicate) become real incidents; the rest stay
// context-only. No external fetch — it reads the local table only. Idempotent
// and safe to re-run. Dry-run by default; pass --commit to write.
//
// Deliberately NOT part of `scrape:prod`; the two Apify importers already run
// this pass after each import, and prod ingest promotes at scrape time.
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const log = (s: string) => console.log(s);

  const result = await runSocialPromote({ commit, log });
  log(
    [
      "promote-social —",
      `mode=${result.mode}`,
      `considered=${result.unpromotedConsidered}`,
      `already-promoted=${result.skippedAlreadyPromoted}`,
      `not-security=${result.skippedNotSecurity}`,
      `not-credible=${result.skippedNotCredible}`,
      `duplicate=${result.skippedDuplicate}`,
      `new=${result.newToInsert}`,
      `inserted=${result.inserted}`,
    ].join(" "),
  );
  if (result.errors.length > 0) {
    log(`  ${result.errors.length} error(s):`);
    for (const e of result.errors) log(`    ${e}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
