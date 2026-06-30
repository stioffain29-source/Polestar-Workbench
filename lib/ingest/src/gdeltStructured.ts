import {
  db,
  gdeltStructuredItemsTable,
  type InsertGdeltStructuredItem,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";
import {
  GDELT_STRUCTURED_HEALTH_NAME,
  GDELT_STRUCTURED_HEALTH_TOPIC,
  GDELT_STRUCTURED_NOT_CONFIGURED_MESSAGE,
} from "./optionalIntegrations";

// ===========================================================================
// GDELT Cloud structured event layer — a pilot ADDITIVE structured source.
//
// This adapter does a daily broad pull of GDELT Cloud v2 EVENTS and STORIES for
// the monitored countries and stores them as STANDALONE structured context in
// their OWN table (gdelt_structured_items), exactly like the ReliefWeb reports
// adapter stores humanitarian reports in reliefweb_reports.
//
//   CRITICAL PRODUCT RULE: these rows are NEVER incidents. They live in their
//   own table precisely so a GDELT item can never inflate any incident count,
//   never reach a report/PDF, and never touch the report editor. This module
//   does NOT import incidentsTable and never writes to it. It is an isolated,
//   read-only intelligence layer.
//
// It is also DISTINCT from gdeltEnrich.ts: that pass cross-matches GDELT v1
// Conflict-Events onto existing flashpoint INCIDENTS to attach precision fields.
// This module never touches incidents and uses the v2 Events/Stories API. The
// two share no Source Health row (different name + topic) so they never
// overwrite each other.
//
// LANES (events only): the broad per-country pull returns every GDELT category,
// so we bucket locally and KEEP only the events that map to a tracked lane.
// Anything that maps to no lane is dropped (never stored under a fabricated
// lane). STORIES are stored with lane = NULL — GDELT does not lane-code stories,
// so we never guess one.
//
// QU BUDGET DISCIPLINE (GDELT free plan ~100 Query Units/month, 1 QU per REST
// call): a daily pull of 4 countries x (events + stories) with pagination would
// blow the free budget, so the pass is bounded three ways (mirrors gdeltEnrich):
//   1. A cadence gate: it no-ops unless the last run was more than
//      GDELT_STRUCTURED_INTERVAL_HOURS ago (default 24h = daily), tracked via
//      max(fetched_at) so frequent autoscale cold starts cannot re-spend QU.
//   2. A hard per-run REST-call cap (GDELT_STRUCTURED_MAX_CALLS) enforced in the
//      client with 429 backoff — one run can never run away.
//   3. A per-feed page cap (GDELT_STRUCTURED_MAX_PAGES) on cursor pagination.
//
// Disable entirely with GDELT_STRUCTURED_ENABLED=false. With no
// GDELT_CLOUD_API_KEY it no-ops cleanly (records a not_configured source).
//
// Every byte of the upstream response is treated as UNTRUSTED input and each
// field is shape-validated before use. Like every ingest module it NEVER closes
// the shared DB pool — only the CLI wrapper does — and never throws: all
// failures are captured in the returned summary so an upstream outage cannot
// break the wider ingest cycle.
// ===========================================================================

// --- Configuration ----------------------------------------------------------

const GDELT_BASE = (
  process.env["GDELT_CLOUD_API_BASE"] ?? "https://gdeltcloud.com"
).replace(/\/+$/, "");

const SOURCE_NAME = "gdelt_cloud";

// Countries pulled (GDELT v2 takes the English country name).
const MONITORED_COUNTRIES = [
  "Indonesia",
  "Philippines",
  "Thailand",
  "Papua New Guinea",
] as const;

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Hours between pulls. Default daily.
const INTERVAL_HOURS = numEnv("GDELT_STRUCTURED_INTERVAL_HOURS", 24);
// Hard cap on REST calls (= QU) per run.
const MAX_CALLS = numEnv("GDELT_STRUCTURED_MAX_CALLS", 16);
// Cursor pages fetched per (country, kind) feed.
const MAX_PAGES = numEnv("GDELT_STRUCTURED_MAX_PAGES", 2);
// Per-page size.
const PAGE_LIMIT = numEnv("GDELT_STRUCTURED_PAGE_LIMIT", 100);
// Lookback window (days). GDELT list windows cannot exceed 30 days. A larger
// window seeds an empty table; once seeded a short rolling window plus dedup
// keeps the daily delta cheap.
const SEED_LOOKBACK_DAYS = Math.min(30, numEnv("GDELT_STRUCTURED_SEED_DAYS", 14));
const RECENT_LOOKBACK_DAYS = Math.min(30, numEnv("GDELT_STRUCTURED_RECENT_DAYS", 3));

const HEALTH_NOTES =
  "GDELT Cloud structured event layer — daily broad pull of GDELT Cloud v2 events + stories for the monitored countries, stored as standalone structured CONTEXT (never as incidents). Events are bucketed to tracked lanes; stories carry no lane. Auto-refreshed each ingest run.";
const HEALTH_URL = "https://gdeltcloud.com";

const FETCH_ATTEMPTS = 3;

/** True unless explicitly switched off with GDELT_STRUCTURED_ENABLED=false. */
export function isGdeltStructuredEnabled(): boolean {
  return process.env["GDELT_STRUCTURED_ENABLED"] !== "false";
}

/** True when a GDELT Cloud API key is present (required to make any call). */
export function isGdeltStructuredConfigured(): boolean {
  return !!process.env["GDELT_CLOUD_API_KEY"]?.trim();
}

// --- Defensive field access (untrusted upstream) ----------------------------

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s ? s : null;
}
function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asInt(v: unknown): number | null {
  const n = asNum(v);
  return n === null ? null : Math.trunc(n);
}
function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Lane + sub-bucket derivation -------------------------------------------

