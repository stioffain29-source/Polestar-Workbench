import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// ===========================================================================
// GDELT protest-coverage evaluation (read-only measurement spike).
//
// Compares GDELT Cloud API protest/unrest coverage against the workbench's
// existing `flashpoint` (Protests & Civil Unrest) feed for the APAC / Pacific
// theatres, over a recent <=30-day window. The goal is to MEASURE how much
// additional coverage and data quality GDELT brings BEFORE committing to a paid
// plan — it does NOT write GDELT data anywhere, does NOT touch the live
// ingest/scoring/reporting paths, and only READS existing flashpoint rows.
//
// GDELT contract used (verified against https://docs.gdeltcloud.com):
//   - Base host       : https://gdeltcloud.com  (GDELT *Cloud*, NOT the legacy
//                        free gdeltproject.org APIs)
//   - Auth            : Authorization: Bearer gdelt_sk_<64-hex>
//   - Protest/unrest  : the ACLED-style Conflict Events API
//       GET /api/v1/conflict-events/summary  (aggregate, group_by=country/event_type)
//       GET /api/v1/conflict-events          (list, for sample records + fields)
//     Protests + Riots are the two `event_type`s under
//     `disorder_type=Demonstrations`, so one summary call grouped by country
//     gives per-country protest+unrest counts. (The generic /api/v2/events
//     surface is CAMEO+ multi-domain events, not the ACLED protest coding.)
//   - Window          : `days` (1..30 list, 1..90 summary) back from `date`.
//   - Country filter  : ISO 3166-1 alpha-3 (e.g. IND, IDN, PHL).
//
// Free-tier discipline (GDELT free plan: 100 Query Units/month, 30 req/min,
// 1 QU per REST call): this run is budgeted to a couple dozen calls at most via
// a hard cap (MAX_CALLS) enforced in the client. Summary-by-country calls are
// preferred over broad pagination; only a handful of targeted list calls are
// made for sample records + quality fields.
//
// Run:  pnpm --filter @workspace/scripts run eval:gdelt
// Requires the GDELT_CLOUD_API_KEY secret (gdelt_sk_...). If absent the script
// exits cleanly with guidance rather than failing obscurely.
// ===========================================================================

// --- Configuration ----------------------------------------------------------

// Base host for the GDELT Cloud API. Overridable via env in case the deployed
// contract differs; the script logs every request URL so a base/param mismatch
// is visible rather than silent.
const GDELT_BASE = (process.env.GDELT_CLOUD_API_BASE ?? "https://gdeltcloud.com").replace(/\/+$/, "");

// Hard cap on total successful REST calls (= QU spent) for ONE evaluation run.
// Protects the 100-QU/month free budget: a single run must never blow it.
const MAX_CALLS = Number(process.env.GDELT_EVAL_MAX_CALLS ?? 24);

// Recent window length in days. GDELT list windows cannot exceed 30 days and
// event history is sparse before March 2026, so we evaluate a recent window,
// never a historical backfill.
const argDays = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);
const WINDOW_DAYS = Math.min(30, Math.max(1, Number.isFinite(argDays) ? argDays : 30));

// Per-country sample size for targeted GDELT list calls (kept small to be QU
// frugal — sample records are for eyeballing quality, not exhaustive paging).
const LIST_LIMIT = Number(process.env.GDELT_EVAL_LIST_LIMIT ?? 25);
// How many of the highest-volume APAC countries get a targeted list call.
const TOP_COUNTRIES_FOR_SAMPLES = 6;

// The disorder type that maps to the flashpoint feed (protests + riots).
const DEMONSTRATIONS = "Demonstrations";

