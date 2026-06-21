import {
  db,
  socialRawTable,
  incidentsTable,
  type InsertSocialRawItem,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";
import { sanitiseCaption } from "./socialWatch";
import {
  extractPngItem,
  derivePngProvince,
  derivePngIncidentDate,
} from "./pngExtract";
import {
  extractWestPapuaItem,
  deriveWestPapuaProvince,
  deriveWestPapuaIncidentDate,
} from "./westPapuaExtract";
import type { IncidentCategory } from "./structuredExtract";
import {
  deriveEligibility,
  detectCredibleDomains,
  pickCorroboration,
  categoryToTopic,
  normaliseSourceTier,
  type SourceTier,
  type CredibleDomainMatch,
  type IncidentCandidate,
} from "./facebookOsintEligibility";

// Facebook OSINT monitoring for the Papua New Guinea + Indonesian Papua theatres.
//
// This is ADDITIVE CONTEXT, modelled on socialWatch.ts / maritimeMovement: a
// Facebook post is NEVER an incident and lives in its OWN table (`social_raw`)
// precisely so an OSINT post can never inflate any incident count. The ONLY path
// into `incidents` is the explicit, gated promote action (routes/socialRaw.ts),
// and the server RE-DERIVES eligibility there — never trusting a client claim.
//
// SCOPE: ONE configurable PUBLIC Facebook page (declared tier official /
// local_media / osint). Posts are keyword-filtered to the PNG + Indonesian Papua
// theatres, classified into a security category, and credibility-scored. Only a
// security-relevant AND credible post is promotable.
//
// PRIVACY (enforced in code): only PUBLIC page posts are requested. Comments,
// author/commenter profiles, reactions and any phone/email are NEVER fetched or
// stored. Captions are sanitised (sanitiseCaption); the stored raw_payload is a
// MINIMISED, token-free projection. The Apify token is sent only as a query
// param and is never stored, logged or surfaced (redacted from every error).
//
// Like every ingest module it NEVER throws (all failures captured in the
// returned summary) and NEVER closes the shared DB pool (only the CLI wrapper
// does).

// --- Config ------------------------------------------------------------------

const DEFAULT_PAGE_HANDLE = "PNGFacts";
const DEFAULT_PROVIDER = "apify";
const DEFAULT_ACTOR = "apify~facebook-posts-scraper";
const DEFAULT_API_BASE = "https://api.apify.com";

const SOURCE_NAME = "facebook_osint";
const PLATFORM = "facebook";

// One Source Health row, under the flashpoint topic (where the Papua/PNG
// protest + unrest collection lives).
const HEALTH_TOPIC = "flashpoint";
export const FACEBOOK_OSINT_HEALTH_NAME = "Facebook OSINT (Papua/PNG)";

const MAX_ITEMS_DEFAULT = 40;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FacebookOsintConfig {
  enabled: boolean;
  provider: string;
  apiKey: string;
  apiBase: string;
  actor: string;
  pageHandle: string;
  pageUrl: string;
  pageName: string | null;
  sourceTier: SourceTier;
  maxItems: number;
  /** True when a key is present and the source is not switched off. */
  configured: boolean;
}

function envFlag(name: string, dflt: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return dflt;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

export function readFacebookOsintConfig(): FacebookOsintConfig {
  const enabled = envFlag("FACEBOOK_OSINT_ENABLED", true);
  const apiKey = process.env.FACEBOOK_API_KEY?.trim() || "";
  const configured = enabled && apiKey.length > 0;

  const pageHandle =
    process.env.FACEBOOK_PAGE_HANDLE?.trim() || DEFAULT_PAGE_HANDLE;
  const pageUrl =
    process.env.FACEBOOK_PAGE_URL?.trim() ||
    `https://www.facebook.com/${pageHandle}`;

  const maxRaw = Number(process.env.FACEBOOK_OSINT_MAX_ITEMS);
  const maxItems = Number.isFinite(maxRaw)
    ? Math.min(120, Math.max(5, Math.trunc(maxRaw)))
    : MAX_ITEMS_DEFAULT;

  return {
    enabled,
    provider: process.env.FACEBOOK_PROVIDER?.trim() || DEFAULT_PROVIDER,
    apiKey,
    apiBase: process.env.FACEBOOK_API_BASE?.trim() || DEFAULT_API_BASE,
    actor: process.env.FACEBOOK_ACTOR?.trim() || DEFAULT_ACTOR,
    pageHandle,
    pageUrl,
    pageName: process.env.FACEBOOK_PAGE_NAME?.trim() || null,
    sourceTier: normaliseSourceTier(process.env.FACEBOOK_PAGE_TIER),
    maxItems,
    configured,
  };
}

export function isFacebookOsintActive(
  cfg = readFacebookOsintConfig(),
): boolean {
  return cfg.enabled && cfg.configured;
}

// --- Scope resolution (PNG + Indonesian Papua keyword filter) ----------------

// Bare country/region cues used when no gazetteer locality matched. ".png" image
// extensions are excluded from the PNG abbreviation via the leading-dot guard.
const PNG_COUNTRY_RE =
  /\b(?:papua new guinea|bougainville|niugini)\b|(?<!\.)\bpng\b/i;
const WP_COUNTRY_RE =
  /\b(?:west papua|papua barat|tanah papua|indonesian papua|highlands papua|south papua|central papua|mountain(?:ous)? papua)\b/i;
const BARE_PAPUA_RE = /\bpapua\b/i;

export interface ScopeResolution {
  inScope: boolean;
  country: string;
  province: string | null;
}

/**
 * Resolve whether a post is in the PNG / Indonesian-Papua scope and, if so, to
 * which country. A gazetteer locality wins (it also gives the province); failing
 * that, the bare country/region cues decide. Bare "papua" (not "papua new
 * guinea") defaults to Indonesian Papua, since the PNG country is "Papua New
 * Guinea" / "PNG", not "Papua".
 */
export function resolveScope(text: string): ScopeResolution {
  const pngProvince = derivePngProvince(null, text);
  if (pngProvince)
    return { inScope: true, country: "Papua New Guinea", province: pngProvince };
  const wpProvince = deriveWestPapuaProvince(null, text);
  if (wpProvince)
    return { inScope: true, country: "Indonesia", province: wpProvince };

  if (PNG_COUNTRY_RE.test(text))
    return { inScope: true, country: "Papua New Guinea", province: null };
  if (WP_COUNTRY_RE.test(text))
    return { inScope: true, country: "Indonesia", province: null };
  if (BARE_PAPUA_RE.test(text))
    return { inScope: true, country: "Indonesia", province: null };

  return { inScope: false, country: "Unknown", province: null };
}

// --- Raw post shape ----------------------------------------------------------

export interface RawFacebookPost {
  externalId: string;
  url: string;
  caption: string;
  imageUrls: string[];
  outboundLinks: string[];
  postedAt: Date | null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseTimestamp(v: unknown): Date | null {
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s)"'<>]+/gi;

function isFacebookHost(host: string): boolean {
  return /(?:^|\.)(?:facebook\.com|fb\.com|fb\.me|fbcdn\.net|fbsbx\.com)$/i.test(
    host,
  );
}

/** Collect outbound (non-Facebook) links from an explicit field + the caption. */
function collectOutboundLinks(explicit: string[], caption: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const s = raw.trim().replace(/[.,;)]+$/, "");
    if (!s) return;
    try {
      const u = new URL(s);
      if (!isFacebookHost(u.hostname.toLowerCase())) out.add(s);
    } catch {
      // ignore unparseable
    }
  };
  for (const e of explicit) add(e);
  const matches = caption.match(URL_RE);
  if (matches) for (const m of matches) add(m);
  return [...out].slice(0, 8);
}

/**
 * Strip the query string and fragment from a URL so NO token-bearing / signed /
 * tracking parameter is ever persisted — Facebook CDN signatures (`oh`/`oe`),
 * `?token=`, `access_token`, UTM tags, etc. all live in the query. Keeps
 * scheme + host + path as a clean provenance link. Returns "" for anything that
 * is not a parseable http(s) URL.
 */
export function sanitiseUrl(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

export function normaliseFacebookPost(raw: unknown): RawFacebookPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id =
    asString(r.postId) ||
    asString(r.id) ||
    asString(r.legacyId) ||
    asString(r.postFacebookId) ||
    asString(r.facebookId);
  let url =
    asString(r.url) ||
    asString(r.postUrl) ||
    asString(r.facebookUrl) ||
    asString(r.topLevelUrl) ||
    asString(r.link);
  if (!id && !url) return null;
  if (!url && id) url = `https://www.facebook.com/${id}`;
  const cleanUrl = sanitiseUrl(url) || (id ? `https://www.facebook.com/${id}` : "");
  if (!cleanUrl) return null;
  const externalId = `fb_${id || cleanUrl}`;

  const caption =
    asString(r.text) ||
    asString(r.message) ||
    asString(r.caption) ||
    asString(r.postText) ||
    asString(r.content);

  const imageUrls: string[] = [];
  const pushImg = (s: string) => {
    if (s) imageUrls.push(s);
  };
  pushImg(asString(r.imageUrl) || asString(r.thumbnailUrl) || asString(r.image));
  if (Array.isArray(r.media)) {
    for (const m of r.media) {
      if (typeof m === "string") {
        pushImg(m);
      } else if (m && typeof m === "object") {
        const mo = m as Record<string, unknown>;
        const photo = mo.photo_image as Record<string, unknown> | undefined;
        pushImg(
          asString(mo.thumbnail) ||
            asString(mo.image) ||
            asString(photo?.uri) ||
            asString(mo.uri),
        );
      }
    }
  }
  if (Array.isArray(r.images)) {
    for (const im of r.images) {
      pushImg(
        typeof im === "string"
          ? im
          : asString((im as Record<string, unknown>)?.url),
      );
    }
  }

  const postedAt =
    parseTimestamp(r.time) ??
    parseTimestamp(r.timestamp) ??
    parseTimestamp(r.date) ??
    parseTimestamp(r.publishedTime) ??
    parseTimestamp(r.publish_time);

  const explicitLinks: string[] = [];
  const addLink = (s: string) => {
    if (s) explicitLinks.push(s);
  };
  addLink(asString(r.link));
  if (Array.isArray(r.links)) {
    for (const l of r.links) {
      addLink(
        typeof l === "string"
          ? l
          : asString((l as Record<string, unknown>)?.url),
      );
    }
  }

  return {
    externalId,
    url: cleanUrl,
    caption,
    imageUrls: Array.from(
      new Set(imageUrls.map(sanitiseUrl).filter(Boolean)),
    ).slice(0, 6),
    outboundLinks: collectOutboundLinks(explicitLinks, caption)
      .map(sanitiseUrl)
      .filter(Boolean),
    postedAt,
  };
}

// --- Resilient JSON fetch (token redacted from every error) ------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Scrub the Apify token out of any message before it is stored or logged. */
function redactToken(msg: string, token: string): string {
  if (!token) return msg;
  return msg.split(token).join("[redacted]").replace(/token=[^&\s]+/gi, "token=[redacted]");
}

async function fetchApifyDataset(
  cfg: FacebookOsintConfig,
): Promise<unknown> {
  const url = `${cfg.apiBase}/v2/acts/${encodeURIComponent(
    cfg.actor,
  )}/run-sync-get-dataset-items?token=${encodeURIComponent(cfg.apiKey)}`;
  const input = {
    startUrls: [{ url: cfg.pageUrl }],
    resultsLimit: cfg.maxItems,
    maxPosts: cfg.maxItems,
    onlyPostsNewerThanXDaysAgo: 30,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(input),
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(`status ${res.status}`);
        if (transient && attempt < FETCH_ATTEMPTS - 1) {
          lastErr = err;
          await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
          continue;
        }
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
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

async function fetchFacebookPosts(
  cfg: FacebookOsintConfig,
): Promise<RawFacebookPost[]> {
  if (cfg.provider !== "apify") {
    throw new Error(
      `Facebook provider "${cfg.provider}" not implemented (only "apify" is supported)`,
    );
  }
  const json = await fetchApifyDataset(cfg);
  const arr = Array.isArray(json)
    ? json
    : json &&
        typeof json === "object" &&
        Array.isArray((json as Record<string, unknown>).items)
      ? ((json as Record<string, unknown>).items as unknown[])
      : [];
  const out: RawFacebookPost[] = [];
  for (const item of arr) {
    const norm = normaliseFacebookPost(item);
    if (norm) out.push(norm);
  }
  return out;
}

// --- Dedup fingerprint -------------------------------------------------------

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function imageFingerprint(urls: string[]): string {
  if (urls.length === 0) return "";
  const first = urls[0]!;
  const noQuery = first.split("?")[0]!;
  const base = noQuery.split("/").filter(Boolean).pop() ?? noQuery;
  return base.toLowerCase();
}

/** Content/image fingerprint so reposts collapse to one row. */
export function makeFacebookDedupKey(caption: string, imageUrls: string[]): string {
  const normCaption = caption
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);
  return `fb_${djb2(`${normCaption}|${imageFingerprint(imageUrls)}`)}`;
}

// --- Classification ----------------------------------------------------------

export interface FbClassification {
  caption: string;
  country: string;
  province: string | null;
  location: string | null;
  category: IncidentCategory;
  businessImpact: string;
  incidentDate: Date | null;
  credibleDomains: CredibleDomainMatch;
  promotionTopic: "flashpoint" | "conflict";
  securityRelevant: boolean;
  dedupKey: string;
}

/**
 * Classify a sanitised post: resolve scope (or reject), derive category /
 * province / business impact / incident date from the shared theatre extractors,
 * and detect credible outbound-link domains. Returns null when out of scope.
 */
export function classifyPost(post: RawFacebookPost): FbClassification | null {
  const caption = sanitiseCaption(post.caption);
  if (!caption) return null;
  const scope = resolveScope(caption);
  if (!scope.inScope) return null;

  const isPng = scope.country === "Papua New Guinea";
  const extraction = isPng
    ? extractPngItem(caption, "", null)
    : extractWestPapuaItem(caption, "", null);
  const pubDate = post.postedAt ?? new Date();
  const incidentDate = isPng
    ? derivePngIncidentDate(caption, pubDate)
    : deriveWestPapuaIncidentDate(caption, pubDate);

  const credibleDomains = detectCredibleDomains(post.outboundLinks);
  const category = extraction.category;

  return {
    caption,
    country: scope.country,
    province: extraction.province ?? scope.province,
    location: null,
    category,
    businessImpact: extraction.businessImpact,
    incidentDate,
    credibleDomains,
    promotionTopic: categoryToTopic(category),
    securityRelevant: category !== "Other security",
    dedupKey: makeFacebookDedupKey(caption, post.imageUrls),
  };
}

// --- Summary -----------------------------------------------------------------

export interface FacebookOsintSummary {
  source: "facebook_osint";
  mode: "commit" | "dry-run";
  active: boolean;
  configured: boolean;
  pageHandle: string;
  sourceTier: SourceTier;
  fetchOk: boolean;
  fetched: number;
  inScope: number;
  securityRelevant: number;
  credible: number;
  corroborated: number;
  promotable: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  totalAfter: number;
  latestPostedAt: string | null;
  error: string | null;
  errors: string[];
  logLines: string[];
}

export function emptyFacebookOsintSummary(): FacebookOsintSummary {
  const cfg = readFacebookOsintConfig();
  return {
    source: "facebook_osint",
    mode: "dry-run",
    active: isFacebookOsintActive(cfg),
    configured: cfg.configured,
    pageHandle: cfg.pageHandle,
    sourceTier: cfg.sourceTier,
    fetchOk: true,
    fetched: 0,
    inScope: 0,
    securityRelevant: 0,
    credible: 0,
    corroborated: 0,
    promotable: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestPostedAt: null,
    error: null,
    errors: [],
    logLines: [],
  };
}

async function tableStats(): Promise<{ total: number; latest: Date | null }> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      // drizzle's max() comes back as an ISO STRING at runtime despite the type.
      latest: sql<Date | string | null>`max(${socialRawTable.postedAt})`,
    })
    .from(socialRawTable)
    .where(eq(socialRawTable.sourceName, SOURCE_NAME));
  const latest = row?.latest ?? null;
  return { total: row?.n ?? 0, latest: latest ? new Date(latest) : null };
}

