import { db, incidentsTable } from "@workspace/db";
import type { InsertIncident } from "@workspace/db";
import { sanitiseCaption } from "./text";
import { translateCaptionToEnglish } from "./captionTranslate";
import type { SeverityTopic } from "./severity";
import { recordSourceHealth } from "./sourceHealth";
import {
  decideInstagramIncident,
  dedupeAndInsertIgIncidents,
  instagramMarkerPostId,
  type NormalisedIgPost,
} from "./instagramSource";

// KAMMI Pusat — SOURCE PROVIDER ONLY (Instagram).
//
// KAMMI is "just another news source", exactly like the X and Instagram
// (Papua / separatist) source providers: it is NOT a product, page, feed,
// report or review queue. It pulls PUBLIC posts from KAMMI Pusat's confirmed
// official Instagram account via an existing paid Apify scraper, PII-scrubs each
// caption, TRANSLATES the Bahasa Indonesia text to English (so the English-only
// relevance router, country gate and stored title all work and re-score on a
// RELEVANCE_RULE_VERSION bump), content-routes it into an EXISTING incident
// topic, relevance-gates it, dedupes it, and (only with commit) inserts it into
// the existing `incidents` table — so a genuine KAMMI protest lands directly in
// the relevant news feed (Flashpoint / Protests & Civil Unrest), and slop is
// discarded at the router.
//
// It REUSES the Instagram source provider's decision + dedupe/insert authority
// (`decideInstagramIncident` + `dedupeAndInsertIgIncidents`, which themselves
// reuse the X provider's `routeTopic` + `xDedupeKey`), so there is ONE routing +
// dedup authority for every social source and no parallel taxonomy can drift.
// STRICT no-fabrication: a post naming no tracked country in its OWN (translated)
// text is SKIPPED (never stamped onto a guessed centroid); captions are
// PII-scrubbed before translation or storage; a post that fails the router is
// discarded, never coerced into a topic.
//
// Like every ingest module it NEVER throws (all failures captured in the
// returned summary) and NEVER closes the shared DB pool (only the CLI wrapper
// does).

// --- Config ------------------------------------------------------------------

// Confirmed official handle (June 2026): Instagram @kammi.pusat (Humas PP
// KAMMI). Overridable by env so the monitored account can change without a
// code edit.
const DEFAULT_INSTAGRAM_HANDLE = "kammi.pusat";
const DEFAULT_INSTAGRAM_PROVIDER = "apify";
const DEFAULT_INSTAGRAM_ACTOR = "apify~instagram-scraper";
const DEFAULT_INSTAGRAM_BASE = "https://api.apify.com";

export const KAMMI_IG_HEALTH_NAME = "KAMMI Instagram";

const MAX_ITEMS_DEFAULT = 40;
const FETCH_TIMEOUT_MS = 20000;
const FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2500;

// Apify async run-and-poll budget. The Instagram scraper actor run regularly
// takes longer than a single HTTP fetch to finish, so instead of the
// synchronous run-sync endpoint (which was always aborted at FETCH_TIMEOUT_MS
// before results came back) we START a run, POLL its status until a terminal
// state, then fetch the dataset. Each individual HTTP call still uses the shared
// 20s FETCH_TIMEOUT_MS; this LONGER overall budget — provided by the polling
// loop, NOT by raising that shared constant — is what lets a slow-but-progressing
// run complete. A run that never reaches a terminal state within the budget is
// aborted and reported as a timeout so it ends cleanly instead of hanging the
// whole ingest. Both are env-overridable for operational tuning.
const INSTAGRAM_RUN_MAX_WAIT_MS_DEFAULT = 180_000;
const INSTAGRAM_RUN_POLL_MS_DEFAULT = 5_000;

function instagramRunMaxWaitMs(): number {
  const raw = Number(process.env.INSTAGRAM_RUN_MAX_WAIT_MS);
  return Number.isFinite(raw) && raw > 0
    ? Math.trunc(raw)
    : INSTAGRAM_RUN_MAX_WAIT_MS_DEFAULT;
}

