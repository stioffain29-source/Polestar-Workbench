// Dump the corrected flashpoint report dataset (fast facts, country rows,
// generated reads) exactly as the preview/PDF would build it, reading
// incidents directly from Postgres via the headless loader.
import { fetchTopicIncidents } from "./topicReportData";
import {
  buildFlashpointReportDataset,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";
import { clampIssueDateToLatestRecord } from "../src/lib/reportWindow";

async function main() {
  const raw = (await fetchTopicIncidents()) as any[];
  const rows = raw.filter((r) => r.topic === "flashpoint" || r.topic === "protests");
  const inp: FlashpointReportIncident[] = rows.map((r) => ({
    id: r.id, title: r.title, topic: r.topic, severity: r.severity ?? "Low",
    occurredAt: r.occurredAt ?? "", country: r.country, summary: r.summary,
    source: r.source, sourceUrl: r.sourceUrl, location: r.location ?? r.country,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const issue = clampIssueDateToLatestRecord(
    today,
    rows.map((r) => ({ occurredAt: r.occurredAt, topic: r.topic })),
  );
  const ds = buildFlashpointReportDataset(inp, "flashpoint", issue);
  console.log("EFFECTIVE ISSUE DATE:", issue);
  console.log("WINDOW:", ds.windowLabel ?? JSON.stringify((ds as any).window ?? ""));
  console.log("\nFAST FACTS:", JSON.stringify((ds as any).fastFacts, null, 1));
  console.log("\nCOUNTRY ROWS:", JSON.stringify((ds as any).countryRows));
  console.log("\nINCLUDED INCIDENTS:", (ds as any).enriched?.length);
  for (const r of ((ds as any).enriched ?? [])) {
    console.log(`  [${r.severity}] ${(r.occurredAt ?? r.date?.toISOString?.() ?? "").slice(0,10)} ${r.country}: ${r.title} | issue=${r.issue}`);
  }
  for (const k of ["autoExecutiveSummary","activismRead","civilUnrestRead","forecastRead","regionalCountryRead","autoWhatMatters","autoImplications","autoWatchNext","autoPolestarView","dataNote"]) {
    const v = (ds as any)[k] ?? (ds as any).reads?.[k];
    if (v) console.log(`\n===== ${k} =====\n${v}`);
  }
  console.log("\nDATASET KEYS:", Object.keys(ds as any).join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
