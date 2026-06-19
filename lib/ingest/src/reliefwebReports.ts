import { db, reliefwebReportsTable, type InsertReliefWebReport } from "@workspace/db";
import { eq, inArray, or, sql } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";
import { isReliefWebConfigured, RELIEFWEB_NOT_CONFIGURED_MESSAGE } from "./reliefweb";

// ReliefWeb (UN OCHA) situational-report CONTEXT adapter.
//
// This is DISTINCT from runReliefWebCorroboration (reliefweb.ts). That pass
// attaches corroborating LINKS to incidents we already scraped. This adapter
// pulls ReliefWeb reports as STANDALONE supporting context for the APAC
// countries we monitor and stores them in their OWN table (reliefweb_reports).
//
// CRITICAL PRODUCT RULE: ReliefWeb enriches the assessment, it does not drive
// the count. These rows are NEVER incidents and live in a separate table, so no
// incident-counting surface can be inflated by them.
//
// The appname is an identifier, not a secret — supply it via RELIEFWEB_APPNAME.
// ReliefWeb's v2 API rejects unapproved appnames with 403, so until an APPROVED
// name is configured the adapter no-ops cleanly (records a not_configured /
// failing source on Source Health) and never crashes the wider ingest cycle.
// Every byte of the upstream response is treated as UNTRUSTED input and each
// field is shape-validated before use. Like every ingest module, it NEVER closes
// the shared DB pool — only the CLI wrapper does.

const RELIEFWEB_ENDPOINT = "https://api.reliefweb.int/v2/reports";
const APPNAME = process.env.RELIEFWEB_APPNAME?.trim() || "";

// APAC countries the workbench monitors. New Zealand is deliberately excluded.
const MONITORED_COUNTRIES = [
  "Indonesia",
  "Philippines",
  "Thailand",
  "Malaysia",
  "Myanmar",
  "Cambodia",
  "Bangladesh",
  "Papua New Guinea",
  "Australia",
] as const;

// First-ever run looks back this many days; subsequent runs resume from the last
// stored report's date (date.created), with a small overlap absorbed by dedup.
const FIRST_RUN_LOOKBACK_DAYS = 7;
const OVERLAP_MS = 12 * 60 * 60 * 1000;

const PAGE_LIMIT = 100;
const MAX_PAGES = 5; // hard cap: at most 500 reports per run.

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 20000;
const BASE_BACKOFF_MS = 2500;

// Constant adapter source key (part of the dedup key).
const SOURCE_NAME = "reliefweb";
// Source Health registration — a DISTINCT row from the corroboration pass
// ("ReliefWeb (UN OCHA)") so the two ReliefWeb uses never overwrite each other.
const HEALTH_TOPIC = "conflict";
const HEALTH_SOURCE_NAME = "ReliefWeb Situational Reports (UN OCHA)";
const HEALTH_NOTES =
  "UN OCHA ReliefWeb — official situational/humanitarian reports pulled as supporting CONTEXT (never as incidents) for the monitored APAC countries. Auto-refreshed each ingest run.";

// ReliefWeb is a REAL API behind bot protection that returns 406 "Blocked due
// to bot activity" for browser-impersonating User-Agents (the opposite of the
// Google-News feeds, which need a browser UA). It identifies clients by the
// `appname` parameter, so we send that same appname as an honest, non-browser
// User-Agent. With a browser UA the request never reaches the 403 appname gate,
// so an approved appname alone would still be blocked.
const RELIEFWEB_UA = APPNAME || "polestar-advisory-workbench";

