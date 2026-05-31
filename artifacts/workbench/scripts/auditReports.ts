/**
 * Multi-report noise audit. For each non-flashpoint report family, dump the
 * records that survive the shared relevance gate + window into the report, so a
 * human can eyeball that nothing embarrassing (keyword-but-not-operational
 * noise) leaks into the cards / prose / tables.
 *   cd artifacts/workbench && npx tsx scripts/auditReports.ts
 */
import { filterTopicReportIncidents, type TopicFastFactsIncident } from "../src/lib/topicFastFacts";

const API = process.env.API ?? "http://localhost:80";
const ISSUE = process.env.ISSUE ?? "2026-05-25";
const TOPICS = ["cargo_watch", "fuel", "fertiliser", "energy", "shipping"];

async function main() {
  const incidents = (await fetch(`${API}/api/incidents?limit=2000`).then((r) => r.json())) as TopicFastFactsIncident[];
  for (const topic of TOPICS) {
    const kept = filterTopicReportIncidents(incidents, topic, ISSUE);
    console.log(`\n==== ${topic.toUpperCase()} — ${kept.length} records in report window ====`);
    kept
      .slice()
      .sort((a: any, b: any) => (a.country ?? "").localeCompare(b.country ?? ""))
      .forEach((r: any, i: number) =>
        console.log(`${String(i + 1).padStart(2)}. [${r.country ?? "?"}] (${r.issue ?? r.severity ?? "?"}) ${r.title}`),
      );
  }
  console.log();
}

main();