function instagramRunPollMs(): number {
  const raw = Number(process.env.INSTAGRAM_RUN_POLL_MS);
  return Number.isFinite(raw) && raw > 0
    ? Math.trunc(raw)
    : INSTAGRAM_RUN_POLL_MS_DEFAULT;
}

export interface KammiSourceConfig {
  enabled: boolean;
  instagram: {
    handle: string;
    provider: string;
    /** Primary token (INSTAGRAM_API_KEY) — kept for reference/display. */
    apiKey: string;
    /**
     * Ordered, deduped candidate Apify tokens to try: INSTAGRAM_API_KEY first,
     * then the APIFY_TOKEN fallback. fetchInstagramPosts tries the next one when
     * the primary is missing or rejected with an auth error.
     */
    apiKeys: string[];
    apiBase: string;
    actor: string;
    enabled: boolean;
    /** True when a key is present and the source is not switched off. */
    configured: boolean;
  };
  maxItems: number;
}

function envFlag(name: string, dflt: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return dflt;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

export function readKammiSourceConfig(): KammiSourceConfig {
  // KAMMI_ENABLED is the primary switch; SOCIAL_WATCH_ENABLED is honoured as a
  // legacy alias so an existing deployment flag keeps working.
  const enabled =
    envFlag("KAMMI_ENABLED", envFlag("SOCIAL_WATCH_ENABLED", true));

  const igPrimaryKey = process.env.INSTAGRAM_API_KEY?.trim() || "";
  // APIFY_TOKEN is accepted as a fallback Apify credential. It is used when
  // INSTAGRAM_API_KEY is unset, AND it is tried by fetchInstagramPosts when the
  // primary key is rejected with an auth error (e.g. a stale/wrong key left in
  // INSTAGRAM_API_KEY). Ordered (primary first), deduped, non-empty.
  const igFallbackKey = process.env.APIFY_TOKEN?.trim() || "";
  const igKeys = Array.from(
    new Set([igPrimaryKey, igFallbackKey].filter((k) => k.length > 0)),
  );
  const igEnabled = envFlag("INSTAGRAM_ENABLED", true);
  const igConfigured = enabled && igEnabled && igKeys.length > 0;

  const maxRaw = Number(
    process.env.KAMMI_MAX_ITEMS ?? process.env.SOCIAL_WATCH_MAX_ITEMS,
  );
  const maxItems = Number.isFinite(maxRaw)
    ? Math.min(120, Math.max(5, Math.trunc(maxRaw)))
    : MAX_ITEMS_DEFAULT;

  return {
    enabled,
    instagram: {
      handle:
        process.env.KAMMI_INSTAGRAM_HANDLE?.trim() || DEFAULT_INSTAGRAM_HANDLE,
      provider:
        process.env.INSTAGRAM_PROVIDER?.trim() || DEFAULT_INSTAGRAM_PROVIDER,
      apiKey: igPrimaryKey,
      apiKeys: igKeys,
      apiBase: process.env.INSTAGRAM_API_BASE?.trim() || DEFAULT_INSTAGRAM_BASE,
      actor: process.env.INSTAGRAM_ACTOR?.trim() || DEFAULT_INSTAGRAM_ACTOR,
      enabled: igEnabled,
      configured: igConfigured,
    },
    maxItems,
  };
}

export function isKammiSourceActive(cfg = readKammiSourceConfig()): boolean {
  return cfg.enabled && cfg.instagram.configured;
}

// --- Raw post shape ----------------------------------------------------------

interface RawInstagramPost {
  externalId: string;
  url: string;
  caption: string;
  postedAt: Date | null;
}

// --- Resilient JSON fetch ----------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(`status ${res.status}`);
        if (transient && attempt < FETCH_ATTEMPTS - 1) {
          lastErr = err;
          await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
          continue;
        }
        // Non-transient HTTP status (a 4xx other than 429 — e.g. 401/403/404) is
        // NOT retried: a retry cannot fix it, and the Instagram token fallback
        // must observe the auth error promptly. Tag it so the catch below
        // re-throws at once instead of burning the remaining attempts on backoff.
        throw Object.assign(err, { nonRetryable: !transient });
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if ((err as { nonRetryable?: boolean } | null)?.nonRetryable) throw err;
      const aborted = ctrl.signal.aborted;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      } else {
        throw aborted ? new Error(`timed out after ${FETCH_TIMEOUT_MS}ms`) : err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// --- Instagram (paid provider, public posts only) ---------------------------

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normaliseInstagramPost(raw: unknown): RawInstagramPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id) || asString(r.shortCode) || asString(r.shortcode);
  const shortCode = asString(r.shortCode) || asString(r.shortcode);
  if (!id && !shortCode) return null;
  const externalId = id || shortCode;

  let url = asString(r.url);
  if (!url && shortCode) url = `https://www.instagram.com/p/${shortCode}/`;
  if (!url) return null;

  const caption = asString(r.caption) || asString(r.text);

  let postedAt: Date | null = null;
  const ts = r.timestamp ?? r.taken_at ?? r.takenAt;
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) postedAt = d;
  } else if (typeof ts === "number") {
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    if (!Number.isNaN(d.getTime())) postedAt = d;
  }

  // Public-data guard: only retain caption/time/url. Owner is the monitored
  // official handle; we never store other personal account data.
  return { externalId: `ig_${externalId}`, url, caption, postedAt };
}