// Events whose `category` maps to one of these lanes are KEPT; everything else
// is dropped. Title-case categories come from family=conflict; the uppercase
// CRIME / INFRASTRUCTURE categories come from family=cameoplus. INFRASTRUCTURE
// is only kept when its event_code / subcategory is the IN02 "Transport
// Disruption" sub-code (IN01 energy / IN03 supply chain / etc. are dropped).
function resolveEventLane(
  category: string | null,
  subcategory: string | null,
  eventCode: string | null,
): string | null {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return null;
  if (c === "protests") return "Protests";
  if (c === "riots") return "Civil unrest and riots";
  if (
    c === "battles" ||
    c === "violence against civilians" ||
    c === "strategic developments" ||
    c.startsWith("explosions") ||
    c.includes("remote violence")
  ) {
    return "Security incidents";
  }
  if (c === "crime") return "Crime";
  if (c === "infrastructure") {
    const sub = (subcategory ?? "").trim().toUpperCase();
    const code = (eventCode ?? "").trim().toUpperCase();
    if (sub.startsWith("IN02") || code.startsWith("IN02")) {
      return "Transport disruption";
    }
    return null;
  }
  return null;
}

// Indonesia-only sub-buckets. Papua is gated on country=Indonesia so an
// Indonesian-Papua match never captures Papua New Guinea (its own country).
function resolveSubBucket(
  country: string | null,
  admin1: string | null,
  location: string | null,
): string | null {
  if ((country ?? "").trim().toLowerCase() !== "indonesia") return null;
  const hay = `${admin1 ?? ""} ${location ?? ""}`.toLowerCase();
  if (/jakarta/.test(hay)) return "Jakarta";
  if (/papua/.test(hay)) return "Indonesian Papua";
  return null;
}

// --- Normalised row ---------------------------------------------------------

type NormalisedItem = {
  kind: "event" | "story";
  externalId: string;
  row: InsertGdeltStructuredItem;
};

function geoOf(o: Record<string, unknown>): {
  country: string | null;
  region: string | null;
  continent: string | null;
  admin1: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const g = asObject(o.geo);
  return {
    country: asStr(g.country),
    region: asStr(g.region),
    continent: asStr(g.continent),
    admin1: asStr(g.admin1),
    location: asStr(g.location),
    latitude: asNum(g.latitude),
    longitude: asNum(g.longitude),
  };
}

