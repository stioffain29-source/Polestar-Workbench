import { classifyScope, classifyRegion, cargoCountry } from "../src/lib/cargoAnalysis";
import { db, incidentsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
const ids = [33244, 13320, 13321, 34578, 11990];
const rows = await db.select().from(incidentsTable).where(inArray(incidentsTable.id, ids));
for (const r of rows) {
  const i = { title: r.title, summary: r.summary, country: r.country };
  console.log(`#${r.id} stored=${r.country} region=${classifyRegion(r.country)} scope=${classifyScope(i, classifyRegion(r.country))} cargoCountry=${cargoCountry(i)}`);
  console.log(`   ${r.title.slice(0,90)}`);
}
process.exit(0);
