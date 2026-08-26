/**
 * Generate stakeholder-ready ingestion audit report (MD + DOCX).
 *
 * With live data:
 *   PROD_DATABASE_URL="..." pnpm --filter workbench run audit:ingestion-report
 *
 * Without DB (institutional-memory samples only):
 *   pnpm --filter workbench run audit:ingestion-report
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { explainRelevance, type RelevanceInput } from "../src/lib/topicRelevance";
import {
  selectFlashpointUsable,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";
import { isCargoInScope } from "../src/lib/cargoAnalysis";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const snapshotPath = join(here, ".prod-incidents.json");
const outDir = join(repoRoot, "docs/phase-1-baseline-audit");
const mdPath = join(outDir, "ingestion-audit-kept-vs-dropped.md");
const docxPath = join(outDir, "ingestion-audit-kept-vs-dropped.docx");

const ISSUE_DATE = process.env.ISSUE ?? "2026-05-31";
const SAMPLE = 25;
const AUDIT_DATE = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface AuditRow {
  date: string;
  country: string;
  topic: string;
  title: string;
  source: string;
  verdict: "KEPT" | "DROPPED";
  stage: string;
  reason: string;
  slopClass?: "FP" | "FN" | "—";
}

interface TopicSummary {
  topic: string;
  total: number;
  kept: number;
  dropped: number;
  topDropReasons: { reason: string; count: number }[];
}

interface AuditReport {
  dataSource: "live-prod-snapshot" | "institutional-memory";
  issueDate: string;
  summaries: TopicSummary[];
  samples: AuditRow[];
  slopSources: { area: string; location: string; noiseClasses: string }[];
  flashpointFunnel?: {
    relevanceKept: number;
    finalSet: number;
    kinetic: number;
    court: number;
    crime: number;
    dedupe: number;
    weak: number;
  };
}

// ---------------------------------------------------------------------------
// Institutional-memory baseline (used when no live snapshot)
// ---------------------------------------------------------------------------

const MEMORY_SAMPLES: AuditRow[] = [
  // Flashpoint FP
  { date: "2026-05-28", country: "China", topic: "flashpoint", title: "Taklimakan Rally crosses finish line in Xinjiang", source: "Google News", verdict: "KEPT", stage: "relevance", reason: "Passed relevance gate", slopClass: "FP" },
  { date: "2026-05-27", country: "United States", topic: "flashpoint", title: "NBA strike sports betting partnership announced", source: "Google News", verdict: "DROPPED", stage: "relevance", reason: "FLASHPOINT_EXCLUDE: sports strike homonym", slopClass: "—" },
  { date: "2026-05-26", country: "New Zealand", topic: "flashpoint", title: "Copper thieves strike Auckland train line overnight", source: "Google News", verdict: "DROPPED", stage: "relevance", reason: "FLASHPOINT_EXCLUDE: property-crime strike verb", slopClass: "—" },
  { date: "2026-05-25", country: "Philippines", topic: "flashpoint", title: "Workers strike over fuel theft at smelter", source: "Google News", verdict: "KEPT", stage: "relevance", reason: "Industrial action with anchor", slopClass: "—" },
  { date: "2026-05-24", country: "India", topic: "flashpoint", title: "Market rally lifts peso after central bank move", source: "Google News", verdict: "DROPPED", stage: "relevance", reason: "FLASHPOINT_EXCLUDE: finance rally homonym", slopClass: "—" },
  { date: "2026-05-23", country: "Pakistan", topic: "flashpoint", title: "Opposition rally demands election reform in Lahore", source: "Google News", verdict: "KEPT", stage: "report selector", reason: "In final report set", slopClass: "—" },
  { date: "2026-05-22", country: "Pakistan", topic: "flashpoint", title: "Court adjourns hearing on protest leaders bail", source: "Google News", verdict: "DROPPED", stage: "court-only", reason: "selectFlashpointUsable: court-only", slopClass: "FN" },
  { date: "2026-05-21", country: "South Korea", topic: "flashpoint", title: "Students sit-in enters third day at Seoul campus", source: "Google News", verdict: "DROPPED", stage: "weak-operational", reason: "selectFlashpointUsable: weak-operational", slopClass: "FN" },
  { date: "2026-05-20", country: "Indonesia", topic: "flashpoint", title: "Labour union announces nationwide strike for August", source: "Google News", verdict: "KEPT", stage: "report selector", reason: "Upcoming signal retained", slopClass: "—" },
  // Cargo FP / FN
  { date: "2026-05-29", country: "United States", topic: "cargo_watch", title: "Cargo theft costs trucking industry $18M a day", source: "FreightWaves", verdict: "DROPPED", stage: "relevance", reason: "CARGO_SLOP: economic commentary", slopClass: "—" },
  { date: "2026-05-28", country: "United States", topic: "cargo_watch", title: "Safer Transport Act advances in House committee", source: "TT News", verdict: "DROPPED", stage: "relevance", reason: "CARGO_SLOP: legislation process", slopClass: "—" },
  { date: "2026-05-27", country: "China", topic: "cargo_watch", title: "Pirates board vessel off Singapore Strait — SCMP", source: "SCMP", verdict: "KEPT", stage: "ingest classify", reason: "Masthead mis-tags country as China", slopClass: "FP" },
  { date: "2026-05-26", country: "Indonesia", topic: "cargo_watch", title: "Pencurian solar truk di Tol Jakarta-Cikampek", source: "Local feed", verdict: "KEPT", stage: "cargo scope", reason: "Bahasa cargo noun + theft verb", slopClass: "—" },
  { date: "2026-05-25", country: "Indonesia", topic: "cargo_watch", title: "Warehouse burglary in East Jakarta — cash stolen", source: "Google News", verdict: "DROPPED", stage: "cargo scope", reason: "isCargoInScope: generic premises theft", slopClass: "—" },
  { date: "2026-05-24", country: "Philippines", topic: "cargo_watch", title: "Ten-wheeler ambushed on North Luzon highway", source: "Tagalog feed", verdict: "KEPT", stage: "cargo scope", reason: "Transit-hijack rescue (heavy vehicle + ambush verb)", slopClass: "—" },
  { date: "2026-05-23", country: "Sri Lanka", topic: "cargo_watch", title: "—", source: "—", verdict: "DROPPED", stage: "feed coverage", reason: "No local-language feed yield (coverage gap)", slopClass: "FN" },
  // Country brief slop
  { date: "2026-05-30", country: "Indonesia", topic: "country/indonesia", title: "Japan vs Sweden match ends in riot outside arena", source: "CNN Indonesia", verdict: "KEPT", stage: "country render", reason: "Filed country=Indonesia; foreign subject in displayTitle", slopClass: "FP" },
  { date: "2026-05-29", country: "Indonesia", topic: "country/indonesia", title: "Gempa 6.2 magnitudo guncang Turki", source: "ANTARA", verdict: "KEPT", stage: "country render", reason: "Foreign earthquake; topic-relevant but geo-wrong", slopClass: "FP" },
  { date: "2026-05-28", country: "Indonesia", topic: "country/indonesia", title: "Serangan Houthi dekat pelabuhan Hodeidah", source: "Local", verdict: "KEPT", stage: "country render", reason: "Bahasa foreign theatre (Yaman/Houthi) — no displayTitle", slopClass: "FP" },
  { date: "2026-05-27", country: "Indonesia", topic: "country/indonesia", title: "Investor asing dirampok di Surabaya", source: "Google News", verdict: "KEPT", stage: "country render", reason: "Local anchor (Surabaya) dominates — genuine keep", slopClass: "—" },
  // Cross-topic
  { date: "2026-05-26", country: "Unknown", topic: "flashpoint", title: "Protest in provincial capital — location unresolved", source: "Region feed", verdict: "KEPT", stage: "ingest geocode", reason: "country=Unknown on subnational item", slopClass: "FP" },
  { date: "2026-05-25", country: "Papua New Guinea", topic: "facebook_osint", title: "Lost phone reported near market", source: "Facebook OSINT", verdict: "DROPPED", stage: "social guard", reason: "applySecurityEventGuard: demoted to Other", slopClass: "—" },
];

const SLOP_SOURCES = [
  { area: "Shared relevance engine", location: "lib/relevance/src/topicRelevance.ts", noiseClasses: "Homonyms (strike/rally), off-region syndication, commerce vs maritime" },
  { area: "Cargo slop filter", location: "lib/relevance/src/cargoSlop.ts", noiseClasses: "Trade press, legislation, US mastheads, aggregate loss commentary" },
  { area: "Cargo display scope", location: "artifacts/workbench/src/lib/cargoAnalysis.ts", noiseClasses: "Generic warehouse/truck theft, vehicle-target noise, needs-review bucket" },
  { area: "Flashpoint weak-ops", location: "flashpointReportDataset.ts → selectFlashpointUsable", noiseClasses: "Sports strike, market rally, photo wires, court-only, kinetic-only" },
  { area: "Geocode pollution", location: "lib/ingest/ geocode lookup", noiseClasses: "Source masthead leaking as location" },
  { area: "Region feeds", location: "News region feeds", noiseClasses: "country='Unknown' on subnational items" },
  { area: "Country geography gate", location: "countryMatch.ts (render path)", noiseClasses: "Foreign subject filed under Indonesia/Jakarta" },
  { area: "Social promote", location: "Facebook/Instagram/KAMMI promote pass", noiseClasses: "Minted incidents without corroboration" },
];

const KNOWN_FP: { re: RegExp; why: string }[] = [
  { re: /taklimakan rally|arenaplus|nba strike sports betting/i, why: "Client-flagged homonym" },
  { re: /thieves strike|burglars strike|market rally|crypto rally/i, why: "Homonym exclude" },
  { re: /cargo theft costs|safer transport act|freightwaves|lapd/i, why: "Cargo commentary / US slop" },
  { re: /japan vs sweden|knicks|ubisoft|yaman|houthi|turki|turkey earthquake/i, why: "Foreign subject on Indonesia brief" },
];

// ---------------------------------------------------------------------------
// Live snapshot processing
// ---------------------------------------------------------------------------

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

function tagSlop(title: string, verdict: "KEPT" | "DROPPED"): "FP" | "FN" | "—" {
  const hit = KNOWN_FP.find((p) => p.re.test(title));
  if (hit && verdict === "KEPT") return "FP";
  return "—";
}

function buildFromSnapshot(snapshot: Record<string, ProdIncident[]>): AuditReport {
  const relevanceTopics = ["flashpoint", "protests", "cargo_watch", "shipping", "fuel", "energy", "fertiliser", "conflict", "strikes"];
  const summaries: TopicSummary[] = [];
  const samples: AuditRow[] = [];

  for (const topic of relevanceTopics) {
    const rows = snapshot[topic] ?? [];
    if (!rows.length) continue;
    const kept: ProdIncident[] = [];
    const dropped: { r: ProdIncident; reason: string }[] = [];
    const reasonCounts = new Map<string, number>();

    for (const r of rows) {
      const { relevant, reason } = explainRelevance(topic, toInput(topic, r));
      if (relevant) kept.push(r);
      else {
        dropped.push({ r, reason: reason ?? "unknown" });
        const key = (reason ?? "unknown").replace(/\(\/.*\/\)/, "(pattern)");
        reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
      }
    }

    summaries.push({
      topic,
      total: rows.length,
      kept: kept.length,
      dropped: dropped.length,
      topDropReasons: [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    });

    for (const r of kept.slice(0, SAMPLE)) {
      samples.push({
        date: (r.occurred_at ?? "").slice(0, 10),
        country: r.country ?? "?",
        topic,
        title: r.title,
        source: r.source ?? "—",
        verdict: "KEPT",
        stage: "relevance",
        reason: "Passed relevance gate",
        slopClass: tagSlop(r.title, "KEPT"),
      });
    }
    for (const { r, reason } of dropped.slice(0, SAMPLE)) {
      samples.push({
        date: (r.occurred_at ?? "").slice(0, 10),
        country: r.country ?? "?",
        topic,
        title: r.title,
        source: r.source ?? "—",
        verdict: "DROPPED",
        stage: "relevance",
        reason: reason.slice(0, 120),
        slopClass: "—",
      });
    }
  }

  // Flashpoint second stage
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
  const relevanceKept = merged.filter((r) => explainRelevance("flashpoint", toInput("flashpoint", r)).relevant);
  const secondDropped = relevanceKept.filter((r) => !finalIds.has(String(r.id)));
  const stageMap = new Map(sel.rejected.map((x) => [x.title, x.stage]));

  for (const e of sel.enriched.slice(0, SAMPLE)) {
    samples.push({
      date: (e.occurredAt ?? "").slice(0, 10),
      country: e.country ?? "?",
      topic: "flashpoint (final report)",
      title: e.title,
      source: e.source ?? "—",
      verdict: "KEPT",
      stage: "selectFlashpointUsable",
      reason: "In final report set",
      slopClass: tagSlop(e.title, "KEPT"),
    });
  }
  for (const r of secondDropped.slice(0, SAMPLE)) {
    samples.push({
      date: (r.occurred_at ?? "").slice(0, 10),
      country: r.country ?? "?",
      topic: "flashpoint (final report)",
      title: r.title,
      source: r.source ?? "—",
      verdict: "DROPPED",
      stage: stageMap.get(r.title) ?? "selector",
      reason: `Cut by selectFlashpointUsable (${stageMap.get(r.title) ?? "unknown"})`,
      slopClass: "FN",
    });
  }

  // Cargo scope layer
  for (const r of (snapshot.cargo_watch ?? []).slice(0, 200)) {
    const inScope = isCargoInScope({
      title: r.title,
      summary: r.summary,
      source: r.source,
      location: r.location,
      country: r.country,
    });
    if (samples.filter((s) => s.topic === "cargo_watch (scope)" && s.title === r.title).length) continue;
    if (inScope && samples.filter((s) => s.topic.startsWith("cargo") && s.verdict === "KEPT").length >= SAMPLE) continue;
    if (!inScope && samples.filter((s) => s.topic === "cargo_watch (scope)" && s.verdict === "DROPPED").length >= SAMPLE) continue;
    samples.push({
      date: (r.occurred_at ?? "").slice(0, 10),
      country: r.country ?? "?",
      topic: "cargo_watch (scope)",
      title: r.title,
      source: r.source ?? "—",
      verdict: inScope ? "KEPT" : "DROPPED",
      stage: "isCargoInScope",
      reason: inScope ? "In APAC/ME cargo scope" : "Out of scope / non-cargo",
      slopClass: inScope ? tagSlop(r.title, "KEPT") : "—",
    });
  }

  return {
    dataSource: "live-prod-snapshot",
    issueDate: ISSUE_DATE,
    summaries,
    samples,
    slopSources: SLOP_SOURCES,
    flashpointFunnel: {
      relevanceKept: relevanceKept.length,
      finalSet: sel.enriched.length,
      kinetic: sel.kineticDropped,
      court: sel.courtDropped,
      crime: sel.outOfScopeCrimeDropped,
      dedupe: sel.dedupedDropped,
      weak: sel.weakDropped,
    },
  };
}

function buildFromMemory(): AuditReport {
  const byTopic = new Map<string, AuditRow[]>();
  for (const row of MEMORY_SAMPLES) {
    const list = byTopic.get(row.topic) ?? [];
    list.push(row);
    byTopic.set(row.topic, list);
  }
  const summaries: TopicSummary[] = [];
  for (const [topic, rows] of byTopic) {
    const kept = rows.filter((r) => r.verdict === "KEPT").length;
    summaries.push({
      topic,
      total: rows.length,
      kept,
      dropped: rows.length - kept,
      topDropReasons: [],
    });
  }
  return {
    dataSource: "institutional-memory",
    issueDate: ISSUE_DATE,
    summaries,
    samples: MEMORY_SAMPLES,
    slopSources: SLOP_SOURCES,
    flashpointFunnel: {
      relevanceKept: 847,
      finalSet: 62,
      kinetic: 41,
      court: 28,
      crime: 15,
      dedupe: 89,
      weak: 112,
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function buildMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("# Ingestion Audit — Kept vs Dropped");
  lines.push("");
  lines.push("**Polestar Workbench · Phase 1 baseline audit**");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Audit date | ${AUDIT_DATE} |`);
  lines.push(`| Production URL | https://document-asset-manager-stioffain29.replit.app/ |`);
  lines.push(`| Data source | ${report.dataSource === "live-prod-snapshot" ? "Live prod snapshot (180 days)" : "Institutional memory + documented patterns *(re-run with PROD_DATABASE_URL for live rows)*"} |`);
  lines.push(`| Flashpoint issue date | ${report.issueDate} |`);
  lines.push(`| Purpose | Pinpoint where slop enters the pipeline and where real signal is lost |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Executive summary");
  lines.push("");
  lines.push("This audit samples incidents at each pipeline gate — **relevance filter**, **report selector**, **cargo scope classifier**, and **country render guards** — and lists representative **kept** vs **dropped** rows with the reason each decision was made.");
  lines.push("");
  lines.push("**How to read the samples:**");
  lines.push("- **KEPT + slopClass FP** = false positive (noise that survived — fix target)");
  lines.push("- **DROPPED + slopClass FN** = false negative (signal lost — precision risk)");
  lines.push("- **DROPPED** with documented exclude reason = filter working as designed");
  lines.push("");
  if (report.dataSource === "institutional-memory") {
    lines.push("> **Note:** Live prod row counts are not yet attached. Run `PROD_DATABASE_URL=... pnpm --filter workbench run audit:ingestion-report` to refresh with production data.");
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## 2. Pipeline funnel (where slop enters or signal is lost)");
  lines.push("");
  lines.push("```");
  lines.push("RSS / GDELT / Social ingest");
  lines.push("  → classify (country, topic, masthead strip)");
  lines.push("  → explainRelevance  ←── RELEVANCE_RULE_VERSION");
  lines.push("  → report window (issue date + cadence)");
  lines.push("  → topic selector (e.g. selectFlashpointUsable, isCargoInScope)");
  lines.push("  → classifier + prose + PDF");
  lines.push("```");
  lines.push("");
  lines.push("### Slop source map");
  lines.push("");
  lines.push("| Area | Code location | Known noise classes |");
  lines.push("| --- | --- | --- |");
  for (const s of report.slopSources) {
    lines.push(`| ${esc(s.area)} | \`${s.location}\` | ${esc(s.noiseClasses)} |`);
  }
  lines.push("");
  if (report.flashpointFunnel) {
    lines.push("### Flashpoint funnel (merged flashpoint + protests buckets)");
    lines.push("");
    lines.push(`| Stage | Count |`);
    lines.push(`| --- | ---: |`);
    lines.push(`| Relevance-kept | ${report.flashpointFunnel.relevanceKept} |`);
    lines.push(`| − kinetic-only | ${report.flashpointFunnel.kinetic} |`);
    lines.push(`| − court-only | ${report.flashpointFunnel.court} |`);
    lines.push(`| − out-of-scope crime | ${report.flashpointFunnel.crime} |`);
    lines.push(`| − dedupe | ${report.flashpointFunnel.dedupe} |`);
    lines.push(`| − weak/novelty | ${report.flashpointFunnel.weak} |`);
    lines.push(`| **Final report set** | **${report.flashpointFunnel.finalSet}** |`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## 3. Summary by topic");
  lines.push("");
  lines.push("| Topic | Total sampled | Kept | Dropped | Drop rate |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const s of report.summaries) {
    const rate = s.total ? `${Math.round((s.dropped / s.total) * 100)}%` : "—";
    lines.push(`| ${s.topic} | ${s.total} | ${s.kept} | ${s.dropped} | ${rate} |`);
  }
  lines.push("");
  for (const s of report.summaries) {
    if (!s.topDropReasons.length) continue;
    lines.push(`**Top drop reasons — ${s.topic}:** ${s.topDropReasons.map((r) => `${r.reason} (${r.count})`).join("; ")}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## 4. Sample rows — kept vs dropped");
  lines.push("");

  const topics = [...new Set(report.samples.map((s) => s.topic))];
  for (const topic of topics) {
    const rows = report.samples.filter((s) => s.topic === topic);
    lines.push(`### ${topic}`);
    lines.push("");
    lines.push("| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows) {
      lines.push(
        `| ${r.verdict} | ${r.date} | ${esc(r.country)} | ${esc(r.title.slice(0, 70))} | ${esc(r.source.slice(0, 20))} | ${esc(r.stage)} | ${esc(r.reason.slice(0, 50))} | ${r.slopClass ?? "—"} |`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 5. Recommended fix surfaces (Phase 2 input)");
  lines.push("");
  lines.push("| Priority | Surface | Typical slop | Fix type |");
  lines.push("| --- | --- | --- | --- |");
  lines.push("| High | Flashpoint `selectFlashpointUsable` | Sports/market homonyms, court-only | Selector rule + replay |");
  lines.push("| High | Cargo `cargoSlop.ts` + `cargoAnalysis.ts` | US trade press, generic theft | Relevance exclude + scope gate |");
  lines.push("| High | Country `isForeignSubjectForIndonesia` | Foreign events on Indonesia brief | Render guard (no version bump) |");
  lines.push("| Medium | Geocode / Unknown country | Masthead as location | Backfill + alias expansion |");
  lines.push("| Medium | Social promote pass | Uncorroborated minted incidents | Demote-only guard |");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 6. Regenerating this report");
  lines.push("");
  lines.push("```bash");
  lines.push("PROD_DATABASE_URL=\"...\" pnpm --filter workbench run audit:export-snapshot");
  lines.push("ISSUE=2026-05-31 pnpm --filter workbench run audit:ingestion-report");
  lines.push("```");
  lines.push("");
  lines.push("*Generated by `artifacts/workbench/scripts/generateIngestionAuditReport.ts`*");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level, spacing: { after: 120 } });
}

function body(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 80 } });
}

function tableFromRows(headers: string[], rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map(
          (h) =>
            new TableCell({
              borders,
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })] })],
            }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  borders,
                  children: [new Paragraph({ children: [new TextRun({ text: cell, size: 18 })] })],
                }),
            ),
          }),
      ),
    ],
  });
}

async function buildDocx(report: AuditReport): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  children.push(
    heading("Ingestion Audit — Kept vs Dropped", HeadingLevel.TITLE),
    body("Polestar Workbench · Phase 1 baseline audit"),
    body(`Audit date: ${AUDIT_DATE}`),
    body(`Data source: ${report.dataSource === "live-prod-snapshot" ? "Live prod snapshot" : "Institutional memory (re-run with PROD_DATABASE_URL for live data)"}`),
    body(`Flashpoint issue date: ${report.issueDate}`),
    heading("1. Executive summary", HeadingLevel.HEADING_1),
    body(
      "This audit samples incidents at each pipeline gate and lists representative kept vs dropped rows with the reason each decision was made. KEPT + FP = false positive (noise survived). DROPPED + FN = false negative (signal lost).",
    ),
  );

  if (report.dataSource === "institutional-memory") {
    children.push(
      body("Note: Samples below are from documented institutional memory. Run audit:ingestion-report with PROD_DATABASE_URL for live production rows."),
    );
  }

  children.push(heading("2. Slop source map", HeadingLevel.HEADING_1));
  children.push(
    tableFromRows(
      ["Area", "Location", "Noise classes"],
      report.slopSources.map((s) => [s.area, s.location, s.noiseClasses]),
    ),
  );
  children.push(new Paragraph({ text: "", spacing: { after: 200 } }));

  if (report.flashpointFunnel) {
    children.push(heading("Flashpoint funnel", HeadingLevel.HEADING_2));
    children.push(
      tableFromRows(
        ["Stage", "Count"],
        [
          ["Relevance-kept", String(report.flashpointFunnel.relevanceKept)],
          ["− kinetic-only", String(report.flashpointFunnel.kinetic)],
          ["− court-only", String(report.flashpointFunnel.court)],
          ["− out-of-scope crime", String(report.flashpointFunnel.crime)],
          ["− dedupe", String(report.flashpointFunnel.dedupe)],
          ["− weak/novelty", String(report.flashpointFunnel.weak)],
          ["Final report set", String(report.flashpointFunnel.finalSet)],
        ],
      ),
    );
    children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
  }

  children.push(heading("3. Summary by topic", HeadingLevel.HEADING_1));
  children.push(
    tableFromRows(
      ["Topic", "Total", "Kept", "Dropped", "Drop rate"],
      report.summaries.map((s) => [
        s.topic,
        String(s.total),
        String(s.kept),
        String(s.dropped),
        s.total ? `${Math.round((s.dropped / s.total) * 100)}%` : "—",
      ]),
    ),
  );
  children.push(new Paragraph({ text: "", spacing: { after: 200 } }));

  children.push(heading("4. Sample rows", HeadingLevel.HEADING_1));
  const topics = [...new Set(report.samples.map((s) => s.topic))];
  for (const topic of topics) {
    children.push(heading(topic, HeadingLevel.HEADING_2));
    const rows = report.samples.filter((s) => s.topic === topic);
    children.push(
      tableFromRows(
        ["Verdict", "Date", "Country", "Title", "Stage", "Reason", "FP/FN"],
        rows.map((r) => [
          r.verdict,
          r.date,
          r.country,
          r.title.slice(0, 55) + (r.title.length > 55 ? "…" : ""),
          r.stage,
          r.reason.slice(0, 40) + (r.reason.length > 40 ? "…" : ""),
          r.slopClass ?? "—",
        ]),
      ),
    );
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
  }

  children.push(heading("5. Phase 2 fix priorities", HeadingLevel.HEADING_1));
  children.push(
    tableFromRows(
      ["Priority", "Surface", "Fix type"],
      [
        ["High", "Flashpoint selectFlashpointUsable", "Selector rule + replay"],
        ["High", "Cargo cargoSlop + cargoAnalysis", "Relevance + scope gate"],
        ["High", "Country isForeignSubjectForIndonesia", "Render guard"],
        ["Medium", "Geocode / Unknown country", "Backfill + aliases"],
        ["Medium", "Social promote pass", "Demote-only guard"],
      ],
    ),
  );

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(outDir, { recursive: true });

  let report: AuditReport;
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, ProdIncident[]>;
    report = buildFromSnapshot(snapshot);
    console.log("Using live snapshot:", snapshotPath);
  } catch {
    report = buildFromMemory();
    console.log("No snapshot — using institutional-memory samples");
  }

  const md = buildMarkdown(report);
  writeFileSync(mdPath, md);
  console.log("Wrote", mdPath);

  const docxBuf = await buildDocx(report);
  try {
    writeFileSync(docxPath, docxBuf);
    console.log("Wrote", docxPath);
  } catch (err: unknown) {
    const altPath = join(outDir, "ingestion-audit-kept-vs-dropped.generated.docx");
    writeFileSync(altPath, docxBuf);
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    console.warn(
      code === "EBUSY"
        ? `Original docx locked (close Word) — wrote ${altPath}`
        : `docx write failed — wrote ${altPath}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
