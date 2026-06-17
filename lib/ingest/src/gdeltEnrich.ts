import { db, incidentsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { maxSeverity, severityFromFatalities, type Severity } from "./severity";
import type { IngestOptions } from "./types";

// ===========================================================================
// GDELT precision-enrichment pass (ADDITIVE — never replaces the keyword feed).
//
// The `flashpoint` (Protests & Civil Unrest) feed is a keyword RSS scraper: it
// is broad on VOLUME but cannot produce the structured, ACLED-style fields an
// analyst wants — precise sub-national lat/long, confirmed fatality counts,
// named actors, and event/sub-event coding. GDELT's Conflict-Events API does.
//
// This pass cross-matches GDELT's AI-coded Demonstrations events against the
// flashpoint rows already in the DB and attaches those structured fields where
// it finds a confident match. It NEVER inserts GDELT rows of its own and never
// removes a keyword row — it only enriches. Every enriched field is nullable so
// every downstream surface falls back to the base field when GDELT did not
// match a given row.
//
// Budget discipline (GDELT free plan: 100 Query Units/month, 1 QU per REST
// call): the pass is LOW CADENCE and bounded three ways —
//   1. A cadence gate: it no-ops unless the last run was more than
//      GDELT_ENRICH_INTERVAL_HOURS ago (default weekly), tracked via the
//      max(gdelt_enriched_at) stamp so frequent autoscale cold starts cannot
//      re-spend QU.
//   2. A hard per-run call cap (GDELT_ENRICH_MAX_CALLS, default 10) enforced in
//      the client with 429 backoff — one run can never blow the monthly budget.
//   3. A bounded back-match: only countries with un-checked recent incidents are
//      queried, stalest first, so the work converges across runs (mirrors the
//      ReliefWeb corroboration pass) instead of re-querying every row forever.
//
// Disable entirely with GDELT_ENRICH_ENABLED=false. With no GDELT_CLOUD_API_KEY
// it no-ops cleanly (like the ReliefWeb pass without an approved appname).
// ===========================================================================

// --- Configuration ----------------------------------------------------------

const GDELT_BASE = (process.env["GDELT_CLOUD_API_BASE"] ?? "https://gdeltcloud.com").replace(/\/+$/, "");

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Hours between enrichment runs. Default weekly — the structured fields change
// slowly and the QU budget is small, so a frequent cadence buys nothing.
const INTERVAL_HOURS = numEnv("GDELT_ENRICH_INTERVAL_HOURS", 168);
// Hard cap on REST calls (= QU) per run. Weekly x 10 ~= 43 QU/month, inside the
// 100-QU free budget with headroom.
const MAX_CALLS = numEnv("GDELT_ENRICH_MAX_CALLS", 10);
// Recent window enriched (days). GDELT list windows cannot exceed 30 days.
const WINDOW_DAYS = Math.min(30, numEnv("GDELT_ENRICH_WINDOW_DAYS", 30));
// Per-country list page size.
const LIST_LIMIT = numEnv("GDELT_ENRICH_LIST_LIMIT", 50);
// Match gates.
const DATE_TOLERANCE_DAYS = 2;
const MIN_TITLE_SIM = 0.5;

const DEMONSTRATIONS = "Demonstrations";

function enabled(): boolean {
  return process.env["GDELT_ENRICH_ENABLED"] !== "false";
}

// --- APAC / Pacific scope (mirrors gdelt-eval.ts) ---------------------------
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

function resolveScope(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = String(raw).trim().toLowerCase();
  if (!norm) return null;
  for (const c of APAC_SCOPE) {
    if (c.iso3.toLowerCase() === norm) return c.canonical;
    if (c.codes.includes(norm)) return c.canonical;
    if (norm === c.canonical.toLowerCase()) return c.canonical;
  }
  // GDELT has no separate identifier for Indonesian West Papua — it folds those
  // events under Indonesia, but the flashpoint feed splits West Papua out, so
  // map it onto Indonesia for the country query.
  if (norm === "west papua") return "Indonesia";
  return null;
}

function iso3For(canonical: string): string | null {
  return APAC_SCOPE.find((s) => s.canonical === canonical)?.iso3 ?? null;
}

// --- Defensive field access (mirrors gdelt-eval.ts) -------------------------
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
function asStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asStr(x)).filter((s): s is string => !!s);
  const s = asStr(v);
  return s ? [s] : [];
}

