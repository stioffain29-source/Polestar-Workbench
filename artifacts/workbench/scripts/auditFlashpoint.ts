/**
 * Audit dump: prints the ACTUAL records that survive into the report and the
 * ACTUAL records that get dropped, straight from live data, so a human can
 * verify by eye that (a) nothing junk got in and (b) nothing real got out.
 *   cd artifacts/workbench && npx tsx scripts/auditFlashpoint.ts
 */
import {
  selectFlashpointUsable,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";
import { filterIncidentsToWindow } from "../src/lib/reportWindow";
import { isTopicRelevant } from "../src/lib/topicRelevance";

const API = process.env.API ?? "http://localhost:80";
const TOPIC = "protests";
const ISSUE = "2026-05-30";

async function main() {
  const incidents = (await fetch(`${API}/api/incidents?limit=500`).then((r) => r.json())) as FlashpointReportIncident[];

  // What the report keeps.
  const kept = selectFlashpointUsable(incidents, TOPIC, ISSUE).enriched;

  // The full candidate pool BEFORE the noise filter (in-window, on-topic,
  // merged flashpoint+protests buckets) so we can show what was removed.
  const candidates = filterIncidentsToWindow(incidents, TOPIC, ISSUE)
    .filter((i) => i.topic === "flashpoint" || i.topic === "protests")
    .filter((i) =>
      isTopicRelevant(TOPIC, {
        topic: i.topic, title: i.title, summary: i.summary ?? null,
        source: i.source ?? null, sourceUrl: i.sourceUrl ?? null, location: i.location ?? null,
      }),
    );
  const keptTitles = new Set(kept.map((r) => r.title));
  const dropped = candidates.filter((c) => !keptTitles.has(c.title));

  console.log(`\n==== KEPT: ${kept.length} records that appear in the report (every one should be a real protest/strike/unrest) ====`);
  kept
    .slice()
    .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? ""))
    .forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. [${r.country ?? "?"}] ${r.title}`));

  console.log(`\n==== DROPPED: ${dropped.length} records removed as noise/duplicate (every one should be NOT a live protest) ====`);
  dropped.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. [${r.country ?? "?"}] ${r.title}`));
  console.log();
}

main();
