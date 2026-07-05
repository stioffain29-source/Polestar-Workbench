import { db, incidentsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { geocode } from "./geocode";
import { detectCountry, stripSourceMasthead } from "./newsTopic";
import { GLOBAL_EXTRA_ALIASES, GLOBAL_TOPIC_ALIASES } from "./topicConfigs";

// One-time re-attribution for the GLOBAL commodity topics (energy / fuel /
// fertiliser). These three monitors were opened up to out-of-region incidents:
// their ingest configs now resolve out-of-region countries via
// GLOBAL_TOPIC_ALIASES, and the energy relevance gate no longer geo-excludes
// them. But rows ALREADY stored before that change carry the WRONG country — a
// region feed blind-stamped its defaultCountry (e.g. a Spanish grid blackout
// tagged Myanmar, a Cuban island-wide blackout tagged Indonesia) because the
// old gazetteer recognised no country in the headline. Those rows sit on an
// in-region centroid, so once they become relevant they would shade the wrong
// country on the world map — a map/table parity break.
//
// This pass re-runs the SAME masthead-stripped detectCountry the ingest
// classifier uses, over GLOBAL_TOPIC_ALIASES (region-first), and re-stamps a
// row only when BOTH:
//   (a) the detected country differs from the stored one, AND
//   (b) EITHER the stored country is 'Unknown' (never resolved),
//       OR the detected country is one of the GLOBAL_EXTRA (out-of-region)
//       canonicals — i.e. an out-of-region country now recognised.
// Guard (b) deliberately never fires on an in-region -> in-region change: the
// region-first alias order means a headline naming any tracked in-region
// country still resolves to it, so this can only MOVE a row OUT of the region
// (fixing a mis-stamp), never reshuffle in-region attributions.
//
// On a re-stamp the country-centroid coordinates are OVERWRITTEN (the stored
// coords belonged to the wrong country), so the incident plots on the correct
// country. Idempotent: after a commit run detected === stored for every touched
// row, so a re-run is a no-op.

export type GlobalReattributionSummary = {
  mode: "dry-run" | "commit";
  topics: string[];
  scanned: number;
  restamped: number;
  fromUnknown: number;
  fromMisstamp: number;
  perCountry: [string, number][];
  restampSamples: { id: number; from: string; to: string; title: string }[];
  logLines: string[];
};

export async function runGlobalCountryReattribution(
  opts: { commit?: boolean; topics?: string[]; limit?: number } = {},
): Promise<GlobalReattributionSummary> {
  const commit = opts.commit ?? false;
  const topics = opts.topics ?? ["energy", "fuel", "fertiliser"];
  const limit = opts.limit ?? 20000;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const perCountry = new Map<string, number>();
  const restampSamples: GlobalReattributionSummary["restampSamples"] = [];

  // Canonicals that qualify a stored (already-attributed) row for a re-stamp —
  // the out-of-region set only. In-region canonicals are excluded so an
  // in-region -> in-region change can never fire.
  const globalExtra = new Set(GLOBAL_EXTRA_ALIASES.map((c) => c.canonical));

  log(
    `Global country re-attribution — mode=${commit ? "COMMIT" : "DRY-RUN"}, topics=[${topics.join(", ")}], limit=${limit}`,
  );

  const rows = await db
    .select({
      id: incidentsTable.id,
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

  let restamped = 0;
  let fromUnknown = 0;
  let fromMisstamp = 0;

  for (const r of rows) {
    const stored = r.country?.trim() ?? "";
    const rawHay = `${r.title}\n${r.summary ?? ""}`.toLowerCase();
    const geoHay = stripSourceMasthead(rawHay, r.source ?? "");
    const detected = detectCountry(geoHay, GLOBAL_TOPIC_ALIASES);
    if (!detected || detected === stored) continue;

    const isUnknown = stored === "" || stored === "Unknown";
    const isMisstamp = !isUnknown && globalExtra.has(detected);
    if (!isUnknown && !isMisstamp) continue;

    restamped++;
    if (isUnknown) fromUnknown++;
    else fromMisstamp++;
    perCountry.set(detected, (perCountry.get(detected) ?? 0) + 1);
    if (restampSamples.length < 40)
      restampSamples.push({
        id: r.id,
        from: stored || "Unknown",
        to: detected,
        title: r.title.slice(0, 80),
      });

    if (commit) {
      const set: Partial<typeof incidentsTable.$inferInsert> = { country: detected };
      // The stored coordinates belonged to the WRONG country, so overwrite with
      // the newly-detected country's best geocode (city-level if the text names
      // one, else the country centroid).
      const geo = geocode(detected, `${r.title} ${r.summary ?? ""}`);
      if (geo) {
        set.latitude = geo.latitude;
        set.longitude = geo.longitude;
        if (geo.location) set.location = geo.location;
      }
      // Re-assert the stored country in the WHERE so a row re-attributed between
      // SELECT and UPDATE (e.g. concurrent live ingest) is left untouched.
      await db
        .update(incidentsTable)
        .set(set)
        .where(and(eq(incidentsTable.id, r.id), eq(incidentsTable.country, r.country)));
    }
  }

  const sortedCov = [...perCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Re-attribution totals ===");
  log(`  Scanned          : ${rows.length}`);
  log(`  Re-stamped       : ${restamped}`);
  log(`    from Unknown   : ${fromUnknown}`);
  log(`    from mis-stamp : ${fromMisstamp}`);
  log("");
  log("=== Re-stamped country coverage ===");
  for (const [c, n] of sortedCov) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedCov.length === 0) log("  (none)");
  if (!commit) log("\nDRY-RUN — no rows written. Re-run with --commit to update.");

  return {
    mode: commit ? "commit" : "dry-run",
    topics,
    scanned: rows.length,
    restamped,
    fromUnknown,
    fromMisstamp,
    perCountry: sortedCov,
    restampSamples,
    logLines,
  };
}
