import { db, incidentsTable } from "@workspace/db";
import type { InsertIncident } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanText } from "./text";
import { classifySeverity, type SeverityTopic } from "./severity";
import { geocode } from "./geocode";
import { detectCountry } from "./newsTopic";
import { COUNTRY_ALIASES } from "./topicConfigs";
import {
  evaluateIncidentRelevance,
  isTopicRelevant,
  type RelevanceInput,
} from "@workspace/relevance";
import { recordSourceHealth } from "./sourceHealth";

// X (Twitter) Recent Search — SOURCE PROVIDER ONLY.
//
// This is NOT a new product, page, feed or report. It fetches recent X posts
// via the existing X_BEARER_TOKEN, normalises each into the shared incident
// shape, content-routes it into an EXISTING incident topic, relevance-gates it,
// dedupes it, and (only with commit) inserts it into the existing `incidents`
// table. Manual CLI only, dry-run by default, STRICT no-fabrication.
//
// It deliberately does NOT close the shared DB pool (mirrors the other ingest
// runners) and is deliberately NOT wired into the scheduler (runIngestOnce).

const X_RECENT_SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";

// Idempotency marker written to analyst_notes so re-runs recognise an already-
// ingested post and never insert it twice. Deliberately NOT in the
// backfillRelevance marker-exclusion list: X rows are text-classified and MUST
// re-score on a RELEVANCE_RULE_VERSION bump (unlike lane/marker-vouched
// gdelt_cloud/tapa_offline rows).
export const X_MARKER_PREFIX = "x_search:";

export function xMarker(postId: string, author: string | null, queryLabel: string): string {
  const parts = [`${X_MARKER_PREFIX}${postId}`];
  if (author) parts.push(`@${author}`);
  if (queryLabel) parts.push(`query:${queryLabel}`);
  return parts.join(" | ");
}

/** The X post id encoded in an analyst_notes marker, or null. */
export function markerPostId(analystNotes: string | null | undefined): string | null {
  if (!analystNotes || !analystNotes.startsWith(X_MARKER_PREFIX)) return null;
  const rest = analystNotes.slice(X_MARKER_PREFIX.length);
  const id = rest.split("|")[0]?.trim();
  return id || null;
}

// Same fuzzy dedupe key the news-topic ingest uses (mirror dedupeKey in
// newsTopic.ts / gdeltDedupeKey — keep the formula identical) so an X post
// duplicating an already-scraped news incident (same headline, day, country,
// topic) collapses rather than double-counts.
export function xDedupeKey(title: string, when: Date, country: string, topic: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    topic,
  ].join("||");
}

function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

// Data-centre content signal. A post about a data centre / hyperscale facility
// content-routes to the internal `data_centre_candidate` HOLD — it is COUNTED
// but NEVER committed to `incidents` (the data-centre registry is a curated
// facilities table, not an incident feed). Kept deliberately narrow so ordinary
// "cloud outage" chatter does not trip it.
const DATA_CENTRE_RE =
  /\b(data ?cent(?:er|re)s?|hyperscale|colocation|colo facilit|server farm)\b/i;

export function matchesDataCentre(text: string): boolean {
  return DATA_CENTRE_RE.test(text);
}

// Content-routing precedence (owner-approved): data-centre first (HELD, never
// committed) → conflict → flashpoint → shipping → cargo_watch. For the real
// topics we reuse the maintained relevance engine as the router: the FIRST
// topic whose own rules judge the post relevant wins. This makes routing and
// the relevance gate one and the same, so routed rows are relevant by
// construction and no parallel keyword taxonomy can drift from the engine.
const ROUTE_TOPICS: SeverityTopic[] = ["conflict", "flashpoint", "shipping", "cargo_watch"];

export type XRoute =
  | { kind: "topic"; topic: SeverityTopic }
  | { kind: "data_centre_candidate" }
  | { kind: "none" };

export function routeTopic(input: { title: string; summary: string; source: string; sourceUrl: string }): XRoute {
  const hay = `${input.title}\n${input.summary}`;
  if (matchesDataCentre(hay)) return { kind: "data_centre_candidate" };
  for (const topic of ROUTE_TOPICS) {
    const rel: RelevanceInput = {
      topic,
      title: input.title,
      summary: input.summary,
      source: input.source,
      sourceUrl: input.sourceUrl,
      location: null,
    };
    if (isTopicRelevant(topic, rel)) return { kind: "topic", topic };
  }
  return { kind: "none" };
}

