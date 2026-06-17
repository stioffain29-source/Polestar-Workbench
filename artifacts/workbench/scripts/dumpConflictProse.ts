/**
 * Dump the EXACT rendered Conflict Watch prose (all sections) for a report, so
 * the auto-prose can be reviewed as the reader sees it.
 *   cd artifacts/workbench && ISSUE=2026-06-16 npx tsx scripts/dumpConflictProse.ts
 */
import {
  buildConflictReportDataset,
  type ConflictReportIncident,
} from "../src/lib/conflictReportDataset";

const API = process.env.API ?? "http://localhost:80";
const ISSUE = process.env.ISSUE ?? "2026-06-16";
const TOPIC = "conflict";

async function main() {
  const raw = (await fetch(`${API}/api/incidents?limit=3000`).then((r) =>
    r.json(),
  )) as any[];
  const incidents: ConflictReportIncident[] = raw
    .filter((i) => i.topic === TOPIC)
    .map((i) => ({
      id: i.id,
      title: i.title,
      topic: i.topic,
      severity: i.severity,
      occurredAt: i.occurredAt ?? i.occurred_at,
      country: i.country ?? null,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? i.source_url ?? null,
      location: i.location ?? null,
      displayTitle: i.displayTitle ?? i.display_title ?? null,
    }));

  const ds = buildConflictReportDataset(incidents, TOPIC, ISSUE);

  const rule = (s: string) => console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`);
  console.log(ds.reportingPeriodLong);
  console.log(`Worst severity: ${ds.worstSeverityLabel}`);

  rule("SITUATION");
  console.log(ds.autoSituation);

  rule("TOP ACTIVITY AREAS");
  ds.topActivityAreas.forEach((a, i) => {
    console.log(
      `\n[${i + 1}] ${a.theatre} — worst ${a.worstSeverityLabel}, incidents ${a.incidentCount}, highImpact ${a.highImpactCount}, casualtySignal ${a.casualtySignalCount}, pulledIn=${a.pulledInFromLookback}`,
    );
    console.log(a.paragraph);
  });

  rule("OTHER WATCHED THEATRES (prose)");
  console.log(ds.autoOtherWatched);

  rule("WHAT MATTERS");
  console.log(ds.autoWhatMatters);

  rule("WATCH NEXT");
  console.log(ds.autoWatchNext);

  rule("POLESTAR VIEW");
  console.log(ds.autoPolestarView);

  rule("RELATED INCIDENTS (table rows)");
  ds.relatedIncidents.forEach((r, i) =>
    console.log(
      `${String(i + 1).padStart(2)}. [${r.country ?? "?"}] (${r.severity}) ${r.displayTitle ?? r.title}`,
    ),
  );
}

main();
