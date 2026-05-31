// Live-production relevance audit.
//
// Runs the SHIPPED relevance gate (`explainRelevance`) against a snapshot
// of the live production `incidents` table and prints, per report family,
// the KEPT records and the DROPPED records WITH the reason each was
// rejected. This is the proof artefact the client requires: included list,
// rejected list with reasons, and confirmation that no excluded record can
// reach the report (cards / prose / tables all consume this same gate).
//
// Snapshot is produced from the read-only production replica into
// scripts/.prod-incidents.json. Run with:
//   cd artifacts/workbench && npx tsx scripts/auditLiveRelevance.ts
//
// The gate here is byte-for-byte the same function the dataset builder
// (flashpointReportDataset / shippingReportDataset / topicFastFacts),
// the prose generator (draftReportProse) and the PDF exporter
// (exportTopicReportPdf) all call, so a record dropped here is dropped
// everywhere.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { explainRelevance, type RelevanceInput } from "../src/lib/topicRelevance";
import {
  selectFlashpointUsable,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";

const here = dirname(fileURLToPath(import.meta.url));

interface ProdIncident {
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
}

const snapshot = JSON.parse(
  readFileSync(join(here, ".prod-incidents.json"), "utf8"),
) as Record<string, ProdIncident[]>;

// Records the client explicitly flagged as noise that must NOT survive.
const FLAGGED = [
  /taklimakan rally/i,
  /arenaplus/i,
  /nba strike sports betting/i,
];

function toInput(topic: string, r: ProdIncident): RelevanceInput {
  return {
    topic,
    title: r.title,
    summary: r.summary,
    source: r.source,
    sourceUrl: r.source_url,
    location: r.location ?? r.country,
  };
}

const lines: string[] = [];
function out(s = "") {
  lines.push(s);
  console.log(s);
}

const families = Object.keys(snapshot);
let grandKept = 0;
let grandDropped = 0;
const flaggedSurvivors: string[] = [];

for (const topic of families) {
  const rows = snapshot[topic] ?? [];
  const kept: ProdIncident[] = [];
  const dropped: { r: ProdIncident; reason: string }[] = [];
  for (const r of rows) {
    const { relevant, reason } = explainRelevance(topic, toInput(topic, r));
    if (relevant) kept.push(r);
    else dropped.push({ r, reason });
  }
  grandKept += kept.length;
  grandDropped += dropped.length;

  out("");
  out("=".repeat(78));
  out(`TOPIC: ${topic}   total=${rows.length}  KEPT=${kept.length}  DROPPED=${dropped.length}`);
  out("=".repeat(78));

  // Aggregate the drop reasons so the rejection logic is auditable.
  const reasonCounts = new Map<string, number>();
  for (const d of dropped) {
    const key = d.reason.replace(/\(\/.*\/\)/, "(…pattern…)");
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  out("");
  out("DROP REASON SUMMARY:");
  for (const [reason, n] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    out(`  ${String(n).padStart(4)}  ${reason}`);
  }

  // Confirm the client-flagged noise is dropped (and show its reason).
  const flaggedHere = rows.filter((r) => FLAGGED.some((re) => re.test(r.title)));
  if (flaggedHere.length) {
    out("");
    out("CLIENT-FLAGGED NOISE IN THIS TOPIC:");
    for (const r of flaggedHere) {
      const { relevant, reason } = explainRelevance(topic, toInput(topic, r));
      const verdict = relevant ? "*** SURVIVED (BUG) ***" : "DROPPED";
      out(`  [${verdict}] "${r.title}"`);
      out(`            reason: ${reason}`);
      if (relevant) flaggedSurvivors.push(`${topic}: ${r.title}`);
    }
  }

  // Show the top KEPT records (the included list) — most recent first.
  out("");
  out(`INCLUDED RECORDS (showing up to 12 of ${kept.length}, newest first):`);
  for (const r of kept.slice(0, 12)) {
    const d = (r.occurred_at ?? "").slice(0, 10);
    out(`  KEEP  ${d}  [${r.country ?? "?"}]  ${r.title}`);
  }

  // Show a sample of DROPPED records with their reasons (the reject list).
  out("");
  out(`REJECTED RECORDS WITH REASONS (showing up to 20 of ${dropped.length}, newest first):`);
  for (const { r, reason } of dropped.slice(0, 20)) {
    const d = (r.occurred_at ?? "").slice(0, 10);
    out(`  DROP  ${d}  [${r.country ?? "?"}]  ${r.title}`);
    out(`        -> ${reason}`);
  }

  // For Flashpoint, the relevance gate is only stage ONE. The report dataset
  // (selectFlashpointUsable) then strips kinetic-only, court-only,
  // out-of-scope crime, novelty and weak-operational noise (retrospective
  // accountability, aftermath/normalisation, diplomatic protest/visit
  // homonyms, sports, legislative process, defence procurement, etc.). A
  // Flashpoint / Protests report renders from BOTH the `flashpoint` (live
  // scraper) and `protests` (legacy import) buckets merged — exactly what
  // the in-app ReportEditor does (topic `protests` -> data topic
  // `flashpoint`). Run the REAL pipeline once over the merged buckets so the
  // proof reflects what actually reaches the cards / prose / tables, not just
  // what passes relevance. (The standalone "protests" topic above is shown
  // for the relevance gate only; its operational set is folded in here.)
  if (topic === "flashpoint") {
    const issueDate = "2026-05-31";
    const mergedRows = [...(snapshot.flashpoint ?? []), ...(snapshot.protests ?? [])];
    const asInput: FlashpointReportIncident[] = mergedRows.map((r) => ({
      id: r.id,
      title: r.title,
      topic: r.topic,
      severity: r.severity ?? "Low",
      occurredAt: r.occurred_at ?? "",
      country: r.country,
      summary: r.summary,
      source: r.source,
      sourceUrl: r.source_url,
      location: r.location ?? r.country,
    }));
    const sel = selectFlashpointUsable(asInput, "flashpoint", issueDate);
    const finalIds = new Set(sel.enriched.map((e) => String(e.id)));
    const mergedKept = mergedRows.filter(
      (r) => explainRelevance("flashpoint", toInput("flashpoint", r)).relevant,
    );
    const secondStageDropped = mergedKept.filter((r) => !finalIds.has(String(r.id)));
    out("");
    out("-".repeat(78));
    out("FULL REPORT PIPELINE — Flashpoint/Protests merged (gate -> operational -> report set)");
    out("-".repeat(78));
    out(
      `  relevance-kept=${mergedKept.length} (flashpoint+protests buckets)  ->  ` +
        `in window+deduped, minus kinetic(${sel.kineticDropped}) ` +
        `court(${sel.courtDropped}) dedupe(${sel.dedupedDropped}) ` +
        `weak/novelty(${sel.weakDropped})  =>  FINAL REPORT SET=${sel.enriched.length}`,
    );
    out("");
    out(`FINAL REPORT RECORDS (what cards/prose/tables share, up to 15 of ${sel.enriched.length}, newest first):`);
    for (const e of sel.enriched.slice(0, 15)) {
      const d = (e.occurredAt ?? "").slice(0, 10);
      out(`  IN   ${d}  [${e.country ?? "?"}]  ${e.title}`);
    }
    out("");
    out(
      `SECOND-STAGE DROPS (relevance-kept but removed before the report; ` +
        `up to 20 of ${secondStageDropped.length}):`,
    );
    for (const r of secondStageDropped.slice(0, 20)) {
      const d = (r.occurred_at ?? "").slice(0, 10);
      out(`  CUT  ${d}  [${r.country ?? "?"}]  ${r.title}`);
    }
  }
}

out("");
out("#".repeat(78));
out(`GRAND TOTAL  KEPT=${grandKept}  DROPPED=${grandDropped}  of ${grandKept + grandDropped}`);
out(`CLIENT-FLAGGED SURVIVORS: ${flaggedSurvivors.length === 0 ? "NONE (all flagged noise dropped)" : flaggedSurvivors.join("; ")}`);
out("#".repeat(78));

writeFileSync(join(here, "AUDIT_LIVE_RELEVANCE.txt"), lines.join("\n"));
console.log("\nFull report written to scripts/AUDIT_LIVE_RELEVANCE.txt");

if (flaggedSurvivors.length > 0) {
  console.error("\nFAIL: client-flagged noise survived the gate.");
  process.exit(1);
}
