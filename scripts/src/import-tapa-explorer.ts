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

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const RAW_OUT = process.env.TAPA_RAW_OUT ?? resolve(REPO_ROOT, "tapa_apac_incidents_raw.csv");
const DUPES_OUT =
  process.env.TAPA_DUPES_OUT ??
  resolve(REPO_ROOT, "tapa_apac_incidents_possible_duplicates.csv");

/** Exact output columns, in this order. */
const COLUMNS = [
  "Date of incident",
  "Incident Category",
  "Modus Operandi",
  "Product Category",
  "Location Type",
  "High Value",
  "Value EUR",
  "City",
  "Country",
] as const;

/**
 * Accepted header spellings per output column (normalised). Exact TIS labels
 * first; a few safe variants for the EUR value column. Kept conservative to
 * avoid mis-mapping a different column.
 */
const HEADER_ALIASES: Record<(typeof COLUMNS)[number], string[]> = {
  "Date of incident": ["date of incident", "incident date"],
  "Incident Category": ["incident category"],
  "Modus Operandi": ["modus operandi"],
  "Product Category": ["product category"],
  "Location Type": ["location type"],
  "High Value": ["high value"],
  "Value EUR": ["value eur", "value euro", "value in eur"],
  City: ["city"],
  Country: ["country"],
};

function normHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

interface TableInfo {
  headerCells: string[]; // positional (aligns with <td> order)
  nameToIndex: Map<string, number>; // normalised header -> column index
  rowsHtml: string[]; // inner HTML of each data <tr>
  score: number; // how many required columns matched
}

function inspectTable(tableInner: string): TableInfo {
  const theadMatch = tableInner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
  const headerSource = theadMatch ? theadMatch[1] : tableInner;
  const headerCells = [...headerSource.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    cellText(m[1]),
  );

  const nameToIndex = new Map<string, number>();
  headerCells.forEach((label, idx) => {
    const key = normHeader(label);
    if (key && !nameToIndex.has(key)) nameToIndex.set(key, idx);
  });

  let score = 0;
  for (const col of COLUMNS) {
    if (HEADER_ALIASES[col].some((a) => nameToIndex.has(a))) score += 1;
  }

  const bodyMatch = tableInner.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  const bodySource = bodyMatch ? bodyMatch[1] : tableInner;
  const rowsHtml = [...bodySource.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => m[1])
    .filter((tr) => /<td\b/i.test(tr)); // drop header/filter rows (th only)

  return { headerCells, nameToIndex, rowsHtml, score };
}

/** Choose the table on the page that best matches the required incident columns. */
function pickIncidentTable(html: string): TableInfo | null {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
  let best: TableInfo | null = null;
  for (const inner of tables) {
    const info = inspectTable(inner);
    if (!best || info.score > best.score) best = info;
  }
  // Require a clear majority of the 9 columns so we don't grab a layout table.
  return best && best.score >= 5 ? best : null;
}

function extractRows(info: TableInfo): string[][] {
  const colIndex = COLUMNS.map((col) => {
    for (const alias of HEADER_ALIASES[col]) {
      const idx = info.nameToIndex.get(alias);
      if (idx !== undefined) return idx;
    }
    return -1;
  });

  const out: string[][] = [];
  for (const trInner of info.rowsHtml) {
    const cells = [...trInner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    // Skip GridView "no results" placeholder rows.
    if (cells.length === 1 && /no results|empty/i.test(cells[0])) continue;
    const row = colIndex.map((idx) => (idx >= 0 ? (cells[idx] ?? "") : ""));
    if (row.some((v) => v !== "")) out.push(row);
  }
  return out;
}

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
    const info = pickIncidentTable(html);
    if (!info) {
      console.warn(`No incident table found in ${file} — skipped.`);
      continue;
    }
    const missing = COLUMNS.filter(
      (col) => !HEADER_ALIASES[col].some((a) => info.nameToIndex.has(a)),
    );
    if (missing.length > 0) {
      console.warn(`${file}: missing columns ${missing.join(", ")} (left blank).`);
    }
    const rows = extractRows(info);
    combined.push(...rows);
    parsedFiles += 1;
    console.log(`${file}: ${rows.length} rows`);
  }

  const header = COLUMNS.map(csvCell).join(",");
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

  const countryIdx = COLUMNS.indexOf("Country");
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
