import { db, incidentsTable } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { resolveFlashpointCountry } from "./flashpoint";

// One-time repair: relocate flashpoint incidents whose stored country came ONLY
// from a leaked Google-News source masthead. The publisher name is appended to
// both the title (after " - ") and the summary, so a publisher city ("The Manila
// Times" -> Manila) became the sole country signal of an out-of-region story
// that named no real location — e.g. an overseas "G7 protest turns from carnival
// to violent stand-off". Such rows were mis-stamped to the publisher's APAC
// country and could crown it the highest-severity country.
//
// The ingest now strips the masthead before country resolution
// (resolveFlashpointCountry) and drops these rows. This re-runs the IDENTICAL
// masthead-stripped resolution over every already-stored flashpoint row; where
// it now resolves to null (the masthead was the SOLE country signal), the row is
// RELOCATED to country='Unknown' with its coordinates nulled — non-destructive,
// and durable across relevance backfills (which never touch the country column).
//
// Conservative by construction: a row whose city/country sits in the actual
// content still resolves (non-null) and is left untouched; only the pure
// masthead-leak rows move.

export type FlashpointMastheadRelocateSummary = {
  mode: "dry-run" | "commit";
  candidates: number;
  relocated: number;
  fromCountry: [string, number][];
  relocatedSamples: { id: number; from: string; title: string }[];
  logLines: string[];
};

export async function runFlashpointMastheadRelocate(
  opts: { commit?: boolean; limit?: number } = {},
): Promise<FlashpointMastheadRelocateSummary> {
  const commit = opts.commit ?? false;
  const limit = opts.limit ?? 20000;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const fromCountry = new Map<string, number>();
  const relocatedSamples: FlashpointMastheadRelocateSummary["relocatedSamples"] = [];

  log(`Flashpoint masthead relocate — mode=${commit ? "COMMIT" : "DRY-RUN"}, limit=${limit}`);

  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.topic, "flashpoint"),
        ne(incidentsTable.country, "Unknown"),
      ),
    )
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Candidates (flashpoint, country<>'Unknown'): ${rows.length}`);

  const toRelocate: number[] = [];
  for (const r of rows) {
    if (!r.country) continue;
    const derived = resolveFlashpointCountry(r.title ?? "", r.summary ?? "");
    if (derived !== null) continue;
    toRelocate.push(r.id);
    fromCountry.set(r.country, (fromCountry.get(r.country) ?? 0) + 1);
    if (relocatedSamples.length < 30)
      relocatedSamples.push({ id: r.id, from: r.country, title: (r.title ?? "").slice(0, 80) });
  }

  let relocated = 0;
  if (commit && toRelocate.length > 0) {
    const res = await db
      .update(incidentsTable)
      .set({ country: "Unknown", latitude: null, longitude: null })
      // Re-assert country<>'Unknown' so a row attributed between SELECT and
      // UPDATE is never clobbered.
      .where(and(inArray(incidentsTable.id, toRelocate), ne(incidentsTable.country, "Unknown")));
    relocated = res.rowCount ?? toRelocate.length;
  } else {
    relocated = toRelocate.length;
  }

  const sortedFrom = [...fromCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Relocate totals ===");
  log(`  Candidates : ${rows.length}`);
  log(`  Relocated  : ${toRelocate.length}`);
  log("");
  log("=== Relocated from country ===");
  for (const [c, n] of sortedFrom) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedFrom.length === 0) log("  (none)");
  if (!commit) log("\nDRY-RUN — no rows written. Re-run with --commit to update.");

  return {
    mode: commit ? "commit" : "dry-run",
    candidates: rows.length,
    relocated,
    fromCountry: sortedFrom,
    relocatedSamples,
    logLines,
  };
}
