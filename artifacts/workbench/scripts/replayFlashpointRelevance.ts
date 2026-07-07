// Repeatable Flashpoint/Protests relevance replay harness (Task #325).
//
// Purpose: keep non-protest noise out of the Flashpoint / Protests report as
// new phrasings appear. Runs the SHIPPED relevance gate (`explainRelevance`,
// the same function the report dataset, prose and PDF exporter all consume)
// over a snapshot of recent production `flashpoint` + `protests` rows and
// prints, per topic:
//   - total / KEEP / DROP counts
//   - a DROP-reason histogram (so the rejection logic is auditable)
//   - the surviving rows that still contain a known homonym marker, so a
//     reviewer can eyeball whether a NEW leak class has appeared.
//
// This is the triage loop for finding new leak classes. When a survivor is
// confirmed noise, add it as a concrete DROP fixture in
// __tests__/relevance/protestsFeedRelevance.test.ts and tighten the gate in
// lib/relevance/src/topicRelevance.ts.
//
// ---------------------------------------------------------------------------
// SNAPSHOT — the harness runs with NO manual export step out of the box: it
// falls back to a committed sample fixture (scripts/fixtures/protestsSample.csv)
// when neither REPLAY_CSV nor /tmp/prod.csv is present, so
//
//   cd artifacts/workbench && npx tsx scripts/replayFlashpointRelevance.ts
//
// works immediately. To triage against CURRENT production instead, refresh the
// snapshot with ONE command from the code-execution sandbox — run this query
// via executeSql(environment:"production") and write r.output to /tmp/prod.csv:
//
//   SELECT id, topic, title, summary, country, occurred_at
//   FROM incidents
//   WHERE topic IN ('flashpoint','protests')
//     AND occurred_at > now() - interval '90 days'
//   ORDER BY occurred_at DESC
//   LIMIT 800;
//
// (or point REPLAY_CSV=/path/to/rows.csv at any exported CSV). Snapshot
// resolution order: REPLAY_CSV → /tmp/prod.csv → committed sample fixture.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { explainRelevance, type RelevanceInput } from "../src/lib/topicRelevance";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_FIXTURE = join(HERE, "fixtures", "protestsSample.csv");

function resolveCsvPath(): string {
  if (process.env.REPLAY_CSV) return process.env.REPLAY_CSV;
  if (existsSync("/tmp/prod.csv")) return "/tmp/prod.csv";
  return SAMPLE_FIXTURE;
}

const CSV_PATH = resolveCsvPath();
if (CSV_PATH === SAMPLE_FIXTURE) {
  console.log(
    `[replay] no REPLAY_CSV / /tmp/prod.csv found — using committed sample fixture:\n         ${SAMPLE_FIXTURE}\n`,
  );
}

// Homonym markers whose presence in a KEPT row is worth a manual look — these
// are the word families that most often carry a non-protest sense.
const SURVIVOR_MARKERS: { label: string; re: RegExp }[] = [
  { label: "demonstration (tech/demo)", re: /\bdemonstration\b/i },
  { label: "fans (entertainment)", re: /\bfans?\b/i },
  { label: "investor/trader (markets)", re: /\b(investors?|traders?|shareholders?)\b/i },
  { label: "crackdown (regulatory)", re: /\bcrackdown\b/i },
  { label: "rally (market/sport)", re: /\brally\b/i },
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (c === "\r") {
      /* skip */
    } else cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
const header = rows[0];
const col = (n: string) => header.indexOf(n);
const data = rows.slice(1).filter((r) => r.some((c) => c.length));

interface Row {
  topic: string;
  title: string;
  summary: string;
  country: string;
}
const parsed: Row[] = data.map((r) => ({
  topic: r[col("topic")] ?? "",
  title: r[col("title")] ?? "",
  summary: r[col("summary")] ?? "",
  country: r[col("country")] ?? "",
}));

function toInput(r: Row): RelevanceInput {
  return { topic: r.topic, title: r.title, summary: r.summary, location: r.country };
}

let grandKeep = 0;
let grandDrop = 0;

for (const topic of ["flashpoint", "protests"] as const) {
  const topicRows = parsed.filter((r) => r.topic === topic);
  if (!topicRows.length) continue;
  const kept: Row[] = [];
  const reasonCounts = new Map<string, number>();
  let dropped = 0;
  for (const r of topicRows) {
    const { relevant, reason } = explainRelevance(topic, toInput(r));
    if (relevant) {
      kept.push(r);
    } else {
      dropped++;
      const key = reason.replace(/\(\/.*\/\)/, "(…pattern…)");
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  grandKeep += kept.length;
  grandDrop += dropped;

  console.log("=".repeat(78));
  console.log(
    `TOPIC ${topic}   total=${topicRows.length}  KEEP=${kept.length}  DROP=${dropped}`,
  );
  console.log("=".repeat(78));
  console.log("DROP REASON HISTOGRAM:");
  for (const [reason, n] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }

  console.log("\nSURVIVORS CARRYING A HOMONYM MARKER (review for NEW leak classes):");
  let flagged = 0;
  for (const m of SURVIVOR_MARKERS) {
    const hits = kept.filter((r) => m.re.test(r.title));
    if (!hits.length) continue;
    console.log(`  [${m.label}]  ${hits.length}`);
    for (const r of hits.slice(0, 8)) console.log(`      KEEP  ${r.title}`);
    flagged += hits.length;
  }
  if (!flagged) console.log("  (none)");
  console.log("");
}

console.log("#".repeat(78));
console.log(`GRAND TOTAL  KEEP=${grandKeep}  DROP=${grandDrop}  of ${grandKeep + grandDrop}`);
console.log("#".repeat(78));
