import { db, incidentsTable } from "@workspace/db";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { extractPngItem, derivePngIncidentDate } from "./pngExtract";
import { extractWestPapuaItem, deriveWestPapuaIncidentDate } from "./westPapuaExtract";
import type { StructuredExtraction } from "./structuredExtract";

// Per-incident structured extraction over the incident rows attributed to a
// Papua theatre, so the country brief reads province / category /
// business_impact / incident_date STRAIGHT FROM THE API instead of re-deriving
// them client-side.
//
// Why this is needed: a Papua country brief aggregates EVERY topic tagged to its
// country (flashpoint, protests, conflict, cargo_watch, fuel, …), but only the
// flashpoint ingest populates the four columns inline (lib/ingest/src/
// flashpoint.ts via the extract + date helpers). Every other tagged row — and
// every flashpoint row ingested before those columns shipped — reads null and
// used to force the report onto an in-browser mirror rulebook. This pass
// re-applies the IDENTICAL extraction the ingest uses to ALL the theatre's rows
// so the report no longer recomputes.
//
// The extraction is a pure, deterministic function of the row's existing title /
// summary / location / occurredAt, so the pass is idempotent — re-running it
// produces the same values and never invents data. There is no analyst-editing
// surface for these derived columns, so the full pass rewrites them
// unconditionally (the `onlyNull` mode used by the live ingest fills just the
// unpopulated rows).

// Match any incident whose country tag includes Papua New Guinea (case-
// insensitive), mirroring the PNG brief's token match so the scope stays PNG.
// Compound tags like "West Papua; Papua New Guinea" are in scope here (and so
// are excluded from the West Papua scope below — one row carries a single
// enrichment set, and cross-border rows keep their PNG enrichment).
const PNG_COUNTRY_MATCH: SQL = sql`${incidentsTable.country} ILIKE '%papua new guinea%'`;

// Match Indonesian Papua rows: any country tag containing "papua" but NOT
// "papua new guinea". Only the Papua-group countries and PNG contain the
// substring "papua", so this can never leak onto a non-Papua country, and the
// NOT-PNG clause keeps cross-border rows on their PNG enrichment.
const WEST_PAPUA_COUNTRY_MATCH: SQL = sql`${incidentsTable.country} ILIKE '%papua%' AND ${incidentsTable.country} NOT ILIKE '%papua new guinea%'`;

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

type ExtractItemFn = (
  title: string,
  summary: string,
  location: string | null | undefined,
) => StructuredExtraction;
type DeriveDateFn = (text: string, pubDate: Date) => Date | null;

// Theatre-agnostic core backfill. The PNG and West Papua entry points below are
// thin wrappers that bind their own country scope + extractor.
async function runStructuredExtractBackfill(
  theatre: string,
  countryMatch: SQL,
  extractItem: ExtractItemFn,
  deriveDate: DeriveDateFn,
  opts: { commit?: boolean; limit?: number; onlyNull?: boolean },
): Promise<PngExtractBackfillSummary> {
  const commit = opts.commit ?? false;
  const limit = opts.limit ?? 10000;
  // onlyNull restricts the pass to rows that have not been extracted yet
  // (category null — category + business_impact are written as a pair). The
  // live-ingest enrichment uses this so it touches only newly-inserted rows and
  // converges; the one-time boot backfill leaves it off to refresh every row
  // against the current rulebook.
  const onlyNull = opts.onlyNull ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const perCategory = new Map<string, number>();
  const samples: PngExtractBackfillSummary["samples"] = [];

  log(
    `${theatre} extraction backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}, limit=${limit}, onlyNull=${onlyNull}`,
  );

  const selectWhere = onlyNull
    ? and(countryMatch, isNull(incidentsTable.category))
    : countryMatch;

  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      location: incidentsTable.location,
      occurredAt: incidentsTable.occurredAt,
    })
    .from(incidentsTable)
    .where(selectWhere)
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Candidates (${theatre}-tagged rows${onlyNull ? ", unextracted" : ""}): ${rows.length}`);

  let updated = 0;
  let provinceFilled = 0;
  let incidentDateFilled = 0;

  for (const r of rows) {
    const { province, category, businessImpact } = extractItem(
      r.title,
      r.summary,
      r.location,
    );
    const incidentDate = deriveDate(`${r.title} ${r.summary}`, r.occurredAt);

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
      // Re-assert the country scope (and the onlyNull guard) in the WHERE so a
      // row whose country changed between SELECT and UPDATE is left untouched
      // (the extraction is only valid for the theatre's rows).
      const updateWhere = onlyNull
        ? and(eq(incidentsTable.id, r.id), countryMatch, isNull(incidentsTable.category))
        : and(eq(incidentsTable.id, r.id), countryMatch);
      await db
        .update(incidentsTable)
        .set({ province, category, businessImpact, incidentDate })
        .where(updateWhere);
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

export async function runPngExtractBackfill(
  opts: { commit?: boolean; limit?: number; onlyNull?: boolean } = {},
): Promise<PngExtractBackfillSummary> {
  return runStructuredExtractBackfill(
    "PNG",
    PNG_COUNTRY_MATCH,
    extractPngItem,
    derivePngIncidentDate,
    opts,
  );
}

export async function runWestPapuaExtractBackfill(
  opts: { commit?: boolean; limit?: number; onlyNull?: boolean } = {},
): Promise<PngExtractBackfillSummary> {
  return runStructuredExtractBackfill(
    "West Papua",
    WEST_PAPUA_COUNTRY_MATCH,
    extractWestPapuaItem,
    deriveWestPapuaIncidentDate,
    opts,
  );
}