/** Coerce one upstream EVENT into a trusted row, or null to drop it. */
function normaliseEvent(raw: unknown): NormalisedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const externalId = asStr(o.id);
  const title = asStr(o.title);
  if (!externalId || !title) return null;

  const category = asStr(o.category);
  const subcategory = asStr(o.subcategory);
  const eventCode = asStr(o.event_code);
  // Events that map to no tracked lane are dropped (never stored).
  const lane = resolveEventLane(category, subcategory, eventCode);
  if (!lane) return null;

  const geo = geoOf(o);
  const row: InsertGdeltStructuredItem = {
    sourceName: SOURCE_NAME,
    kind: "event",
    externalId,
    title: title.slice(0, 1000),
    summary: asStr(o.summary)?.slice(0, 4000) ?? null,
    url: asStr(o.url),
    primaryStoryUrl: asStr(o.primary_story_url),
    sourceDate: parseDate(o.event_date),
    codedAt: parseDate(o.coded_at),
    upstreamUpdatedAt: parseDate(o.updated_at),
    country: geo.country,
    region: geo.region,
    continent: geo.continent,
    admin1: geo.admin1,
    location: geo.location,
    latitude: geo.latitude,
    longitude: geo.longitude,
    family: asStr(o.family),
    category,
    subcategory,
    domain: asStr(o.domain),
    eventCode,
    lane,
    subBucket: resolveSubBucket(geo.country, geo.admin1, geo.location),
    hasFatalities: asBool(o.has_fatalities),
    fatalities: asInt(o.fatalities),
    imageUrl: asStr(o.image_url),
    topLanguage: asStr(o.top_language),
    actors: asArray(o.actors),
    metrics: asObject(o.metrics),
    topArticles: asArray(o.top_articles),
    linkedEvents: asArray(o.linked_events),
    storyRefs: [],
    extras: {
      geo_context: asObject(o.geo_context),
      civilian_targeting: o.civilian_targeting ?? null,
      civilian_targeting_label: asStr(o.civilian_targeting_label),
      processed_at: asStr(o.processed_at),
    },
  };
  return { kind: "event", externalId, row };
}

/** Coerce one upstream STORY into a trusted row (lane always NULL), or null. */
function normaliseStory(raw: unknown): NormalisedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const externalId = asStr(o.id);
  const title = asStr(o.title);
  if (!externalId || !title) return null;

  const geo = geoOf(o);
  const row: InsertGdeltStructuredItem = {
    sourceName: SOURCE_NAME,
    kind: "story",
    externalId,
    title: title.slice(0, 1000),
    summary: asStr(o.summary)?.slice(0, 4000) ?? null,
    url: asStr(o.url),
    primaryStoryUrl: null,
    sourceDate: parseDate(o.story_date),
    codedAt: null,
    upstreamUpdatedAt: parseDate(o.updated_at),
    country: geo.country,
    region: geo.region,
    continent: geo.continent,
    admin1: geo.admin1,
    location: geo.location,
    latitude: geo.latitude,
    longitude: geo.longitude,
    family: asStr(o.family),
    category: asStr(o.category),
    subcategory: asStr(o.subcategory),
    domain: asStr(o.domain),
    eventCode: null,
    // STORIES are never lane-coded — no fabrication.
    lane: null,
    subBucket: resolveSubBucket(geo.country, geo.admin1, geo.location),
    hasFatalities: asBool(o.has_fatalities),
    fatalities: asInt(o.fatalities),
    imageUrl: asStr(o.image_url),
    topLanguage: asStr(o.top_language),
    actors: [],
    metrics: asObject(o.metrics),
    topArticles: asArray(o.top_articles),
    linkedEvents: asArray(o.linked_events),
    storyRefs: [],
    extras: {
      geo_context: asObject(o.geo_context),
      entity_refs: asArray(o.entity_refs),
      language_breakdown: asArray(o.language_breakdown),
      has_events: o.has_events ?? null,
      has_civilian_targeting: o.has_civilian_targeting ?? null,
      processed_at: asStr(o.processed_at),
    },
  };
  return { kind: "story", externalId, row };
}

// --- GDELT Cloud v2 client (hard QU cap + 429 backoff) ----------------------

type Page = { data: unknown[]; nextCursor: string | null };

class GdeltV2Client {
  private calls = 0;
  constructor(
    private readonly apiKey: string,
    private readonly maxCalls: number,
  ) {}

  get qu(): number {
    return this.calls;
  }
  get exhausted(): boolean {
    return this.calls >= this.maxCalls;
  }

