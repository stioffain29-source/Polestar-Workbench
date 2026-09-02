/**
 * Assemble a detailed Phase 4.1 validation report from gate logs + metadata.
 *
 * Usage:
 *   npx tsx scripts/buildPhase41Report.ts <detail-dir>
 *
 * Expects:
 *   <detail-dir>/header.env   — KEY=value run metadata
 *   <detail-dir>/gates.tsv    — tab-separated gate results
 *   <detail-dir>/<gate-id>.log
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type GateId =
  | "typecheck"
  | "jest"
  | "pdf-fonts"
  | "topic-font-audit"
  | "country-brief-sweep";

type GateResult = "PASS" | "FAIL" | "SKIP";

interface GateMeta {
  id: GateId;
  label: string;
  description: string;
  result: GateResult;
  exitCode: number;
  durationSec: number;
  skipReason?: string;
}

const GATE_DESCRIPTIONS: Record<GateId, string> = {
  typecheck: "TypeScript project references + artifact packages",
  jest: "Full Jest suite (all workbench / lib / ingest tests)",
  "pdf-fonts":
    "Country brief PDF font gate — PNG, West Papua, Indonesia must use Roboto only",
  "topic-font-audit":
    "Topic report PDF font gate — shipping, fuel, cargo_watch, flashpoint",
  "country-brief-sweep":
    "Six structured country briefs — §33 gate, §30 banned phrases, §16 trend wording",
};

const GATE_ORDER: GateId[] = [
  "typecheck",
  "jest",
  "pdf-fonts",
  "topic-font-audit",
  "country-brief-sweep",
];

function readLog(dir: string, id: GateId): string {
  const path = join(dir, `${id}.log`);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function readHeader(dir: string): Record<string, string> {
  const path = join(dir, "header.env");
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

function readGates(dir: string): GateMeta[] {
  const path = join(dir, "gates.tsv");
  if (!existsSync(path)) return [];
  const rows = readFileSync(path, "utf8").trimEnd().split("\n").slice(1);
  const byId = new Map<GateId, GateMeta>();
  for (const row of rows) {
    const [id, result, exitCode, durationSec, label, skipReason] = row.split("\t");
    if (!id) continue;
    const gateId = id as GateId;
    byId.set(gateId, {
      id: gateId,
      label: label || gateId,
      description: GATE_DESCRIPTIONS[gateId] ?? gateId,
      result: result as GateResult,
      exitCode: Number(exitCode),
      durationSec: Number(durationSec),
      skipReason: skipReason || undefined,
    });
  }
  return GATE_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
}

function tail(text: string, lines: number): string {
  const rows = text.trimEnd().split("\n");
  if (rows.length <= lines) return text.trimEnd();
  return rows.slice(-lines).join("\n");
}

function extractJestSummary(log: string): string[] {
  const out: string[] = [];
  for (const line of log.split("\n")) {
    if (/Test Suites:/.test(line)) out.push(line.trim());
    if (/Tests:/.test(line)) out.push(line.trim());
    if (/Snapshots:/.test(line)) out.push(line.trim());
    if (/Time:/.test(line)) out.push(line.trim());
  }
  return out.length ? out : ["(Jest summary line not found in log)"];
}

function extractFontPassLines(log: string): string[] {
  return log
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.startsWith(">>") ||
        l.startsWith("PASS") ||
        l.startsWith("FAIL") ||
        /Roboto|Tf-operator|Auditing fonts|Exporting/i.test(l),
    );
}

function extractCountrySweepLines(log: string): string[] {
  const lines = log.split("\n");
  const start = lines.findIndex((l) => l.includes("country brief sweep summary"));
  const slice = start >= 0 ? lines.slice(Math.max(0, start - 40)) : lines;
  return slice
    .map((l) => l.trimEnd())
    .filter(
      (l) =>
        l.startsWith(">>") ||
        l.startsWith("PASS") ||
        l.startsWith("FAIL") ||
        l.includes("[countryGate]") ||
        l.includes("country brief sweep summary"),
    );
}

function section(title: string, body: string): string {
  const bar = "-".repeat(72);
  return `${bar}\n${title}\n${bar}\n${body.trimEnd()}\n`;
}

function formatGateTable(gates: GateMeta[]): string {
  const header = "Gate".padEnd(22) + "Result".padEnd(8) + "Duration".padEnd(10) + "Notes";
  const rows = gates.map((g) => {
    const note = g.skipReason ?? GATE_DESCRIPTIONS[g.id];
    const dur = g.result === "SKIP" ? "—" : `${g.durationSec}s`;
    return (
      g.id.padEnd(22) +
      g.result.padEnd(8) +
      dur.padEnd(10) +
      note.slice(0, 80)
    );
  });
  return [header, "-".repeat(72), ...rows].join("\n");
}

function gateDetail(g: GateMeta, log: string): string {
  const head = [
    `Gate: ${g.label} (${g.id})`,
    `Purpose: ${GATE_DESCRIPTIONS[g.id]}`,
    `Result: ${g.result} (exit ${g.exitCode}, ${g.durationSec}s)`,
  ];
  if (g.skipReason) head.push(`Skip reason: ${g.skipReason}`);

  let body = "";
  if (g.result === "SKIP") {
    body = g.skipReason ? `Skipped — ${g.skipReason}` : "Skipped.";
  } else if (g.id === "jest") {
    const summary = extractJestSummary(log);
    const excerpt =
      g.result === "FAIL"
        ? tail(log, 80)
        : `${summary.join("\n")}\n\n${tail(log, 15)}`;
    body = excerpt;
  } else if (g.id === "pdf-fonts" || g.id === "topic-font-audit") {
    const highlights = extractFontPassLines(log);
    body =
      (highlights.length ? highlights.join("\n") : tail(log, 40)) +
      (g.result === "FAIL" ? `\n\n--- log tail ---\n${tail(log, 60)}` : "");
  } else if (g.id === "country-brief-sweep") {
    const highlights = extractCountrySweepLines(log);
    body =
      (highlights.length ? highlights.join("\n") : tail(log, 50)) +
      (g.result === "FAIL" ? `\n\n--- log tail ---\n${tail(log, 80)}` : "");
  } else {
    body = g.result === "FAIL" ? tail(log, 80) : tail(log, 30);
  }

  return section(g.label.toUpperCase(), [...head, "", body].join("\n"));
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: buildPhase41Report.ts <detail-dir>");
    process.exit(2);
  }

  const header = readHeader(dir);
  const gates = readGates(dir);
  const status = (header.STATUS ?? "UNKNOWN") as "PASSED" | "FAILED";
  const durationSec = Number(header.DURATION_SEC ?? "0");
  const failedGateCount = Number(header.FAILED_GATE_COUNT ?? "0");
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const dbConfigured = header.DATABASE_CONFIGURED === "true";

  const failed = gates.filter((g) => g.result === "FAIL");
  const skipped = gates.filter((g) => g.result === "SKIP");

  const reportHeader = [
    "=".repeat(72),
    "POLESTAR WORKBENCH — PHASE 4.1 VALIDATION REPORT",
    "=".repeat(72),
    "",
    `Status:           ${status}`,
    `Run started:      ${header.STARTED_AT ?? "unknown"}`,
    `Run finished:     ${header.FINISHED_AT ?? "unknown"}`,
    `Total duration:   ${durationLabel} (${durationSec}s)`,
    `Host:             ${header.HOST ?? "unknown"}`,
    `Repository:       ${header.REPO ?? "unknown"}`,
    `Live DB gates:    ${dbConfigured ? "enabled (PROD_DATABASE_URL set)" : "skipped — no database URL"}`,
    "",
    "Gates executed:",
    "  1. typecheck — pnpm typecheck",
    "  2. jest — pnpm test (full suite)",
    "  3. pdf-fonts — validateFonts.sh (country brief Roboto gate)",
    "  4. topic-font-audit — auditTopicFonts.sh (topic report Roboto gate)",
    "  5. country-brief-sweep — verifyCountryBriefs.sh (six country briefs)",
    "",
  ].join("\n");

  const executive = section(
    "EXECUTIVE SUMMARY",
    [
      formatGateTable(gates),
      "",
      status === "PASSED"
        ? "Overall: all gates green."
        : `Overall: ${failedGateCount} gate(s) failed or skipped.`,
    ].join("\n"),
  );

  const gateSections = gates.map((g) => gateDetail(g, readLog(dir, g.id))).join("\n");

  let failuresBlock = "";
  if (failed.length || skipped.length) {
    const lines: string[] = [];
    for (const g of failed) {
      lines.push(`FAIL  ${g.id}: exit ${g.exitCode} after ${g.durationSec}s`);
    }
    for (const g of skipped) {
      lines.push(`SKIP  ${g.id}: ${g.skipReason ?? "not run"}`);
    }
    failuresBlock = section("FAILURES AND SKIPS", lines.join("\n"));
  }

  const footer = section(
    "NEXT STEPS",
    status === "PASSED"
      ? [
          "No action required — all automated QA gates passed.",
          "Re-run: pnpm validate:phase41",
          "Reference: docs/ingestion-report-quality-plan.md §4.1",
        ].join("\n")
      : [
          "Review the failing gate sections above (full log tails included for FAIL gates).",
          "Fix issues, then re-run: pnpm validate:phase41",
          "Reference: docs/ingestion-report-quality-plan.md §4.1",
        ].join("\n"),
  );

  process.stdout.write(
    [reportHeader, executive, gateSections, failuresBlock, footer].join("\n"),
  );
}

main();
