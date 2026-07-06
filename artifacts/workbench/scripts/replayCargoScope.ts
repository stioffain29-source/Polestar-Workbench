import { readFileSync, writeFileSync } from "node:fs";
import { classifyScope, classifyRegion } from "../src/lib/cargoAnalysis";

type Row = {
  id: number;
  country: string | null;
  relevance_status: string | null;
  title: string;
  display_title: string | null;
  summary: string | null;
};

const rowsPath = process.argv[2] ?? ".local/cargo_rows.json";
const outPath = process.argv[3] ?? ".local/cargo_scope.json";
const rows: Row[] = JSON.parse(readFileSync(rowsPath, "utf8"));

const result: Record<number, string> = {};
for (const r of rows) {
  const i = {
    title: r.title,
    summary: r.summary ?? "",
    country: r.country,
  } as never;
  result[r.id] = classifyScope(i, classifyRegion(r.country));
}
writeFileSync(outPath, JSON.stringify(result, null, 0));

const tally: Record<string, number> = {};
for (const s of Object.values(result)) tally[s] = (tally[s] ?? 0) + 1;
console.log("rows:", rows.length, "tally:", JSON.stringify(tally));