type GdeltEvent = {
  country: string | null;
  date: string | null;
  title: string | null;
  // Every headline variant GDELT carries for the event (its own coded title,
  // the cluster label, and the ORIGINAL clustered article headlines). Our rows
  // come from Google-News RSS, so an original source_title is the closest match
  // to incident.title — far better recall than GDELT's reworded display_title.
  titles: string[];
  // Every source URL GDELT clustered (plus its story/source url). A normalised
  // match against incident.sourceUrl is a DEFINITIVE, precision-safe link.
  urls: string[];
  lat: number | null;
  lng: number | null;
  fatalities: number | null;
  actors: string | null;
  eventType: string | null;
  subEventType: string | null;
  confidence: number | null;
  admin1: string | null;
  placeName: string | null;
};

function parseEvent(o: Record<string, unknown>): GdeltEvent {
  const rawCountry = asStr(
    pick(o, ["country", "country_code", "country_name", "countryname", "iso3", "actiongeo_countryname", "actiongeo_countrycode"]),
  );
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
  const displayTitle = asStr(pick(o, ["display_title", "title", "cluster_label", "headline", "name"]));
  const titleVariants = [
    displayTitle,
    asStr(pick(o, ["cluster_label"])),
    ...asStrArray(pick(o, ["source_titles", "sourcetitles"])),
  ].filter((s): s is string => !!s);
  const urlVariants = [
    ...asStrArray(pick(o, ["source_urls", "sourceurls"])),
    asStr(pick(o, ["url", "source_url", "sourceurl", "cluster_url", "story_url", "link"])),
  ].filter((s): s is string => !!s);
  return {
    country: resolveScope(rawCountry),
    date,
    title: displayTitle,
    titles: [...new Set(titleVariants)],
    urls: [...new Set(urlVariants)],
    lat: asNum(pick(o, ["latitude", "lat", "actiongeo_lat", "geo_lat"])),
    lng: asNum(pick(o, ["longitude", "lon", "lng", "long", "actiongeo_long", "geo_long"])),
    fatalities: asNum(pick(o, ["fatalities", "num_fatalities", "deaths", "killed", "fatality_count"])),
    actors: actors || null,
    eventType: asStr(pick(o, ["event_type", "eventtype", "category"])),
    subEventType: asStr(pick(o, ["sub_event_type", "subcategory", "sub_event", "subevent"])),
    confidence: asNum(pick(o, ["confidence", "avg_confidence", "confidence_score"])),
    admin1: asStr(pick(o, ["admin1", "admin_1", "adm1", "state", "province"])),
    placeName: asStr(pick(o, ["location", "place", "place_name", "city"])),
  };
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// --- GDELT client (hard QU cap + 429 backoff) -------------------------------
class GdeltClient {
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

  async get(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    if (this.calls >= this.maxCalls) {
      throw new Error(`QU budget cap reached (${this.maxCalls} calls).`);
    }
    const url = new URL(`${GDELT_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

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
      // 429 is not charged a QU — respect Retry-After, bound the retries.
      if (res.status === 429) {
        if (attempt > 5) throw new Error("429 Too Many Requests — retries exhausted");
        const ra = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 2000 * attempt);
        await sleep(waitMs);
        continue;
      }
      this.calls++;
      const bodyText = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${bodyText.slice(0, 300)}`);
      try {
        return JSON.parse(bodyText);
      } catch {
        throw new Error(`Response was not JSON (first 200 chars): ${bodyText.slice(0, 200)}`);
      }
    }
  }
}

async function fetchEventsList(client: GdeltClient, iso3: string, anchorDate: string, days: number): Promise<GdeltEvent[]> {
  const payload = await client.get("/api/v1/conflict-events", {
    disorder_type: DEMONSTRATIONS,
    country: iso3,
    days,
    date: anchorDate,
    limit: LIST_LIMIT,
  });
  return extractArray(payload, ["events", "results", "data", "records", "items"]).map(parseEvent);
}

// --- Title similarity -------------------------------------------------------
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "over", "after", "amid", "says",
  "say", "near", "amid", "their", "have", "has", "are", "was", "were", "that",
  "this", "his", "her", "its", "out", "off", "who", "but", "not", "all", "new",
]);

