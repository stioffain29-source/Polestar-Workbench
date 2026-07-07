/**
 * Generic OFFLINE risk-seed importer (local-file, one-shot, dry-run default).
 *
 * Seeds one or more dimensions of the per-country data-centre risk framework
 * from a LOCAL dataset file, via a source picked from the swappable registry
 * (`lib/riskSourceRegistry.ts`). It is scoped to the countries the workbench
 * already tracks — every distinct facility country plus every existing risk row
 * — so it seeds relevant host countries only, never the whole dataset.
 *
 * STRICT no-fabrication:
 *  - a seeded dimension is ALWAYS `provisional` (amber badge) and cites its
 *    source year in `source` / `seededFrom` / `sourceDate`; the analyst clears
 *    the flag on review;
 *  - LOCKED, overridden or analyst-written dimensions are NEVER touched;
 *  - a country missing from the dataset stays "not reported" (never guessed);
 *  - with no file, nothing is seeded.
 *
 * It reads ONE local file only — it never fetches, scrapes, or hits the network.
 * It is NOT wired into the scheduler; run it by hand when a new edition lands.
 *
 * Usage (dry-run prints planned changes, writes nothing):
 *   pnpm --filter @workspace/scripts run import:risk-seed -- --source=wgi-regquality --file=attached_assets/wgi-regquality-2023.csv --year=2023
 *   pnpm --filter @workspace/scripts run import:risk-seed -- --source=wgi-regquality --file=attached_assets/wgi-regquality-2023.csv --year=2023 --commit
 *   pnpm --filter @workspace/scripts run import:risk-seed            # lists available sources
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pool, db } from "@workspace/db";
import {
  dataCentreCountryRiskTable,
  dataCentreFacilitiesTable,
  type DataCentreRiskDimensions,
  type DataCentreRiskDimensionValue,
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";

import {
  buildSeededDimension,
  buildNoteDimension,
  isSeedable,
} from "./lib/riskSeed.js";
import {
  getRiskSource,
  listRiskSources,
  type RiskSourceEntry,
} from "./lib/riskSourceRegistry.js";

function argValue(prefix: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function printSources(): void {
  console.log("Available offline risk-seed sources (--source=<id>):");
  for (const s of listRiskSources()) {
    console.log(
      `  ${s.id.padEnd(22)} → ${s.dimensions.join(", ")}  [${s.confidence}]  ${s.scaleNote}`,
    );
  }
}

// Build the per-country seeded dimension for the resolved year.
function seedValue(
  source: RiskSourceEntry,
  raw: number | string,
  year: number,
): DataCentreRiskDimensionValue {
  if (source.kind === "note") {
    return buildNoteDimension({
      rationale: source.rationale(String(raw), year),
      source: source.sourceLabel(year),
      seededFrom: source.seededFromLabel(year),
      sourceDate: String(year),
      confidence: source.confidence,
    });
  }
  const value = Number(raw);
  return buildSeededDimension({
    rating: source.valueToRating(value),
    rationale: source.rationale(value, year),
    source: source.sourceLabel(year),
    seededFrom: source.seededFromLabel(year),
    sourceDate: String(year),
    confidence: source.confidence,
  });
}

async function main(): Promise<void> {
  const sourceId = argValue("--source=");
  if (!sourceId) {
    printSources();
    await pool.end();
    return;
  }
  const source = getRiskSource(sourceId);
  if (!source) {
    console.error(`Unknown source '${sourceId}'.`);
    printSources();
    await pool.end();
    process.exit(1);
  }

  const commit = process.argv.slice(2).includes("--commit");
  const filePath = argValue("--file=");
  if (!filePath) {
    console.log(
      `No source file provided (--file=<path>). Nothing seeded; ${source.dimensions.join(", ")} stay 'not reported'.`,
    );
    await pool.end();
    return;
  }

  const abs = resolve(filePath);
  const text = readFileSync(abs, "utf8");

  // Parse into a country → raw-value/note map, and resolve the edition year.
  const byCountry = new Map<string, number | string>();
  let parsedYear: number | null = null;
  if (source.kind === "note") {
    const parsed = source.parseNotes(text);
    for (const r of parsed.rows) {
      byCountry.set(r.country.trim().toLowerCase(), r.note);
    }
  } else {
    const parsed = source.parse(text);
    parsedYear = parsed.year;
    for (const r of parsed.rows) {
      byCountry.set(r.country.trim().toLowerCase(), r.value);
    }
  }

  const yearOverride = argValue("--year=");
  const year =
    yearOverride != null && yearOverride !== ""
      ? Number(yearOverride)
      : parsedYear;
  if (year == null || !Number.isFinite(year)) {
    console.error(
      "Could not determine the source year from the file; pass --year=<YYYY>.",
    );
    await pool.end();
    process.exit(1);
  }
  if (byCountry.size === 0) {
    console.error(
      `No usable rows parsed from ${abs} (need a country column and a ${source.kind === "note" ? "note" : "value"} column).`,
    );
    await pool.end();
    process.exit(1);
  }

  // Seed universe: distinct facility countries + existing risk rows.
  const facilityCountries = await db
    .selectDistinct({ country: dataCentreFacilitiesTable.country })
    .from(dataCentreFacilitiesTable);
  const existingRisks = await db.select().from(dataCentreCountryRiskTable);
  const riskByCountry = new Map(
    existingRisks.map((r) => [r.country.trim().toLowerCase(), r]),
  );

  const universe = new Map<string, string>(); // lower → display country
  for (const f of facilityCountries) {
    const c = (f.country ?? "").trim();
    if (c) universe.set(c.toLowerCase(), c);
  }
  for (const r of existingRisks) {
    const c = r.country.trim();
    if (c) universe.set(c.toLowerCase(), c);
  }

  type DataCentreRiskDimensionKey = (typeof source.dimensions)[number];
  type Plan = {
    country: string;
    raw: number | string;
    changed: DataCentreRiskDimensionKey[];
    isNew: boolean;
    seeded: DataCentreRiskDimensionValue;
  };
  const plans: Plan[] = [];
  const unmatched: string[] = [];

  for (const [lower, display] of universe) {
    const raw = byCountry.get(lower);
    if (raw == null) {
      unmatched.push(display);
      continue;
    }
    const existing = riskByCountry.get(lower);
    const changed: DataCentreRiskDimensionKey[] = [];
    for (const key of source.dimensions) {
      if (isSeedable(existing?.dimensions?.[key], source.seededFromPrefix)) {
        changed.push(key);
      }
    }
    if (changed.length > 0) {
      // Build (and thereby VALIDATE) the seeded value now, during planning, so a
      // dry-run surfaces an out-of-range dataset value BEFORE any write — the
      // dry-run then does exactly what --commit would (no partial commits).
      const seeded = seedValue(source, raw, year);
      plans.push({ country: display, raw, changed, isNew: !existing, seeded });
    }
  }

  plans.sort((a, b) => a.country.localeCompare(b.country));

  console.log(
    `${source.name} seed — year ${year}, band map v${source.bandMapVersion}, ` +
      `${plans.length} country(ies) to seed (${universe.size} tracked, ${unmatched.length} unmatched).`,
  );
  for (const p of plans) {
    console.log(
      `  ${p.isNew ? "NEW " : "upd "}${p.country.padEnd(24)} ${String(p.raw).padStart(6)}  → ${p.changed.join(", ")}`,
    );
  }
  if (unmatched.length > 0) {
    console.log(
      `\n  Not in dataset (stay 'not reported'): ${unmatched
        .sort((a, b) => a.localeCompare(b))
        .join(", ")}`,
    );
  }

  if (!commit) {
    console.log("\nDry run — pass --commit to write. Nothing changed.");
    await pool.end();
    return;
  }

  let written = 0;
  // One transaction so a mid-run failure rolls back rather than leaving a
  // partial seed (dry-run already validated every value above).
  await db.transaction(async (tx) => {
    for (const p of plans) {
      const lower = p.country.toLowerCase();
      const existing = riskByCountry.get(lower);
      const nextDimensions: DataCentreRiskDimensions = {
        ...(existing?.dimensions ?? {}),
      };
      for (const key of p.changed) {
        nextDimensions[key] = p.seeded;
      }
      if (existing) {
        await tx
          .update(dataCentreCountryRiskTable)
          .set({ dimensions: nextDimensions, updatedAt: sql`now()` })
          .where(sql`${dataCentreCountryRiskTable.id} = ${existing.id}`);
      } else {
        await tx.insert(dataCentreCountryRiskTable).values({
          country: p.country,
          dimensions: nextDimensions,
          createdBy: `${source.seededFromLabel(year)} seed`,
        });
      }
      written += 1;
    }
  });
  console.log(`\nCommitted — ${written} country risk row(s) seeded/updated.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
