// TEMP diagnostic: run the SHARED cargo model over the live cargo rows exactly
// as the report editor/preview/PDF do, and print the reconciliation-relevant
// numbers (window size, deduped operational total, enforcement total, weekly
// range) plus the cluster groupings so under-merge / mis-attribution defects are
// visible. Delete after the cargo generator fixes are proven.
import { fetchTopicIncidents } from "./topicReportData";
import {
  buildCargoPatternModel,
  type CargoPatternModelInput,
} from "../src/lib/cargoPatternModel";
import { classifyScope, classifyRegion } from "../src/lib/cargoAnalysis";
import { filterTopicReportIncidents } from "../src/lib/topicFastFacts";

const ISSUE = process.env.ISSUE_DATE?.trim() || new Date().toISOString().slice(0, 10);

async function main() {
  const raw = (await fetchTopicIncidents()) as Array<Record<string, unknown>>;
  const cargo = raw.filter((i) => (i.topic ?? "cargo_watch") === "cargo_watch");
  const input: CargoPatternModelInput[] = cargo.map((i) => ({
    id: i.id as string,
    topic: i.topic as string,
    title: i.title as string,
    summary: (i.summary as string) ?? null,
    source: (i.source as string) ?? null,
    sourceUrl: (i.sourceUrl as string) ?? null,
    location: (i.location as string) ?? null,
    country: (i.country as string) ?? null,
    severity: (i.severity as string) ?? null,
    occurredAt: i.occurredAt as string,
  }));

  // Window as the report does, then show scope breakdown of the windowed set.
  const windowed = filterTopicReportIncidents(
    input.map((i) => ({ ...i, severity: i.severity ?? "" })) as never,
    "cargo_watch",
    ISSUE,
  ) as unknown as CargoPatternModelInput[];

  const scopeCounts: Record<string, number> = {};
  for (const i of windowed) {
    const s = classifyScope(
      { title: i.title, summary: i.summary ?? null, country: i.country ?? null },
      classifyRegion(i.country ?? null),
    );
    scopeCounts[s] = (scopeCounts[s] ?? 0) + 1;
  }

  const model = buildCargoPatternModel(input, { issueDate: ISSUE });
  console.log(`ISSUE_DATE=${ISSUE}`);
  console.log(`raw cargo rows: ${cargo.length}`);
  console.log(`windowed rows: ${windowed.length}`);
  console.log(`windowed scope breakdown:`, JSON.stringify(scopeCounts));
  console.log(`--- model ---`);
  console.log(`totalUnique (operational): ${model.totalUnique}`);
  console.log(`enforcement clusters: ${model.enforcement?.items?.length ?? "n/a"}`);
  const weeks = model.activity?.weeks ?? [];
  console.log(
    `weekly matrix weeks: ${weeks.length}` +
      (weeks.length
        ? ` [${weeks[0].key} .. ${weeks[weeks.length - 1].key}]`
        : ""),
  );
  console.log(`weeklyTotals: ${JSON.stringify(model.activity?.weeklyTotals ?? [])}`);
  console.log(`unconfirmedTotal: ${model.activity?.unconfirmedTotal ?? "n/a"}`);
  // Show multi-copy clusters (clusterSize > 1) — proof of dedup working — and
  // any suspiciously duplicated primaries that SHOULD have merged.
  const clusters = model.appendix ?? [];
  console.log(`appendix rows (deduped register): ${clusters.length}`);
  const july = clusters.filter((r) =>
    String((r as { date?: string }).date ?? "").startsWith("2026-07"),
  );
  console.log(`\n--- July appendix rows (${july.length}) ---`);
  for (const r of july as Array<Record<string, unknown>>) {
    console.log(
      `${String(r.date).slice(0, 10)} | ${r.country} | ${String(r.summary).slice(0, 85)}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