  async get(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<Page> {
    if (this.calls >= this.maxCalls) {
      throw new Error(`QU budget cap reached (${this.maxCalls} calls).`);
    }
    const url = new URL(`${GDELT_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    let attempt = 0;
    while (true) {
      attempt++;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
        });
      } catch (err) {
        if (attempt > FETCH_ATTEMPTS) {
          throw new Error(
            `network error after ${attempt} attempts: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await sleep(Math.min(10000, 1500 * attempt));
        continue;
      }
      // 429 is not charged a QU — respect Retry-After, bound the retries.
      if (res.status === 429) {
        if (attempt > 5) throw new Error("429 Too Many Requests — retries exhausted");
        const ra = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 2000 * attempt);
        await sleep(waitMs);
        continue;
      }
      this.calls++;
      const bodyText = await res.text();
      // 5xx may be transient — retry within the attempt budget.
      if (res.status >= 500 && attempt <= FETCH_ATTEMPTS) {
        await sleep(Math.min(10000, 1500 * attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${bodyText.slice(0, 300)}`);
      }
      let json: unknown;
      try {
        json = JSON.parse(bodyText);
      } catch {
        throw new Error(`Response was not JSON (first 200 chars): ${bodyText.slice(0, 200)}`);
      }
      const obj = asObject(json);
      if (obj.success === false) {
        throw new Error(
          `GDELT error: ${asStr(obj.error) ?? "unknown"} (${asStr(obj.code) ?? "?"})`,
        );
      }
      const data = asArray(obj.data);
      const pagination = asObject(obj.pagination);
      const nextCursor = asStr(pagination.next_cursor);
      return { data, nextCursor };
    }
  }
}

// --- Public types -----------------------------------------------------------

export type GdeltStructuredSummary = {
  source: "gdelt_structured";
  mode: "commit" | "dry-run";
  configured: boolean;
  /** False when GDELT_STRUCTURED_ENABLED=false or no API key. */
  enabled: boolean;
  /** Did the pass actually query GDELT this run? */
  ran: boolean;
  reason: "disabled" | "no-api-key" | "cadence" | "ok";
  windowFrom: string | null;
  windowTo: string | null;
  countriesQueried: string[];
  /** Valid events retained (post lane filter). */
  eventsFetched: number;
  /** Valid stories retained. */
  storiesFetched: number;
  /** Events dropped because they mapped to no tracked lane. */
  eventsDropped: number;
  /** Malformed upstream rows dropped during validation. */
  rejected: number;
  /** Validated items new to the table. */
  newToInsert: number;
  /** Rows actually written (commit mode). */
  inserted: number;
  /** Total gdelt_structured_items rows after the run. */
  totalAfter: number;
  /** Newest stored source_date after the run (ISO), or null. */
  latestSourceDate: string | null;
  /** REST calls spent this run (= QU). */
  quSpent: number;
  /** False when configured but every upstream fetch failed. */
  fetchOk: boolean;
  errors: string[];
  logLines: string[];
};

function emptyBase(commit: boolean, configured: boolean): GdeltStructuredSummary {
  return {
    source: "gdelt_structured",
    mode: commit ? "commit" : "dry-run",
    configured,
    enabled: isGdeltStructuredEnabled() && configured,
    ran: false,
    reason: "ok",
    windowFrom: null,
    windowTo: null,
    countriesQueried: [],
    eventsFetched: 0,
    storiesFetched: 0,
    eventsDropped: 0,
    rejected: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestSourceDate: null,
    quSpent: 0,
    fetchOk: true,
    errors: [],
    logLines: [],
  };
}

async function tableStats(): Promise<{ total: number; latest: Date | null }> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      latest: sql<Date | null>`max(${gdeltStructuredItemsTable.sourceDate})`,
    })
    .from(gdeltStructuredItemsTable)
    .where(eq(gdeltStructuredItemsTable.sourceName, SOURCE_NAME));
  const latestRaw = row?.latest ?? null;
  return { total: row?.n ?? 0, latest: latestRaw ? new Date(latestRaw) : null };
}

async function registerHealth(opts: {
  configured: boolean;
  disabled?: boolean;
  feedOk?: boolean;
  error?: string | null;
}): Promise<void> {
  if (!opts.configured) {
    const error = opts.disabled
      ? "GDELT_STRUCTURED_ENABLED=false — the structured event layer is switched off."
      : GDELT_STRUCTURED_NOT_CONFIGURED_MESSAGE;
    await recordSourceHealth(
      GDELT_STRUCTURED_HEALTH_TOPIC,
      [{ name: GDELT_STRUCTURED_HEALTH_NAME, url: HEALTH_URL, ok: false, error }],
      { sourceType: "api", reliability: 4, notes: HEALTH_NOTES, notConfigured: true },
    );
    return;
  }
  await recordSourceHealth(
    GDELT_STRUCTURED_HEALTH_TOPIC,
    [
      {
        name: GDELT_STRUCTURED_HEALTH_NAME,
        url: HEALTH_URL,
        ok: !!opts.feedOk,
        error: opts.feedOk ? null : (opts.error ?? "GDELT Cloud query failed — retrying next run"),
      },
    ],
    { sourceType: "api", reliability: 4, notes: HEALTH_NOTES },
  );
}

/**
 * Pull one (country, kind) feed across cursor pages, validating each row.
 * Returns the retained rows plus per-feed counters. Throws a clear Error only
 * on a permanent/first-page failure so the caller records the feed as failing;
 * a later-page failure stops pagination but keeps the rows already gathered.
 */
async function fetchFeed(
  client: GdeltV2Client,
  kind: "event" | "story",
  country: string,
  dateStart: string,
  dateEnd: string,
  log: (s: string) => void,
): Promise<{ items: NormalisedItem[]; rawCount: number; rejected: number; eventsDropped: number }> {
  const path = kind === "event" ? "/api/v2/events" : "/api/v2/stories";
  const items: NormalisedItem[] = [];
  let rawCount = 0;
  let rejected = 0;
  let eventsDropped = 0;
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (client.exhausted) {
      log(`  ${country}/${kind}: QU cap reached — stopping pagination at page ${page}.`);
      break;
    }
    const pageResult = await client.get(path, {
      country,
      date_start: dateStart,
      date_end: dateEnd,
      sort: "recent",
      limit: PAGE_LIMIT,
      cursor,
    });
    rawCount += pageResult.data.length;
    for (const raw of pageResult.data) {
      const norm = kind === "event" ? normaliseEvent(raw) : normaliseStory(raw);
      if (norm) {
        items.push(norm);
      } else if (kind === "event") {
        // Could be a malformed row OR a valid event with no tracked lane. We
        // can only tell by re-checking the id/title presence cheaply.
        if (raw && typeof raw === "object" && asStr((raw as Record<string, unknown>).id) && asStr((raw as Record<string, unknown>).title)) {
          eventsDropped++;
        } else {
          rejected++;
        }
      } else {
        rejected++;
      }
    }
    if (!pageResult.nextCursor || pageResult.data.length === 0) break;
    cursor = pageResult.nextCursor;
  }
  return { items, rawCount, rejected, eventsDropped };
}

/**
 * Run the GDELT Cloud structured event-layer ingest. Pulls events + stories for
 * the monitored countries over a recent window, buckets events to lanes,
 * de-duplicates against the table, and stores the new ones. Never throws. Does
 * NOT close the shared DB pool.
 */
export async function runGdeltStructuredIngest(
  opts: { commit?: boolean } = {},
): Promise<GdeltStructuredSummary> {
  const commit = opts.commit ?? false;
  const configured = isGdeltStructuredConfigured();
  const base = emptyBase(commit, configured);
  const log = (s: string) => base.logLines.push(s);
  log(`GDELT Cloud structured event layer — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  try {
    if (!isGdeltStructuredEnabled()) {
      log("GDELT_STRUCTURED_ENABLED=false — skipping (no QU spent).");
      base.enabled = false;
      base.reason = "disabled";
      if (commit) await registerHealth({ configured: false, disabled: true });
      const stats = await tableStats();
      base.totalAfter = stats.total;
      base.latestSourceDate = stats.latest ? stats.latest.toISOString() : null;
      return base;
    }

    const apiKey = process.env["GDELT_CLOUD_API_KEY"]?.trim();
    if (!apiKey) {
      log(GDELT_STRUCTURED_NOT_CONFIGURED_MESSAGE);
      base.enabled = false;
      base.reason = "no-api-key";
      if (commit) await registerHealth({ configured: false });
      const stats = await tableStats();
      base.totalAfter = stats.total;
      base.latestSourceDate = stats.latest ? stats.latest.toISOString() : null;
      return base;
    }

    // Cadence gate: skip unless the last run was > INTERVAL_HOURS ago. The
    // max(fetched_at) stamp acts as the last-run clock so frequent autoscale
    // cold starts cannot re-spend QU.
    const [{ lastRun } = { lastRun: null }] = (await db
      .select({ lastRun: sql<Date | null>`max(${gdeltStructuredItemsTable.fetchedAt})` })
      .from(gdeltStructuredItemsTable)
      .where(eq(gdeltStructuredItemsTable.sourceName, SOURCE_NAME))) as Array<{
      lastRun: Date | null;
    }>;
    if (lastRun) {
      const ageHours = (Date.now() - new Date(lastRun).getTime()) / 3600000;
      if (ageHours < INTERVAL_HOURS) {
        log(`Last run ${ageHours.toFixed(1)}h ago < ${INTERVAL_HOURS}h interval — skipping (no QU spent).`);
        base.reason = "cadence";
        const stats = await tableStats();
        base.totalAfter = stats.total;
        base.latestSourceDate = stats.latest ? stats.latest.toISOString() : null;
        return base;
      }
    }

    const stats0 = await tableStats();
    const lookbackDays = stats0.total === 0 ? SEED_LOOKBACK_DAYS : RECENT_LOOKBACK_DAYS;
    const now = new Date();
    const dateEnd = ymd(now);
    const dateStart = ymd(new Date(now.getTime() - lookbackDays * 86400000));
    base.windowFrom = dateStart;
    base.windowTo = dateEnd;
    base.reason = "ok";
    base.ran = true;
    log(`  window: ${dateStart} .. ${dateEnd} (${stats0.total === 0 ? "seed" : "recent"} ${lookbackDays}d)`);

    const client = new GdeltV2Client(apiKey, MAX_CALLS);
    const collected: NormalisedItem[] = [];
    const countriesQueried: string[] = [];
    let anyFeedOk = false;
    let firstError: string | null = null;

    for (const country of MONITORED_COUNTRIES) {
      if (client.exhausted) {
        log(`  QU cap reached before ${country} — stopping (will resume next run).`);
        break;
      }
      countriesQueried.push(country);
      for (const kind of ["event", "story"] as const) {
        if (client.exhausted) break;
        try {
          const r = await fetchFeed(client, kind, country, dateStart, dateEnd, log);
          collected.push(...r.items);
          base.rejected += r.rejected;
          base.eventsDropped += r.eventsDropped;
          anyFeedOk = true;
          log(`  ${country}/${kind}: ${r.rawCount} raw, ${r.items.length} kept, ${r.eventsDropped} no-lane, ${r.rejected} rejected.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!firstError) firstError = msg;
          base.errors.push(`${country}/${kind}: ${msg}`);
          log(`  FETCH ERROR ${country}/${kind}: ${msg}`);
        }
      }
    }

    base.quSpent = client.qu;
    base.countriesQueried = countriesQueried;
    base.fetchOk = anyFeedOk || base.errors.length === 0;

    // Dedup within the batch by (kind, externalId).
    const byKey = new Map<string, NormalisedItem>();
    for (const it of collected) {
      const key = `${it.kind}:${it.externalId}`;
      if (!byKey.has(key)) byKey.set(key, it);
    }
    const unique = Array.from(byKey.values());
    base.eventsFetched = unique.filter((u) => u.kind === "event").length;
    base.storiesFetched = unique.filter((u) => u.kind === "story").length;

    if (commit) {
      let inserted = 0;
      // Insert in chunks; the (source_name, kind, external_id) unique index makes
      // this idempotent via onConflictDoNothing — race-safe across manual +
      // scheduled runs.
      const CHUNK = 200;
      for (let i = 0; i < unique.length; i += CHUNK) {
        const slice = unique.slice(i, i + CHUNK).map((u) => u.row);
        if (slice.length === 0) continue;
        const res = await db
          .insert(gdeltStructuredItemsTable)
          .values(slice)
          .onConflictDoNothing()
          .returning({ id: gdeltStructuredItemsTable.id });
        inserted += res.length;
      }
      base.inserted = inserted;
      base.newToInsert = inserted;
      await registerHealth({ configured: true, feedOk: base.fetchOk, error: firstError });
      log(`  committed: ${inserted} new item(s) stored; QU spent ${base.quSpent}.`);
    } else {
      base.newToInsert = unique.length;
      log(`  DRY-RUN — ${unique.length} unique item(s); no rows written; QU spent ${base.quSpent}.`);
    }

    const stats1 = await tableStats();
    base.totalAfter = stats1.total;
    base.latestSourceDate = stats1.latest ? stats1.latest.toISOString() : null;
    return base;
  } catch (err) {
    // Never break the wider ingest cycle.
    const msg = err instanceof Error ? err.message : String(err);
    base.errors.push(msg);
    base.fetchOk = false;
    log(`  UNEXPECTED ERROR: ${msg}`);
    try {
      const stats = await tableStats();
      base.totalAfter = stats.total;
      base.latestSourceDate = stats.latest ? stats.latest.toISOString() : null;
    } catch {
      // best effort
    }
    return base;
  }
}

/** Empty summary used when the pass is skipped (e.g. lock contention). */
export function emptyGdeltStructuredSummary(): GdeltStructuredSummary {
  return emptyBase(false, isGdeltStructuredConfigured());
}
