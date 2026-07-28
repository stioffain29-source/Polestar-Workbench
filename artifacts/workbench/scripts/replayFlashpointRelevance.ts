// One-off replay: run the shared flashpoint relevance gate over the live
// report window rows and print verdict changes vs the persisted status.
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { explainRelevance } from "../../../lib/relevance/src/topicRelevance";

const days = Number(process.env.DAYS ?? 10);

async function main() {
  const res = await db.execute(sql`
    SELECT id, title, summary, source, source_url AS url, country, severity, relevance_status
      FROM incidents
     WHERE topic IN ('flashpoint','protests')
       AND occurred_at >= now() - (${String(days)} || ' days')::interval
     ORDER BY occurred_at DESC`);
  const rows = res.rows as Array<Record<string, string>>;
  let flips = 0;
  for (const r of rows) {
    const v = explainRelevance("flashpoint", {
      title: r.title, summary: r.summary, source: r.source, url: r.url,
    });
    const was = r.relevance_status !== "irrelevant";
    if (v.relevant !== was) {
      flips++;
      console.log(`${v.relevant ? "KEEP<-drop" : "DROP<-keep"} [${r.id}] ${r.title}`);
      console.log(`    reason: ${v.reason.slice(0, 150)}`);
    }
  }
  console.log(`\n${rows.length} rows scanned, ${flips} verdict flips.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
