/**
 * Export a topic-grouped incidents snapshot for offline relevance audits.
 *
 * Writes `scripts/.prod-incidents.json` consumed by auditLiveRelevance.ts.
 *
 * Usage (prod or dev):
 *   PROD_DATABASE_URL="..." pnpm --filter workbench exec tsx scripts/exportProdIncidentsSnapshot.ts
 *   DATABASE_URL="..."       pnpm --filter workbench exec tsx scripts/exportProdIncidentsSnapshot.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set PROD_DATABASE_URL or DATABASE_URL");
  process.exit(1);
}
process.env.DATABASE_URL ??= url;

const { desc, sql } = await import("drizzle-orm");
const { db, incidentsTable } = await import("@workspace/db");

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, ".prod-incidents.json");

interface SnapshotRow {
  id: number;
  topic: string;
  title: string;
  summary: string | null;
  country: string | null;
  location: string | null;
  source: string | null;
  source_url: string | null;
  occurred_at: string | null;
  severity: string | null;
  display_title: string | null;
  relevance_status: string | null;
}

async function main() {
  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
      location: incidentsTable.location,
      source: incidentsTable.source,
      source_url: incidentsTable.sourceUrl,
      occurred_at: sql<string | null>`to_char(${incidentsTable.occurredAt}, 'YYYY-MM-DD"T"HH24:MI:SSOF')`,
      severity: incidentsTable.severity,
      display_title: incidentsTable.displayTitle,
      relevance_status: incidentsTable.relevanceStatus,
    })
    .from(incidentsTable)
    .where(sql`${incidentsTable.occurredAt} >= now() - interval '180 days'`)
    .orderBy(desc(incidentsTable.occurredAt));

  const byTopic: Record<string, SnapshotRow[]> = {};
  for (const r of rows) {
    const bucket = byTopic[r.topic] ?? [];
    bucket.push(r);
    byTopic[r.topic] = bucket;
  }

  writeFileSync(outPath, JSON.stringify(byTopic, null, 2));
  console.log(`Wrote ${rows.length} incidents across ${Object.keys(byTopic).length} topics → ${outPath}`);
  for (const [topic, list] of Object.entries(byTopic).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${topic.padEnd(16)} ${list.length}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
