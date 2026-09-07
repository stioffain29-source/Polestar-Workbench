/**
 * Week 0 baseline capture — action plan prep (docs/action-plan-sep-2026.md).
 *
 * Writes artifacts to docs/phase-4-proof-pack/week0-baseline/
 *
 * Requires one of:
 *   PROD_DATABASE_URL / DATABASE_URL  → export snapshot + headless PDFs
 *   PROD_SESSION_COOKIE                 → fetch snapshot via prod API
 *
 * Usage:
 *   pnpm --filter workbench run baseline:week0
 *   ISSUE=2026-05-31 pnpm --filter workbench run baseline:week0
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  selectFlashpointUsable,
  buildFlashpointReportDataset,
  validateFlashpointReportDataset,
  type FlashpointRejectStage,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";
import { loadFlashpointIncidents } from "./flashpointIncidentLoader";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const outDir = join(repoRoot, "docs/phase-4-proof-pack/week0-baseline");
const snapshotPath = join(here, ".prod-incidents.json");
const ISSUE = process.env.ISSUE ?? "2026-05-31";

interface StepResult {
  id: string;
  status: "done" | "skipped" | "blocked";
  detail: string;
}

const results: StepResult[] = [];

function log(msg: string) {
  console.log(msg);
}

function record(id: string, status: StepResult["status"], detail: string) {
  results.push({ id, status, detail });
  const tag = status === "done" ? "OK" : status === "skipped" ? "SKIP" : "BLOCKED";
  console.log(`[${tag}] ${id}: ${detail}`);
}

function loadEnvLocal() {
  const envPath = join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readLines(envPath)) {
    if (line.match(/^\s*#/) || line.match(/^\s*$/)) continue;
    const pair = line.split("=", 2);
    if (pair.length !== 2) continue;
    const key = pair[0]!.trim();
    const val = pair[1]!.trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8").split(/\r?\n/);
}

function dist(items: { country: string | null }[]): string {
  const m = new Map<string, number>();
  for (const r of items) m.set(r.country ?? "—", (m.get(r.country ?? "—") ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`)
    .join("  ");
}

function runFunnelDiagnostic(issueDate: string, incidents: FlashpointReportIncident[]): string {
  const sel = selectFlashpointUsable(incidents, "flashpoint", issueDate);
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w("# Flashpoint funnel — Week 0 baseline");
  w(`Issue date: ${issueDate}`);
  w(`Captured: ${new Date().toISOString()}`);
  w("");
  w(`raw window (in-window, flashpoint+protests): ${sel.rawWindowCount}`);

  const stages: FlashpointRejectStage[] = [
    "off-topic",
    "kinetic-only",
    "court-only",
    "out-of-scope-crime",
    "duplicate",
    "weak-novelty",
    "weak-operational",
  ];
  for (const stage of stages) {
    const dropped = sel.rejected.filter((r) => r.stage === stage);
    w("");
    w(`STAGE DROP [${stage}] = ${dropped.length}`);
    if (dropped.length) w(`   countries: ${dist(dropped)}`);
  }

  w("");
  w("=".repeat(80));
  w(`FINAL REPORT SET = ${sel.enriched.length}`);
  w(`   countries: ${dist(sel.enriched.map((e) => ({ country: e.country })))}`);
  w("=".repeat(80));

  for (const focus of ["Nepal", "Bangladesh", "Philippines", "Japan", "Pakistan", "South Korea"]) {
    const drops = sel.rejected.filter((r) => r.country === focus);
    const inFinal = sel.enriched.filter((e) => (e.country ?? "") === focus).length;
    w("");
    w(`--- ${focus}: ${inFinal} in final, ${drops.length} dropped ---`);
    const byStage = new Map<string, number>();
    for (const d of drops) byStage.set(d.stage, (byStage.get(d.stage) ?? 0) + 1);
    for (const [s, n] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
      w(`   ${String(n).padStart(3)}  ${s}`);
    }
    for (const d of drops.slice(0, 5)) {
      w(`     [${d.stage}] ${d.date}  ${d.title}`);
    }
  }

  return lines.join("\n");
}

function runParityProof(issueDate: string, incidents: Parameters<typeof selectFlashpointUsable>[0]): string {
  const sel = selectFlashpointUsable(incidents, "flashpoint", issueDate);
  const ds = buildFlashpointReportDataset(incidents, "flashpoint", issueDate);
  const parityErrors = validateFlashpointReportDataset(ds);
  const distinctCard = ds.fastFacts.find((k) => k.label === "Distinct Incidents");
  if (distinctCard && distinctCard.value !== String(ds.enriched.length)) {
    parityErrors.push(`Distinct Incidents KPI "${distinctCard.value}" != enriched ${ds.enriched.length}`);
  }
  const enrichedIds = new Set(ds.enriched.map((r) => r.id));
  for (const r of [...ds.activismRows, ...ds.unrestRows]) {
    if (!enrichedIds.has(r.id)) parityErrors.push(`Table row id ${r.id} not in enriched set`);
  }

  const lines: string[] = [];
  lines.push("# Flashpoint parity proof — Week 0 baseline");
  lines.push(`Issue date: ${issueDate}`);
  lines.push(`Raw in-window: ${sel.rawWindowCount}`);
  lines.push(`INCLUDED: ${sel.enriched.length}  |  REJECTED: ${sel.rejected.length}`);
  lines.push(`DATASET enriched: ${ds.enriched.length}  |  PARITY: ${parityErrors.length === 0 ? "OK" : `${parityErrors.length} issue(s)`}`);
  if (parityErrors.length) {
    lines.push("");
    lines.push("PARITY FAILURES:");
    for (const e of parityErrors) lines.push(`  ✗ ${e}`);
  }
  return lines.join("\n");
}

async function stepExportSnapshot(): Promise<boolean> {
  const dbUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      execSync("pnpm exec tsx scripts/exportProdIncidentsSnapshot.ts", {
        cwd: join(here, ".."),
        stdio: "inherit",
        env: process.env,
      });
      record("0.1", "done", `Snapshot exported → ${snapshotPath}`);
      return true;
    } catch {
      record("0.1", "blocked", "exportProdIncidentsSnapshot failed — check PROD_DATABASE_URL");
      return false;
    }
  }

  if (process.env.PROD_SESSION_COOKIE) {
    try {
      execSync("pnpm exec tsx scripts/fetchProdSnapshotFromApi.ts", {
        cwd: join(here, ".."),
        stdio: "inherit",
        env: process.env,
      });
      record("0.1", "done", `Snapshot fetched via API → ${snapshotPath}`);
      return true;
    } catch {
      record("0.1", "blocked", "fetchProdSnapshotFromApi failed — check PROD_SESSION_COOKIE");
      return false;
    }
  }

  if (existsSync(snapshotPath)) {
    record("0.1", "skipped", `Using existing snapshot at ${snapshotPath}`);
    return true;
  }

  record(
    "0.1",
    "blocked",
    "Set PROD_DATABASE_URL in .env.local, or PROD_SESSION_COOKIE (logged-in Replit session)",
  );
  return false;
}

async function stepFunnelAndParity(hasSnapshot: boolean) {
  if (!hasSnapshot && !existsSync(snapshotPath)) {
    record("0.2", "blocked", "No snapshot — complete 0.1 first");
    record("0.3", "blocked", "No snapshot — complete 0.1 first");
    return;
  }

  process.env.USE_SNAPSHOT = "1";
  const { incidents, source, meta } = await loadFlashpointIncidents();
  log(`Loading incidents from ${source} (flashpoint=${meta.flashpointCount}, protests=${meta.protestsCount})`);

  const funnel = runFunnelDiagnostic(ISSUE, incidents);
  const funnelPath = join(outDir, `flashpoint-funnel-${ISSUE}.txt`);
  writeFileSync(funnelPath, funnel);
  const finalCount = (funnel.match(/FINAL REPORT SET = (\d+)/) ?? [])[1] ?? "?";
  record("0.2", "done", `Funnel written → ${funnelPath} (final set = ${finalCount})`);

  const parity = runParityProof(ISSUE, incidents);
  const parityPath = join(outDir, `flashpoint-parity-${ISSUE}.txt`);
  writeFileSync(parityPath, parity);
  const parityOk = parity.includes("PARITY: OK");
  record("0.3", "done", `Parity written → ${parityPath} (${parityOk ? "OK" : "issues found"})`);
}

async function stepHeadlessPdfs() {
  const dbUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    record("0.4", "blocked", "Set PROD_DATABASE_URL or DATABASE_URL for headless PDF export");
    return;
  }
  process.env.DATABASE_URL ??= dbUrl;

  const exports: { topic: string; out: string; extra?: Record<string, string> }[] = [
    { topic: "flashpoint", out: join(outDir, `flashpoint-before-${ISSUE}.pdf`) },
    { topic: "cargo_watch", out: join(outDir, `cargo-watch-before.pdf`) },
    {
      topic: "country",
      out: join(outDir, "indonesia-brief-before.pdf"),
      extra: { COUNTRY_SLUG: "indonesia" },
    },
  ];

  let ok = 0;
  for (const exp of exports) {
    try {
      const env = {
        ...process.env,
        TOPIC: exp.topic,
        OUT_PATH: exp.out,
        ISSUE_DATE: ISSUE,
        ...exp.extra,
      };
      execSync("pnpm exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts", {
        cwd: join(here, ".."),
        stdio: "pipe",
        env,
      });
      ok++;
    } catch (e) {
      log(`PDF export failed for ${exp.topic}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (ok === exports.length) {
    record("0.4", "done", `${ok} before PDFs exported to ${outDir}`);
  } else if (ok > 0) {
    record("0.4", "done", `${ok}/${exports.length} PDFs exported (some failed)`);
  } else {
    record("0.4", "blocked", "All PDF exports failed — check DATABASE_URL and report rows in prod");
  }
}

function stepPhase2Docx() {
  try {
    execSync("python scripts/generate_phase2_fix_plan_docx.py", {
      cwd: repoRoot,
      stdio: "inherit",
    });
    record("0.5", "done", "Phase 2 DOCX regenerated → docs/phase-2-fix-plan/phase-2-prioritised-fix-backlog.docx");
  } catch {
    record("0.5", "blocked", "python scripts/generate_phase2_fix_plan_docx.py failed");
  }
}

function writeManifest() {
  const manifest = {
    capturedAt: new Date().toISOString(),
    issueDate: ISSUE,
    steps: results,
    nextActions: results.some((r) => r.status === "blocked")
      ? [
          "Add PROD_DATABASE_URL to .env.local (Neon/Replit Postgres connection string), OR",
          "Add PROD_SESSION_COOKIE from logged-in Replit browser (DevTools → Cookies → connect.sid)",
          "Re-run: pnpm --filter workbench run baseline:week0",
        ]
      : ["Proceed to Sprint 1 Day 1 — FP-02 selector recovery"],
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const md = [
    "# Week 0 baseline manifest",
    "",
    `**Captured:** ${manifest.capturedAt}`,
    `**Issue date:** ${ISSUE}`,
    "",
    "| Step | Status | Detail |",
    "| --- | --- | --- |",
    ...results.map((r) => `| ${r.id} | ${r.status} | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Next actions",
    "",
    ...manifest.nextActions.map((a) => `- ${a}`),
  ].join("\n");
  writeFileSync(join(outDir, "README.md"), md);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  loadEnvLocal();

  log("=".repeat(60));
  log("Week 0 baseline capture");
  log(`Output: ${outDir}`);
  log(`Issue date: ${ISSUE}`);
  log("=".repeat(60));

  const hasSnapshot = await stepExportSnapshot();
  await stepFunnelAndParity(hasSnapshot || existsSync(snapshotPath));
  await stepHeadlessPdfs();
  stepPhase2Docx();
  record("0.6", "skipped", "Log Steve PDFs in docs/phase-1-baseline-audit/1.4-stakeholder-examples.md when received");

  writeManifest();

  const blocked = results.filter((r) => r.status === "blocked");
  if (blocked.length) {
    console.log("");
    console.log(`${blocked.length} step(s) blocked — see ${join(outDir, "README.md")}`);
    process.exit(1);
  }
  console.log("");
  console.log("Week 0 baseline complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
