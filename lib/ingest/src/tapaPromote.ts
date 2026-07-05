import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { db, incidentsTable } from "@workspace/db";
import type { InsertIncident } from "@workspace/db";
import { and, like, sql } from "drizzle-orm";
import type { Severity } from "./severity";
import { geocode } from "./geocode";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import { recordSourceHealth } from "./sourceHealth";
import {
  parseTapaHtml,
  tapaRowToRecord,
  TAPA_COLUMNS,
  type TapaRecord,
} from "./tapaParser";

// TAPA "Data Explorer" offline → incident PROMOTE pass.
//
// Reads the SAVED TAPA HTML pages (no scrape / no cookies / no credentials / no
// browser), parses them through the shared pure tapaParser, and promotes each
// row into a real Cargo Watch incident (topic='cargo_watch'). Mirrors the GDELT
// promote pass (gdeltPromote.ts): a pure, unit-testable decision function plus a
// commit runner that dedupes against the DB by an idempotency marker and never
// closes the shared pool.
//
// No fabrication: every promoted incident's title/summary is a faithful
// restatement of TAPA's own nine structured fields. The only derived value is
// the EUR→USD conversion, which is done at a CONFIGURED FX rate and always
// accompanied by an explicit provenance sentence in the summary.

export const TAPA_SOURCE_LABEL = "TAPA EMEA (APAC)";

// Idempotency marker prefix written to analyst_notes. The full marker is
// `tapa_offline:<sha256(9 fields)>:<n>` where n is the occurrence index within
// the group of rows byte-identical across all nine fields — so even genuine
// duplicate rows get a stable, unique marker and a re-run never double-inserts.
export const TAPA_PROMOTE_MARKER_PREFIX = "tapa_offline:";

// Default EUR→USD rate, overridable via TAPA_EUR_USD_RATE. Kept configurable so
// the conversion is never a hard-coded guess baked into the data.
export const DEFAULT_EUR_USD_RATE = 1.09;
export const TAPA_EUR_USD_RATE_ENV = "TAPA_EUR_USD_RATE";

/** Read the configured EUR→USD rate, falling back to the default. */
export function readTapaEurUsdRate(): number {
  const raw = process.env[TAPA_EUR_USD_RATE_ENV];
  if (!raw) return DEFAULT_EUR_USD_RATE;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EUR_USD_RATE;
}

// Categories that map to MODERATE on their own (user-defined). Verbatim TAPA
// "Incident Category" spellings.
export const TAPA_MODERATE_CATEGORIES = new Set<string>([
  "Robbery",
  "Theft of Vehicle",
  "Theft from Vehicle",
  "Theft from Facility",
]);

// Modus operandi that maps to MODERATE on its own (user-defined). Verbatim TAPA
// "Modus Operandi" spelling.
export const TAPA_VIOLENT_MODUS = "Violent & Threat with Violence";

// APAC + Middle East country names recognised as in-scope Cargo Watch geography.
// MUST mirror the APAC + MIDDLE_EAST sets in
// artifacts/workbench/src/lib/cargoAnalysis.ts (lib/ingest cannot import a
// workbench module). Keep in sync when scope changes. analystInScope is only set
// true for a row whose (normalised) country is in this set, so an unexpected
// TAPA dateline can never be forced into scope.
export const TAPA_SCOPE_COUNTRIES = new Set<string>([
  // APAC
  "Singapore", "Malaysia", "Indonesia", "Thailand", "Vietnam", "Philippines",
  "Cambodia", "Laos", "Myanmar", "India", "Pakistan", "Bangladesh", "Sri Lanka",
  "China", "Taiwan", "South Korea", "Japan", "Australia", "New Zealand",
  "Papua New Guinea",
  // Middle East
  "Saudi Arabia", "UAE", "United Arab Emirates", "Oman", "Qatar", "Bahrain",
  "Kuwait", "Jordan", "Iran", "Iraq", "Yemen", "Israel", "Lebanon", "Syria",
]);

/**
 * Normalise a raw TAPA country label to the canonical name the rest of the
 * pipeline uses. Hong Kong is filed under China (matching cargoAnalysis's
 * "hong kong"→China alias) with a geo hint so it still plots at the city.
 */
