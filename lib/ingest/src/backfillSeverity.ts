import { db, incidentsTable } from "@workspace/db";
import { and, eq, or, like, inArray } from "drizzle-orm";
import {
  classifySeverity,
  maxSeverity,
  severityFromFatalities,
  ALL_SEVERITY_TOPICS,
  type Severity,
  type SeverityTopic,
} from "./severity";
import type { IngestOptions } from "./types";

// One-off (idempotent) reclassification of already-ingested rows.
//
// The scrapers historically wrote severity="low" for every record, so
// auto-scraped rows already in the DB stay a single Low bar even after the
// scrapers learn to rate severity. Every time classifySeverity() itself
// gains a fix (a new fatal/attack signal, a new false-positive guard, etc.)
// the SAME staleness reappears for whatever was ingested before the fix
// shipped — this pass re-rates EXISTING machine-classified rows with
// whatever the classifier currently says, so historical data stays in sync
// with the live classifier instead of freezing at ingest-time judgement.
//
// IMPORTANT (fixed staleness bug): this used to filter topic IN
// (flashpoint, cargo_watch) only, so a classifier fix would silently never
// reach the other eight SeverityTopic values (conflict, indonesia_local,
// apac_local, shipping, energy, fuel, fertiliser, data_centres) even though
// the general news scraper (newsTopic.ts) writes the identical
// 'auto-scraped:' marker for all of them. Scope is now every topic
// classifySeverity() covers (ALL_SEVERITY_TOPICS), so the heal is general
// rather than a per-topic patch.
//
// Rows are matched by marker prefix, not by which pipeline wrote them, so
// every machine-classified source is covered: 'auto-scraped:' (news
// scrapers), 'gdelt_cloud:' (GDELT structured promotion), and 'social_raw:'
// (Facebook OSINT promotion). Analyst-entered rows carry none of these
// markers and are never touched.
//
// Lives in the lib (not just a script) so the API server can run the
// identical code against the writable prod DB — the workspace only sees a
// read-only prod replica.

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

export type BackfillRow = {
  title: string;
  summary: string | null;
  topic: SeverityTopic;
  fatalities: number | null;
};

/**
 * Pure per-row reclassification, split out from runSeverityBackfill so it is
 * unit-testable without a DB. Same rule as the main loop: text
 * classification is the base, never dropped below the floor implied by a
 * structured GDELT fatality count.
 */
export function nextSeverityForRow(row: BackfillRow): Severity {
  const fromText = classifySeverity(row.title, row.summary ?? "", row.topic);
  const floor = severityFromFatalities(row.fatalities);
  return floor ? maxSeverity(fromText, floor) : fromText;
}

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
        inArray(incidentsTable.topic, ALL_SEVERITY_TOPICS),
        or(
          like(incidentsTable.analystNotes, "auto-scraped:%"),
          like(incidentsTable.analystNotes, "gdelt_cloud:%"),
          like(incidentsTable.analystNotes, "social_raw:%"),
        ),
      ),
    );

  const distribution = EMPTY_DIST();
  const updates: { id: number; severity: Severity }[] = [];

  for (const r of rows) {
    // Safe: the query above already scoped topic to ALL_SEVERITY_TOPICS.
    const next = nextSeverityForRow({
      title: r.title,
      summary: r.summary,
      topic: r.topic as SeverityTopic,
      fatalities: r.fatalities,
    });
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