/** True for an Apify auth rejection (bad/expired/wrong token) — HTTP 401/403. */
export function isApifyAuthError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /\bstatus 40[13]\b/.test(m);
}

/**
 * An auth rejection (401/403) raised specifically by the run-START call, before
 * any Apify run was created. This is the ONLY condition under which the token
 * fallback may advance to the next candidate — a post-start auth error (during
 * polling or dataset fetch) must NOT trigger a fallback, because a run has
 * already been started (and paid for) with the current token, so retrying with a
 * different token would start a second run and incur extra spend.
 */
export class ApifyStartAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApifyStartAuthError";
  }
}

// Apify actor-run lifecycle. READY/RUNNING are transitional; the states below
// are terminal (or terminal-bound and reported as such by the API once
// reached). Only SUCCEEDED yields a usable dataset — the others mean the run
// ended without results and must surface as an error.
const APIFY_TERMINAL_STATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

interface ApifyRunInfo {
  id: string;
  status: string;
  datasetId: string;
}

/** Extract {id,status,defaultDatasetId} from an Apify run/actor-run response. */
function parseApifyRun(json: unknown): ApifyRunInfo | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const id = asString(d.id);
  if (!id) return null;
  return {
    id,
    status: asString(d.status),
    datasetId: asString(d.defaultDatasetId),
  };
}

/**
 * Best-effort abort of a still-running Apify run so a budget-exhausted run stops
 * spending. NEVER throws — a failed abort must not mask the timeout that
 * triggered it, and the ingest must degrade gracefully regardless.
 */
