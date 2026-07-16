// Proof harness for the foreign-geography leak fix.
//
// The fix is precision-first: keep the existing BLOCKLIST guards and add the two
// missing foreign places (Toronto -> INDO_FOREIGN_SUBJECT_RE; Okinawa ->
// FOREIGN_SUBJECT_RE). An earlier allowlist attempt ("require a home anchor")
// was measured HERE to drop ~half of every country's genuine local rows, so it
// was discarded. This harness runs the REAL headless country filter
// (loadIncidents + filterForCountry, the exact mirror of CountryReport.tsx) over
// live Postgres rows and reports:
//   1. Fate of the confirmed leak rows (8 Toronto -> Indonesia; 1 Okinawa ->
//      Philippines): each must now be absent from the kept set.
//   2. Collateral: per country, pool size vs kept size, so the fix is shown to
//      remove only the leaks and NOT gut the report.
//
// Run: cd artifacts/workbench && \
//   npx tsx --import ./scripts/registerLoader.mjs scripts/proveGeoGuard.ts
import { loadIncidents, filterForCountry } from "./countryReportData";
import {
  incidentMatchesCountry,
  isForeignSubjectForIndonesia,
  isForeignSubjectNoHomeAnchor,
} from "../src/lib/countryMatch";

const TORONTO_IDS = new Set([
  "33560",
  "32590",
  "32880",
  "32592",
  "32594",
  "32883",
  "32876",
  "32879",
]);

function en(i: { ln?: string | null; displayTitle?: string | null; title: string | null }) {
  return `${i.ln ?? i.displayTitle ?? ""} ${i.title ?? ""}`;
}

async function main() {
  const all = await loadIncidents();

  const keptIndo = new Set(filterForCountry(all, "Indonesia").map((r) => String(r.id)));
  const keptPh = new Set(filterForCountry(all, "Philippines").map((r) => String(r.id)));

  console.log("================= TARGET LEAK ROWS (must all DROP) =================\n");

  console.log("--- Indonesia brief: 8 Toronto rows filed country=Indonesia ---");
  let indoAllGone = true;
  for (const i of all) {
    if (!TORONTO_IDS.has(String(i.id))) continue;
    const dominanceDrops = isForeignSubjectForIndonesia(en(i));
    const survives = keptIndo.has(String(i.id));
    if (survives) indoAllGone = false;
    console.log(
      `  id ${i.id} | loc=${i.location ?? "∅"} | "${(i.title ?? "").slice(0, 58)}"`,
    );
    console.log(
      `      dominance guard drops? ${dominanceDrops ? "YES" : "no"} | in kept set? ${survives ? "YES ❌" : "NO ✅"}`,
    );
  }

  console.log("\n--- Philippines brief: Okinawa typhoon row ---");
  let okinawaGone = true;
  for (const i of all) {
    if (String(i.id) !== "32389") continue;
    const blockDrops = isForeignSubjectNoHomeAnchor(
      i.title,
      i.displayTitle ?? null,
      i.location,
      "Philippines",
    );
    const survives = keptPh.has(String(i.id));
    okinawaGone = !survives;
    console.log(`  id ${i.id} | loc=${i.location ?? "∅"} | "${i.title}"`);
    console.log(
      `      blocklist guard drops? ${blockDrops ? "YES" : "no"} | in kept set? ${survives ? "YES ❌" : "NO ✅"}`,
    );
  }

  console.log("\n================= COLLATERAL (report must NOT be gutted) =================");
  for (const name of ["Indonesia", "Philippines", "Thailand"]) {
    const pool = all.filter((i) => incidentMatchesCountry(i.country, name));
    const kept = filterForCountry(all, name);
    const dropped = pool.length - kept.filter((k) => incidentMatchesCountry(k.country, name)).length;
    const pct = pool.length ? ((dropped / pool.length) * 100).toFixed(1) : "0";
    console.log(
      `\n${name}: pool(country-matched 90d)=${pool.length} | kept by full filter=${kept.length} | net dropped from pool=${dropped} (${pct}%)`,
    );
  }

  console.log(
    `\n================= VERDICT: ${indoAllGone && okinawaGone ? "ALL LEAKS DROPPED ✅" : "LEAK REMAINS ❌"} =================`,
  );
  process.exit(indoAllGone && okinawaGone ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
