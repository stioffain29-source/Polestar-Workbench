/**
 * TAPA APAC incident importer.
 *
 * Standalone, read-only export. Fetches the TAPA (TIS) incident index — pages
 * 1..5 at per-page=100 — parses the incident GridView table ONLY, and writes a
 * single CSV: tapa_apac_incidents.csv at the repository root.
 *
 * It does NOT touch the database, Cargo Watch, or any incident table — it only
 * reads the remote grid and writes a CSV file.
 *
 * Auth: the full logged-in dataset (per-page=100, member scope) requires a TAPA
 * session. Provide it via the TAPA_SESSION_COOKIE secret — copy the whole cookie
 * string for database.tapaemea.org from a logged-in browser. Without it the
 * request falls back to the anonymous public version, which hard-caps at 10 rows
 * per page and is unfiltered.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.TAPA_INCIDENT_URL ?? "https://database.tapaemea.org/incident/index";
const PER_PAGE = Number(process.env.TAPA_PER_PAGE ?? "100");
const PAGE_COUNT = Number(process.env.TAPA_PAGES ?? "5");
const PAGES = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1);
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = process.env.TAPA_OUT ?? resolve(REPO_ROOT, "tapa_apac_incidents.csv");
const COOKIE = process.env.TAPA_SESSION_COOKIE?.trim();

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

/** Strip all markup from a table cell and collapse whitespace. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

interface ParsedGrid {
  headers: string[];
  rows: string[][];
}

/**
 * Parse the incident GridView from a TIS page. Picks the <table> that actually
 * carries data-key rows (the kv-grid), reads its <th> header labels, then each
 * <tr data-key="…"> row's <td> cells.
 */
function parseIncidentGrid(pageHtml: string): ParsedGrid {
  const tables = [...pageHtml.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  const gridInner =
    tables.map((m) => m[1]).find((inner) => /<tr\b[^>]*\bdata-key=/i.test(inner)) ??
    tables[0]?.[1] ??
    "";

  const headers = [...gridInner.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => cellText(m[1]))
    .filter((h) => h.length > 0);

  const rows: string[][] = [];
  for (const tr of gridInner.matchAll(/<tr\b[^>]*\bdata-key=[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return { headers, rows };
}

async function fetchPage(page: number): Promise<string> {
  const url = `${BASE}?page=${page}&per-page=${PER_PAGE}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
  });
  if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main(): Promise<void> {
  if (!COOKIE) {
    console.warn(
      "WARNING: TAPA_SESSION_COOKIE not set — using the anonymous public TIS " +
        "version (hard-capped at 10 rows/page, unfiltered). Provide the secret " +
        "to export the full logged-in dataset.",
    );
  }

  let headers: string[] = [];
  const allRows: string[][] = [];
  const perPageCounts: number[] = [];

  for (const page of PAGES) {
    const html = await fetchPage(page);
    const grid = parseIncidentGrid(html);
    if (grid.headers.length > headers.length) headers = grid.headers;
    if (grid.rows.length === 0 && /\b(please )?log ?in\b/i.test(cellText(html))) {
      console.warn(`page ${page}: 0 rows and a login prompt is present — the session may be unauthenticated.`);
    }
    perPageCounts.push(grid.rows.length);
    allRows.push(...grid.rows);
    console.log(`page ${page}: ${grid.rows.length} incident rows`);
    if (page !== PAGES[PAGES.length - 1]) await new Promise((r) => setTimeout(r, 800));
  }

  if (headers.length === 0) {
    throw new Error("No incident table found — the page layout may have changed or the session is invalid.");
  }

  const lines = [headers.map(csvCell).join(",")];
  for (const row of allRows) {
    lines.push(headers.map((_h, i) => csvCell(row[i] ?? "")).join(","));
  }
  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

  // Country breakdown (context only) — find the "Country" column if present.
  const countryIdx = headers.findIndex((h) => /^country$/i.test(h));
  if (countryIdx >= 0) {
    const tally = new Map<string, number>();
    for (const row of allRows) {
      const c = (row[countryIdx] ?? "").trim() || "(blank)";
      tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    console.log("Country breakdown:", top.map(([c, n]) => `${c}=${n}`).join(", "));
  }

  console.log(
    `\nWrote ${allRows.length} incident rows to ${OUT}` +
      `\nColumns: ${headers.join(" | ")}` +
      `\nPer-page counts: ${perPageCounts.join(", ")}` +
      `\nSession: ${COOKIE ? "logged-in (TAPA_SESSION_COOKIE)" : "anonymous public"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