async function abortApifyRun(
  cfg: KammiSourceConfig,
  token: string,
  runId: string,
): Promise<void> {
  try {
    const url = `${cfg.instagram.apiBase}/v2/actor-runs/${encodeURIComponent(runId)}/abort?token=${encodeURIComponent(token)}`;
    await fetchJson(url, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  } catch {
    // Swallow: abort is best-effort cleanup only.
  }
}

async function fetchInstagramPostsWithToken(
  cfg: KammiSourceConfig,
  token: string,
): Promise<RawInstagramPost[]> {
  const ig = cfg.instagram;
  const input = {
    directUrls: [`https://www.instagram.com/${ig.handle}/`],
    resultsType: "posts",
    resultsLimit: cfg.maxItems,
    addParentData: false,
  };

  // 1. START an asynchronous actor run (this returns as soon as the run is
  // queued — it does NOT wait for the scrape to finish). A 401/403 here is
  // thrown by fetchJson BEFORE any run is created, so the token fallback in
  // fetchInstagramPosts observes the auth error promptly and starts (pays for)
  // no run. The token is a query param per Apify's API and is NEVER stored or
  // surfaced. Only PUBLIC profile posts are requested.
  const startUrl = `${ig.apiBase}/v2/acts/${encodeURIComponent(ig.actor)}/runs?token=${encodeURIComponent(token)}`;
  let startJson: unknown;
  try {
    startJson = await fetchJson(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    // A 401/403 HERE means the token was rejected before any run was created, so
    // it is safe (and free) to try the next candidate token. Tag it as a
    // start-phase auth error so the fallback loop can distinguish it from a
    // post-start auth error (which must NOT fall back — see below).
    if (isApifyAuthError(err)) {
      throw new ApifyStartAuthError(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
  let run = parseApifyRun(startJson);
  if (!run) throw new Error("Apify run start returned no run id");

  // 2. POLL the run status until it reaches a terminal state or the overall
  // budget expires. This budget — not the 20s per-call FETCH_TIMEOUT_MS — is
  // what lets a multi-minute scraper run finish. A run still not terminal at the
  // deadline is aborted (to stop spend) and reported as a timeout so it ends
  // cleanly. Note: the START above already succeeded, so a run exists and has
  // been paid for. Any error from here on (including a 401/403 while polling or
  // fetching the dataset) is a PLAIN error — NOT an ApifyStartAuthError — so the
  // token fallback in fetchInstagramPosts will NOT fire and start a second run;
  // the error is surfaced as-is and captured by the caller's try/catch.
  const budgetMs = instagramRunMaxWaitMs();
  const pollMs = instagramRunPollMs();
  const deadline = Date.now() + budgetMs;
  while (!APIFY_TERMINAL_STATES.has(run.status)) {
    if (Date.now() >= deadline) {
      await abortApifyRun(cfg, token, run.id);
      throw new Error(
        `Apify run timed out after ${Math.round(budgetMs / 1000)}s (last status ${run.status || "unknown"})`,
      );
    }
    await sleep(pollMs);
    const statusUrl = `${ig.apiBase}/v2/actor-runs/${encodeURIComponent(run.id)}?token=${encodeURIComponent(token)}`;
    const statusJson = await fetchJson(statusUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const next = parseApifyRun(statusJson);
    if (next) run = next;
  }

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run did not succeed (status ${run.status})`);
  }
  if (!run.datasetId) {
    throw new Error("Apify run succeeded but returned no dataset id");
  }

  // 3. FETCH the succeeded run's dataset items.
  const itemsUrl = `${ig.apiBase}/v2/datasets/${encodeURIComponent(run.datasetId)}/items?token=${encodeURIComponent(token)}&clean=true&limit=${cfg.maxItems}`;
  const json = await fetchJson(itemsUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const arr = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).items)
      ? ((json as Record<string, unknown>).items as unknown[])
      : [];
  const out: RawInstagramPost[] = [];
  for (const item of arr) {
    const norm = normaliseInstagramPost(item);
    if (norm) out.push(norm);
  }
  return out;
}

export async function fetchInstagramPosts(
  cfg: KammiSourceConfig,
): Promise<RawInstagramPost[]> {
  const ig = cfg.instagram;
  if (ig.provider !== "apify") {
    throw new Error(
      `Instagram provider "${ig.provider}" not implemented (only "apify" is supported)`,
    );
  }
  // Try each candidate Apify token in order (INSTAGRAM_API_KEY first, then the
  // APIFY_TOKEN fallback). Fall through to the next candidate ONLY on an
  // ApifyStartAuthError — a 401/403 raised by the run-START call BEFORE any run
  // was created. Any other error (a non-auth start failure, OR an auth error
  // that surfaced after a run already started while polling/fetching) stops
  // here: a run has already been paid for, so retrying with a different token
  // would start (and pay for) a second run.
  const tokens = ig.apiKeys;
  if (tokens.length === 0) {
    throw new Error("no Instagram API token configured");
  }
  let lastErr: unknown;
  for (let i = 0; i < tokens.length; i++) {
    try {
      return await fetchInstagramPostsWithToken(cfg, tokens[i]!);
    } catch (err) {
      lastErr = err;
      if (i < tokens.length - 1 && err instanceof ApifyStartAuthError) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// --- Summary -----------------------------------------------------------------

export interface KammiSourceSummary {
  source: "kammi_instagram";
  mode: "commit" | "dry-run";
  active: boolean;
  configured: boolean;
  fetchOk: boolean;
  fetched: number;
  skippedAlreadyIngested: number;
  skippedNoText: number;
  skippedNoDate: number;
  skippedUnroutable: number;
  skippedNoCountry: number;
  dataCentreHeld: number;
  translated: number;
  translateFailed: number;
  routable: number;
  duplicateMarker: number;
  duplicateKey: number;
  duplicateUrl: number;
  newToInsert: number;
  inserted: number;
  byTopic: Array<[string, number]>;
  errors: string[];
  logLines: string[];
}

export function emptyKammiSourceSummary(): KammiSourceSummary {
  const cfg = readKammiSourceConfig();
  return {
    source: "kammi_instagram",
    mode: "dry-run",
    active: isKammiSourceActive(cfg),
    configured: cfg.instagram.configured,
    fetchOk: true,
    fetched: 0,
    skippedAlreadyIngested: 0,
    skippedNoText: 0,
    skippedNoDate: 0,
    skippedUnroutable: 0,
    skippedNoCountry: 0,
    dataCentreHeld: 0,
    translated: 0,
    translateFailed: 0,
    routable: 0,
    duplicateMarker: 0,
    duplicateKey: 0,
    duplicateUrl: 0,
    newToInsert: 0,
    inserted: 0,
    byTopic: [],
    errors: [],
    logLines: [],
  };
}

export interface KammiSourceOptions {
  commit?: boolean;
  /** Max dataset items to pull (overrides the configured maxItems). */
  limit?: number;
  log?: (s: string) => void;
}

/**
 * Pull public KAMMI Instagram posts, translate each caption to English, route it
 * into an existing incident topic, relevance-gate, dedupe (marker + fuzzy key +
 * URL) and insert the new ones (commit only). Returns a structured summary.
 * Does NOT close the shared DB pool. No-ops gracefully when the source is not
 * configured or is switched off.
 */
export async function runKammiSourceIngest(
  opts: KammiSourceOptions = {},
): Promise<KammiSourceSummary> {
  const commit = opts.commit ?? false;
  const summary = emptyKammiSourceSummary();
  summary.mode = commit ? "commit" : "dry-run";
  const log = (s: string) => {
    summary.logLines.push(s);
    opts.log?.(s);
  };

  log(`kammi-source — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const cfg = readKammiSourceConfig();
  if (opts.limit && opts.limit > 0) {
    cfg.maxItems = Math.min(120, Math.max(1, Math.trunc(opts.limit)));
  }
  summary.active = isKammiSourceActive(cfg);
  summary.configured = cfg.instagram.configured;
  if (!summary.active) {
    log(
      "  not configured (set INSTAGRAM_API_KEY or APIFY_TOKEN; KAMMI_ENABLED/INSTAGRAM_ENABLED not off) — no-op.",
    );
    return summary;
  }

  let posts: RawInstagramPost[];
  try {
    posts = await fetchInstagramPosts(cfg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.fetchOk = false;
    summary.errors.push(msg);
    log(`  fetch ERROR: ${msg}`);
    return summary;
  }
  summary.fetched = posts.length;
  log(`  fetched            : ${summary.fetched}`);

  // Pre-load already-ingested Instagram marker ids so we can skip posts we have
  // already committed BEFORE spending the translation model on them (the shared
  // dedupe pass would catch them anyway, but only after paying to translate).
  const existingMarkers = await db
    .select({ analystNotes: incidentsTable.analystNotes })
    .from(incidentsTable);
  const ingestedIds = new Set<string>();
  for (const row of existingMarkers) {
    const pid = instagramMarkerPostId(row.analystNotes);
    if (pid) ingestedIds.add(pid);
  }

  const decided: Array<{ topic: SeverityTopic; row: InsertIncident; id: string }> =
    [];
  for (const p of posts) {
    if (ingestedIds.has(p.externalId)) {
      summary.skippedAlreadyIngested++;
      continue;
    }
    // PII-scrub BEFORE translation or storage.
    const sanitised = sanitiseCaption(p.caption);
    if (!sanitised.trim()) {
      summary.skippedNoText++;
      continue;
    }
    // Translate Bahasa → English so the English-only router / country gate work
    // and the stored title re-scores on a RELEVANCE_RULE_VERSION bump. Fall back
    // to the sanitised original when the LLM is unavailable — it will mostly drop
    // at the relevance gate, never be fabricated into a topic.
    const english = await translateCaptionToEnglish(sanitised);
    if (english) summary.translated++;
    else summary.translateFailed++;
    const routingText = english ?? sanitised;

    const normalised: NormalisedIgPost = {
      id: p.externalId,
      text: routingText,
      url: p.url,
      author: cfg.instagram.handle,
      createdAt: p.postedAt,
    };
    const d = decideInstagramIncident(normalised);
    if (!d.insert) {
      if (d.reason === "no-text") summary.skippedNoText++;
      else if (d.reason === "no-date") summary.skippedNoDate++;
      else if (d.reason === "unroutable") summary.skippedUnroutable++;
      else if (d.reason === "no-country") summary.skippedNoCountry++;
      else summary.dataCentreHeld++;
      continue;
    }
    decided.push({ topic: d.topic, row: d.row, id: normalised.id });
  }
  summary.routable = decided.length;

  log(`  already ingested   : ${summary.skippedAlreadyIngested}`);
  log(`  translated         : ${summary.translated}`);
  log(`  translate failed   : ${summary.translateFailed}`);
  log(`  data-centre held   : ${summary.dataCentreHeld}`);
  log(`  no country         : ${summary.skippedNoCountry}`);
  log(`  unroutable         : ${summary.skippedUnroutable}`);
  log(`  routable           : ${summary.routable}`);

  const res = await dedupeAndInsertIgIncidents(decided, { commit, log });
  summary.duplicateMarker = res.duplicateMarker;
  summary.duplicateKey = res.duplicateKey;
  summary.duplicateUrl = res.duplicateUrl;
  summary.newToInsert = res.newToInsert;
  summary.inserted = res.inserted;
  summary.byTopic = res.byTopic;
  for (const e of res.errors) summary.errors.push(e);

  if (commit && summary.errors.length === 0) {
    await recordSourceHealth(
      "flashpoint",
      [
        {
          name: KAMMI_IG_HEALTH_NAME,
          url: `https://www.instagram.com/${cfg.instagram.handle}/`,
          ok: summary.fetchOk,
          collected: summary.fetched,
          retained: summary.inserted,
          rejected:
            summary.skippedNoText +
            summary.skippedNoCountry +
            summary.skippedUnroutable +
            summary.dataCentreHeld +
            summary.duplicateMarker +
            summary.duplicateKey +
            summary.duplicateUrl,
        },
      ],
      {
        sourceType: "social",
        reliability: 2,
        notes:
          "KAMMI Pusat source provider. Public Instagram posts translated to English, content-routed into existing incident topics (Flashpoint / Protests & Civil Unrest); captions PII-scrubbed; a post naming no tracked country is skipped and slop is discarded at the router. Not an incident queue.",
        scrapeMethod: "Apify Instagram dataset (run-and-poll)",
      },
    );
  }

  return summary;
}
