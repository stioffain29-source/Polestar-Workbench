import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { classifyScope, classifyRegion } from "../src/lib/cargoAnalysis";

const rowsPath = process.argv[2];
const mode = process.argv[3]; // "baseline" | "after"
const rows = JSON.parse(readFileSync(rowsPath, "utf8")) as Array<{
  id: number;
  title: string;
  summary: string | null;
  country: string | null;
}>;

const scopes = new Map<number, string>();
const counts: Record<string, number> = {};
for (const r of rows) {
  const i = { title: r.title, summary: r.summary, country: r.country };
  const scope = classifyScope(i, classifyRegion(i.country));
  scopes.set(r.id, scope);
  counts[scope] = (counts[scope] ?? 0) + 1;
}
console.log(`[${mode}] scope counts:`, JSON.stringify(counts));

const baselinePath = ".local/cargo_baseline.json";
if (mode === "baseline") {
  writeFileSync(baselinePath, JSON.stringify(Object.fromEntries(scopes)));
  console.log("wrote baseline");
} else if (mode === "after") {
  if (!existsSync(baselinePath)) {
    console.log("NO BASELINE — run baseline first");
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, string>;
  const changed: Array<{ id: number; from: string; to: string; title: string }> = [];
  for (const r of rows) {
    const from = base[String(r.id)];
    const to = scopes.get(r.id)!;
    if (from !== to) changed.push({ id: r.id, from, to, title: r.title });
  }
  console.log(`\n=== ${changed.length} rows changed scope ===`);
  for (const c of changed) {
    console.log(`#${c.id} ${c.from} -> ${c.to} :: ${c.title.slice(0, 120)}`);
  }
}