function titleTokens(title: string | null): Set<string> {
  if (!title) return new Set();
  // Drop a trailing " - Source" / " | Source" masthead (Google-News style).
  const stripped = title.replace(/\s+[-|–—]\s+[^-|–—]{1,40}$/u, "");
  const tokens = stripped
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

// Normalise a URL for equality matching: strip scheme, leading "www.", any
// query/fragment, and a trailing slash. A Google-News RSS link and the same
// article URL GDELT clustered should collapse to the same key. Returns null for
// unusable/empty strings so we never match two blanks together.
function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = url.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/\/+$/, "");
  return s || null;
}

// --- Public types -----------------------------------------------------------
export type GdeltEnrichSummary = {
  provider: "gdelt";
  mode: "commit" | "dry-run";
  /** False when GDELT_ENRICH_ENABLED=false or no API key (no QU spent). */
  enabled: boolean;
  /** Did the pass actually query GDELT this run? */
  ran: boolean;
  /** Why the pass did not run, when ran=false. */
  reason: "disabled" | "no-api-key" | "cadence" | "no-candidates" | "ok";
  incidentsConsidered: number;
  countriesQueried: number;
  incidentsMatched: number;
  fieldsEnriched: number;
  geoUpgraded: number;
  severityRaised: number;
  /** REST calls spent this run (= QU). */
  quSpent: number;
  fetchOk: boolean;
  errors: string[];
  logLines: string[];
};

function noop(reason: GdeltEnrichSummary["reason"], commit: boolean, logLines: string[]): GdeltEnrichSummary {
  return {
    provider: "gdelt",
    mode: commit ? "commit" : "dry-run",
    enabled: reason !== "disabled" && reason !== "no-api-key",
    ran: false,
    reason,
    incidentsConsidered: 0,
    countriesQueried: 0,
    incidentsMatched: 0,
    fieldsEnriched: 0,
    geoUpgraded: 0,
    severityRaised: 0,
    quSpent: 0,
    fetchOk: true,
    errors: [],
    logLines,
  };
}

type Candidate = {
  id: number;
  country: string;
  title: string;
  sourceUrl: string | null;
  resolvedUrl: string | null;
  occurredAt: Date;
  latitude: number | null;
  longitude: number | null;
  location: string | null;
  severity: string;
  gdeltEnrichedAt: Date | null;
};

/**
 * Cross-match GDELT Demonstrations events onto existing flashpoint incidents
 * and attach the structured fields. Does NOT close the shared DB pool (see
 * runFlashpointIngest for the rationale). Read-only DB access in dry-run.
 */