// A normalised X post — the neutral shape the pure decision function consumes,
// so routing/dedupe/insert-building are unit-testable without the network.
export type NormalisedTweet = {
  id: string;
  text: string;
  url: string;
  author: string | null;
  createdAt: Date | null;
  queryLabel: string;
};

export type XDecision =
  | { insert: true; topic: SeverityTopic; row: InsertIncident }
  | {
      insert: false;
      reason: "no-date" | "no-text" | "no-country" | "data-centre-hold" | "unroutable";
    };

/**
 * Decide whether one normalised X post becomes an incident, and if so build the
 * exact InsertIncident row. Pure and side-effect free (bar `new Date()` for the
 * evaluation timestamp) so the whole mapping is unit-testable without a DB or
 * network. STRICT no-fabrication: a post with no tracked country in its text is
 * SKIPPED (never stamped onto a guessed centroid); a data-centre post is HELD.
 */
export function decideXIncident(post: NormalisedTweet): XDecision {
  const text = cleanText(post.text);
  if (!text) return { insert: false, reason: "no-text" };
  if (!post.createdAt) return { insert: false, reason: "no-date" };

  const source = "X";
  const route = routeTopic({ title: text, summary: text, source, sourceUrl: post.url });
  if (route.kind === "data_centre_candidate") return { insert: false, reason: "data-centre-hold" };
  if (route.kind === "none") return { insert: false, reason: "unroutable" };
  const topic = route.topic;

  // No-fabrication country attribution: only keep a post that names a tracked
  // country in its own text. We never guess a country for a free-floating post.
  const country = detectCountry(text.toLowerCase(), COUNTRY_ALIASES);
  if (!country) return { insert: false, reason: "no-country" };

  const title = text.slice(0, 500);
  const summary = text.slice(0, 2000);

  const geo = geocode(country, `${title} ${summary}`);
  const severity = classifySeverity(title, summary, topic);

  const rel = evaluateIncidentRelevance(topic, {
    topic,
    title,
    summary,
    source,
    sourceUrl: post.url,
    location: geo?.location ?? null,
  });

  const row: InsertIncident = {
    topic,
    title,
    summary,
    country,
    location: geo?.location ?? null,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    occurredAt: post.createdAt,
    severity,
    confidence: "low",
    source,
    sourceUrl: post.url,
    analystNotes: xMarker(post.id, post.author, post.queryLabel),
    relevanceStatus: rel.status,
    relevanceScore: rel.score,
    relevanceReason: rel.reason,
    relevanceVersion: rel.version,
    relevanceEvaluatedAt: new Date(),
  };

  return { insert: true, topic, row };
}

export interface XConfig {
  bearerToken: string;
}

/** Resolved X credentials, or null when X_BEARER_TOKEN is unset. */
export function readXConfig(): XConfig | null {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return null;
  return { bearerToken: token };
}

export function isXConfigured(): boolean {
  return readXConfig() !== null;
}

// Example queries. English-only and retweet-excluded so the recent-search
// window returns original posts. The `label` tags the query's INTENDED topic
// for the run report only — the FINAL topic always comes from content routing.
export type XQuery = { label: string; q: string };

export const X_SEARCH_QUERIES: XQuery[] = [
  { label: "conflict", q: "(clash OR ambush OR firefight OR insurgent OR militant) lang:en -is:retweet" },
  { label: "flashpoint", q: "(protest OR rally OR riot OR strike OR unrest) lang:en -is:retweet" },
  { label: "shipping", q: "(tanker OR vessel OR port OR strait) (attack OR seized OR blocked) lang:en -is:retweet" },
  { label: "cargo_watch", q: "(\"cargo theft\" OR \"truck hijack\" OR \"warehouse robbery\") lang:en -is:retweet" },
];

type XApiTweet = { id?: unknown; text?: unknown; created_at?: unknown; author_id?: unknown };
type XApiUser = { id?: unknown; username?: unknown };

/**
 * Fetch one recent-search page. Returns normalised tweets. Upstream JSON is
 * untrusted external input, so every field access is defensive.
 */
