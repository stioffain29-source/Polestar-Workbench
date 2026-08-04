import { db, incidentsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { APAC_LOCAL_CONFIG, CONFLICT_CONFIG, INDONESIA_LOCAL_CONFIG } from "./topicConfigs";
import { classifyNewsItem, type NewsTopicConfig } from "./newsTopic";

// One-time cleanup for the cross-country contamination bug fixed alongside
// this file: apac_local / indonesia_local / conflict are single-country-scoped
// regional topics (they never set globalExtraAliases — unlike energy / fuel /
// fertiliser / data_centres, which WANT out-of-region countries). Before the
// OUT_OF_REGION blocklist was expanded to a near-complete world list, a story
// naming an untracked foreign country (Greece, Ceuta, ...) fell through
// classify()'s `const country = detected ?? feed.defaultCountry` and was
// blind-stamped with the feed's default country instead of being rejected —
// e.g. a Greek wildfire story on the Philippine Daily Inquirer feed was
// stamped Philippines, an unrelated Ceuta riot on an Indonesian feed was
// stamped Indonesia.
//
// This pass re-runs the EXACT SAME classifyNewsItem() the live ingest
// classifier uses (now with the expanded OUT_OF_REGION list) over every
// already-stored row in these three topics. Unlike globalReattribute.ts,
// there is no correct country to re-stamp a rejected row TO — these topics
// only cover their own tracked country, so a row that would now be rejected
// as `out-of-region:<Country>` never belonged in this dataset at all and is
// DELETED, mirroring what classify() would have done had this fix existed at
// ingest time. A row that still resolves to a tracked in-region country (the
// overwhelming majority) is completely untouched.
//
// Deliberately conservative: only rows whose classify() reason is exactly
// `out-of-region:*` are removed. Deny-list rejects, allow-list misses, etc.
// mean something else changed since ingest and are left alone.

const TOPIC_CONFIGS: Record<string, NewsTopicConfig> = {
  apac_local: APAC_LOCAL_CONFIG,
  indonesia_local: INDONESIA_LOCAL_CONFIG,
  conflict: CONFLICT_CONFIG,
};

export type RegionalCleanupDecision =
  | { drop: false }
  | { drop: true; foreignCountry: string };

// Pure per-row decision, extracted for unit testing without a live DB
// connection. Mirrors exactly what the loop in runRegionalOutOfRegionCleanup
// does with classifyNewsItem's result.
export function decideRegionalCleanup(
  cfg: NewsTopicConfig,
  row: { title: string; summary?: string | null; source?: string | null; country: string },
): RegionalCleanupDecision {
  const result = classifyNewsItem(cfg, row.title, row.summary ?? "", {
    sourceName: row.source ?? "",
    defaultCountry: row.country,
  });
  if (result.kept) return { drop: false };
  const match = /^out-of-region:(.+)$/.exec(result.reason);
  if (!match) return { drop: false };
  return { drop: true, foreignCountry: match[1] };
}

export type RegionalOutOfRegionCleanupSummary = {
  mode: "dry-run" | "commit";
  topics: string[];
  scanned: number;
  deleted: number;
  perForeignCountry: [string, number][];
  deletedSamples: { id: number; topic: string; storedCountry: string; foreignCountry: string; title: string }[];
  logLines: string[];
};

export async function runRegionalOutOfRegionCleanup(
  opts: { commit?: boolean; topics?: string[]; limit?: number } = {},
): Promise<RegionalOutOfRegionCleanupSummary> {
  const commit = opts.commit ?? false;
  const topics = opts.topics ?? ["apac_local", "indonesia_local", "conflict"];
  const limit = opts.limit ?? 50000;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const perForeignCountry = new Map<string, number>();
  const deletedSamples: RegionalOutOfRegionCleanupSummary["deletedSamples"] = [];

  log(
    `Regional out-of-region cleanup — mode=${commit ? "COMMIT" : "DRY-RUN"}, topics=[${topics.join(", ")}], limit=${limit}`,
  );

  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      source: incidentsTable.source,
      country: incidentsTable.country,
    })
    .from(incidentsTable)
    .where(inArray(incidentsTable.topic, topics))
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Scanned rows: ${rows.length}`);

  const idsToDelete: number[] = [];

  for (const r of rows) {
    const cfg = TOPIC_CONFIGS[r.topic];
    if (!cfg) continue;

    const decision = decideRegionalCleanup(cfg, r);
    if (!decision.drop) continue; // in-region, or rejected for an unrelated reason — leave alone

    const foreignCountry = decision.foreignCountry;
    idsToDelete.push(r.id);
    perForeignCountry.set(foreignCountry, (perForeignCountry.get(foreignCountry) ?? 0) + 1);
    if (deletedSamples.length < 60) {
      deletedSamples.push({
        id: r.id,
        topic: r.topic,
        storedCountry: r.country,
        foreignCountry,
        title: r.title.slice(0, 100),
      });
    }
  }

  if (commit && idsToDelete.length > 0) {
    // Chunk the delete to keep the IN-list reasonable.
    const chunkSize = 500;
    for (let i = 0; i < idsToDelete.length; i += chunkSize) {
      const chunk = idsToDelete.slice(i, i + chunkSize);
      await db.delete(incidentsTable).where(inArray(incidentsTable.id, chunk));
    }
  }

  const sortedCov = [...perForeignCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Cleanup totals ===");
  log(`  Scanned          : ${rows.length}`);
  log(`  ${commit ? "Deleted" : "Would delete"}         : ${idsToDelete.length}`);
  log("");
  log("=== Foreign-country coverage of removed rows ===");
  for (const [c, n] of sortedCov) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedCov.length === 0) log("  (none)");
  log("");
  log("=== Sample removed rows (up to 60) ===");
  for (const s of deletedSamples) {
    log(`  #${s.id} [${s.topic}] stored=${s.storedCountry} -> foreign=${s.foreignCountry} :: ${s.title}`);
  }
  if (!commit) log("\nDRY-RUN — no rows deleted. Re-run with --commit to delete.");

  return {
    mode: commit ? "commit" : "dry-run",
    topics,
    scanned: rows.length,
    deleted: idsToDelete.length,
    perForeignCountry: sortedCov,
    deletedSamples,
    logLines,
  };
}
