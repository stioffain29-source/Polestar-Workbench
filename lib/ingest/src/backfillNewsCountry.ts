import { db, incidentsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { geocode } from "./geocode";
import { detectCountry } from "./newsTopic";
import { COUNTRY_ALIASES } from "./topicConfigs";

// One-time backfill: re-derive the country of news-topic incidents that the
// region feeds left at 'Unknown'. Those feeds search several countries at once
// and fall back to defaultCountry='Unknown' whenever the headline names no
// in-region COUNTRY word — even when it names a state, city, utility or
// regulator that unambiguously identifies the country (e.g. "K-Electric",
// "NEPRA", "Gazipur", "NEA", "Kerala"). The gazetteer (COUNTRY_ALIASES) now
// recognises those, so this pass runs the SAME detectCountry over each Unknown
// row's title+summary and fills the country (and country-centroid coordinates,
// only when the row has none) for any row that now resolves.
//
// Deliberately conservative: it ONLY touches rows whose stored country is
// 'Unknown', never overwriting an already-attributed row. Rows that still name
// no place stay 'Unknown' (rendered "—") — that is honest, not a defect.

export type NewsCountryBackfillSummary = {
  mode: "dry-run" | "commit";
  topics: string[];
  candidates: number;
  resolved: number;
  stillUnknown: number;
  perCountry: [string, number][];
  resolvedSamples: { id: number; country: string; title: string }[];
  logLines: string[];
};

export async function runNewsCountryBackfill(
  opts: { commit?: boolean; topics?: string[]; limit?: number } = {},
): Promise<NewsCountryBackfillSummary> {
  const commit = opts.commit ?? false;
  const topics = opts.topics ?? ["energy"];
  const limit = opts.limit ?? 5000;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const perCountry = new Map<string, number>();
  const resolvedSamples: NewsCountryBackfillSummary["resolvedSamples"] = [];

  log(
    `News-topic country backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}, topics=[${topics.join(", ")}], limit=${limit}`,
  );

  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      latitude: incidentsTable.latitude,
      longitude: incidentsTable.longitude,
    })
    .from(incidentsTable)
    .where(
      and(
        inArray(incidentsTable.topic, topics),
        eq(incidentsTable.country, "Unknown"),
      ),
    )
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Candidates (country='Unknown'): ${rows.length}`);

  let resolved = 0;
  for (const r of rows) {
    const hay = `${r.title}\n${r.summary ?? ""}`.toLowerCase();
    const country = detectCountry(hay, COUNTRY_ALIASES);
    if (!country) continue;

    resolved++;
    perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
    if (resolvedSamples.length < 30)
      resolvedSamples.push({ id: r.id, country, title: r.title.slice(0, 80) });

    if (commit) {
      const set: Partial<typeof incidentsTable.$inferInsert> = { country };
      // Only fill coordinates when the row has none — never overwrite a row that
      // already carries (potentially more precise) coordinates.
      if (r.latitude == null && r.longitude == null) {
        const geo = geocode(country, `${r.title} ${r.summary ?? ""}`);
        if (geo) {
          set.latitude = geo.latitude;
          set.longitude = geo.longitude;
          if (geo.location) set.location = geo.location;
        }
      }
      // Re-assert country='Unknown' in the WHERE so the Unknown-only invariant
      // is enforced at the DB boundary — a row attributed between SELECT and
      // UPDATE (e.g. if ever reused during live operation) is left untouched.
      await db
        .update(incidentsTable)
        .set(set)
        .where(and(eq(incidentsTable.id, r.id), eq(incidentsTable.country, "Unknown")));
    }
  }

  const sortedCov = [...perCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Backfill totals ===");
  log(`  Candidates       : ${rows.length}`);
  log(`  Resolved         : ${resolved}`);
  log(`  Still Unknown    : ${rows.length - resolved}`);
  log("");
  log("=== Resolved country coverage ===");
  for (const [c, n] of sortedCov) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedCov.length === 0) log("  (none)");
  if (!commit) log("\nDRY-RUN — no rows written. Re-run with --commit to update.");

  return {
    mode: commit ? "commit" : "dry-run",
    topics,
    candidates: rows.length,
    resolved,
    stillUnknown: rows.length - resolved,
    perCountry: sortedCov,
    resolvedSamples,
    logLines,
  };
}
