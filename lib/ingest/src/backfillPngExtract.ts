import { db, incidentsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { extractPngItem, derivePngIncidentDate } from "./pngExtract";

// One-time backfill: re-run the canonical PNG per-incident extraction over the
// flashpoint rows attributed to Papua New Guinea so the PNG country brief reads
// province / category / business_impact / incident_date straight from the API
// instead of re-deriving them client-side.
//
// Why this is needed: the four PNG columns are populated at INGEST
// (lib/ingest/src/flashpoint.ts via extractPngItem + derivePngIncidentDate), so
// only rows ingested AFTER those columns shipped carry them. Every PNG row
// ingested earlier — in both dev and prod — reads null and forces the report
// onto its client-side mirror rulebook. This pass re-applies the IDENTICAL
// extraction the ingest now uses to those historical rows.
//
// Scope: ONLY flashpoint rows whose stored country is one of the PNG country
// tags ("Papua New Guinea" or the cross-border "West Papua; Papua New Guinea"),
// mirroring the ingest's isPng gate so the broadened PNG scope never leaks into
// other countries. The extraction is a pure, deterministic function of the
// row's existing title / summary / location / occurredAt, so the pass is
// idempotent — re-running it produces the same values and never invents data.
// There is no analyst-editing surface for these derived columns, so the pass
// rewrites them unconditionally (it does not protect a prior value the way the
// blank-only backfills do for analyst-owned fields).

// The PNG country tags the flashpoint ingest assigns (see resolvePapuaPng in
// flashpoint.ts). Keep in sync with the isPng gate there.
const PNG_COUNTRY_TAGS = ["Papua New Guinea", "West Papua; Papua New Guinea"];

export type PngExtractBackfillSummary = {
  mode: "dry-run" | "commit";
  candidates: number;
  updated: number;
  provinceFilled: number;
  incidentDateFilled: number;
  perCategory: [string, number][];
  samples: {
    id: number;
    province: string | null;
    category: string;
    incidentDate: string | null;
    title: string;
  }[];
  logLines: string[];
};

export async function runPngExtractBackfill(
  opts: { commit?: boolean; limit?: number } = {},
): Promise<PngExtractBackfillSummary> {
  const commit = opts.commit ?? false;
  const limit = opts.limit ?? 10000;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const perCategory = new Map<string, number>();
  const samples: PngExtractBackfillSummary["samples"] = [];

  log(
    `PNG extraction backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}, limit=${limit}`,
  );

  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      location: incidentsTable.location,
      occurredAt: incidentsTable.occurredAt,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.topic, "flashpoint"),
        inArray(incidentsTable.country, PNG_COUNTRY_TAGS),
      ),
    )
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Candidates (flashpoint PNG rows): ${rows.length}`);

  let updated = 0;
  let provinceFilled = 0;
  let incidentDateFilled = 0;

  for (const r of rows) {
    const { province, category, businessImpact } = extractPngItem(
      r.title,
      r.summary,
      r.location,
    );
    const incidentDate = derivePngIncidentDate(
      `${r.title} ${r.summary}`,
      r.occurredAt,
    );

    if (province) provinceFilled++;
    if (incidentDate) incidentDateFilled++;
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    if (samples.length < 30) {
      samples.push({
        id: r.id,
        province,
        category,
        incidentDate: incidentDate ? incidentDate.toISOString() : null,
        title: r.title.slice(0, 80),
      });
    }

    if (commit) {
      // Re-assert the PNG country scope in the WHERE so a row whose country
      // changed between SELECT and UPDATE is left untouched (the extraction is
      // only valid for PNG rows).
      await db
        .update(incidentsTable)
        .set({ province, category, businessImpact, incidentDate })
        .where(
          and(
            eq(incidentsTable.id, r.id),
            eq(incidentsTable.topic, "flashpoint"),
            inArray(incidentsTable.country, PNG_COUNTRY_TAGS),
          ),
        );
    }
    updated++;
  }

  const sortedCat = [...perCategory.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Backfill totals ===");
  log(`  Candidates           : ${rows.length}`);
  log(`  Rows extracted        : ${updated}`);
  log(`  Province resolved     : ${provinceFilled}`);
  log(`  Incident-date resolved: ${incidentDateFilled}`);
  log("");
  log("=== Category coverage ===");
  for (const [c, n] of sortedCat) log(`  ${c.padEnd(28)} ${n}`);
  if (sortedCat.length === 0) log("  (none)");
  if (!commit) log("\nDRY-RUN — no rows written. Re-run with --commit to update.");

  return {
    mode: commit ? "commit" : "dry-run",
    candidates: rows.length,
    updated,
    provinceFilled,
    incidentDateFilled,
    perCategory: sortedCat,
    samples,
    logLines,
  };
}
