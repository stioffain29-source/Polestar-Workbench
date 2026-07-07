import {
  runPeeringDbFacilityRegistryImport,
  PEERINGDB_DC_COUNTRIES,
  type PeeringDbCountryResult,
} from "@workspace/ingest";
import { pool } from "@workspace/db";

/**
 * PeeringDB → Data Centre facility REGISTRY importer (supervised CLI).
 *
 * Populates the analyst-maintained `data_centre_facilities` table from the
 * public PeeringDB facility API (https://www.peeringdb.com/api/fac — free, no
 * key). All logic lives in @workspace/ingest
 * (runPeeringDbFacilityRegistryImport); this is a thin CLI wrapper that prints a
 * dry-run preview and closes the pool. PeeringDB is the SECOND source into the
 * same registry, alongside the OpenStreetMap importer (import-osm-data-centres).
 *
 * STRICT no-fabrication: only facilities with a real name AND coordinates are
 * imported; operator/capacity/status/risk are NEVER guessed (blank reads "not
 * reported"). The canonical PeeringDB URL is stored on each row for provenance
 * and as the idempotency marker, so re-runs never duplicate.
 *
 * This is DELIBERATELY manual (dry-run → review → commit, country by country) —
 * it is NOT wired into the api-server scheduler and never touches incidents.
 *
 * Usage:
 *   # dry-run everything (default — writes nothing):
 *   pnpm --filter @workspace/scripts run import:peeringdb-data-centres
 *   # dry-run one country (Singapore first):
 *   pnpm --filter @workspace/scripts run import:peeringdb-data-centres -- --country=SG
 *   # commit one country after reviewing the dry-run:
 *   pnpm --filter @workspace/scripts run import:peeringdb-data-centres -- --country=SG --commit
 *   # scope to several / cap for sampling:
 *   pnpm --filter @workspace/scripts run import:peeringdb-data-centres -- --country=SG,MY --limit=20
 */

function argValue(prefix: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
}

function printPreview(r: PeeringDbCountryResult): void {
  if (r.preview.length === 0) return;
  console.log(`\n  ${r.iso} ${r.country} — ${r.preview.length} new facility(ies) to add:`);
  const rows = r.preview.map((f) => ({
    name: truncate(f.name, 40),
    city: truncate(f.city ?? "not reported", 20),
    coords: `${f.latitude.toFixed(4)},${f.longitude.toFixed(4)}`,
    operator: truncate(f.operator ?? "not reported", 26),
    source: f.sourceUrl,
  }));
  const w = {
    name: Math.max(4, ...rows.map((x) => x.name.length)),
    city: Math.max(4, ...rows.map((x) => x.city.length)),
    coords: Math.max(6, ...rows.map((x) => x.coords.length)),
    operator: Math.max(8, ...rows.map((x) => x.operator.length)),
  };
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    `    ${pad("NAME", w.name)}  ${pad("CITY", w.city)}  ${pad("COORDS", w.coords)}  ${pad("OPERATOR", w.operator)}  SOURCE`,
  );
  for (const x of rows) {
    console.log(
      `    ${pad(x.name, w.name)}  ${pad(x.city, w.city)}  ${pad(x.coords, w.coords)}  ${pad(x.operator, w.operator)}  ${x.source}`,
    );
  }
}

async function main(): Promise<void> {
  const commit = process.argv.slice(2).includes("--commit");
  const countryRaw = argValue("--country=");
  const countries = countryRaw
    ? countryRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Fail loudly on a typo (e.g. --country=SGP) rather than silently importing
  // nothing — an unrecognised token would otherwise look like a successful no-op.
  if (countries) {
    const known = new Set(
      PEERINGDB_DC_COUNTRIES.flatMap((c) => [
        c.iso.toLowerCase(),
        c.country.toLowerCase(),
      ]),
    );
    const unknown = countries.filter((c) => !known.has(c.toLowerCase()));
    if (unknown.length > 0) {
      console.error(
        `Unrecognised --country value(s): ${unknown.join(", ")}\n` +
          `Valid: ${PEERINGDB_DC_COUNTRIES.map((c) => `${c.iso} (${c.country})`).join(", ")}`,
      );
      await pool.end();
      process.exit(1);
    }
  }
  const limitRaw = argValue("--limit=");
  const perCountryLimit =
    limitRaw != null && limitRaw !== "" && Number.isFinite(Number(limitRaw))
      ? Number(limitRaw)
      : undefined;

  const summary = await runPeeringDbFacilityRegistryImport({
    commit,
    countries,
    perCountryLimit,
  });

  console.log(summary.logLines.join("\n"));

  // Per-country dry-run preview tables (what WOULD be added).
  if (!commit) {
    for (const r of summary.countries) printPreview(r);
  }

  const failed = summary.countries.filter((c) => !c.fetchOk);
  if (failed.length > 0) {
    console.log(
      `\n${failed.length} country(ies) failed to fetch: ${failed.map((c) => c.iso).join(", ")}`,
    );
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