export function normaliseTapaCountry(raw: string): { country: string; geoHint?: string } {
  const c = raw.trim();
  const lc = c.toLowerCase();
  if (lc === "viet nam" || lc === "vietnam") return { country: "Vietnam" };
  if (lc === "korea, republic of" || lc === "south korea" || lc === "republic of korea") {
    return { country: "South Korea" };
  }
  if (lc.startsWith("taiwan")) return { country: "Taiwan" };
  if (lc === "hong kong") return { country: "China", geoHint: "Hong Kong" };
  return { country: c };
}

/** Parse a TAPA "Value EUR" cell to an integer, or null for "N/A" / blank. */
export function parseTapaEur(valueEur: string): number | null {
  const cleaned = valueEur.replace(/[,\s]/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

/** Convert EUR to USD at the given rate, rounded to the nearest integer. */
export function eurToUsd(eur: number, rate: number): number {
  return Math.round(eur * rate);
}

/**
 * Severity band per the owner spec. Precedence High → Moderate → Low; the tiers
 * Extreme and Insignificant are NEVER assigned here.
 *   HIGH     = High Value = Yes OR USD >= 100000
 *   MODERATE = USD in [10000, 100000) OR Violent modus OR one of the four
 *              MODERATE categories
 *   LOW      = everything else (USD < 10000, or Value EUR = N/A)
 */
export function decideTapaSeverity(
  highValue: string,
  usd: number | null,
  modusOperandi: string,
  incidentCategory: string,
): Severity {
  const isHighValue = /^yes$/i.test(highValue.trim());
  if (isHighValue || (usd != null && usd >= 100000)) return "high";
  const violent = modusOperandi.trim().toLowerCase() === TAPA_VIOLENT_MODUS.toLowerCase();
  const moderateCategory = TAPA_MODERATE_CATEGORIES.has(incidentCategory.trim());
  if ((usd != null && usd >= 10000 && usd < 100000) || violent || moderateCategory) {
    return "moderate";
  }
  return "low";
}

/** Parse a "dd.mm.yyyy" TAPA date to a UTC-midnight Date, or null if invalid. */
export function parseTapaDate(dateOfIncident: string): Date | null {
  const m = dateOfIncident.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates that JS would otherwise roll over (e.g. 31.02).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** sha256 hex of the nine TAPA fields, used as the idempotency marker body. */
export function tapaRowHash(row: string[]): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

/** Build the full idempotency marker for a row hash + occurrence index. */
export function tapaMarker(rowHash: string, occurrence: number): string {
  return `${TAPA_PROMOTE_MARKER_PREFIX}${rowHash}:${occurrence}`;
}

/** True when an analyst_notes value carries a TAPA promote marker. */
export function isTapaMarker(analystNotes: string | null | undefined): boolean {
  return !!analystNotes && analystNotes.startsWith(TAPA_PROMOTE_MARKER_PREFIX);
}

function fmtThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const UK_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatUkDate(d: Date): string {
  return `${d.getUTCDate()} ${UK_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function isMeaningful(v: string, blankWords: RegExp): boolean {
  const t = v.trim();
  return t !== "" && !blankWords.test(t);
}

/** The nine TAPA fields plus the resolved FX rate and idempotency marker. */
export interface TapaPromoteInput {
  dateOfIncident: string;
  incidentCategory: string;
  modusOperandi: string;
  productCategory: string;
  locationType: string;
  highValue: string;
  valueEur: string;
  city: string;
  country: string;
  eurUsdRate: number;
  marker: string;
}

export type TapaPromoteDecision =
  | { promote: true; row: InsertIncident }
  | { promote: false; reason: "no-date" | "no-country" };

/** Build a TapaPromoteInput from a parsed record + rate + marker. */
export function tapaInputFromRecord(
  rec: TapaRecord,
  eurUsdRate: number,
  marker: string,
): TapaPromoteInput {
  return {
    dateOfIncident: rec["Date of incident"],
    incidentCategory: rec["Incident Category"],
    modusOperandi: rec["Modus Operandi"],
    productCategory: rec["Product Category"],
    locationType: rec["Location Type"],
    highValue: rec["High Value"],
    valueEur: rec["Value EUR"],
    city: rec["City"],
    country: rec["Country"],
    eurUsdRate,
    marker,
  };
}

/**
 * Decide whether one TAPA row promotes into an incident, and if so build the
 * exact InsertIncident row. Pure and side-effect free (bar `new Date()` for the
 * evaluation timestamp) so the whole mapping is unit-testable without a DB.
 */
export function decideTapaPromotion(input: TapaPromoteInput): TapaPromoteDecision {
  const occurredAt = parseTapaDate(input.dateOfIncident);
  if (!occurredAt) return { promote: false, reason: "no-date" };

  if (!input.country.trim()) return { promote: false, reason: "no-country" };
  const norm = normaliseTapaCountry(input.country);

  const eur = parseTapaEur(input.valueEur);
  const usd = eur != null ? eurToUsd(eur, input.eurUsdRate) : null;
  const severity = decideTapaSeverity(
    input.highValue,
    usd,
    input.modusOperandi,
    input.incidentCategory,
  );

  const inScope = TAPA_SCOPE_COUNTRIES.has(norm.country);
  const city = input.city.trim();
  const geoText = city || norm.geoHint || "";
  const geo = geocode(norm.country, geoText);
  const location = city || norm.geoHint || geo?.location || null;

  const category = input.incidentCategory.trim();
  const placeLabel = location ? `${location}, ${norm.country}` : norm.country;

  const catBlank = /^(unknown|n\/a)$/i;
  const catLabel = isMeaningful(category, catBlank) ? category : "Cargo crime incident";
  const productBlank = /^(unspecified|unknown|n\/a)$/i;
  const product = isMeaningful(input.productCategory, productBlank)
    ? input.productCategory.trim()
    : null;

  const title = product
    ? `${catLabel} of ${product} — ${placeLabel}`
    : `${catLabel} — ${placeLabel}`;

  const summaryParts: string[] = [
    `TAPA-recorded cargo crime incident on ${formatUkDate(occurredAt)} in ${placeLabel}.`,
    `Incident category: ${category || "Unknown"}.`,
    `Modus operandi: ${input.modusOperandi.trim() || "Unknown"}.`,
    `Product category: ${input.productCategory.trim() || "Unspecified"}.`,
    `Location type: ${input.locationType.trim() || "Unknown"}.`,
  ];
  if (usd != null) {
    // The USD figure sits next to the word "value" so the Cargo Watch USD-loss
    // parser (parseUsdLoss) captures it; the FX sentence carries no digits so it
    // cannot interfere with that first-match parse.
    summaryParts.push(
      `Estimated goods value US$${fmtThousands(usd)}. ` +
        `Original TAPA value reported in EUR and converted to USD using configured FX rate.`,
    );
  }
  const summary = summaryParts.join(" ");

  const row: InsertIncident = {
    topic: "cargo_watch",
    title: title.slice(0, 500),
    summary: summary.slice(0, 2000),
    country: norm.country,
    location,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    occurredAt,
    severity,
    confidence: "high",
    source: TAPA_SOURCE_LABEL,
    sourceUrl: null,
    category: category || null,
    fatalities: null,
    actors: null,
    analystNotes: input.marker,
    analystInScope: inScope,
    relevanceStatus: "relevant",
    relevanceScore: 1,
    relevanceReason: `tapa offline: ${category || "cargo crime"}`,
    relevanceVersion: RELEVANCE_RULE_VERSION,
    relevanceEvaluatedAt: new Date(),
  };

  return { promote: true, row };
}

/**
 * Assign a stable idempotency marker to every parsed row. Rows byte-identical
 * across all nine fields share a hash; the occurrence index (0-based, in stable
 * parse order) disambiguates them so genuine duplicates each get a unique
 * marker and a re-run reproduces the exact same markers.
 */
export function markTapaRows(rows: string[][]): Array<{ record: TapaRecord; marker: string }> {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const hash = tapaRowHash(row);
    const n = counts.get(hash) ?? 0;
    counts.set(hash, n + 1);
    return { record: tapaRowToRecord(row), marker: tapaMarker(hash, n) };
  });
}

export interface TapaPromoteSummary {
  mode: "commit" | "dry-run";
  reason: "ok" | "html-dir-not-found" | "no-html-files";
  htmlDir: string | null;
  filesParsed: number;
  eurUsdRate: number;
  rowsParsed: number;
  promotable: number;
  skippedNoDate: number;
  skippedNoCountry: number;
  /** Already-promoted (idempotency marker present) — skipped. */
  duplicateMarker: number;
  newToInsert: number;
  inserted: number;
  bySeverity: Array<[string, number]>;
  byCountry: Array<[string, number]>;
  /** Total TAPA-promoted incidents in the table after this run (commit only). */
  totalAfter: number | null;
  errors: string[];
  logLines: string[];
}

export function emptyTapaPromoteSummary(err?: unknown): TapaPromoteSummary {
  return {
    mode: "commit",
    reason: "no-html-files",
    htmlDir: null,
    filesParsed: 0,
    eurUsdRate: DEFAULT_EUR_USD_RATE,
    rowsParsed: 0,
    promotable: 0,
    skippedNoDate: 0,
    skippedNoCountry: 0,
    duplicateMarker: 0,
    newToInsert: 0,
    inserted: 0,
    bySeverity: [],
    byCountry: [],
    totalAfter: null,
    errors: err ? [err instanceof Error ? err.message : String(err)] : [],
    logLines: [],
  };
}

/**
 * Resolve the directory holding the saved TAPA HTML pages. Honours
 * TAPA_HTML_DIR, else searches upward from the current working directory for an
 * `attached_assets` folder (so it works whether the process runs from the repo
 * root or a package subdir), returning null when none is found.
 */
export function resolveTapaHtmlDir(): string | null {
  const override = process.env.TAPA_HTML_DIR;
  if (override) {
    const p = resolve(override);
    return existsSync(p) ? p : null;
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "attached_assets");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Recursively collect *.html / *.htm files under a directory. */
export function collectTapaHtmlFiles(dir: string): string[] {
  const found: string[] = [];
  const scan = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) scan(full);
      else if (/\.html?$/i.test(full)) found.push(full);
    }
  };
  try {
    scan(dir);
  } catch {
    return [];
  }
  return found.sort();
}

/**
 * Promote SAVED TAPA HTML rows into Cargo Watch incidents. Reads local HTML
 * files (0 network), builds incident rows, dedupes against existing incidents by
 * the idempotency marker only, and inserts the new ones. Returns a structured
 * summary. Does NOT close the shared pool (mirrors runGdeltPromote).
 */
export async function runTapaPromote(
  opts: { commit?: boolean; htmlDir?: string; eurUsdRate?: number } = {},
): Promise<TapaPromoteSummary> {
  const commit = opts.commit ?? false;
  const eurUsdRate = opts.eurUsdRate ?? readTapaEurUsdRate();
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);

  log(`tapa-promote — mode=${commit ? "COMMIT" : "DRY-RUN"} rate=${eurUsdRate}`);

  const htmlDir = opts.htmlDir ?? resolveTapaHtmlDir();
  if (!htmlDir) {
    log("  attached_assets not found — set TAPA_HTML_DIR. Nothing to promote.");
    return {
      ...emptyTapaPromoteSummary(),
      mode: commit ? "commit" : "dry-run",
      reason: "html-dir-not-found",
      htmlDir: null,
      eurUsdRate,
      logLines,
    };
  }

  const files = collectTapaHtmlFiles(htmlDir);
  if (files.length === 0) {
    log(`  no HTML files under ${htmlDir}. Nothing to promote.`);
    return {
      ...emptyTapaPromoteSummary(),
      mode: commit ? "commit" : "dry-run",
      reason: "no-html-files",
      htmlDir,
      eurUsdRate,
      logLines,
    };
  }

  const allRows: string[][] = [];
  let filesParsed = 0;
  for (const file of files) {
    const parsed = parseTapaHtml(readFileSync(file, "utf8"));
    if (!parsed) {
      log(`  no incident table in ${file} — skipped.`);
      continue;
    }
    if (parsed.missingColumns.length > 0) {
      log(`  ${file}: missing columns ${parsed.missingColumns.join(", ")}`);
    }
    allRows.push(...parsed.rows);
    filesParsed++;
  }

  const marked = markTapaRows(allRows);

  let skippedNoDate = 0;
  let skippedNoCountry = 0;
  const decided: InsertIncident[] = [];
  for (const { record, marker } of marked) {
    const d = decideTapaPromotion(tapaInputFromRecord(record, eurUsdRate, marker));
    if (!d.promote) {
      if (d.reason === "no-date") skippedNoDate++;
      else skippedNoCountry++;
      continue;
    }
    decided.push(d.row);
  }

  // Dedupe against existing incidents by the idempotency marker ONLY (a re-run
  // reproduces identical markers). Deliberately no fuzzy title/URL key: a TAPA
  // row and a separately-scraped news row for the same event are kept distinct.
  const existing = await db
    .select({ analystNotes: incidentsTable.analystNotes })
    .from(incidentsTable)
    .where(like(incidentsTable.analystNotes, `${TAPA_PROMOTE_MARKER_PREFIX}%`));
  const seenMarkers = new Set<string>();
  for (const row of existing) {
    if (row.analystNotes) seenMarkers.add(row.analystNotes);
  }

  let duplicateMarker = 0;
  const toInsert: InsertIncident[] = [];
  const bySeverity = new Map<string, number>();
  const byCountry = new Map<string, number>();
  for (const row of decided) {
    const marker = row.analystNotes ?? "";
    if (seenMarkers.has(marker)) {
      duplicateMarker++;
      continue;
    }
    seenMarkers.add(marker);
    toInsert.push(row);
    bySeverity.set(row.severity, (bySeverity.get(row.severity) ?? 0) + 1);
    byCountry.set(row.country, (byCountry.get(row.country) ?? 0) + 1);
  }

  log(`  files parsed          : ${filesParsed}/${files.length}`);
  log(`  rows parsed           : ${allRows.length}`);
  log(`  promotable            : ${decided.length}`);
  log(`  no-date               : ${skippedNoDate}`);
  log(`  no-country            : ${skippedNoCountry}`);
  log(`  already promoted      : ${duplicateMarker}`);
  log(`  new to insert         : ${toInsert.length}`);

  let inserted = 0;
  let totalAfter: number | null = null;
  if (commit && toInsert.length > 0) {
    try {
      // Chunk the insert so a very large first import stays within pool limits.
      const CHUNK = 100;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        await db.insert(incidentsTable).values(toInsert.slice(i, i + CHUNK));
      }
      inserted = toInsert.length;
      log(`  inserted              : ${inserted}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      log(`  INSERT FAILED         : ${msg}`);
    }
  } else if (!commit) {
    log("  DRY-RUN — no rows written. Re-run with commit to insert.");
  }

  if (commit) {
    const res = await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM incidents WHERE analyst_notes LIKE ${
        TAPA_PROMOTE_MARKER_PREFIX + "%"
      }`,
    );
    totalAfter = (res.rows[0] as { count: number } | undefined)?.count ?? null;

    if (errors.length === 0) {
      await recordSourceHealth(
        "cargo_watch",
        [
          {
            name: "TAPA EMEA (APAC) — offline import",
            url: "https://www.tapaemea.org",
            ok: true,
            collected: allRows.length,
            retained: inserted,
            rejected: skippedNoDate + skippedNoCountry + duplicateMarker,
          },
        ],
        {
          sourceType: "manual",
          reliability: 4,
          notes:
            "Offline TAPA Data Explorer pages promoted into Cargo Watch incidents. EUR values converted to USD at a configured FX rate (provenance stated per incident).",
          scrapeMethod: "Offline HTML import (no scrape)",
        },
      );
    }
  }

  return {
    mode: commit ? "commit" : "dry-run",
    reason: "ok",
    htmlDir,
    filesParsed,
    eurUsdRate,
    rowsParsed: allRows.length,
    promotable: decided.length,
    skippedNoDate,
    skippedNoCountry,
    duplicateMarker,
    newToInsert: toInsert.length,
    inserted,
    bySeverity: [...bySeverity.entries()].sort((a, b) => b[1] - a[1]),
    byCountry: [...byCountry.entries()].sort((a, b) => b[1] - a[1]),
    totalAfter,
    errors,
    logLines,
  };
}

// Re-export so consumers can reference the parsed column list alongside the
// promote API without a second import.
export { TAPA_COLUMNS };