// --- Corroboration (read-only against incidents) -----------------------------

async function findCorroboration(
  cls: FbClassification,
  date: Date,
): Promise<{ incidentId: number; reason: string } | null> {
  const window = 10; // CORROBORATION_WINDOW_DAYS
  const since = new Date(date.getTime() - window * DAY_MS);
  const until = new Date(date.getTime() + window * DAY_MS);
  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
      province: incidentsTable.province,
      category: incidentsTable.category,
      occurredAt: incidentsTable.occurredAt,
      incidentDate: incidentsTable.incidentDate,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.country, cls.country),
        // Match on EITHER the publication time or the (often more precise) event
        // date — an incident whose occurredAt is outside the window but whose
        // incidentDate falls inside it must still be considered, otherwise the
        // scorer (which keys off incidentDate ?? occurredAt) never sees it.
        or(
          and(
            gte(incidentsTable.occurredAt, since),
            lte(incidentsTable.occurredAt, until),
          ),
          and(
            gte(incidentsTable.incidentDate, since),
            lte(incidentsTable.incidentDate, until),
          ),
        ),
      ),
    )
    .limit(200);
  const candidates: IncidentCandidate[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    country: r.country,
    province: r.province,
    category: r.category,
    occurredAt: r.occurredAt,
    incidentDate: r.incidentDate,
  }));
  const match = pickCorroboration(
    {
      text: cls.caption,
      country: cls.country,
      province: cls.province,
      category: cls.category,
      date,
    },
    candidates,
  );
  return match ? { incidentId: match.incident.id, reason: match.reason } : null;
}

