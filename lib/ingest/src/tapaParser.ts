// Pure parser for SAVED TAPA "Data Explorer" HTML pages.
//
// Extracted from scripts/src/import-tapa-explorer.ts so BOTH the offline CSV
// importer AND the incident promote pass (tapaPromote.ts) parse the saved HTML
// through ONE implementation and can never drift. This module is pure: it takes
// an HTML string and returns table rows. It does NOT read files, scrape TAPA,
// use login cookies, store credentials, or automate a browser.

/** Exact output columns, in this order. */
export const TAPA_COLUMNS = [
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

export type TapaColumn = (typeof TAPA_COLUMNS)[number];
export type TapaRecord = Record<TapaColumn, string>;

/**
 * Accepted header spellings per output column (normalised). Exact TIS labels
 * first; a few safe variants for the EUR value column. Kept conservative to
 * avoid mis-mapping a different column.
 */
const HEADER_ALIASES: Record<TapaColumn, string[]> = {
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

/** Strip tags and collapse whitespace from a table cell's inner HTML. */
export function cellText(html: string): string {
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
  for (const col of TAPA_COLUMNS) {
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
  const colIndex = TAPA_COLUMNS.map((col) => {
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

export interface TapaParseResult {
  /** Rows aligned positionally to TAPA_COLUMNS (9 cells each). */
  rows: string[][];
  /** Columns whose header could not be found in the table (left blank). */
  missingColumns: TapaColumn[];
}

/**
 * Parse the incident table out of one saved TAPA Data Explorer HTML page.
 * Returns null when no table with a clear majority of the required columns is
 * present (e.g. a login page or an unrelated document).
 */
export function parseTapaHtml(html: string): TapaParseResult | null {
  const info = pickIncidentTable(html);
  if (!info) return null;
  const missingColumns = TAPA_COLUMNS.filter(
    (col) => !HEADER_ALIASES[col].some((a) => info.nameToIndex.has(a)),
  );
  return { rows: extractRows(info), missingColumns };
}

/** Turn a positional 9-cell row into a field-keyed record. */
export function tapaRowToRecord(row: string[]): TapaRecord {
  const rec = {} as TapaRecord;
  TAPA_COLUMNS.forEach((col, i) => {
    rec[col] = row[i] ?? "";
  });
  return rec;
}