export type ReliefWebReportsSummary = {
  source: "reliefweb_reports";
  mode: "commit" | "dry-run";
  configured: boolean;
  /** ISO start of the date.created window queried this run, or null. */
  windowFrom: string | null;
  /** Reports returned by the upstream (post-validation). */
  reportsFetched: number;
  /** Malformed upstream rows dropped during validation. */
  rejected: number;
  /** Validated reports already present in the table (skipped). */
  duplicateInDb: number;
  /** Validated reports new to the table. */
  newToInsert: number;
  /** Rows actually written (commit mode). */
  inserted: number;
  /** Total reliefweb_reports rows after the run. */
  totalAfter: number;
  /** Newest stored report date after the run (ISO), or null. */
  latestReportDate: string | null;
  /** Distinct countries represented in this run's fetched reports. */
  countriesCovered: string[];
  /** False when configured but every upstream fetch failed. */
  fetchOk: boolean;
  errors: string[];
  logLines: string[];
};

// --- Untrusted-response handling ---------------------------------------------

type NormalisedReport = {
  externalId: string;
  title: string;
  summary: string | null;
  body: string | null;
  url: string;
  sourceOrg: string | null;
  country: string | null;
  countries: string[];
  publishedAt: Date | null;
  originalDate: Date | null;
  categoryRaw: string | null;
  confidence: string;
  tags: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Strip light markdown to plain text and clip for storage. */
function toPlainText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/[*_`>#]+/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, max) : null;
}

function namesFrom(value: unknown, max: number): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (item && typeof item === "object") {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
    if (out.length >= max) break;
  }
  return out;
}

const HIGH_CONFIDENCE_ORG =
  /\b(ocha|united nations|un\b|unhcr|who\b|unicef|wfp\b|undp|fao\b|iom\b|ifrc|icrc|red cross|red crescent|european commission)\b/i;

const TAG_KEYWORDS: Array<[string, RegExp]> = [
  ["flood", /\bflood/i],
  ["earthquake", /\bearthquake|\bquake/i],
  ["cyclone", /\bcyclone|\btyphoon|\bstorm/i],
  ["drought", /\bdrought/i],
  ["conflict", /\bconflict|\bclash|\barmed|\bfighting|\binsurg/i],
  ["displacement", /\bdisplac|\brefugee|\bidp\b|\bevacuat/i],
  ["food", /\bfood security|\bfamine|\bhunger|\bmalnutrition/i],
  ["health", /\bhealth|\bdisease|\boutbreak|\bcholera|\bmeasles/i],
  ["protection", /\bprotection|\bhuman rights|\bgbv\b/i],
];

function deriveTags(title: string, categoryRaw: string | null, country: string | null): string[] {
  const hay = `${title} ${categoryRaw ?? ""}`;
  const tags = new Set<string>();
  for (const [tag, re] of TAG_KEYWORDS) if (re.test(hay)) tags.add(tag);
  if (country) tags.add(country.toLowerCase());
  return Array.from(tags);
}

/** Coerce one upstream report into our trusted shape; null drops the row. */
function normaliseReport(raw: unknown): NormalisedReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const fields = r.fields;
  if (typeof id !== "string" && typeof id !== "number") return null;
  if (!fields || typeof fields !== "object") return null;
  const f = fields as Record<string, unknown>;

  const title = typeof f.title === "string" ? f.title.trim() : "";
  if (!title) return null;

  let url = typeof f.url_alias === "string" ? f.url_alias : "";
  if (!url && typeof f.url === "string") url = f.url;
  if (!url) url = `https://reliefweb.int/node/${id}`;
  if (!/^https?:\/\//i.test(url)) return null;

  let sourceOrg: string | null = null;
  if (Array.isArray(f.source) && f.source.length > 0) {
    const s = f.source[0];
    if (s && typeof s === "object") {
      const so = s as Record<string, unknown>;
      const name =
        (typeof so.shortname === "string" && so.shortname) ||
        (typeof so.name === "string" && so.name) ||
        null;
      sourceOrg = name ? String(name).slice(0, 200) : null;
    }
  }

  let publishedAt: Date | null = null;
  let originalDate: Date | null = null;
  if (f.date && typeof f.date === "object") {
    const d = f.date as Record<string, unknown>;
    publishedAt = parseDate(d.created) ?? parseDate(d.original);
    originalDate = parseDate(d.original);
  }

  let country: string | null = null;
  if (f.primary_country && typeof f.primary_country === "object") {
    const name = (f.primary_country as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) country = name.trim();
  }
  const countries = namesFrom(f.country, 30);
  if (!country && countries.length > 0) country = countries[0]!;

  const body = toPlainText(f.body, 8000);
  let summary: string | null = null;
  if (f.headline && typeof f.headline === "object") {
    summary = toPlainText((f.headline as Record<string, unknown>).summary, 600);
  }
  if (!summary && body) summary = body.slice(0, 400);

  const categories = [
    ...namesFrom(f.format, 5),
    ...namesFrom(f.theme, 8),
    ...namesFrom(f.disaster_type, 5),
  ];
  const categoryRaw = categories.length ? categories.join(", ").slice(0, 400) : null;

  const confidence = sourceOrg && HIGH_CONFIDENCE_ORG.test(sourceOrg) ? "high" : "medium";
  const tags = deriveTags(title, categoryRaw, country);

  return {
    externalId: String(id),
    title: title.slice(0, 500),
    summary,
    body,
    url,
    sourceOrg,
    country,
    countries,
    publishedAt,
    originalDate,
    categoryRaw,
    confidence,
    tags,
  };
}

/**
 * Fetch ONE page of reports created since `from` for the monitored countries.
 * Retries transient failures only; throws a clear Error on permanent failure
 * (e.g. 403 unapproved appname) so the caller records a failing source.
 */
// ReliefWeb's date-range filters validate the request BEFORE the appname check,
// and they reject the millisecond-bearing `Date.toISOString()` form
// (`2026-06-12T06:56:11.143Z` → 400 "must be an ISO 8601 date"). They accept a
// second-precision ISO 8601 with a numeric offset, so strip the milliseconds and
// rewrite the `Z` as `+00:00`. Without this the request never reaches the 403
// appname gate, so an approved appname alone would not make it work.
function reliefwebDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function fetchReportsPage(from: Date, offset: number): Promise<NormalisedReport[]> {
  const body = {
    appname: APPNAME,
    limit: PAGE_LIMIT,
    offset,
    filter: {
      operator: "AND",
      conditions: [
        { field: "date.created", value: { from: reliefwebDate(from) } },
        { field: "country", value: MONITORED_COUNTRIES as unknown as string[], operator: "OR" },
      ],
    },
    fields: {
      include: [
        "id",
        "title",
        "url",
        "url_alias",
        "date.created",
        "date.original",
        "source.name",
        "source.shortname",
        "primary_country.name",
        "country.name",
        "headline.summary",
        "body",
        "format.name",
        "theme.name",
        "disaster_type.name",
      ],
    },
    sort: ["date.created:desc"],
  };
  const url = `${RELIEFWEB_ENDPOINT}?appname=${encodeURIComponent(APPNAME)}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "User-Agent": RELIEFWEB_UA,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          redirect: "follow",
        });
      } catch (err) {
        throw {
          transient: true,
          message: ctrl.signal.aborted
            ? `timed out after ${FETCH_TIMEOUT_MS}ms`
            : err instanceof Error
              ? err.message
              : String(err),
        };
      }
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        let detail: string;
        if (res.status === 403) {
          detail =
            "status 403 — appname not approved by ReliefWeb (request approval at https://apidoc.reliefweb.int/parameters#appname)";
        } else if (res.status === 406) {
          // ReliefWeb/HDX bot protection blocks datacenter egress IPs (same
          // class as the Liveuamap Cloudflare block). Expected from Replit's
          // egress; the request itself is well-formed and reaches the API.
          detail =
            "status 406 — blocked by ReliefWeb bot protection (datacenter egress IP); expected from this network, retries on the next cycle";
        } else {
          detail = `status ${res.status}`;
        }
        throw { transient, message: detail };
      }
      const json: unknown = await res.json();
      const data =
        json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).data)
          ? ((json as Record<string, unknown>).data as unknown[])
          : [];
      const out: NormalisedReport[] = [];
      for (const item of data) {
        const norm = normaliseReport(item);
        if (norm) out.push(norm);
      }
      // Attach a private marker so the caller can count raw vs validated.
      (out as NormalisedReport[] & { rawCount?: number }).rawCount = data.length;
      return out;
    } catch (err) {
      lastErr = err;
      const transient = !!(err && typeof err === "object" && (err as { transient?: boolean }).transient);
      if (transient && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      } else {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const msg =
    lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String((lastErr as { message: unknown }).message)
      : String(lastErr);
  throw new Error(msg);
}

async function tableStats(): Promise<{ total: number; latest: Date | null }> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      latest: sql<Date | null>`max(${reliefwebReportsTable.publishedAt})`,
    })
    .from(reliefwebReportsTable)
    .where(eq(reliefwebReportsTable.sourceName, SOURCE_NAME));
  return { total: row?.n ?? 0, latest: row?.latest ?? null };
}

/**
 * Run the ReliefWeb situational-context ingest. Pulls reports for the monitored
 * APAC countries created since the last stored report (or the 7-day lookback on
 * a first run), validates and de-duplicates them, and stores the new ones. Never
 * throws — all failures are captured in the returned summary so an upstream
 * outage cannot break the wider ingest cycle. Does NOT close the shared DB pool.
 */
export async function runReliefWebReportsIngest(
  opts: { commit?: boolean } = {},
): Promise<ReliefWebReportsSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  const configured = isReliefWebConfigured();

  log(`ReliefWeb situational reports — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const base: ReliefWebReportsSummary = {
    source: "reliefweb_reports",
    mode: commit ? "commit" : "dry-run",
    configured,
    windowFrom: null,
    reportsFetched: 0,
    rejected: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestReportDate: null,
    countriesCovered: [],
    fetchOk: true,
    errors,
    logLines,
  };

  try {
    if (!configured) {
      log(RELIEFWEB_NOT_CONFIGURED_MESSAGE);
      if (commit) {
        await recordSourceHealth(
          HEALTH_TOPIC,
          [{ name: HEALTH_SOURCE_NAME, url: "https://reliefweb.int", ok: false, error: RELIEFWEB_NOT_CONFIGURED_MESSAGE }],
          { sourceType: "api", reliability: 5, notes: HEALTH_NOTES, notConfigured: true },
        );
      }
      const stats = await tableStats();
      base.totalAfter = stats.total;
      base.latestReportDate = stats.latest ? stats.latest.toISOString() : null;
      return base;
    }

    const stats0 = await tableStats();
    const from = stats0.latest
      ? new Date(stats0.latest.getTime() - OVERLAP_MS)
      : new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 86400000);
    base.windowFrom = from.toISOString();
    log(`  window: date.created from ${from.toISOString()} (${stats0.latest ? "incremental" : "first-run 7d"})`);

    // Paginate newest-first until a short page or the page cap.
    const fetched: NormalisedReport[] = [];
    let rawTotal = 0;
    let fetchOk = true;
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_LIMIT;
      try {
        const pageRows = await fetchReportsPage(from, offset);
        const raw = (pageRows as NormalisedReport[] & { rawCount?: number }).rawCount ?? pageRows.length;
        rawTotal += raw;
        fetched.push(...pageRows);
        log(`  page ${page + 1}: ${raw} report(s) returned, ${pageRows.length} valid`);
        if (raw < PAGE_LIMIT) break;
      } catch (err) {
        fetchOk = false;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        log(`  FETCH ERROR (page ${page + 1}): ${msg}`);
        break;
      }
    }
    base.fetchOk = fetchOk;
    base.reportsFetched = fetched.length;
    base.rejected = Math.max(0, rawTotal - fetched.length);

    // Dedup within the batch by externalId (newest-first wins).
    const byId = new Map<string, NormalisedReport>();
    for (const rep of fetched) if (!byId.has(rep.externalId)) byId.set(rep.externalId, rep);
    const unique = Array.from(byId.values());

    const countriesCovered = Array.from(
      new Set(unique.map((r) => r.country).filter((c): c is string => !!c)),
    ).sort();
    base.countriesCovered = countriesCovered;

    // Dedup against the DB: external_id (primary) + url (fallback).
    let toInsert: NormalisedReport[] = unique;
    if (unique.length > 0) {
      const ids = unique.map((r) => r.externalId);
      const urls = unique.map((r) => r.url);
      const existing = await db
        .select({ externalId: reliefwebReportsTable.externalId, url: reliefwebReportsTable.url })
        .from(reliefwebReportsTable)
        .where(
          or(
            inArray(reliefwebReportsTable.externalId, ids),
            inArray(reliefwebReportsTable.url, urls),
          ),
        );
      const haveId = new Set(existing.map((e) => e.externalId));
      const haveUrl = new Set(existing.map((e) => e.url));
      toInsert = unique.filter((r) => !haveId.has(r.externalId) && !haveUrl.has(r.url));
    }
    base.duplicateInDb = unique.length - toInsert.length;
    base.newToInsert = toInsert.length;
    log(`  ${unique.length} unique fetched; ${base.duplicateInDb} already stored; ${toInsert.length} new`);

    if (commit) {
      if (toInsert.length > 0) {
        const values: InsertReliefWebReport[] = toInsert.map((r) => ({
          sourceName: SOURCE_NAME,
          externalId: r.externalId,
          title: r.title,
          summary: r.summary,
          body: r.body,
          url: r.url,
          sourceOrg: r.sourceOrg,
          country: r.country,
          countries: r.countries,
          publishedAt: r.publishedAt,
          originalDate: r.originalDate,
          categoryRaw: r.categoryRaw,
          sourceType: "humanitarian_report",
          classification: "context",
          confidence: r.confidence,
          tags: r.tags,
        }));
        const inserted = await db
          .insert(reliefwebReportsTable)
          .values(values)
          .onConflictDoNothing()
          .returning({ id: reliefwebReportsTable.id });
        base.inserted = inserted.length;
      }
      // Health: failing only when configured but every fetch failed.
      const feedOk = fetchOk || fetched.length > 0;
      await recordSourceHealth(
        HEALTH_TOPIC,
        [
          {
            name: HEALTH_SOURCE_NAME,
            url: "https://reliefweb.int",
            ok: feedOk,
            error: feedOk ? null : errors[0] ?? "ReliefWeb reports query failed",
          },
        ],
        { sourceType: "api", reliability: 5, notes: HEALTH_NOTES },
      );
      log(`  committed: ${base.inserted} new report(s) stored`);
    } else {
      log(`  DRY-RUN — no rows written.`);
    }

    const stats1 = await tableStats();
    base.totalAfter = stats1.total;
    base.latestReportDate = stats1.latest ? stats1.latest.toISOString() : null;
    return base;
  } catch (err) {
    // Never let this break the wider ingest cycle.
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    log(`  UNEXPECTED ERROR: ${msg}`);
    base.fetchOk = false;
    try {
      const stats = await tableStats();
      base.totalAfter = stats.total;
      base.latestReportDate = stats.latest ? stats.latest.toISOString() : null;
    } catch {
      // ignore — best effort.
    }
    return base;
  }
}

/** Empty summary used when the reports pass is skipped (e.g. lock contention). */
export function emptyReliefWebReportsSummary(): ReliefWebReportsSummary {
  return {
    source: "reliefweb_reports",
    mode: "dry-run",
    configured: isReliefWebConfigured(),
    windowFrom: null,
    reportsFetched: 0,
    rejected: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestReportDate: null,
    countriesCovered: [],
    fetchOk: true,
    errors: [],
    logLines: [],
  };
}