// --- Run ---------------------------------------------------------------------

/**
 * Run the Facebook OSINT ingest. Pulls recent PUBLIC posts from the configured
 * page, keyword-filters them to the PNG / Indonesian-Papua scope, classifies +
 * credibility-scores them, de-duplicates, and stores NEW rows as supporting
 * CONTEXT (never incidents). Never throws; never closes the shared pool.
 */
export async function runFacebookOsintIngest(
  opts: { commit?: boolean } = {},
): Promise<FacebookOsintSummary> {
  const commit = opts.commit ?? false;
  const cfg = readFacebookOsintConfig();
  const summary = emptyFacebookOsintSummary();
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  summary.mode = commit ? "commit" : "dry-run";
  summary.active = isFacebookOsintActive(cfg);
  summary.configured = cfg.configured;
  summary.logLines = logLines;
  summary.errors = errors;
  log(
    `facebook-osint — mode=${commit ? "COMMIT" : "DRY-RUN"} active=${summary.active} page=${cfg.pageHandle} tier=${cfg.sourceTier}`,
  );

  // --- Fetch (no-op when not configured).
  const collected: RawFacebookPost[] = [];
  if (cfg.configured) {
    try {
      const posts = await fetchFacebookPosts(cfg);
      summary.fetched = posts.length;
      collected.push(...posts);
      log(`  facebook(${cfg.pageHandle}): ${posts.length} public post(s)`);
    } catch (err) {
      const msg = redactToken(
        err instanceof Error ? err.message : String(err),
        cfg.apiKey,
      );
      summary.fetchOk = false;
      summary.error = msg;
      errors.push(`facebook: ${msg}`);
      log(`  facebook FETCH ERROR: ${msg}`);
    }
  } else {
    log("  facebook: not configured (FACEBOOK_API_KEY unset or disabled)");
  }

  // --- Classify + scope-filter.
  interface Candidate {
    post: RawFacebookPost;
    cls: FbClassification;
  }
  const candidates: Candidate[] = [];
  for (const post of collected) {
    const cls = classifyPost(post);
    if (!cls) continue;
    candidates.push({ post, cls });
  }
  summary.inScope = candidates.length;
  summary.securityRelevant = candidates.filter(
    (c) => c.cls.securityRelevant,
  ).length;

  // --- In-run dedup by dedupKey.
  const byKey = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!byKey.has(c.cls.dedupKey)) byKey.set(c.cls.dedupKey, c);
  }
  let unique = Array.from(byKey.values());

  // --- Dedup against the table (dedup_key primary; external_id fallback).
  if (unique.length > 0) {
    const keys = unique.map((u) => u.cls.dedupKey);
    const extIds = unique.map((u) => u.post.externalId);
    const existing = await db
      .select({
        dedupKey: socialRawTable.dedupKey,
        externalId: socialRawTable.externalId,
      })
      .from(socialRawTable)
      .where(
        or(
          inArray(socialRawTable.dedupKey, keys),
          inArray(socialRawTable.externalId, extIds),
        ),
      );
    const haveKey = new Set(existing.map((e) => e.dedupKey));
    const haveExt = new Set(existing.map((e) => e.externalId));
    const before = unique.length;
    unique = unique.filter(
      (u) => !haveKey.has(u.cls.dedupKey) && !haveExt.has(u.post.externalId),
    );
    summary.duplicateInDb = before - unique.length;
  }
  summary.newToInsert = unique.length;

  // --- Build insert rows: corroboration (read-only) + final eligibility.
  const values: InsertSocialRawItem[] = [];
  for (const { post, cls } of unique) {
    const date = cls.incidentDate ?? post.postedAt ?? new Date();
    let corroboration: { incidentId: number; reason: string } | null = null;
    try {
      corroboration = await findCorroboration(cls, date);
    } catch (err) {
      // Corroboration is a soft credibility upgrade — never fail the ingest.
      const msg = err instanceof Error ? err.message : String(err);
      log(`  corroboration lookup failed: ${msg}`);
    }
    const eligibility = deriveEligibility({
      category: cls.category,
      sourceTier: cfg.sourceTier,
      credibleDomainLabels: cls.credibleDomains.labels,
      corroborated: corroboration !== null,
      corroborationReason: corroboration?.reason ?? null,
    });
    if (corroboration) summary.corroborated++;
    if (eligibility.credible) summary.credible++;
    if (eligibility.promotable) summary.promotable++;

    values.push({
      sourceName: SOURCE_NAME,
      platform: PLATFORM,
      pageHandle: cfg.pageHandle,
      pageName: cfg.pageName,
      sourceTier: cfg.sourceTier,
      externalId: post.externalId,
      postedAt: post.postedAt,
      incidentDate: cls.incidentDate,
      caption: cls.caption,
      imageUrls: post.imageUrls,
      links: post.outboundLinks,
      detectedCredibleDomains: cls.credibleDomains.labels,
      country: cls.country,
      province: cls.province,
      location: cls.location,
      category: cls.category,
      businessImpact: cls.businessImpact,
      securityRelevant: eligibility.securityRelevant,
      credible: eligibility.credible,
      credibilityReason: eligibility.credibilityReason,
      corroborated: corroboration !== null,
      corroborationReason: corroboration?.reason ?? null,
      corroboratingIncidentId: corroboration?.incidentId ?? null,
      promotionTopic: cls.promotionTopic,
      url: post.url,
      classification: "context",
      dedupKey: cls.dedupKey,
      // MINIMISED, token-free provenance — never the full payload (no comments,
      // author profile, reactions, phone/email).
      rawPayload: {
        externalId: post.externalId,
        url: post.url,
        postedAt: post.postedAt ? post.postedAt.toISOString() : null,
        imageCount: post.imageUrls.length,
        linkHosts: cls.credibleDomains.hosts,
        actor: cfg.actor,
        page: cfg.pageHandle,
      },
      promotable: eligibility.promotable,
      lastCheckedAt: new Date(),
      fetchedAt: new Date(),
    });
  }

  // --- Persist.
  if (commit && values.length > 0) {
    const inserted = await db
      .insert(socialRawTable)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: socialRawTable.id });
    summary.inserted = inserted.length;
    log(`  committed: ${summary.inserted} new row(s)`);
  } else if (!commit) {
    log("  DRY-RUN — no rows written.");
  }

  // --- Stamp last-checked on existing rows when the fetch succeeded.
  if (commit && cfg.configured && summary.fetchOk) {
    await db
      .update(socialRawTable)
      .set({ lastCheckedAt: new Date() })
      .where(eq(socialRawTable.sourceName, SOURCE_NAME));
  }

  // --- Source Health (single row).
  if (commit) {
    await recordSourceHealthForPage(cfg, summary);
  }

  const stats = await tableStats();
  summary.totalAfter = stats.total;
  summary.latestPostedAt = stats.latest ? stats.latest.toISOString() : null;
  return summary;
}

