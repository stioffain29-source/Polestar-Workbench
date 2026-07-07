import { readFileSync } from "node:fs";
import {
  runDataCentreEnrichment,
  getProviderProfile,
  PROVIDER_PROFILES,
  COVERAGE_FIELDS,
  type ProviderProfile,
  type EnrichmentSummary,
} from "@workspace/ingest";
import { pool } from "@workspace/db";

/**
 * Provider-AGNOSTIC Data Centre ENRICHMENT importer (supervised CLI).
 *
 * ENRICHES existing `data_centre_facilities` rows (filled by the OSM / PeeringDB
 * importers) with the operational fields those free sources don't publish —
 * STATUS, FACILITY TYPE, CAPACITY (MW) and IT LOAD (MW) — from a THIRD-PARTY
 * provider EXPORT FILE. It is provider-agnostic: a provider is a
 * `ProviderProfile` (column map + status/type value maps) in @workspace/ingest;
 * a new provider = a new profile, never an engine change.
 *
 * OFFLINE / no-key by design (mirrors the TAPA offline importer): you evaluate a
 * SAMPLE export with NO API key. Dry-run prints a per-FIELD COVERAGE table (does
 * the sample actually carry these fields?) and a per-record DIFF (what WOULD
 * change) before any --commit.
 *
 * STRICT no-fabrication: a field is written ONLY where the source explicitly
 * states a value that maps to the fixed vocabulary (status/type) or parses as a
 * bare number (capacity). Operator names NEVER infer type. Each written field
 * stamps `enrichment_sources`; re-runs are idempotent no-ops.
 *
 * DELIBERATELY manual (dry-run -> review -> --commit); NOT wired into the
 * api-server scheduler and never touches incidents.
 *
 * Usage:
 *   # dry-run a sample with the GENERIC profile (canonical column headers):
 *   pnpm --filter @workspace/scripts run enrich:data-centres -- --file=attached_assets/sample.csv --provider=generic
 *   # dry-run one country scope:
 *   pnpm --filter @workspace/scripts run enrich:data-centres -- --file=... --provider=generic --country=Singapore
 *   # commit after reviewing the dry-run:
 *   pnpm --filter @workspace/scripts run enrich:data-centres -- --file=... --provider=generic --commit
 */

function argValue(prefix: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
}

function padTable(rows: string[][], headers: string[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join(
    "\n",
  );
}

function printCoverage(summary: EnrichmentSummary): void {
  console.log(`\nFIELD COVERAGE — ${summary.totalRecords} sample record(s):`);
  const rows = COVERAGE_FIELDS.map((field) => {
    const c = summary.coverage.find((x) => x.field === field)!;
    const unmap =
      field === "status" || field === "facilityType"
        ? c.unmappable > 0
          ? String(c.unmappable)
          : "-"
        : "";
    return [field, `${c.present}/${c.total}`, `${c.pct}%`, unmap];
  });
  console.log(padTable(rows, ["FIELD", "PRESENT", "%", "UNMAPPABLE"]));
}

function printDiffs(summary: EnrichmentSummary): void {
  if (summary.diffs.length === 0) {
    console.log("\nNo field changes proposed (already enriched or nothing usable).");
    return;
  }
  console.log(`\nPROPOSED CHANGES — ${summary.diffs.length}:`);
  const rows = summary.diffs.map((d) => [
    truncate(d.facilityName, 34),
    d.field,
    truncate(String(d.current ?? "not reported"), 22),
    truncate(String(d.proposed), 22),
    truncate(d.sourceRef ?? "-", 30),
  ]);
  console.log(padTable(rows, ["FACILITY", "FIELD", "CURRENT", "PROPOSED", "SOURCE"]));
}

function printUnmatched(summary: EnrichmentSummary): void {
  if (summary.unmatchedRecords.length > 0) {
    console.log(
      `\nUNMATCHED (in sample, not in registry) — ${summary.unmatchedRecords.length}:`,
    );
    for (const r of summary.unmatchedRecords.slice(0, 50)) {
      console.log(
        `  ${truncate(r.name, 40)}  ${r.country ?? "?"}${r.city ? ` / ${r.city}` : ""}`,
      );
    }
    if (summary.unmatchedRecords.length > 50) {
      console.log(`  \u2026 and ${summary.unmatchedRecords.length - 50} more`);
    }
  }
  if (summary.ambiguousRecords.length > 0) {
    console.log(`\nAMBIGUOUS (multiple registry candidates, skipped) — ${summary.ambiguousRecords.length}:`);
    for (const r of summary.ambiguousRecords.slice(0, 50)) {
      console.log(
        `  ${truncate(r.name, 40)}  ${r.country ?? "?"}  -> ids ${r.candidateIds.join(", ")}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const filePath = argValue("--file=");
  const providerToken = argValue("--provider=") ?? "generic";
  const commit = process.argv.slice(2).includes("--commit");
  const countryRaw = argValue("--country=");
  const countries = countryRaw
    ? countryRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  if (!filePath) {
    console.error(
      "Missing --file=<path>. Point it at a provider sample export (CSV/JSON).",
    );
    await pool.end();
    process.exit(1);
  }

  const profile: ProviderProfile | undefined = getProviderProfile(providerToken);
  if (!profile) {
    console.error(
      `Unknown --provider=${providerToken}. Known: ${Object.keys(PROVIDER_PROFILES).join(", ")}`,
    );
    await pool.end();
    process.exit(1);
  }

  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Could not read --file=${filePath}: ${(err as Error).message}`);
    await pool.end();
    process.exit(1);
  }

  const summary = await runDataCentreEnrichment({
    profile,
    fileContent,
    commit,
    countries,
  });

  console.log(summary.logLines.join("\n"));
  printCoverage(summary);
  if (!commit) {
    printDiffs(summary);
    printUnmatched(summary);
    console.log("\nDRY-RUN only — re-run with --commit to write these changes.");
  }

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