export async function runGdeltEnrich(opts: IngestOptions = {}): Promise<GdeltEnrichSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`GDELT enrichment — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  if (!enabled()) {
    log("GDELT_ENRICH_ENABLED=false — skipping (no QU spent).");
    return noop("disabled", commit, logLines);
  }
  const apiKey = process.env["GDELT_CLOUD_API_KEY"];
  if (!apiKey) {
    log("GDELT_CLOUD_API_KEY not set — skipping (no QU spent).");
    return noop("no-api-key", commit, logLines);
  }

  // --- Cadence gate: skip unless the last run was > INTERVAL_HOURS ago. The
  // max(gdelt_enriched_at) stamp acts as the last-run clock, so frequent
  // autoscale cold starts cannot re-spend QU.
  const [{ lastRun } = { lastRun: null }] = (await db
    .select({ lastRun: sql<Date | null>`max(${incidentsTable.gdeltEnrichedAt})` })
    .from(incidentsTable)) as Array<{ lastRun: Date | null }>;
  if (lastRun) {
    const ageHours = (Date.now() - new Date(lastRun).getTime()) / 3600000;
    if (ageHours < INTERVAL_HOURS) {
      log(`Last run ${ageHours.toFixed(1)}h ago < ${INTERVAL_HOURS}h interval — skipping (no QU spent).`);
      return noop("cadence", commit, logLines);
    }
  }

  // --- Candidate rows: recent flashpoint incidents not checked within the
  // interval (NULL = never checked). Stalest/never-checked first so the bounded
  // back-match converges across runs.
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const intervalAgo = new Date(Date.now() - INTERVAL_HOURS * 3600000);
  const candidates = (await db
    .select({
      id: incidentsTable.id,
      country: incidentsTable.country,
      title: incidentsTable.title,
      sourceUrl: incidentsTable.sourceUrl,
      resolvedUrl: incidentsTable.resolvedUrl,
      occurredAt: incidentsTable.occurredAt,
      latitude: incidentsTable.latitude,
      longitude: incidentsTable.longitude,
      location: incidentsTable.location,
      severity: incidentsTable.severity,
      gdeltEnrichedAt: incidentsTable.gdeltEnrichedAt,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.topic, "flashpoint"),
        gte(incidentsTable.occurredAt, windowStart),
        or(isNull(incidentsTable.gdeltEnrichedAt), lt(incidentsTable.gdeltEnrichedAt, intervalAgo)),
      ),
    )) as Candidate[];

  if (candidates.length === 0) {
    log("No recent un-checked flashpoint incidents — nothing to enrich.");
    return noop("no-candidates", commit, logLines);
  }
  log(`Candidates (recent, un-checked) : ${candidates.length}`);

  // Group candidates by GDELT canonical country (a compound country string like
  // "West Papua; Indonesia" can map onto more than one). Each candidate lands in
  // every canonical country it resolves to.
  const byCountry = new Map<string, Candidate[]>();
  const candidateMinStamp = new Map<string, number>(); // canonical -> oldest stamp (nulls = 0)
  for (const c of candidates) {
    const canon = new Set<string>();
    for (const part of String(c.country ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
      const r = resolveScope(part);
      if (r) canon.add(r);
    }
    const stampMs = c.gdeltEnrichedAt ? new Date(c.gdeltEnrichedAt).getTime() : 0;
    for (const canonical of canon) {
      if (!byCountry.has(canonical)) byCountry.set(canonical, []);
      byCountry.get(canonical)!.push(c);
      const prev = candidateMinStamp.get(canonical);
      if (prev === undefined || stampMs < prev) candidateMinStamp.set(canonical, stampMs);
    }
  }

  // Query order: countries with the stalest (oldest / never-checked) candidates
  // first, so a budget-capped run always makes progress on the most-overdue.
  const countriesByPriority = [...byCountry.keys()]
    .filter((c) => iso3For(c))
    .sort((a, b) => (candidateMinStamp.get(a) ?? 0) - (candidateMinStamp.get(b) ?? 0));

  const client = new GdeltClient(apiKey, MAX_CALLS);
  const anchorDate = ymd(new Date());
  const errors: string[] = [];
  let fetchOk = true;

  // The set of candidate ids we actually examined (a country was queried), so we
  // only stamp gdelt_enriched_at on rows we genuinely checked.
  const examinedIds = new Set<number>();
  const updates: Array<{
    id: number;
    fields: Partial<{
      fatalities: number | null;
      actors: string | null;
      gdeltEventType: string | null;
      gdeltSubEventType: string | null;
      gdeltConfidence: number | null;
      latitude: number;
      longitude: number;
      location: string;
      severity: Severity;
    }>;
    matched: boolean;
    geoUpgraded: boolean;
    severityRaised: boolean;
    matchedByUrl: boolean;
  }> = [];

  let countriesQueried = 0;
  for (const canonical of countriesByPriority) {
    if (client.exhausted) break;
    const iso3 = iso3For(canonical)!;
    let events: GdeltEvent[] = [];
    try {
      events = await fetchEventsList(client, iso3, anchorDate, WINDOW_DAYS);
      countriesQueried++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${canonical} (${iso3}): ${msg}`);
      fetchOk = false;
      log(`  ${canonical}: list call failed — ${msg}`);
      // A budget-cap error means stop; other errors just skip this country.
      if (/QU budget cap/.test(msg)) break;
      continue;
    }
    // Pre-tokenise every title variant (coded title + cluster label + original
    // clustered headlines) and collect every normalised source URL per event.
    const eventTokens = events.map((e) => ({
      e,
      tokenSets: e.titles.map((t) => titleTokens(t)),
      urls: new Set(e.urls.map((u) => normalizeUrl(u)).filter((u): u is string => !!u)),
    }));

    for (const c of byCountry.get(canonical) ?? []) {
      examinedIds.add(c.id);
      const cTokens = titleTokens(c.title);
      // Prefer the resolved publisher URL over the raw Google News redirect:
      // GDELT clusters on the publisher URL, so a redirect can never match.
      const cUrl = normalizeUrl(c.resolvedUrl ?? c.sourceUrl);
      const cDate = new Date(c.occurredAt);
      let best: { e: GdeltEvent; sim: number; byUrl?: boolean } | null = null;
      for (const { e, tokenSets, urls } of eventTokens) {
        if (!e.date) continue;
        if (daysBetween(cDate, new Date(e.date)) > DATE_TOLERANCE_DAYS) continue;
        // A shared source URL is a definitive link — accept immediately (sim=1).
        if (cUrl && urls.has(cUrl)) {
          best = { e, sim: 1, byUrl: true };
          break;
        }
        // Otherwise take the best Jaccard across all of the event's headline
        // variants — our RSS title usually matches an original source_title far
        // better than GDELT's reworded display_title.
        let sim = 0;
        for (const tokens of tokenSets) {
          const s = jaccard(cTokens, tokens);
          if (s > sim) sim = s;
        }
        if (sim >= MIN_TITLE_SIM && (!best || sim > best.sim)) best = { e, sim };
      }
      if (!best) continue;

      const e = best.e;
      const fields: (typeof updates)[number]["fields"] = {};
      if (e.fatalities !== null) fields.fatalities = e.fatalities;
      if (e.actors) fields.actors = e.actors;
      if (e.eventType) fields.gdeltEventType = e.eventType;
      if (e.subEventType) fields.gdeltSubEventType = e.subEventType;
      if (e.confidence !== null) fields.gdeltConfidence = e.confidence;

      // Geo upgrade: GDELT sub-national lat/long is more precise than the
      // keyword feed's country-centroid geocode. Only overwrite when GDELT has
      // real coords; otherwise keep the existing geo (graceful fallback).
      let geoUpgraded = false;
      if (e.lat !== null && e.lng !== null) {
        fields.latitude = e.lat;
        fields.longitude = e.lng;
        const place = [e.placeName, e.admin1].filter(Boolean).join(", ");
        if (place) fields.location = place;
        geoUpgraded = true;
      }

      // Severity floor from the structured fatality count — a fatal protest
      // reads at least Extreme even when the headline carried no casualty word.
      let severityRaised = false;
      const floor = severityFromFatalities(e.fatalities);
      if (floor) {
        const next = maxSeverity(c.severity as Severity, floor);
        if (next !== c.severity) {
          fields.severity = next;
          severityRaised = true;
        }
      }

      updates.push({ id: c.id, fields, matched: true, geoUpgraded, severityRaised, matchedByUrl: best.byUrl ?? false });
    }
  }

  const matched = updates.filter((u) => u.matched).length;
  const matchedByUrl = updates.filter((u) => u.matchedByUrl).length;
  const geoUpgraded = updates.filter((u) => u.geoUpgraded).length;
  const severityRaised = updates.filter((u) => u.severityRaised).length;
  const fieldsEnriched = updates.reduce((acc, u) => acc + Object.keys(u.fields).length, 0);

  log(`  Countries queried  : ${countriesQueried}`);
  log(`  Incidents examined : ${examinedIds.size}`);
  log(`  Incidents matched  : ${matched}`);
  log(`     via source URL  : ${matchedByUrl}`);
  log(`  Geo upgraded       : ${geoUpgraded}`);
  log(`  Severity raised    : ${severityRaised}`);
  log(`  QU spent           : ${client.qu}`);

  if (!commit) {
    log("DRY-RUN — no rows written. Re-run with --commit to apply.");
    return {
      provider: "gdelt",
      mode: "dry-run",
      enabled: true,
      ran: true,
      reason: "ok",
      incidentsConsidered: examinedIds.size,
      countriesQueried,
      incidentsMatched: matched,
      fieldsEnriched,
      geoUpgraded,
      severityRaised,
      quSpent: client.qu,
      fetchOk,
      errors,
      logLines,
    };
  }

  const now = new Date();
  // Apply the structured-field updates for matched rows.
  for (const u of updates) {
    if (Object.keys(u.fields).length === 0) continue;
    await db.update(incidentsTable).set(u.fields).where(eq(incidentsTable.id, u.id));
  }
  // Stamp gdelt_enriched_at on EVERY examined row (matched or not) so the
  // bounded back-match does not re-check them within the interval. Rows whose
  // country was not queried this run keep a null stamp and are picked up next
  // run.
  if (examinedIds.size > 0) {
    await db
      .update(incidentsTable)
      .set({ gdeltEnrichedAt: now })
      .where(inArray(incidentsTable.id, [...examinedIds]));
  }
  log(`Committed ${updates.length} enrichment update(s); stamped ${examinedIds.size} examined row(s).`);

  return {
    provider: "gdelt",
    mode: "commit",
    enabled: true,
    ran: true,
    reason: "ok",
    incidentsConsidered: examinedIds.size,
    countriesQueried,
    incidentsMatched: matched,
    fieldsEnriched,
    geoUpgraded,
    severityRaised,
    quSpent: client.qu,
    fetchOk,
    errors,
    logLines,
  };
}
