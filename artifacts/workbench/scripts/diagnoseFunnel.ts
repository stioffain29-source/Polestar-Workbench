// Funnel diagnostic for a single Flashpoint/Protests report window.
//
// Fetches live incidents from the running API and runs the REAL
// selectFlashpointUsable pipeline, then prints, per filter stage, how many
// records and which countries are dropped. This pinpoints where in-scope
// countries are lost. Run with:
//   cd artifacts/workbench && npx tsx scripts/diagnoseFunnel.ts [issueDate]

import {
  selectFlashpointUsable,
  type FlashpointReportIncident,
  type FlashpointRejectStage,
} from "../src/lib/flashpointReportDataset";

const issueDate = process.argv[2] ?? "2026-05-24";
const API = process.env.API_BASE ?? "http://localhost:80";

interface ApiIncident {
  id: number;
  topic: string;
  title: string;
  summary: string | null;
  country: string | null;
  location: string | null;
  source: string | null;
  sourceUrl: string | null;
  occurredAt: string | null;
  severity: string | null;
}

async function fetchAll(topic: string): Promise<ApiIncident[]> {
  const res = await fetch(`${API}/api/incidents?topic=${topic}&limit=5000`);
  if (!res.ok) throw new Error(`fetch ${topic} -> ${res.status}`);
  return (await res.json()) as ApiIncident[];
}

function dist(items: { country: string }[]): string {
  const m = new Map<string, number>();
  for (const r of items) m.set(r.country, (m.get(r.country) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`)
    .join("  ");
}

async function main() {
  const [flashpoint, protests] = await Promise.all([
    fetchAll("flashpoint"),
    fetchAll("protests"),
  ]);
  const merged = [...flashpoint, ...protests];
  const asInput: FlashpointReportIncident[] = merged.map((r) => ({
    id: r.id,
    title: r.title,
    topic: r.topic,
    severity: r.severity ?? "Low",
    occurredAt: r.occurredAt ?? "",
    country: r.country,
    summary: r.summary,
    source: r.source,
    sourceUrl: r.sourceUrl,
    location: r.location ?? r.country,
  }));

  const sel = selectFlashpointUsable(asInput, "flashpoint", issueDate);

  console.log("#".repeat(80));
  console.log(`FLASHPOINT FUNNEL — issueDate=${issueDate}  (window = issueDate + 6 prior days)`);
  console.log(`  source pool: flashpoint=${flashpoint.length} protests=${protests.length}`);
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

  // Focus: where do Pakistan and South Korea die?
  for (const focus of ["Pakistan", "South Korea", "India", "China"]) {
    const drops = sel.rejected.filter((r) => r.country === focus);
    const inFinal = sel.enriched.filter((e) => (e.country ?? "") === focus).length;
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