// --- APAC / Pacific scope ---------------------------------------------------
// Mirrors the canonical countries in lib/ingest/src/flashpoint.ts
// (COUNTRY_ALIASES) plus the Papua / PNG split that resolvePapuaPng() handles.
// `iso3` is the GDELT country-filter code; `codes` are the identifiers we accept
// when matching the API's per-country buckets (name + ISO2 + ISO3 + FIPS 10-4),
// because the bucket key may be a code or a name.
//
// NOTE: GDELT has no separate identifier for Indonesian "West Papua" — those
// events fall under Indonesia (IDN). The flashpoint feed DOES split West Papua
// out (a coverage nuance flagged in the report).
type ScopeCountry = { canonical: string; iso3: string; codes: string[] };
const APAC_SCOPE: ScopeCountry[] = [
  { canonical: "Australia", iso3: "AUS", codes: ["australia", "au", "aus", "as"] },
  { canonical: "Bangladesh", iso3: "BGD", codes: ["bangladesh", "bd", "bgd", "bg"] },
  { canonical: "China", iso3: "CHN", codes: ["china", "cn", "chn", "ch"] },
  { canonical: "India", iso3: "IND", codes: ["india", "in", "ind"] },
  { canonical: "Indonesia", iso3: "IDN", codes: ["indonesia", "id", "idn"] },
  { canonical: "Japan", iso3: "JPN", codes: ["japan", "jp", "jpn", "ja"] },
  { canonical: "Malaysia", iso3: "MYS", codes: ["malaysia", "my", "mys"] },
  { canonical: "Myanmar", iso3: "MMR", codes: ["myanmar", "burma", "mm", "mmr", "bm"] },
  { canonical: "Nepal", iso3: "NPL", codes: ["nepal", "np", "npl"] },
  { canonical: "Pakistan", iso3: "PAK", codes: ["pakistan", "pk", "pak"] },
  { canonical: "Philippines", iso3: "PHL", codes: ["philippines", "ph", "phl", "rp"] },
  { canonical: "South Korea", iso3: "KOR", codes: ["south korea", "korea south", "republic of korea", "kr", "kor", "ks"] },
  { canonical: "Sri Lanka", iso3: "LKA", codes: ["sri lanka", "lk", "lka", "ce"] },
  { canonical: "Thailand", iso3: "THA", codes: ["thailand", "th", "tha"] },
  { canonical: "Vietnam", iso3: "VNM", codes: ["vietnam", "viet nam", "vn", "vnm", "vm"] },
  { canonical: "Papua New Guinea", iso3: "PNG", codes: ["papua new guinea", "pg", "png", "pp"] },
];

// GDELT-side canonical resolver. Returns the APAC canonical name for a raw
// country token (name or code) from the API, or null if out of scope.
function resolveScope(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = String(raw).trim().toLowerCase();
  if (!norm) return null;
  for (const c of APAC_SCOPE) {
    if (c.iso3.toLowerCase() === norm) return c.canonical;
    if (c.codes.includes(norm)) return c.canonical;
    if (norm === c.canonical.toLowerCase()) return c.canonical;
  }
  return null;
}

// --- Defensive field access -------------------------------------------------
// The exact JSON field names are not pinned here, so every getter tries the
// plausible aliases and returns the first present value.
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v !== null && v !== undefined && v !== "") return v;
    }
  }
  return undefined;
}
function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s ? s : null;
}

type GdeltEvent = {
  raw: Record<string, unknown>;
  country: string | null; // canonical APAC name, or null if unresolved/out-of-scope
  rawCountry: string | null;
  date: string | null; // yyyy-mm-dd best effort
  title: string | null;
  url: string | null;
  lat: number | null;
  lng: number | null;
  fatalities: number | null;
  civilianTargeting: string | null;
  actors: string | null;
  eventType: string | null; // Protests / Riots (ACLED event_type)
  subEventType: string | null; // ACLED sub_event_type
  confidence: number | null; // AI coding confidence 0..1
  admin1: string | null; // sub-national admin (state/province)
  placeName: string | null; // named location/city
  interaction: string | null; // actor interaction coding
  mentionCount: number | null; // corroborating mentions/sources
  notes: string | null; // AI-generated event narrative
};

