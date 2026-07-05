/**
 * TAPA Data Explorer importer (offline, upload-only).
 *
 * Parses the incident table from one or more SAVED TAPA Data Explorer HTML
 * files and writes every row (NO dedupe) to a main CSV, plus a separate review
 * CSV listing rows that are byte-identical across all 9 fields.
 *
 * It does NOT scrape TAPA, use login cookies, store credentials, or automate a
 * browser. It only reads local .html files and writes a CSV. Nothing here
 * touches the database or Cargo Watch.
 *
 * The HTML parsing is the SHARED, unit-tested parser from @workspace/ingest
 * (parseTapaHtml / TAPA_COLUMNS) — the same code the incident promote pass uses
 * — so the CSV export and the incident import can never diverge in how they
 * read a page.
 *
 * Input discovery (first match wins):
 *   1. File/dir paths passed as CLI args after `--`.
 *   2. TAPA_HTML_DIR env var (a directory to scan).
 *   3. Default: scan ./attached_assets recursively for *.html / *.htm.
 *
 * Output (both at the repository root, both exactly the 9 columns, no extras):
 *   - tapa_apac_incidents_raw.csv — every row from every page, NO dedupe
 *     (override with TAPA_RAW_OUT).
 *   - tapa_apac_incidents_possible_duplicates.csv — every occurrence of any row
 *     byte-identical across all 9 fields, grouped, for analyst review only
 *     (override with TAPA_DUPES_OUT).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run import:tapa-explorer
 *   pnpm --filter @workspace/scripts run import:tapa-explorer -- attached_assets/page1.html attached_assets/page2.html
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseTapaHtml, TAPA_COLUMNS } from "@workspace/ingest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const RAW_OUT = process.env.TAPA_RAW_OUT ?? resolve(REPO_ROOT, "tapa_apac_incidents_raw.csv");
const DUPES_OUT =
  process.env.TAPA_DUPES_OUT ??
  resolve(REPO_ROOT, "tapa_apac_incidents_possible_duplicates.csv");

function collectHtmlFiles(): string[] {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const isHtml = (p: string) => /\.html?$/i.test(p);
  const scanDir = (dir: string): string[] => {
    const found: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) found.push(...scanDir(full));
      else if (isHtml(full)) found.push(full);
    }
    return found;
  };

  if (args.length > 0) {
    const files: string[] = [];
    for (const a of args) {
      const full = resolve(a);
      let st;
      try {
        st = statSync(full);
      } catch {
        console.warn(`Input not found, skipping: ${a}`);
        continue;
      }
      if (st.isDirectory()) files.push(...scanDir(full));
      else if (isHtml(full)) files.push(full);
      else console.warn(`Skipping non-HTML input: ${a}`);
    }
    return files;
  }

  const dir = process.env.TAPA_HTML_DIR
    ? resolve(process.env.TAPA_HTML_DIR)
    : resolve(REPO_ROOT, "attached_assets");
  try {
    return scanDir(dir).sort();
  } catch {
    return [];
  }
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function main(): void {
  const files = collectHtmlFiles();
  if (files.length === 0) {
    console.error(
      "No HTML files found. Upload your saved TAPA Data Explorer pages to " +
        "attached_assets/ (or pass file paths after `--`), then re-run.",
    );
    process.exit(1);
  }

  const combined: string[][] = [];
  let parsedFiles = 0;
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const parsed = parseTapaHtml(html);
    if (!parsed) {
      console.warn(`No incident table found in ${file} — skipped.`);
      continue;
    }
    if (parsed.missingColumns.length > 0) {
      console.warn(
        `${file}: missing columns ${parsed.missingColumns.join(", ")} (left blank).`,
      );
    }
    combined.push(...parsed.rows);
    parsedFiles += 1;
    console.log(`${file}: ${parsed.rows.length} rows`);
  }

  const header = TAPA_COLUMNS.map(csvCell).join(",");
  const toCsv = (rows: string[][]) =>
    [header, ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";

  // Main output: EVERY row from EVERY page, NO dedupe, exact 9 columns.
  writeFileSync(RAW_OUT, toCsv(combined), "utf8");

  // Review output: every occurrence of any row byte-identical across all 9
  // fields, grouped by first appearance. Analyst review only — never used to
  // prune the main file.
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  combined.forEach((row, i) => {
    const key = JSON.stringify(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, i);
  });
  const dupeKeys = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([k]) => k)
    .sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
  const dupeRows: string[][] = [];
  for (const key of dupeKeys) {
    const row = JSON.parse(key) as string[];
    for (let n = 0; n < (counts.get(key) ?? 0); n++) dupeRows.push(row);
  }
  writeFileSync(DUPES_OUT, toCsv(dupeRows), "utf8");

  const countryIdx = TAPA_COLUMNS.indexOf("Country");
  const tally = new Map<string, number>();
  for (const row of combined) {
    const c = (row[countryIdx] ?? "").trim() || "(blank)";
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]);

  console.log(
    `\nParsed ${parsedFiles}/${files.length} file(s).` +
      `\nMain (no dedupe): ${combined.length} rows -> ${RAW_OUT}` +
      `\nPossible duplicates: ${dupeRows.length} rows in ${dupeKeys.length} group(s) -> ${DUPES_OUT}` +
      `\nCountry breakdown: ${top.map(([c, n]) => `${c}=${n}`).join(", ")}`,
  );
}

main();
