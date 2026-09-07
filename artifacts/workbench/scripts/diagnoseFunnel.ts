// Funnel diagnostic for a single Flashpoint/Protests report window.
//
// Loads incidents via flashpointIncidentLoader (snapshot or live API) and runs
// the REAL selectFlashpointUsable pipeline, then prints, per filter stage, how
// many records and which countries are dropped. Run with:
//   USE_SNAPSHOT=1 ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts

import {
  selectFlashpointUsable,
  type FlashpointRejectStage,
} from "../src/lib/flashpointReportDataset";
import { loadFlashpointIncidents } from "./flashpointIncidentLoader";

const issueDate = process.env.ISSUE ?? process.argv[2] ?? "2026-05-24";

function dist(items: { country: string }[]): string {
  const m = new Map<string, number>();
  for (const r of items) m.set(r.country, (m.get(r.country) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`)
    .join("  ");
}

async function main() {
  const { incidents, source, meta } = await loadFlashpointIncidents();
  const sel = selectFlashpointUsable(incidents, "flashpoint", issueDate);

  console.log("#".repeat(80));
  console.log(`FLASHPOINT FUNNEL — issueDate=${issueDate}  (window = issueDate + 6 prior days)`);
  console.log(
    `  source: ${source}${meta.path ? ` (${meta.path})` : meta.apiBase ? ` (${meta.apiBase})` : ""}`,
  );
  console.log(
    `  source pool: flashpoint=${meta.flashpointCount} protests=${meta.protestsCount}`,
  );
  console.log("#".repeat(80));
  console.log(`raw window (in-window, flashpoint+protests bucket): ${sel.rawWindowCount}`);

  const stages: FlashpointRejectStage[] = [
    "off-topic",
    "kinetic-only",
    "court-only",
    "out-of-scope-crime",
    "duplicate",
    "weak-novelty",
    "weak-operational",
  ];
  for (const stage of stages) {
    const dropped = sel.rejected.filter((r) => r.stage === stage);
    console.log("");
    console.log(`STAGE DROP [${stage}] = ${dropped.length}`);
    if (dropped.length) console.log(`   countries: ${dist(dropped)}`);
  }

  console.log("");
  console.log("=".repeat(80));
  console.log(`FINAL REPORT SET = ${sel.enriched.length}`);
  console.log(`   countries: ${dist(sel.enriched.map((e) => ({ country: e.country ?? "—" })))}`);
  console.log("=".repeat(80));

  for (const focus of ["Pakistan", "South Korea", "India", "China", "Nepal", "Bangladesh", "Philippines", "Japan"]) {
    const drops = sel.rejected.filter((r) => r.country === focus);
    const inFinal = sel.enriched.filter((e) => (e.country ?? "") === focus).length;
    if (inFinal === 0 && drops.length === 0) continue;
    console.log("");
    console.log(`--- ${focus}: ${inFinal} in final, ${drops.length} dropped ---`);
    const byStage = new Map<string, number>();
    for (const d of drops) byStage.set(d.stage, (byStage.get(d.stage) ?? 0) + 1);
    for (const [s, n] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(3)}  ${s}`);
    }
    for (const d of drops.slice(0, 8)) {
      console.log(`     [${d.stage}] ${d.date}  ${d.title}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