async function recordSourceHealthForPage(
  cfg: FacebookOsintConfig,
  summary: FacebookOsintSummary,
): Promise<void> {
  const name = FACEBOOK_OSINT_HEALTH_NAME;
  const url = cfg.pageUrl;
  const notes = `Public Facebook page (${cfg.pageHandle}, tier=${cfg.sourceTier}) monitored as supporting OSINT CONTEXT for the PNG/Indonesian-Papua theatres — NEVER incidents. Promotion to an incident is explicit, gated (security category AND a credibility signal) and server-re-derived.`;
  if (!cfg.configured) {
    await recordSourceHealth(
      HEALTH_TOPIC,
      [{ name, url, ok: false, error: "Integration not configured" }],
      { sourceType: "social", reliability: 2, notes, notConfigured: true },
    );
    return;
  }
  if (summary.fetchOk) {
    await recordSourceHealth(HEALTH_TOPIC, [{ name, url, ok: true }], {
      sourceType: "social",
      reliability: 2,
      notes,
    });
    return;
  }
  // Configured but this run failed — pending (awaiting validation / provider
  // access), not a hard outage, until it succeeds once.
  await recordSourceHealth(
    HEALTH_TOPIC,
    [{ name, url, ok: false, error: summary.error ?? "fetch failed" }],
    { sourceType: "social", reliability: 2, notes, pending: true },
  );
}