export async function fetchRecentSearch(
  cfg: XConfig,
  query: XQuery,
  maxResults = 25,
): Promise<NormalisedTweet[]> {
  const url = new URL(X_RECENT_SEARCH_URL);
  url.searchParams.set("query", query.q);
  url.searchParams.set("max_results", String(Math.min(Math.max(maxResults, 10), 100)));
  url.searchParams.set("tweet.fields", "created_at,author_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.bearerToken}`,
      "User-Agent": "PolestarWorkbench XSearch",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`X recent search ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: unknown;
    includes?: { users?: unknown };
  };

  const users = new Map<string, string>();
  const rawUsers = json.includes?.users;
  if (Array.isArray(rawUsers)) {
    for (const u of rawUsers as XApiUser[]) {
      const id = typeof u.id === "string" ? u.id : null;
      const username = typeof u.username === "string" ? u.username : null;
      if (id && username) users.set(id, username);
    }
  }

  const out: NormalisedTweet[] = [];
  const rawData = json.data;
  if (!Array.isArray(rawData)) return out;
  for (const t of rawData as XApiTweet[]) {
    const id = typeof t.id === "string" ? t.id : null;
    const text = typeof t.text === "string" ? t.text : "";
    if (!id) continue;
    const authorId = typeof t.author_id === "string" ? t.author_id : null;
    const author = authorId ? users.get(authorId) ?? null : null;
    const createdRaw = typeof t.created_at === "string" ? t.created_at : null;
    const createdAt = createdRaw ? new Date(createdRaw) : null;
    const url = author ? `https://x.com/${author}/status/${id}` : `https://x.com/i/status/${id}`;
    out.push({
      id,
      text,
      url,
      author,
      createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
      queryLabel: query.label,
    });
  }
  return out;
}

export type XSearchSummary = {
  mode: "commit" | "dry-run";
  configured: boolean;
  fetched: number;
  skippedNoText: number;
  skippedNoDate: number;
  skippedUnroutable: number;
  skippedNoCountry: number;
  dataCentreHeld: number;
  routable: number;
  duplicateMarker: number;
  duplicateKey: number;
  duplicateUrl: number;
  newToInsert: number;
  inserted: number;
  byTopic: Array<[string, number]>;
  errors: string[];
  logLines: string[];
};

