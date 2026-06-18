import { db, incidentsTable } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { resolveFlashpointCountry } from "./flashpoint";

// One-time repair (inverse of flashpointMastheadRelocate): re-attribute stored
// flashpoint incidents that sit at country='Unknown' (or NULL) but now resolve to
// a real APAC country with the expanded gazetteer. The country resolver gained
// plural demonyms ("Malaysians", "Nepalis", "Indonesians", ...) that older rows
// pre-date, so a row whose ONLY country signal is such a demonym was stranded at
// Unknown. This re-runs the IDENTICAL masthead-stripped resolution
// (resolveFlashpointCountry) over every Unknown/NULL flashpoint row and, where it
// now resolves, RELOCATES the row to that country.
//
// Coordinates are intentionally left NULL — the resolver yields a country, not a
// point, and fabricating a centroid would be dishonest geo. Conservative by
// construction: a row that still resolves to null stays Unknown; an already
// attributed row is never touched (the WHERE only selects Unknown/NULL).

export type FlashpointUnknownReattributeSummary = {
  mode: "dry-run" | "commit";
  candidates: number;
  reattributed: number;
  toCountry: [string, number][];
  reattributedSamples: { id: number; to: string; title: string }[];
  logLines: string[];
};

export async function runFlashpointUnknownReattribute(
  opts: { commit?: boolean; limit?: number } = {},
): Promise<FlashpointUnknownReattributeSummary> {
  const commit = opts.commit ?? false;
  const limit = opts.limit ?? 20000;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const toCountry = new Map<string, number>();
  const reattributedSamples: FlashpointUnknownReattributeSummary["reattributedSamples"] = [];

  log(`Flashpoint Unknown re-attribute — mode=${commit ? "COMMIT" : "DRY-RUN"}, limit=${limit}`);

  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.topic, "flashpoint"),
        or(isNull(incidentsTable.country), eq(incidentsTable.country, "Unknown")),
      ),
    )
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Candidates (flashpoint, country IS NULL or 'Unknown'): ${rows.length}`);

  // Bucket the re-attributable ids by their derived country so each country is a
  // single batched UPDATE.
  const byCountry = new Map<string, number[]>();
  for (const r of rows) {
    const derived = resolveFlashpointCountry(r.title ?? "", r.summary ?? "");
    if (derived === null) continue;
    let ids = byCountry.get(derived);
    if (!ids) {
      ids = [];
      byCountry.set(derived, ids);
    }
    ids.push(r.id);
    toCountry.set(derived, (toCountry.get(derived) ?? 0) + 1);
    if (reattributedSamples.length < 30)
      reattributedSamples.push({ id: r.id, to: derived, title: (r.title ?? "").slice(0, 80) });
  }

  let reattributed = 0;
  if (commit) {
    for (const [country, ids] of byCountry) {
      if (ids.length === 0) continue;
      const res = await db
        .update(incidentsTable)
        .set({ country })
        // Re-assert Unknown/NULL so a row attributed between SELECT and UPDATE is
        // never clobbered.
        .where(
          and(
            inArray(incidentsTable.id, ids),
            or(isNull(incidentsTable.country), eq(incidentsTable.country, "Unknown")),
          ),
        );
      reattributed += res.rowCount ?? ids.length;
    }
  } else {
    reattributed = [...toCountry.values()].reduce((a, b) => a + b, 0);
  }

  const sortedTo = [...toCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Re-attribute totals ===");
  log(`  Candidates    : ${rows.length}`);
  log(`  Re-attributed : ${[...toCountry.values()].reduce((a, b) => a + b, 0)}`);
  log("");
  log("=== Re-attributed to country ===");
  for (const [c, n] of sortedTo) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedTo.length === 0) log("  (none)");
  if (!commit) log("\nDRY-RUN — no rows written. Re-run with --commit to update.");

  return {
    mode: commit ? "commit" : "dry-run",
    candidates: rows.length,
    reattributed,
    toCountry: sortedTo,
    reattributedSamples,
    logLines,
  };
}
