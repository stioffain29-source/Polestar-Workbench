import pg from "pg";
import { classifyRegion, cargoCountry, classifyCategory, classifyScope } from "../../artifacts/workbench/src/lib/cargoAnalysis";
import { dedupeMonitorRows } from "../../artifacts/workbench/src/lib/monitorDedupe";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  `SELECT id, title, summary, source, country, location, occurred_at, severity, analyst_in_scope
     FROM incidents WHERE topic = 'cargo_watch'`,
);

const enrichedAll = rows.map((r) => {
  const i = {
    title: r.title as string,
    summary: r.summary as string | null,
    source: r.source as string | null,
    location: r.location as string | null,
    country: r.country as string | null,
    analystInScope: r.analyst_in_scope as boolean | null,
  };
  const rawRegion = classifyRegion(i.country);
  return {
    id: r.id as number,
    title: r.title as string,
    severity: r.severity as string,
    occurredAt: r.occurred_at as Date,
    displayCountry: cargoCountry(i),
    category: classifyCategory(i),
    scope: classifyScope(i, rawRegion),
  };
});

const deduped = dedupeMonitorRows(
  enrichedAll.map((i) => ({ ...i, date: new Date(i.occurredAt) })),
  (i) => (i.scope === "in_scope" ? 2 : i.scope === "country_review" ? 1 : 0),
);
const inScope = deduped.filter((i) => i.scope === "in_scope");

const mc = new Map<string, number>();
inScope.forEach((i) => {
  if (i.displayCountry == null) return;
  mc.set(i.displayCountry, (mc.get(i.displayCountry) ?? 0) + 1);
});
const byCountry = Array.from(mc.entries())
  .map(([country, count]) => ({ country, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 12);

const mk = new Map<string, number>();
inScope.forEach((i) => mk.set(i.category, (mk.get(i.category) ?? 0) + 1));
const byCategory = Array.from(mk.entries())
  .map(([category, count]) => ({ category, count }))
  .sort((a, b) => b.count - a.count);

console.log(
  JSON.stringify(
    {
      total: inScope.length,
      countriesCovered: new Set(inScope.map((i) => i.displayCountry).filter(Boolean)).size,
      byCountry,
      byCategory,
    },
    null,
    2,
  ),
);
await pool.end();