export function emptyXSearchSummary(): XSearchSummary {
  return {
    mode: "dry-run",
    configured: false,
    fetched: 0,
    skippedNoText: 0,
    skippedNoDate: 0,
    skippedUnroutable: 0,
    skippedNoCountry: 0,
    dataCentreHeld: 0,
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

export type XSearchOptions = {
  commit?: boolean;
  /** Restrict to a single query label (e.g. "conflict"). */
  queryLabel?: string;
  /** Max results per query (10..100). */
  maxResults?: number;
};

/**
 * Fetch recent X posts, route them into existing incident topics, relevance-gate,
 * dedupe (marker + fuzzy key + URL) and insert the new ones (commit only).
 * Returns a structured summary. Does NOT close the shared DB pool. No-ops
 * gracefully when X_BEARER_TOKEN is unset.
 */
export async function runXSearchIngest(opts: XSearchOptions = {}): Promise<XSearchSummary> {
  const commit = opts.commit ?? false;
  const summary = emptyXSearchSummary();
  summary.mode = commit ? "commit" : "dry-run";
  const log = (s: string) => summary.logLines.push(s);

  log(`x-search — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const cfg = readXConfig();
  if (!cfg) {
    log("  X_BEARER_TOKEN not set — no-op.");
    return summary;
  }
  summary.configured = true;

  const queries = opts.queryLabel
    ? X_SEARCH_QUERIES.filter((q) => q.label === opts.queryLabel)
    : X_SEARCH_QUERIES;
  if (queries.length === 0) {
    log(`  no query matches label="${opts.queryLabel}".`);
    return summary;
  }

  const posts: NormalisedTweet[] = [];
  for (const q of queries) {
    try {
      const page = await fetchRecentSearch(cfg, q, opts.maxResults ?? 25);
      posts.push(...page);
      log(`  query ${q.label.padEnd(12)} fetched ${page.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(msg);
      log(`  query ${q.label.padEnd(12)} ERROR: ${msg}`);
    }
  }
  summary.fetched = posts.length;

  const decided: Array<{ topic: SeverityTopic; row: InsertIncident; id: string }> = [];
  for (const p of posts) {
    const d = decideXIncident(p);
    if (!d.insert) {
      if (d.reason === "no-text") summary.skippedNoText++;
      else if (d.reason === "no-date") summary.skippedNoDate++;
      else if (d.reason === "unroutable") summary.skippedUnroutable++;
      else if (d.reason === "no-country") summary.skippedNoCountry++;
      else summary.dataCentreHeld++;
      continue;
    }
    decided.push({ topic: d.topic, row: d.row, id: p.id });
  }
  summary.routable = decided.length;

  // Dedupe against existing incidents: idempotency marker (re-runs), fuzzy key
  // (a scraped/other-source row for the same event) and URL.
  const existing = await db
    .select({
      title: incidentsTable.title,
      occurredAt: incidentsTable.occurredAt,
      country: incidentsTable.country,
      topic: incidentsTable.topic,
      sourceUrl: incidentsTable.sourceUrl,
      resolvedUrl: incidentsTable.resolvedUrl,
      analystNotes: incidentsTable.analystNotes,
    })
    .from(incidentsTable);

  const seenMarkers = new Set<string>();
  const existingKeys = new Set<string>();
  const existingUrls = new Set<string>();
  for (const row of existing) {
    const pid = markerPostId(row.analystNotes);
    if (pid) seenMarkers.add(pid);
    existingKeys.add(xDedupeKey(row.title, row.occurredAt, row.country, row.topic));
    if (row.sourceUrl) existingUrls.add(normaliseUrl(row.sourceUrl));
    if (row.resolvedUrl) existingUrls.add(normaliseUrl(row.resolvedUrl));
  }

  const toInsert: InsertIncident[] = [];
  const byTopic = new Map<string, number>();
  for (const d of decided) {
    if (seenMarkers.has(d.id)) {
      summary.duplicateMarker++;
      continue;
    }
    const key = xDedupeKey(d.row.title, d.row.occurredAt as Date, d.row.country, d.row.topic);
    if (existingKeys.has(key)) {
      summary.duplicateKey++;
      continue;
    }
    const url = d.row.sourceUrl ? normaliseUrl(d.row.sourceUrl) : null;
    if (url && existingUrls.has(url)) {
      summary.duplicateUrl++;
      continue;
    }
    toInsert.push(d.row);
    // Grow the guard sets so two posts describing the same event in one run
    // cannot both insert.
    seenMarkers.add(d.id);
    existingKeys.add(key);
    if (url) existingUrls.add(url);
    byTopic.set(d.topic, (byTopic.get(d.topic) ?? 0) + 1);
  }
  summary.newToInsert = toInsert.length;
  summary.byTopic = [...byTopic.entries()].sort((a, b) => b[1] - a[1]);

  log(`  fetched            : ${summary.fetched}`);
  log(`  data-centre held   : ${summary.dataCentreHeld}`);
  log(`  no country         : ${summary.skippedNoCountry}`);
  log(`  unroutable         : ${summary.skippedUnroutable}`);
  log(`  routable           : ${summary.routable}`);
  log(`  already ingested   : ${summary.duplicateMarker}`);
  log(`  dupe (key)         : ${summary.duplicateKey}`);
  log(`  dupe (url)         : ${summary.duplicateUrl}`);
  log(`  new to insert      : ${summary.newToInsert}`);

  if (commit && toInsert.length > 0) {
    try {
      await db.insert(incidentsTable).values(toInsert);
      summary.inserted = toInsert.length;
      log(`  inserted           : ${summary.inserted}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(msg);
      log(`  INSERT FAILED      : ${msg}`);
    }
  } else if (!commit) {
    log("  DRY-RUN — no rows written. Re-run with --commit to insert.");
  }

  if (commit && summary.errors.length === 0) {
    await recordSourceHealth(
      "flashpoint",
      [
        {
          name: "X (Twitter) Recent Search",
          url: "https://x.com",
          ok: true,
          collected: summary.fetched,
          retained: summary.inserted,
          rejected:
            summary.skippedNoCountry +
            summary.skippedUnroutable +
            summary.dataCentreHeld +
            summary.duplicateMarker +
            summary.duplicateKey +
            summary.duplicateUrl,
        },
      ],
      {
        sourceType: "api",
        reliability: 2,
        notes:
          "X (Twitter) Recent Search source provider. Manual CLI only (not scheduled). Posts content-routed into existing incident topics; data-centre posts held, never committed.",
        scrapeMethod: "X API v2 recent search",
      },
    );
  }

  return summary;
}