function parseEvent(o: Record<string, unknown>): GdeltEvent {
  const rawCountry =
    asStr(
      pick(o, [
        "country",
        "country_code",
        "country_name",
        "countryname",
        "iso3",
        "actiongeo_countryname",
        "actiongeo_countrycode",
      ]),
    ) ?? null;
  const dateRaw = asStr(
    pick(o, ["date", "event_date", "eventdate", "occurred_at", "seendate", "published_at", "publishdate", "datetime"]),
  );
  let date: string | null = null;
  if (dateRaw) {
    const iso = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const compact = dateRaw.match(/^(\d{4})(\d{2})(\d{2})/);
    if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    else if (compact) date = `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  const actor1 = asStr(pick(o, ["actor1", "actor1_name", "actor1name", "actor_1", "primary_actor"]));
  const actor2 = asStr(pick(o, ["actor2", "actor2_name", "actor2name", "actor_2", "secondary_actor"]));
  const actorsField = asStr(pick(o, ["actors", "associated_actors"]));
  const actors = actorsField ?? ([actor1, actor2].filter(Boolean).join(" / ") || null);
  return {
    raw: o,
    rawCountry,
    country: resolveScope(rawCountry),
    date,
    title: asStr(pick(o, ["display_title", "title", "cluster_label", "headline", "narrative", "notes", "name"])),
    url: asStr(pick(o, ["url", "source_url", "sourceurl", "cluster_url", "story_url", "link"])),
    lat: asNum(pick(o, ["latitude", "lat", "actiongeo_lat", "geo_lat"])),
    lng: asNum(pick(o, ["longitude", "lon", "lng", "long", "actiongeo_long", "geo_long"])),
    fatalities: asNum(pick(o, ["fatalities", "num_fatalities", "deaths", "killed", "fatality_count"])),
    civilianTargeting: asStr(pick(o, ["civilian_targeting", "civiliantargeting", "is_civilian_targeting"])),
    actors: actors || null,
    eventType: asStr(pick(o, ["event_type", "eventtype", "category"])),
    subEventType: asStr(pick(o, ["sub_event_type", "subcategory", "sub_event", "subevent"])),
    confidence: asNum(pick(o, ["confidence", "avg_confidence", "confidence_score"])),
    admin1: asStr(pick(o, ["admin1", "admin_1", "adm1", "state", "province"])),
    placeName: asStr(pick(o, ["location", "place", "place_name", "city"])),
    interaction: asStr(pick(o, ["interaction", "interaction_type"])),
    mentionCount: asNum(pick(o, ["mention_count", "mentions", "num_mentions", "duplicate_count"])),
    notes: asStr(pick(o, ["notes", "narrative", "summary"])),
  };
}

// Pull an array of records out of whatever envelope the API uses.
function extractArray(payload: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[];
    }
    for (const k of ["data", "result", "response"]) {
      const inner = obj[k];
      if (inner && typeof inner === "object") {
        const found = extractArray(inner, keys);
        if (found.length) return found;
      }
    }
  }
  return [];
}

// --- GDELT client -----------------------------------------------------------
class GdeltClient {
  private calls = 0;
  readonly requestLog: string[] = [];
  constructor(private readonly apiKey: string) {}

  get qu(): number {
    return this.calls;
  }

  async get(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    if (this.calls >= MAX_CALLS) {
      throw new Error(`QU budget cap reached (${MAX_CALLS} calls). Aborting to protect the free 100-QU/month budget.`);
    }
    const url = new URL(`${GDELT_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const display = url.toString();

    let attempt = 0;
    while (true) {
      attempt++;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        });
      } catch (err) {
        if (attempt > 3) throw new Error(`network error after ${attempt} attempts: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(Math.min(10000, 1500 * attempt));
        continue;
      }

      // Rate limited — respect Retry-After. A 429 is not charged a QU, so we do
      // NOT count it; we DO bound the retries so we never spin forever.
      if (res.status === 429) {
        if (attempt > 5) throw new Error("429 Too Many Requests — retries exhausted");
        const ra = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 2000 * attempt);
        this.requestLog.push(`  RATE-LIMITED (429), waiting ${Math.round(waitMs / 1000)}s — ${display}`);
        await sleep(waitMs);
        continue;
      }

      // Successful (or definitively-failed) call consumes one QU.
      this.calls++;
      const ok = res.ok;
      const bodyText = await res.text();
      this.requestLog.push(`  QU#${this.calls} HTTP ${res.status} — ${display}`);
      if (!ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${bodyText.slice(0, 400)}`);
      }
      try {
        return JSON.parse(bodyText);
      } catch {
        throw new Error(`Response was not JSON (first 300 chars): ${bodyText.slice(0, 300)}`);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bucketCount(r: Record<string, unknown>): number {
  return asNum(pick(r, ["count", "n", "total", "num_events", "event_count", "events", "value", "doc_count"])) ?? 0;
}

// --- Summary fetches --------------------------------------------------------
type CountryCount = { canonical: string; raw: string; count: number };

async function fetchDemonstrationsByCountry(
  client: GdeltClient,
  anchorDate: string,
  days: number,
): Promise<{ inScope: CountryCount[]; totalWorld: number; sampleBucket: Record<string, unknown> | null }> {
  const payload = await client.get("/api/v1/conflict-events/summary", {
    disorder_type: DEMONSTRATIONS,
    group_by: "country",
    days,
    date: anchorDate,
  });
  const rows = extractArray(payload, ["buckets", "groups", "countries", "results", "summary", "data"]);
  const sampleBucket = rows[0] ?? null;
  const inScope: CountryCount[] = [];
  let bucketSum = 0;
  for (const r of rows) {
    const rawCountry = asStr(pick(r, ["country", "country_code", "country_name", "countryname", "key", "name", "code", "iso3"])) ?? "";
    const count = bucketCount(r);
    bucketSum += count;
    const canonical = resolveScope(rawCountry);
    if (canonical) inScope.push({ canonical, raw: rawCountry, count });
  }
  // Prefer an explicit totals object if present, else the bucket sum.
  let totalWorld = bucketSum;
  if (payload && typeof payload === "object") {
    const totals = (payload as Record<string, unknown>).totals;
    if (totals && typeof totals === "object") {
      const t = bucketCount(totals as Record<string, unknown>);
      if (t > 0) totalWorld = t;
    }
  }
  // Collapse duplicates (name + code both matched to same canonical).
  const merged = new Map<string, CountryCount>();
  for (const r of inScope) {
    const prev = merged.get(r.canonical);
    if (prev) prev.count += r.count;
    else merged.set(r.canonical, { ...r });
  }
  return { inScope: [...merged.values()].sort((a, b) => b.count - a.count), totalWorld, sampleBucket };
}

async function fetchWorldEventTypeSplit(
  client: GdeltClient,
  anchorDate: string,
  days: number,
): Promise<Record<string, number>> {
  const payload = await client.get("/api/v1/conflict-events/summary", {
    disorder_type: DEMONSTRATIONS,
    group_by: "event_type",
    days,
    date: anchorDate,
  });
  const rows = extractArray(payload, ["buckets", "groups", "results", "summary", "data"]);
  const split: Record<string, number> = {};
  for (const r of rows) {
    const key = asStr(pick(r, ["event_type", "category", "key", "name"])) ?? "Unknown";
    split[key] = (split[key] ?? 0) + bucketCount(r);
  }
  return split;
}

// --- Targeted list fetch ----------------------------------------------------
async function fetchEventsList(
  client: GdeltClient,
  iso3: string,
  anchorDate: string,
  days: number,
): Promise<GdeltEvent[]> {
  const payload = await client.get("/api/v1/conflict-events", {
    disorder_type: DEMONSTRATIONS,
    country: iso3,
    days,
    date: anchorDate,
    limit: LIST_LIMIT,
  });
  const rows = extractArray(payload, ["events", "results", "data", "records", "items"]);
  return rows.map(parseEvent);
}

// --- DB (current flashpoint) side, read-only --------------------------------
type DbCountry = { country: string; n: number };
async function readFlashpointSide(startDate: string, endDate: string): Promise<{
  total: number;
  relevantTotal: number;
  byCountry: DbCountry[];
  withCoords: number;
  withLocation: number;
  byDate: Map<string, Set<string>>;
  sample: { country: string; date: string; severity: string; title: string }[];
}> {
  // `n` = raw rows; `n_relevant` mirrors the app's default read gate
  // (defaultRelevanceCondition: keep NULL or != 'irrelevant'), so the
  // comparison is against what the workbench actually shows, not raw scrape.
  const countRes = await db.execute(sql`
    SELECT country, COUNT(*)::int AS n,
           COUNT(*) FILTER (
             WHERE relevance_status IS NULL OR relevance_status <> 'irrelevant'
           )::int AS n_relevant,
           COUNT(latitude)::int AS with_coords,
           COUNT(location)::int AS with_location
    FROM incidents
    WHERE topic = 'flashpoint'
      AND occurred_at >= ${startDate}::date
      AND occurred_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY country
    ORDER BY n DESC
  `);
  const byCountry: DbCountry[] = [];
  let total = 0;
  let relevantTotal = 0;
  let withCoords = 0;
  let withLocation = 0;
  for (const row of countRes.rows as Array<{ country: string; n: number; n_relevant: number; with_coords: number; with_location: number }>) {
    byCountry.push({ country: row.country, n: row.n });
    total += row.n;
    relevantTotal += row.n_relevant;
    withCoords += row.with_coords;
    withLocation += row.with_location;
  }

  const rowsRes = await db.execute(sql`
    SELECT country, occurred_at::date AS d, severity, title
    FROM incidents
    WHERE topic = 'flashpoint'
      AND occurred_at >= ${startDate}::date
      AND occurred_at < (${endDate}::date + INTERVAL '1 day')
    ORDER BY occurred_at DESC
  `);
  const byDate = new Map<string, Set<string>>();
  const sample: { country: string; date: string; severity: string; title: string }[] = [];
  for (const row of rowsRes.rows as Array<{ country: string; d: string; severity: string; title: string }>) {
    const date = String(row.d).slice(0, 10);
    for (const part of String(row.country).split(";").map((s) => s.trim()).filter(Boolean)) {
      if (!byDate.has(part)) byDate.set(part, new Set());
      byDate.get(part)!.add(date);
    }
    if (sample.length < 8) sample.push({ country: row.country, date, severity: row.severity, title: row.title });
  }
  return { total, relevantTotal, byCountry, withCoords, withLocation, byDate, sample };
}

// --- Main -------------------------------------------------------------------
async function main(): Promise<void> {
  const apiKey = process.env.GDELT_CLOUD_API_KEY;
  if (!apiKey) {
    console.error(
      [
        "GDELT_CLOUD_API_KEY is not set.",
        "",
        "This evaluation needs a GDELT Cloud API key (gdelt_sk_...).",
        "  1. Sign up free at https://gdeltcloud.com/auth/sign-up",
        "  2. Dashboard -> Settings -> API Keys -> generate a key",
        "  3. Add it as a secret named GDELT_CLOUD_API_KEY, then re-run:",
        "       pnpm --filter @workspace/scripts run eval:gdelt",
        "",
        "No calls were made; no QU were spent.",
      ].join("\n"),
    );
    await pool.end();
    process.exit(1);
  }

  const now = new Date();
  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const startDate = ymd(start);
  const endDate = ymd(now);

  console.log(`GDELT protest-coverage evaluation`);
  console.log(`  Window     : ${startDate} -> ${endDate} (${WINDOW_DAYS} days)`);
  console.log(`  GDELT base : ${GDELT_BASE}`);
  console.log(`  QU cap     : ${MAX_CALLS} calls\n`);

  const client = new GdeltClient(apiKey);

  // --- GDELT side (QU-frugal) ---
  let gdeltError: string | null = null;
  let summary: { inScope: CountryCount[]; totalWorld: number; sampleBucket: Record<string, unknown> | null } = {
    inScope: [],
    totalWorld: 0,
    sampleBucket: null,
  };
  let worldSplit: Record<string, number> = {};
  const samples: GdeltEvent[] = [];

  try {
    console.log("Fetching GDELT Demonstrations summary (group_by=country)...");
    summary = await fetchDemonstrationsByCountry(client, endDate, WINDOW_DAYS);

    console.log("Fetching GDELT Demonstrations split (group_by=event_type, world)...");
    worldSplit = await fetchWorldEventTypeSplit(client, endDate, WINDOW_DAYS);

    const topCountries = summary.inScope.slice(0, TOP_COUNTRIES_FOR_SAMPLES);
    for (const c of topCountries) {
      if (client.qu >= MAX_CALLS - 1) break;
      const scope = APAC_SCOPE.find((s) => s.canonical === c.canonical);
      if (!scope) continue;
      try {
        console.log(`Fetching GDELT sample events for ${c.canonical} (${scope.iso3})...`);
        const evts = await fetchEventsList(client, scope.iso3, endDate, WINDOW_DAYS);
        for (const e of evts) {
          // Trust the country we filtered by if the row didn't resolve.
          if (!e.country) e.country = c.canonical;
          samples.push(e);
        }
      } catch (err) {
        console.warn(`  list call failed for ${c.canonical}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    gdeltError = err instanceof Error ? err.message : String(err);
    console.error(`\nGDELT fetch failed: ${gdeltError}`);
    console.error("Continuing — the report will record the failure and still capture the flashpoint baseline.\n");
  }

  const gdeltByCountry = new Map<string, number>();
  for (const c of summary.inScope) gdeltByCountry.set(c.canonical, c.count);
  const gdeltTotal = [...gdeltByCountry.values()].reduce((a, b) => a + b, 0);

  // De-dupe samples by URL/title.
  const seenSample = new Set<string>();
  const uniqueSamples = samples.filter((s) => {
    const k = (s.url ?? s.title ?? JSON.stringify(s.raw)).toLowerCase();
    if (seenSample.has(k)) return false;
    seenSample.add(k);
    return true;
  });

  // --- Current flashpoint side (read-only) ---
  console.log("\nReading current flashpoint records from the DB (read-only)...");
  const dbSide = await readFlashpointSide(startDate, endDate);

  // --- Coverage + gaps ---
  const dbByCountry = new Map<string, number>();
  for (const r of dbSide.byCountry) {
    for (const part of r.country.split(";").map((s) => s.trim()).filter(Boolean)) {
      dbByCountry.set(part, (dbByCountry.get(part) ?? 0) + r.n);
    }
  }
  const allCountries = new Set<string>([...APAC_SCOPE.map((c) => c.canonical), ...gdeltByCountry.keys(), ...dbByCountry.keys()]);
  const coverageRows = [...allCountries]
    .map((country) => ({
      country,
      gdelt: gdeltByCountry.get(country) ?? 0,
      db: dbByCountry.get(country) ?? 0,
    }))
    .filter((r) => r.gdelt > 0 || r.db > 0 || APAC_SCOPE.some((c) => c.canonical === r.country))
    .sort((a, b) => b.gdelt + b.db - (a.gdelt + a.db));

  const gdeltOnly = coverageRows.filter((r) => r.gdelt > 0 && r.db === 0);
  const dbOnly = coverageRows.filter((r) => r.db > 0 && r.gdelt === 0);

  // --- Best-effort overlap (country + date) ---
  let overlapMatches = 0;
  let gdeltDated = 0;
  const dbDateKeys = new Set<string>();
  for (const [country, dates] of dbSide.byDate) {
    for (const d of dates) dbDateKeys.add(`${country}|${d}`);
  }
  const gdeltDateKeys = new Set<string>();
  for (const e of uniqueSamples) {
    if (e.country && e.date) {
      gdeltDated++;
      gdeltDateKeys.add(`${e.country}|${e.date}`);
    }
  }
  for (const key of gdeltDateKeys) if (dbDateKeys.has(key)) overlapMatches++;

  // --- Quality-field presence among GDELT samples ---
  const q = {
    n: uniqueSamples.length,
    coords: uniqueSamples.filter((e) => e.lat !== null && e.lng !== null).length,
    subNational: uniqueSamples.filter((e) => e.admin1 !== null || e.placeName !== null).length,
    fatalities: uniqueSamples.filter((e) => e.fatalities !== null).length,
    civilian: uniqueSamples.filter((e) => e.civilianTargeting !== null).length,
    actors: uniqueSamples.filter((e) => e.actors !== null).length,
    subEventType: uniqueSamples.filter((e) => e.subEventType !== null).length,
    confidence: uniqueSamples.filter((e) => e.confidence !== null).length,
    notes: uniqueSamples.filter((e) => e.notes !== null).length,
    mentions: uniqueSamples.filter((e) => e.mentionCount !== null).length,
  };

  // --- Build the report ---
  const lines: string[] = [];
  const L = (s = "") => lines.push(s);
  L(`# GDELT vs Flashpoint — Protest Coverage Evaluation`);
  L();
  L(`- **Generated:** ${now.toISOString()}`);
  L(`- **Window:** ${startDate} → ${endDate} (${WINDOW_DAYS} days)`);
  L(`- **Scope:** APAC / Pacific flashpoint theatres (mirrors \`lib/ingest/src/flashpoint.ts\` COUNTRY_ALIASES + Papua/PNG)`);
  L(`- **GDELT surface:** Conflict Events API, \`disorder_type=Demonstrations\` (Protests + Riots)`);
  L(`- **Endpoints:** \`GET /api/v1/conflict-events/summary\`, \`GET /api/v1/conflict-events\``);
  L(`- **QU spent this run:** ${client.qu} (cap ${MAX_CALLS}; free budget 100/month)`);
  L(`- **GDELT base:** \`${GDELT_BASE}\``);
  if (gdeltError) {
    L();
    L(`> ⚠️ **GDELT fetch error:** ${gdeltError}`);
    L(`>`);
    L(`> The GDELT side is partial or empty. If this is an auth/plan/endpoint`);
    L(`> mismatch (401 MISSING/INVALID_API_KEY, 403 API_ACCESS_DENIED), check the`);
    L(`> request log at the bottom, then re-run. The flashpoint baseline below is`);
    L(`> still valid.`);
  }
  L();
  L(`## 1. Event counts per source`);
  L();
  L(`| Source | Events in window (APAC scope) |`);
  L(`| --- | ---: |`);
  L(`| GDELT (Demonstrations = Protests + Riots) | ${gdeltTotal} |`);
  L(`| Flashpoint (current DB, relevance-gated — what the app shows) | ${dbSide.relevantTotal} |`);
  L(`| Flashpoint (current DB, raw incl. keyword false-positives) | ${dbSide.total} |`);
  L();
  L(
    `> The relevance-gated row mirrors the app's default read filter ` +
      `(\`relevance_status\` NULL or != 'irrelevant'); the raw row is the unfiltered ` +
      `scrape. Compare GDELT against the relevance-gated count for a like-for-like read.`,
  );
  L();
  L(`GDELT world-wide Demonstrations total for context: ${summary.totalWorld}.`);
  if (Object.keys(worldSplit).length) {
    L();
    L(`World-wide Demonstrations split by event type:`);
    for (const [k, v] of Object.entries(worldSplit).sort((a, b) => b[1] - a[1])) L(`- ${k}: ${v}`);
  }
  L();
  L(`## 2. Geographic coverage & gaps`);
  L();
  L(`| Country | GDELT | Flashpoint | Notes |`);
  L(`| --- | ---: | ---: | --- |`);
  for (const r of coverageRows) {
    let note = "";
    if (r.gdelt > 0 && r.db === 0) note = "GDELT-only";
    else if (r.db > 0 && r.gdelt === 0) note = "Flashpoint-only";
    if (r.country === "West Papua") note = (note ? note + "; " : "") + "GDELT folds into Indonesia";
    lines.push(`| ${r.country} | ${r.gdelt} | ${r.db} | ${note} |`);
  }
  L();
  L(`- **Countries with GDELT coverage but no current flashpoint records:** ${gdeltOnly.length ? gdeltOnly.map((r) => `${r.country} (${r.gdelt})`).join(", ") : "none"}`);
  L(`- **Countries with flashpoint records but no GDELT coverage:** ${dbOnly.length ? dbOnly.map((r) => `${r.country} (${r.db})`).join(", ") : "none"}`);
  L();
  L(`## 3. Data-quality deltas GDELT provides`);
  L();
  L(`Field presence across ${q.n} sampled GDELT records (structured ACLED-style`);
  L(`fields the current keyword-scraped flashpoint feed does not carry):`);
  L();
  L(`| Structured field | GDELT samples populated | In flashpoint feed today? |`);
  L(`| --- | ---: | --- |`);
  L(`| precise lat/long | ${q.coords}/${q.n} | Partial — country centroid or curated city only |`);
  L(`| sub-national admin (state / place) | ${q.subNational}/${q.n} | No — country level only for most rows |`);
  L(`| fatalities (count) | ${q.fatalities}/${q.n} | No — only a text severity tier |`);
  L(`| actors (actor pair) | ${q.actors}/${q.n} | No |`);
  L(`| event / sub-event type | ${q.subEventType}/${q.n} | No — single topic only (Protests vs Riots not split) |`);
  L(`| AI coding confidence | ${q.confidence}/${q.n} | No |`);
  L(`| AI narrative (notes) | ${q.notes}/${q.n} | No |`);
  L(`| corroboration (mention / source count) | ${q.mentions}/${q.n} | No |`);
  L(`| civilian-targeting flag | ${q.civilian}/${q.n} (flag; null when N/A) | No |`);
  L();
  L(`Flashpoint side, same window: ${dbSide.withCoords}/${dbSide.total} rows have coordinates`);
  L(`(mostly country centroids), ${dbSide.withLocation}/${dbSide.total} have a named location.`);
  L();
  L(`## 4. Overlap vs unique (best-effort, country + date)`);
  L();
  L(`Approximate match by (country, calendar date) between ${gdeltDated} dated GDELT`);
  L(`sample records and the flashpoint window:`);
  L();
  L(`- GDELT sample (country,date) keys: ${gdeltDateKeys.size}`);
  L(`- Of those, also present in flashpoint: ${overlapMatches}`);
  L(`- GDELT sample keys with no same-day flashpoint match: ${gdeltDateKeys.size - overlapMatches}`);
  L();
  L(`> Exact event matching is not attempted — this is a coarse signal of how`);
  L(`> much GDELT sample activity lines up with days the flashpoint feed already`);
  L(`> covers vs days/countries it may be missing. The summary counts in §1–2 are`);
  L(`> the authoritative coverage measure.`);
  L();
  L(`## 5. Sample GDELT records`);
  L();
  if (uniqueSamples.length === 0) {
    L(`_No GDELT sample records retrieved._`);
  } else {
    for (const e of uniqueSamples.slice(0, 8)) {
      L(`- **${e.title ?? "(no title)"}**`);
      L(
        `  - country=${e.country ?? e.rawCountry ?? "?"} · date=${e.date ?? "?"} · type=${e.eventType ?? "?"}/${e.subEventType ?? "?"} · ` +
          `place=${e.placeName ?? e.admin1 ?? "—"} · geo=${e.lat !== null && e.lng !== null ? `${e.lat},${e.lng}` : "—"} · ` +
          `fatalities=${e.fatalities ?? "—"} · confidence=${e.confidence ?? "—"}`,
      );
      if (e.actors) L(`  - actors: ${e.actors}`);
      if (e.url) L(`  - ${e.url}`);
    }
  }
  L();
  L(`## 6. Current flashpoint sample (for comparison)`);
  L();
  for (const s of dbSide.sample) {
    L(`- **${s.title}** — ${s.country} · ${s.date} · severity=${s.severity}`);
  }
  L();
  L(`> The flashpoint feed is keyword-scraped, so its higher raw count includes`);
  L(`> off-topic false-positives (e.g. market/finance/disaster headlines that`);
  L(`> merely contain "protest"/"rally"). GDELT events are AI-coded demonstrations,`);
  L(`> so the §1 volume gap overstates flashpoint's true protest coverage.`);
  L();
  L(`## 7. Recommendation`);
  L();
  L(recommendation({ gdeltTotal, dbTotal: dbSide.relevantTotal, gdeltOnly, q, gdeltError }));
  L();
  L(`---`);
  L();
  L(`### Appendix A: GDELT request log (QU = ${client.qu})`);
  L();
  L("```");
  for (const r of client.requestLog) L(r);
  L("```");
  if (summary.sampleBucket) {
    L();
    L(`### Appendix B: raw summary bucket (field-name reference)`);
    L();
    L("```json");
    L(JSON.stringify(summary.sampleBucket, null, 2));
    L("```");
  }
  if (uniqueSamples[0]) {
    L();
    L(`### Appendix C: raw event record (field-name reference)`);
    L();
    L("```json");
    L(JSON.stringify(uniqueSamples[0].raw, null, 2));
    L("```");
  }

  const report = lines.join("\n");

  // --- Write + print ---
  const outDir = resolve(process.cwd(), "results", "eval");
  await mkdir(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outPath = resolve(outDir, `gdelt-protest-eval-${stamp}.md`);
  await writeFile(outPath, report, "utf8");

  console.log("\n" + "=".repeat(70));
  console.log("EVALUATION COMPLETE");
  console.log("=".repeat(70));
  console.log(`GDELT (Demonstrations, APAC, ${WINDOW_DAYS}d) : ${gdeltTotal} events`);
  console.log(`Flashpoint (relevance-gated, same window)    : ${dbSide.relevantTotal} events`);
  console.log(`Flashpoint (raw incl. false-positives)       : ${dbSide.total} events`);
  console.log(`Countries GDELT covers that flashpoint misses: ${gdeltOnly.length ? gdeltOnly.map((r) => r.country).join(", ") : "none"}`);
  console.log(`QU spent this run                           : ${client.qu} / ${MAX_CALLS} (free budget 100/month)`);
  if (gdeltError) console.log(`NOTE: GDELT fetch error — ${gdeltError}`);
  console.log(`\nFull comparison written to: ${outPath}`);

  await pool.end();
}

function recommendation(args: {
  gdeltTotal: number;
  dbTotal: number;
  gdeltOnly: { country: string; gdelt: number }[];
  q: { n: number; coords: number; fatalities: number; actors: number; confidence: number };
  gdeltError: string | null;
}): string {
  if (args.gdeltError && args.gdeltTotal === 0) {
    return [
      "**Inconclusive this run** — GDELT returned no data (see error above).",
      "Resolve the auth/plan/endpoint issue and re-run before deciding. The",
      "flashpoint baseline is captured, so a successful re-run will complete the",
      "comparison cheaply (well within the free QU budget).",
    ].join(" ");
  }
  const ratio = args.dbTotal > 0 ? args.gdeltTotal / args.dbTotal : Infinity;
  const structured = args.q.n > 0 && (args.q.coords > 0 || args.q.fatalities > 0 || args.q.actors > 0 || args.q.confidence > 0);
  const parts: string[] = [];
  if (ratio >= 1.5 || args.gdeltOnly.length >= 2) {
    parts.push(
      `**Lean buy / pilot.** GDELT surfaces materially more protest/unrest volume in the APAC window` +
        `${args.gdeltOnly.length ? ` and adds country coverage the current feed misses (${args.gdeltOnly.map((r) => r.country).join(", ")})` : ""}.`,
    );
  } else if (ratio <= 0.7) {
    parts.push(
      "**Lean skip.** GDELT does not meaningfully expand event volume over the current flashpoint feed for these theatres in this window.",
    );
  } else {
    parts.push(
      "**Marginal.** GDELT volume is broadly comparable to the current feed; the case rests on data quality, not raw coverage.",
    );
  }
  if (structured) {
    parts.push(
      "Its main value is STRUCTURED ACLED-style data the keyword scraper cannot produce (precise sub-national lat/long, fatality counts, actor pairs, event/sub-event coding, AI narrative + confidence) — useful for severity scoring, mapping and forecasting.",
    );
  }
  parts.push(
    "Caveat on the volume gap: the flashpoint feed is keyword-scraped and its higher count includes off-topic false-positives (e.g. equities/crypto/disaster headlines), while GDELT rows are AI-coded demonstrations — so the raw count understates GDELT's relative precision.",
  );
  parts.push(
    "Note GDELT folds Indonesian West Papua into Indonesia, so the flashpoint feed's West Papua split is a coverage detail GDELT alone would lose.",
  );
  parts.push("Given the free tier (100 QU/month), a low-cadence supplementary pull is affordable to trial before paying for a higher tier.");
  return parts.join(" ");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
