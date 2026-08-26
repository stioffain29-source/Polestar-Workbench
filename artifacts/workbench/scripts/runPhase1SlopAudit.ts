/**
 * Phase 1.2 slop audit — generates kept/dropped samples from live DB rows.
 *
 * Prerequisites:
 *   PROD_DATABASE_URL or DATABASE_URL set
 *   pnpm --filter workbench exec tsx scripts/exportProdIncidentsSnapshot.ts  (optional refresh)
 *
 * Output:
 *   docs/phase-1-baseline-audit/output/slop-audit-samples.generated.md
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { explainRelevance, type RelevanceInput } from "../src/lib/topicRelevance";
import {
  selectFlashpointUsable,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";
import { isCargoInScope } from "../src/lib/cargoAnalysis";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const snapshotPath = join(here, ".prod-incidents.json");
const outDir = join(repoRoot, "docs/phase-1-baseline-audit/output");
const outPath = join(outDir, "slop-audit-samples.generated.md");

const ISSUE_DATE = process.env.ISSUE ?? "2026-05-31";
const SAMPLE_PER_SIDE = 25;

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
  display_title?: string | null;
  relevance_status?: string | null;
}

const KNOWN_FP_PATTERNS: { re: RegExp; why: string; topic: string }[] = [
  { re: /taklimakan rally/i, why: "Motorsport rally homonym", topic: "flashpoint" },
  { re: /arenaplus/i, why: "Sports betting promo", topic: "flashpoint" },
  { re: /nba strike sports betting/i, why: "Sports strike homonym", topic: "flashpoint" },
  { re: /thieves strike|burglars strike|copper thieves strike/i, why: "Property-crime 'strike' verb", topic: "flashpoint" },
  { re: /rally for the peso|market rally|crypto rally/i, why: "Finance rally homonym", topic: "flashpoint" },
  { re: /cargo theft costs|losses (?:exceed|hit|reach)/i, why: "Trade-press aggregate commentary", topic: "cargo_watch" },
  { re: /safer transport act|cargo theft bill/i, why: "Legislation / process noise", topic: "cargo_watch" },
  { re: /japan vs sweden|knicks riot|ubisoft|missouri shooting/i, why: "Foreign subject filed as Indonesia", topic: "country" },
];

function toInput(topic: string, r: ProdIncident): RelevanceInput {
  return {
    topic,
    title: r.display_title?.trim() ? r.display_title : r.title,
    summary: r.summary,
    source: r.source,
    sourceUrl: r.source_url,
    location: r.location ?? r.country,
  };
}

function mdRow(cols: string[]): string {
  return `| ${cols.join(" | ")} |`;
}

function section(
  lines: string[],
  title: string,
  kept: { r: ProdIncident; reason?: string }[],
  dropped: { r: ProdIncident; reason: string }[],
) {
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`**Kept:** ${kept.length} · **Dropped:** ${dropped.length}`);
  lines.push("");

  lines.push("### False positives (slop that survived — review these first)");
  lines.push("");
  lines.push(mdRow(["Date", "Country", "Title", "Why suspect", "Stage"]));
  lines.push(mdRow(["---", "---", "---", "---", "---"]));
  const fpCandidates = kept.filter(({ r }) =>
    KNOWN_FP_PATTERNS.some((p) => p.re.test(r.title) || p.re.test(r.display_title ?? "")),
  );
  const fpShow = (fpCandidates.length ? fpCandidates : kept.slice(0, SAMPLE_PER_SIDE)).slice(0, SAMPLE_PER_SIDE);
  for (const { r, reason } of fpShow) {
    const pat = KNOWN_FP_PATTERNS.find(
      (p) => p.re.test(r.title) || p.re.test(r.display_title ?? ""),
    );
    lines.push(
      mdRow([
        (r.occurred_at ?? "").slice(0, 10),
        r.country ?? "?",
        r.title.replace(/\|/g, "\\|").slice(0, 80),
        pat?.why ?? (reason ?? "Manual review — no auto-tag"),
        "kept",
      ]),
    );
  }
  lines.push("");

  lines.push("### False negatives (signal dropped — review for over-tight filters)");
  lines.push("");
  lines.push(mdRow(["Date", "Country", "Title", "Drop reason", "Stage"]));
  lines.push(mdRow(["---", "---", "---", "---", "---"]));
  for (const { r, reason } of dropped.slice(0, SAMPLE_PER_SIDE)) {
    lines.push(
      mdRow([
        (r.occurred_at ?? "").slice(0, 10),
        r.country ?? "?",
        r.title.replace(/\|/g, "\\|").slice(0, 80),
        reason.replace(/\|/g, "\\|").slice(0, 60),
        "dropped",
      ]),
    );
  }
  lines.push("");
}

async function main() {
  let snapshot: Record<string, ProdIncident[]>;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, ProdIncident[]>;
  } catch {
    console.error(
      `Missing ${snapshotPath} — run:\n` +
        `  PROD_DATABASE_URL="..." pnpm --filter workbench run audit:export-snapshot`,
    );
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const lines: string[] = [
    "# Slop audit samples (generated)",
    "",
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    `**Issue date (Flashpoint window anchor):** ${ISSUE_DATE}`,
    `**Source:** \`.prod-incidents.json\` (180-day window)`,
    "",
    "> Review each row manually. Auto-tagged false positives match known noise patterns from institutional memory.",
    "",
  ];

  // --- Per-topic relevance gate ---
  const relevanceTopics = [
    "flashpoint",
    "protests",
    "cargo_watch",
    "shipping",
    "fuel",
    "energy",
    "fertiliser",
    "conflict",
    "strikes",
  ];

  for (const topic of relevanceTopics) {
    const rows = snapshot[topic] ?? [];
    if (!rows.length) continue;
    const kept: { r: ProdIncident; reason?: string }[] = [];
    const dropped: { r: ProdIncident; reason: string }[] = [];
    for (const r of rows) {
      const { relevant, reason } = explainRelevance(topic, toInput(topic, r));
      if (relevant) kept.push({ r });
      else dropped.push({ r, reason: reason ?? "unknown" });
    }
    section(lines, `Relevance gate — ${topic}`, kept, dropped);
  }

  // --- Flashpoint full pipeline (second stage) ---
  const merged = [...(snapshot.flashpoint ?? []), ...(snapshot.protests ?? [])];
  const asInput: FlashpointReportIncident[] = merged.map((r) => ({
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
  const sel = selectFlashpointUsable(asInput, "flashpoint", ISSUE_DATE);
  const finalIds = new Set(sel.enriched.map((e) => String(e.id)));
  const relevanceKept = merged.filter(
    (r) => explainRelevance("flashpoint", toInput("flashpoint", r)).relevant,
  );
  const secondDropped = relevanceKept.filter((r) => !finalIds.has(String(r.id)));
  const stageMap = new Map(sel.rejected.map((x) => [String(x.title), x.stage]));

  lines.push("## Flashpoint report pipeline — second-stage drops");
  lines.push("");
  lines.push(
    `Relevance-kept ${relevanceKept.length} → final report set ${sel.enriched.length} ` +
      `(kinetic ${sel.kineticDropped}, court ${sel.courtDropped}, crime ${sel.outOfScopeCrimeDropped}, ` +
      `dedupe ${sel.dedupedDropped}, weak ${sel.weakDropped})`,
  );
  lines.push("");
  lines.push("### False positives in final report set");
  lines.push("");
  lines.push(mdRow(["Date", "Country", "Title", "Why suspect"]));
  lines.push(mdRow(["---", "---", "---", "---"]));
  for (const e of sel.enriched.slice(0, SAMPLE_PER_SIDE)) {
    const pat = KNOWN_FP_PATTERNS.find((p) => p.re.test(e.title));
    lines.push(
      mdRow([
        (e.occurredAt ?? "").slice(0, 10),
        e.country ?? "?",
        e.title.replace(/\|/g, "\\|").slice(0, 80),
        pat?.why ?? "Manual review",
      ]),
    );
  }
  lines.push("");
  lines.push("### Relevance-kept but cut before report (potential false negatives)");
  lines.push("");
  lines.push(mdRow(["Date", "Country", "Title", "Cut stage"]));
  lines.push(mdRow(["---", "---", "---", "---"]));
  for (const r of secondDropped.slice(0, SAMPLE_PER_SIDE)) {
    lines.push(
      mdRow([
        (r.occurred_at ?? "").slice(0, 10),
        r.country ?? "?",
        r.title.replace(/\|/g, "\\|").slice(0, 80),
        stageMap.get(r.title) ?? "unknown",
      ]),
    );
  }
  lines.push("");

  // --- Cargo scope (display gate) ---
  const cargoRows = snapshot.cargo_watch ?? [];
  const cargoKept: { r: ProdIncident }[] = [];
  const cargoDropped: { r: ProdIncident; reason: string }[] = [];
  for (const r of cargoRows) {
    const inScope = isCargoInScope({
      title: r.title,
      summary: r.summary,
      source: r.source,
      location: r.location,
      country: r.country,
    });
    if (inScope) cargoKept.push({ r });
    else cargoDropped.push({ r, reason: "cargo scope classifier (out of scope / non-cargo)" });
  }
  section(lines, "Cargo scope gate (isCargoInScope)", cargoKept, cargoDropped);

  // --- Summary stats ---
  lines.push("## Summary");
  lines.push("");
  lines.push("| Topic | Total | Relevance kept | Relevance dropped |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const topic of relevanceTopics) {
    const rows = snapshot[topic] ?? [];
    if (!rows.length) continue;
    let k = 0;
    for (const r of rows) {
      if (explainRelevance(topic, toInput(topic, r)).relevant) k++;
    }
    lines.push(`| ${topic} | ${rows.length} | ${k} | ${rows.length - k} |`);
  }
  lines.push("");

  writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
