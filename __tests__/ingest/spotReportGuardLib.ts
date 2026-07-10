import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

/** Paths scanned by the P1-D5 Spot Report guard (ingest only — never workbench/API routes). */
export const INGEST_SCAN_PATHS = [
  join(REPO_ROOT, "lib", "ingest"),
  join(REPO_ROOT, "artifacts", "api-server", "src", "lib", "ingestRunner.ts"),
];

export const FORBIDDEN_SPOT_REPORT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "spotReportsTable", re: /spotReportsTable/ },
  { name: "spot_reports", re: /spot_reports/ },
  { name: "insert.*spot", re: /\binsert\s*\([^)]*spot/i },
];

/**
 * Optional escape hatch for documented false positives. Empty today — ingest has
 * zero spot_report writes; guardrail comments are stripped before matching.
 */
export const SPOT_REPORT_GUARD_ALLOWLIST: { file: string; pattern: string }[] = [];

export interface SpotReportGuardViolation {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

/** Strip line and block comments so guardrail prose does not trip the scanner. */
export function stripTsComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += source[i];
    i++;
  }
  return out;
}

function collectTsFiles(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return path.endsWith(".ts") ? [path] : [];
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    out.push(...collectTsFiles(join(path, entry)));
  }
  return out;
}

function isAllowlisted(relFile: string, pattern: string): boolean {
  const norm = relFile.replace(/\\/g, "/");
  return SPOT_REPORT_GUARD_ALLOWLIST.some(
    (a) => norm.endsWith(a.file.replace(/\\/g, "/")) && a.pattern === pattern,
  );
}

export function scanSourceForSpotReportWrites(
  filePath: string,
  rawSource: string,
): SpotReportGuardViolation[] {
  const relFile = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  const source = stripTsComments(rawSource);
  const lines = source.split("\n");
  const violations: SpotReportGuardViolation[] = [];

  for (const { name, re } of FORBIDDEN_SPOT_REPORT_PATTERNS) {
    lines.forEach((line, idx) => {
      if (!re.test(line)) return;
      if (isAllowlisted(relFile, name)) return;
      violations.push({
        file: relFile,
        line: idx + 1,
        pattern: name,
        excerpt: line.trim().slice(0, 120),
      });
    });
  }

  return violations;
}

/** Scan all ingest modules and ingestRunner.ts for forbidden Spot Report writes. */
export function scanIngestForSpotReportWrites(): SpotReportGuardViolation[] {
  const files = INGEST_SCAN_PATHS.flatMap(collectTsFiles);
  const violations: SpotReportGuardViolation[] = [];
  for (const file of files) {
    violations.push(
      ...scanSourceForSpotReportWrites(file, readFileSync(file, "utf8")),
    );
  }
  return violations;
}
