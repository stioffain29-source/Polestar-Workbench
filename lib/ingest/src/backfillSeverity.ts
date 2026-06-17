import { db, incidentsTable } from "@workspace/db";
import { and, eq, like, inArray } from "drizzle-orm";
import { classifySeverity, maxSeverity, severityFromFatalities, type Severity } from "./severity";
import type { IngestOptions } from "./types";

// One-off (idempotent) reclassification of already-ingested rows.
//
// The scrapers historically wrote severity="low" for every record, so the
// ~1k auto-scraped flashpoint/cargo_watch rows already in the DB stay a
// single Low bar even after the scrapers learn to rate severity. This pass
// re-rates EXISTING auto-scraped rows with the same classifySeverity() the
// scrapers now use, so the Severity Distribution chart reflects a realistic
// spread on historical data too.
//
// Scope is limited to auto-scraped rows (analyst_notes LIKE 'auto-scraped:%')
// so analyst-entered severities are never overwritten. Lives in the lib (not
// just a script) so the API server can run the identical code against the
// writable prod DB — the workspace only sees a read-only prod replica.

export type SeverityBackfillSummary = {
  mode: "commit" | "dry-run";
  scanned: number;
  changed: number;
  /** Resulting tier counts across all scanned auto-scraped rows. */
  distribution: Record<Severity, number>;
  logLines: string[];
};

const EMPTY_DIST = (): Record<Severity, number> => ({
  insignificant: 0,
  low: 0,
  moderate: 0,
  high: 0,
  extreme: 0,
});

/**
 * Reclassify existing auto-scraped flashpoint/cargo_watch rows. Does NOT
 * close the shared DB pool — see runFlashpointIngest for the rationale.
 */
export async function runSeverityBackfill(opts: IngestOptions = {}): Promise<SeverityBackfillSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Severity backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      severity: incidentsTable.severity,
      fatalities: incidentsTable.fatalities,
    })
    .from(incidentsTable)
    .where(
      and(
        inArray(incidentsTable.topic, ["flashpoint", "cargo_watch"]),
        like(incidentsTable.analystNotes, "auto-scraped:%"),
      ),
    );

  const distribution = EMPTY_DIST();
  const updates: { id: number; severity: Severity }[] = [];

  for (const r of rows) {
    const topic = r.topic === "cargo_watch" ? "cargo_watch" : "flashpoint";
    // Text classification is the base, but never below the floor implied by a
    // structured GDELT fatality count — otherwise this re-rate would silently
    // revert a fatal-protest Extreme back to a keyword-only tier.
    const fromText = classifySeverity(r.title, r.summary ?? "", topic);
    const floor = severityFromFatalities(r.fatalities);
    const next = floor ? maxSeverity(fromText, floor) : fromText;
    distribution[next]++;
    if (next !== r.severity) updates.push({ id: r.id, severity: next });
  }

  log(`  Scanned auto-scraped rows : ${rows.length}`);
  log(`  Rows to re-rate           : ${updates.length}`);
  log("\n=== Resulting distribution ===");
  for (const tier of ["insignificant", "low", "moderate", "high", "extreme"] as const) {
    log(`  ${tier.padEnd(14)} ${distribution[tier]}`);
  }

  if (!commit) {
    log("\nDRY-RUN — no rows written. Re-run with --commit to apply.");
    return { mode: "dry-run", scanned: rows.length, changed: updates.length, distribution, logLines };
  }

  for (const u of updates) {
    await db.update(incidentsTable).set({ severity: u.severity }).where(eq(incidentsTable.id, u.id));
  }
  log(`\nUpdated ${updates.length} rows.`);

  return { mode: "commit", scanned: rows.length, changed: updates.length, distribution, logLines };
}
