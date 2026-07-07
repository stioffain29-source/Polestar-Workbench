/**
 * CPI corruption/transparency SEED importer (offline, local-file, one-shot).
 *
 * Seeds the `corruption` and `transparency` dimensions of the per-country
 * data-centre risk framework from a LOCAL Transparency International CPI CSV,
 * via the INVERTED band map v1 (see `lib/cpiSeed.ts`). It is scoped to the
 * countries the workbench already tracks — every distinct facility country plus
 * every existing risk row — so it seeds relevant host countries only, never the
 * whole CPI table.
 *
 * STRICT no-fabrication:
 *  - a seeded dimension is ALWAYS `provisional` (amber badge) and cites its CPI
 *    year in `source` / `seededFrom`; the analyst clears the flag on review;
 *  - analyst-overridden or analyst-written dimensions are NEVER touched;
 *  - with no CPI file, nothing is seeded — the dimensions stay "not reported".
 *
 * It reads ONE local file only — it never fetches TI, scrapes, or hits the
 * network. It is NOT wired into the scheduler; run it by hand when a new CPI
 * edition is published.
 *
 * Usage (dry-run prints planned changes, writes nothing):
 *   pnpm --filter @workspace/scripts run import:cpi -- --file=attached_assets/cpi-2024.csv
 *   pnpm --filter @workspace/scripts run import:cpi -- --file=attached_assets/cpi-2024.csv --year=2024 --commit
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pool, db } from "@workspace/db";
import {
  dataCentreCountryRiskTable,
  dataCentreFacilitiesTable,
  type DataCentreRiskDimensions,
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";

import {
  buildSeededDimension,
  isCpiSeedable,
  parseCpiCsv,
} from "./lib/cpiSeed.js";

const SEED_KEYS = ["corruption", "transparency"] as const;

function argValue(prefix: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const commit = process.argv.slice(2).includes("--commit");
  const filePath =
    argValue("--file=") ??
    process.argv.slice(2).find((a) => !a.startsWith("-"));

  if (!filePath) {
    console.log(
      "No CPI source file provided (--file=<path>). Nothing seeded; corruption/transparency stay 'not reported'.",
    );
    await pool.end();
    return;
  }

  const abs = resolve(filePath);
  const text = readFileSync(abs, "utf8");
  const parsed = parseCpiCsv(text);
  const yearOverride = argValue("--year=");
  const year =
    yearOverride != null && yearOverride !== ""
      ? Number(yearOverride)
      : parsed.year;

  if (year == null || !Number.isFinite(year)) {
    console.error(
      "Could not determine the CPI year from the file header; pass --year=<YYYY>.",
    );
    await pool.end();
    process.exit(1);
  }
  if (parsed.rows.length === 0) {
    console.error(
      `No usable CPI rows parsed from ${abs} (need a country column and a score column).`,
    );
    await pool.end();
    process.exit(1);
  }

  // CPI rows keyed case-insensitively by country for exact-name matching.
  const cpiByCountry = new Map<string, number>();
  for (const r of parsed.rows) {
    cpiByCountry.set(r.country.trim().toLowerCase(), r.score);
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

  type Plan = {
    country: string;
    score: number;
    changed: (typeof SEED_KEYS)[number][];
    isNew: boolean;
  };
  const plans: Plan[] = [];
  const unmatched: string[] = [];

  for (const [lower, display] of universe) {
    const score = cpiByCountry.get(lower);
    if (score == null) {
      unmatched.push(display);
      continue;
    }
    const existing = riskByCountry.get(lower);
    const changed: (typeof SEED_KEYS)[number][] = [];
    for (const key of SEED_KEYS) {
      if (isCpiSeedable(existing?.dimensions?.[key])) changed.push(key);
    }
    if (changed.length > 0) {
      plans.push({ country: display, score, changed, isNew: !existing });
    }
  }

  plans.sort((a, b) => a.country.localeCompare(b.country));

  console.log(
    `CPI seed — year ${year}, band map v1, ${plans.length} country(ies) to seed` +
      ` (${universe.size} tracked, ${unmatched.length} unmatched in CPI).`,
  );
  for (const p of plans) {
    console.log(
      `  ${p.isNew ? "NEW " : "upd "}${p.country.padEnd(24)} CPI ${String(
        p.score,
      ).padStart(3)}  → ${p.changed.join(", ")}`,
    );
  }
  if (unmatched.length > 0) {
    console.log(
      `\n  Not in CPI file (stay 'not reported'): ${unmatched
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
  for (const p of plans) {
    const lower = p.country.toLowerCase();
    const existing = riskByCountry.get(lower);
    const nextDimensions: DataCentreRiskDimensions = {
      ...(existing?.dimensions ?? {}),
    };
    for (const key of p.changed) {
      nextDimensions[key] = buildSeededDimension(p.score, year);
    }
    if (existing) {
      await db
        .update(dataCentreCountryRiskTable)
        .set({ dimensions: nextDimensions, updatedAt: sql`now()` })
        .where(sql`${dataCentreCountryRiskTable.id} = ${existing.id}`);
    } else {
      await db.insert(dataCentreCountryRiskTable).values({
        country: p.country,
        dimensions: nextDimensions,
        createdBy: "CPI seed",
      });
    }
    written += 1;
  }
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
