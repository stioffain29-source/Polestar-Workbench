// Proof harness for the Shipping Watch report cleanup.
//
// Loads the live shipping incident file for a report's window, runs the SAME
// dataset builder the preview and PDF use, and prints:
//   1. The Related Incidents that were INCLUDED (operational signal).
//   2. A REJECTED list, each with the reason it was dropped.
//   3. Country consistency: chart country order vs the seeded Polestar View.
//   4. Latest Significant Incident + chokepoint headline vs table.
//
// Run: cd artifacts/workbench && REPORT_ID=12 \
//   npx tsx --import ./scripts/registerLoader.mjs scripts/proveShippingSelection.ts
import { readFileSync } from "fs";
import { buildShippingReportDataset, type ShippingReportIncident } from "../src/lib/shippingReportDataset";
import { draftTopicReportProse } from "../src/lib/draftReportProse";
import {
  isLowCredibilityShippingRecord,
  isCapabilityContext,
  SOCIAL_HANDLE_TITLE_RE,
  SOCIAL_SOURCE_RE,
  HUMAN_INTEREST_RE,
  SPECULATIVE_CLAIM_RE,
  GENERIC_COMMENTARY_RE,
  isRhetoricalClosureThreat,
  MEDIA_PACKAGING_RE,
} from "../src/lib/shippingAnalysis";
import { resolveReportWindow, filterIncidentsToWindow } from "../src/lib/reportWindow";
import { isTopicRelevant } from "../src/lib/topicRelevance";

const REPORT_ID = process.env.REPORT_ID ?? "12";

function reason(r: ShippingReportIncident): string {
  const t = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (SOCIAL_HANDLE_TITLE_RE.test(r.title ?? "")) return "social-handle title";
  if (SOCIAL_SOURCE_RE.test(`${r.source ?? ""} ${r.sourceUrl ?? ""}`)) return "social-media source";
  if (HUMAN_INTEREST_RE.test(t)) return "human-interest / repatriation follow-up";
  if (SPECULATIVE_CLAIM_RE.test(t)) return "speculative / unverified strike claim";
  if (GENERIC_COMMENTARY_RE.test(t)) return "commentary / explainer (no operational anchor)";
  if (isRhetoricalClosureThreat(t)) return "political closure rhetoric / threat / claim — not confirmed disruption";
  if (MEDIA_PACKAGING_RE.test(t)) return "media packaging (video / photo / live blog)";
  if (isCapabilityContext(r)) return "capability / procurement / exercise news";
  return "";
}

function main() {
  const [, , issueRaw] = readFileSync("/tmp/shipping_report.txt", "utf8").trim().split("|");
  const topic = "shipping";
  const issueDate: string = issueRaw.slice(0, 10);

  const rows = JSON.parse(readFileSync("/tmp/shipping_incidents.json", "utf8")) as Array<Record<string, unknown>>;
  const incidents: ShippingReportIncident[] = rows.map((r) => ({
    id: r.id as number,
    title: r.title as string,
    topic: r.topic as string,
    severity: r.severity as string,
    occurredAt: typeof r.occurred_at === "string" ? r.occurred_at : new Date(r.occurred_at as string).toISOString(),
    country: r.country as string | null,
    summary: r.summary as string | null,
    source: r.source as string | null,
    sourceUrl: r.source_url as string | null,
    location: r.location as string | null,
  }));

  const win = resolveReportWindow(topic, issueDate);
  const ds = buildShippingReportDataset(incidents, topic, issueDate);

  // Reconstruct the in-window, on-topic pool (pre-credibility) to compute the
  // rejected list — same scope filter the dataset applies before cleaning.
  const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  const onTopic = rawWindow.filter((i) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );
  const rejected = onTopic
    .map((r) => ({ r, why: reason(r) }))
    .filter((x) => x.why !== "");

  console.log("=".repeat(78));
  console.log(`SHIPPING WATCH PROOF — report #${REPORT_ID}  window ${win.label}`);
  console.log("=".repeat(78));

  console.log(`\nIN-WINDOW ON-TOPIC RECORDS: ${onTopic.length}`);
  console.log(`REJECTED (noise / claim / capability / media): ${rejected.length}`);
  console.log(`ENRICHED (in-scope, charted): ${ds.enriched.length}`);

  console.log(`\n--- INCLUDED: RELATED INCIDENTS (${ds.relatedIncidents.length}) ---`);
  ds.relatedIncidents.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. [${r.severity}] ${r.title}`);
  });

  console.log(`\n--- REJECTED WITH REASONS (showing up to 40 of ${rejected.length}) ---`);
  const byReason = new Map<string, number>();
  for (const { why } of rejected) byReason.set(why, (byReason.get(why) ?? 0) + 1);
  console.log("Reason tally:");
  for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(v).padStart(3)}  ${k}`);
  }
  console.log("");
  rejected.slice(0, 40).forEach(({ r, why }, i) => {
    console.log(`${String(i + 1).padStart(2)}. (${why})\n      ${r.title}`);
  });

  console.log(`\n--- FAULT 3: COUNTRY CONSISTENCY ---`);
  console.log(`Chart country order: ${ds.countryRows.slice(0, 5).map((c) => `${c.label}(${c.value})`).join(", ")}`);
  const draft = draftTopicReportProse({ topic, issueDate, incidents: incidents as never });
  console.log(`Seeded Polestar View:\n   ${draft.polestarView}`);
  console.log(`Seeded Executive Summary:\n   ${draft.executiveSummary}`);

  console.log(`\n--- FAULT 4/5: CHOKEPOINT + LATEST SIGNIFICANT ---`);
  const cp = [...ds.chokepointRows].filter((c) => c.count > 0).sort((a, b) => b.count - a.count)[0];
  console.log(`Top chokepoint (credible-only table): ${cp ? `${cp.name} = ${cp.count}` : "none"}`);
  const latestSig = ds.fastFacts.find((f) => f.label.toLowerCase().includes("latest"));
  console.log(`Latest Significant Incident card: ${latestSig ? latestSig.value : "(see preview)"}`);

  console.log(`\n--- FAULT 7: COMMERCIAL IMPACT (${ds.commercialRows.length} records) ---`);
  console.log(`   ${ds.commercialImpactRead.split("\n")[0]}`);


}

try { main(); } catch (e) { console.error(e); process.exit(1); }
