import { db, strikesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { classifyStrikeFields } from "./strikes";
import type { IngestOptions } from "./types";

// One-off (idempotent) reclassification of already-stored strike rows.
//
// The Missile Strike Tracker dashboard derives Target / Weapon / Casualties from
// the DB columns FIRST and only falls back to text when a column is "unknown" /
// null. Historical rows were classified by an earlier, narrower set of rules
// (trailing-\b stem traps that dropped refinery/petrochemical/energy targets; no
// interception->0 casualty rule), so they sit as "unknown" and push several
// charts past the >50% "mostly unattributed" caveat threshold. A second class of
// gaps are hand-entered SEED rows (e.g. the SAMREF / Mina al-Ahmadi refinery and
// Aluminium Bahrain / EGA smelter strikes) that were recorded as unknown/unknown
// before the rulebook learned those terms.
//
// This pass re-runs classifyStrikeFields() — the SAME logic the live scraper now
// uses — over each row's stored `summary` + `source`. It only WRITES a column
// when the new value is a genuine, non-unknown improvement, so analyst edits and
// already-classified rows are never regressed:
//   - target_category / infrastructure: overwrite only when the stored value is
//     "unknown" and the reclassification produced a real category.
//   - casualties: fill only when currently NULL (never overwrite an existing
//     count) and only with a concrete value (explicit deaths or a clean
//     interception -> 0).
//
// Scope covers ALL rows — auto-scraped AND hand-entered/seed rows. The
// fill-only-when-blank rule above is what protects analyst work: a deliberately
// chosen category/count is never "unknown"/NULL, so it is never touched; only
// blanks get filled. (This intentionally REPLACES the earlier auto-scraped-only
// scope, per an explicit decision to also refresh hand-entered records.) Lives in
// the lib (not just a script) so the API server can run the identical code
// against the writable prod DB — the workspace only sees a read-only prod replica.

export type StrikesBackfillSummary = {
  mode: "commit" | "dry-run";
  scanned: number;
  targetFilled: number;
  infraFilled: number;
  casualtiesFilled: number;
  logLines: string[];
};

/**
 * Reclassify existing strike rows (auto-scraped AND hand-entered) from their
 * stored summary + source, filling only blank columns. Does NOT close the shared
 * DB pool — see runStrikesIngest for the rationale.
 */
export async function runStrikesBackfill(opts: IngestOptions = {}): Promise<StrikesBackfillSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Strikes backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const rows = await db
    .select({
      id: strikesTable.id,
      summary: strikesTable.summary,
      source: strikesTable.source,
      targetCategory: strikesTable.targetCategory,
      infrastructure: strikesTable.infrastructure,
      casualties: strikesTable.casualties,
    })
    .from(strikesTable);

  const updates: {
    id: number;
    targetCategory?: string;
    infrastructure?: string;
    casualties?: number;
  }[] = [];

  for (const r of rows) {
    const text = [r.summary ?? "", r.source ?? ""].join(" ");
    const next = classifyStrikeFields(text);
    const patch: { targetCategory?: string; infrastructure?: string; casualties?: number } = {};

    if ((r.targetCategory ?? "unknown") === "unknown" && next.targetCategory !== "unknown") {
      patch.targetCategory = next.targetCategory;
    }
    if ((r.infrastructure ?? "unknown") === "unknown" && next.infrastructure !== "unknown") {
      patch.infrastructure = next.infrastructure;
    }
    if (r.casualties == null && next.casualties != null) {
      patch.casualties = next.casualties;
    }

    if (Object.keys(patch).length > 0) updates.push({ id: r.id, ...patch });
  }

  const targetFilled = updates.filter((u) => u.targetCategory != null).length;
  const infraFilled = updates.filter((u) => u.infrastructure != null).length;
  const casualtiesFilled = updates.filter((u) => u.casualties != null).length;

  log(`  Scanned rows              : ${rows.length}`);
  log(`  Rows to update            : ${updates.length}`);
  log(`    target_category filled  : ${targetFilled}`);
  log(`    infrastructure filled   : ${infraFilled}`);
  log(`    casualties filled       : ${casualtiesFilled}`);

  if (!commit) {
    log("\nDRY-RUN — no rows written. Re-run with --commit to apply.");
    return { mode: "dry-run", scanned: rows.length, targetFilled, infraFilled, casualtiesFilled, logLines };
  }

  for (const u of updates) {
    const set: { targetCategory?: string; infrastructure?: string; casualties?: number } = {};
    if (u.targetCategory != null) set.targetCategory = u.targetCategory;
    if (u.infrastructure != null) set.infrastructure = u.infrastructure;
    if (u.casualties != null) set.casualties = u.casualties;
    await db.update(strikesTable).set(set).where(eq(strikesTable.id, u.id));
  }
  log(`\nUpdated ${updates.length} rows.`);

  return { mode: "commit", scanned: rows.length, targetFilled, infraFilled, casualtiesFilled, logLines };
}
