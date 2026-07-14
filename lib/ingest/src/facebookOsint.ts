import {
  db,
  socialRawTable,
  incidentsTable,
  sourcesTable,
  type InsertSocialRawItem,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";
import { FACEBOOK_OSINT_HEALTH_NAME } from "./optionalIntegrations";
import { sanitiseCaption } from "./text";
import {
  extractPngItem,
  derivePngProvince,
  derivePngLocality,
  derivePngIncidentDate,
} from "./pngExtract";
import {
  extractWestPapuaItem,
  deriveWestPapuaProvince,
  deriveWestPapuaLocality,
  deriveWestPapuaIncidentDate,
} from "./westPapuaExtract";
import type { IncidentCategory } from "./structuredExtract";
import {
  deriveEligibility,
  deriveReview,
  computeConfidence,
  detectCredibleDomains,
  pickCorroboration,
  categoryToTopic,
  normaliseSourceTier,
  applySecurityEventGuard,
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
const DEFAULT_SEARCH_ACTOR = "apify~facebook-search-scraper";
const DEFAULT_API_BASE = "https://api.apify.com";

// Synthetic page handle stamped on rows that came from the keyword post-search
// pass (no single owning page). Always carries the unverified "osint" tier, so a
// search hit is never promotable on tier alone — it needs a linked credible
// domain or a cross-feed corroboration, exactly like any unverified OSINT page.
const SEARCH_PAGE_HANDLE = "facebook-search";

/** A monitored public page + its config-declared credibility tier. */
export interface FacebookPageSource {
  handle: string;
  url: string;
  name: string | null;
  tier: SourceTier;
}

// Curated, OVERRIDABLE default coverage. PNGFacts stays an unverified OSINT
// aggregator; the established outlets carry their real "local_media" tier (an
// analyst still has to click Promote — the tier only governs whether a
// security-relevant post becomes promote-eligible). A mistyped/dead handle just
// returns no posts (graceful), so nothing is ever fabricated. Override via
// FACEBOOK_PAGE_HANDLE(S) / FACEBOOK_PAGE_URL.
const DEFAULT_PAGES: FacebookPageSource[] = [
  { handle: "PNGFacts", url: "https://www.facebook.com/PNGFacts", name: "PNG Facts", tier: "osint" },
  { handle: "EMTVOnlinePNG", url: "https://www.facebook.com/EMTVOnlinePNG", name: "EMTV Online", tier: "local_media" },
  { handle: "postcourierpng", url: "https://www.facebook.com/postcourierpng", name: "Post-Courier", tier: "local_media" },
  { handle: "thenationalpng", url: "https://www.facebook.com/thenationalpng", name: "The National (PNG)", tier: "local_media" },
  { handle: "LoopPNG", url: "https://www.facebook.com/LoopPNG", name: "Loop PNG", tier: "local_media" },
  { handle: "tabloidjubi", url: "https://www.facebook.com/tabloidjubi", name: "Jubi (Papua)", tier: "local_media" },
];

// Curated, OVERRIDABLE keyword post-search terms (PNG + Indonesian-Papua
// security). Override via FACEBOOK_SEARCH_TERMS (comma/semicolon list); set it
// blank to disable the search pass, or FACEBOOK_SEARCH_ENABLED=false.
const DEFAULT_SEARCH_TERMS = [
  "Papua New Guinea unrest",
  "PNG tribal fighting",
  "Port Moresby violence",
  "Bougainville security",
  "West Papua protest",
  "Papua shooting",
  "Jayapura clash",
];

const SOURCE_NAME = "facebook_osint";
const PLATFORM = "facebook";

// One Source Health row, under the flashpoint topic (where the Papua/PNG
// protest + unrest collection lives).
const HEALTH_TOPIC = "flashpoint";
export { FACEBOOK_OSINT_HEALTH_NAME } from "./optionalIntegrations";

const MAX_ITEMS_DEFAULT = 40;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hours between live Facebook OSINT pulls (default daily). The collector
 * self-throttles to this interval via the cadence gate in runFacebookOsintIngest
 * so frequent autoscale cold starts cannot re-spend the PAID Apify call. Keyed
 * off the Source Health heartbeat (sources.last_success_at), which advances on
 * every successful run — including an all-duplicate 0-insert one — unlike
 * social_raw's own timestamps, which do not advance under onConflictDoNothing.
 */
export function facebookOsintIntervalHours(): number {
  const raw = process.env.FACEBOOK_OSINT_INTERVAL_HOURS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/**
 * The pure cadence DECISION: true when a prior successful run exists AND it is
 * more recent than the interval — i.e. the (PAID) fetch should be skipped. A
 * null heartbeat (never run) returns false so an initial-population run always
 * proceeds. `now` is injectable for tests.
 */
export function withinFacebookCadence(
  lastRun: Date | null,
  intervalHours: number,
  now: number = Date.now(),
): boolean {
  if (!lastRun) return false;
  return (now - lastRun.getTime()) / 3_600_000 < intervalHours;
}

export interface FacebookOsintConfig {
  enabled: boolean;
  provider: string;
  apiKey: string;
  apiBase: string;
  /** Apify actor for the per-page post pull. */
  actor: string;
  /** Apify actor for the keyword post-search pass. */
  searchActor: string;
  /** Every monitored public page (curated default, configurable). */
  pages: FacebookPageSource[];
  /** Keyword post-search terms (empty disables the search pass). */
  searchTerms: string[];
  /** True when the search pass is switched on AND has at least one term. */
  searchEnabled: boolean;
  // Primary page (pages[0]) — kept for back-compat with the single-page Source
  // Health row + summary label.
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

/**
 * Resolve the monitored pages. A single-page override
 * (FACEBOOK_PAGE_HANDLE/URL/NAME/TIER) wins (back-compat); else a
 * FACEBOOK_PAGE_HANDLES list ("handle|tier|Name" per entry, tier+name
 * optional); else the curated DEFAULT_PAGES.
 */
function resolvePages(): FacebookPageSource[] {
  const single = process.env.FACEBOOK_PAGE_HANDLE?.trim();
  const singleUrl = process.env.FACEBOOK_PAGE_URL?.trim();
  if (single || singleUrl) {
    const handle = single || DEFAULT_PAGE_HANDLE;
    return [
      {
        handle,
        url: singleUrl || `https://www.facebook.com/${handle}`,
        name: process.env.FACEBOOK_PAGE_NAME?.trim() || null,
        tier: normaliseSourceTier(process.env.FACEBOOK_PAGE_TIER),
      },
    ];
  }
  const list = (process.env.FACEBOOK_PAGE_HANDLES || "")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length) {
    return list.map((entry) => {
      const [handle, tier, name] = entry.split("|").map((x) => x?.trim());
      return {
        handle: handle!,
        url: `https://www.facebook.com/${handle}`,
        name: name || null,
        tier: normaliseSourceTier(tier),
      };
    });
  }
  return DEFAULT_PAGES;
}

/** Resolve the post-search terms (unset → curated default; blank → disabled). */
function resolveSearchTerms(): string[] {
  const raw = process.env.FACEBOOK_SEARCH_TERMS;
  if (raw === undefined) return DEFAULT_SEARCH_TERMS;
  return raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readFacebookOsintConfig(): FacebookOsintConfig {
  const enabled = envFlag("FACEBOOK_OSINT_ENABLED", true);
  const apiKey = process.env.FACEBOOK_API_KEY?.trim() || "";
  const configured = enabled && apiKey.length > 0;

  const pages = resolvePages();
  const primary = pages[0] ?? {
    handle: DEFAULT_PAGE_HANDLE,
    url: `https://www.facebook.com/${DEFAULT_PAGE_HANDLE}`,
    name: null,
    tier: "osint" as SourceTier,
  };

  const searchTerms = resolveSearchTerms();
  const searchEnabled =
    envFlag("FACEBOOK_SEARCH_ENABLED", true) && searchTerms.length > 0;

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
    searchActor:
      process.env.FACEBOOK_SEARCH_ACTOR?.trim() || DEFAULT_SEARCH_ACTOR,
    pages,
    searchTerms,
    searchEnabled,
    pageHandle: primary.handle,
    pageUrl: primary.url,
    pageName: primary.name,
    sourceTier: primary.tier,
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
  // Coarse public engagement counts when the provider supplies them. Counts
  // only — never commenter identities. Null when not reported.
  engagement?: { reactions?: number; comments?: number; shares?: number } | null;
  // Origin metadata attached by the fetch loop (per source page / search pass).
  // Optional so direct unit construction of a post stays terse.
  pageHandle?: string;
  pageName?: string | null;
  /** Public page/group URL the post belongs to, when the provider supplies it. */
  pageUrl?: string | null;
  sourceTier?: SourceTier;
  origin?: "page" | "search";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse a non-negative integer count from a number or comma/space string. */
function asCount(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
  }
  return undefined;
}

/**
 * Defensive engagement parse across the many shapes the Apify Facebook scrapers
 * emit. COUNTS ONLY — no commenter identity is ever read. Returns null when the
 * provider reports nothing (never a fabricated zero).
 */
function parseEngagement(
  r: Record<string, unknown>,
): { reactions?: number; comments?: number; shares?: number } | null {
  const reactionsObj =
    r.reactions && typeof r.reactions === "object"
      ? (r.reactions as Record<string, unknown>)
      : undefined;
  const reactions =
    asCount(r.likes) ??
    asCount(r.likesCount) ??
    asCount(r.reactionsCount) ??
    asCount(r.reactionLikeCount) ??
    asCount(reactionsObj?.total) ??
    asCount(reactionsObj?.totalCount) ??
    (reactionsObj ? undefined : asCount(r.reactions));
  const comments =
    asCount(r.comments) ?? asCount(r.commentsCount) ?? asCount(r.commentCount);
  const shares =
    asCount(r.shares) ?? asCount(r.sharesCount) ?? asCount(r.shareCount);
  const out: { reactions?: number; comments?: number; shares?: number } = {};
  if (reactions !== undefined) out.reactions = reactions;
  if (comments !== undefined) out.comments = comments;
  if (shares !== undefined) out.shares = shares;
  return Object.keys(out).length > 0 ? out : null;
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
    asString(r.permalink) ||
    asString(r.permalinkUrl) ||
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
  // Facebook groups/posts scrapers emit photos under `attachments[]` as
  // { thumbnail, photo_image: { uri }, ... }. Prefer the CDN image fields;
  // the attachment's own `url` is a facebook.com/photo page, not an image.
  if (Array.isArray(r.attachments)) {
    for (const a of r.attachments) {
      if (a && typeof a === "object") {
        const ao = a as Record<string, unknown>;
        const photo = ao.photo_image as Record<string, unknown> | undefined;
        pushImg(
          asString(ao.thumbnail) ||
            asString(photo?.uri) ||
            asString(ao.image) ||
            asString(ao.media),
        );
      }
    }
  }

  const postedAt =
    parseTimestamp(r.time) ??
    parseTimestamp(r.timestamp) ??
    parseTimestamp(r.date) ??
    parseTimestamp(r.publishedTime) ??
    parseTimestamp(r.publish_time) ??
    parseTimestamp(r.createdAt) ??
    parseTimestamp(r.created_time) ??
    parseTimestamp(r.creationTime);

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

  // Source page / group provenance (dataset items carry this; the live fetch
  // loop overrides handle/name/tier from its own per-page config afterwards).
  const pageObj =
    r.page && typeof r.page === "object"
      ? (r.page as Record<string, unknown>)
      : undefined;
  const groupObj =
    r.group && typeof r.group === "object"
      ? (r.group as Record<string, unknown>)
      : undefined;
  const userObj =
    r.user && typeof r.user === "object"
      ? (r.user as Record<string, unknown>)
      : undefined;
  const pageUrl =
    sanitiseUrl(
      asString(r.pageUrl) ||
        asString(r.groupUrl) ||
        asString(pageObj?.url) ||
        asString(groupObj?.url) ||
        // `inputUrl` is the scraper's INPUT url = the source group/page the post
        // was collected from (reliable in both the groups + posts scrapers).
        asString(r.inputUrl),
    ) || null;
  const pageName =
    asString(r.pageName) ||
    asString(r.groupTitle) ||
    asString(r.groupName) ||
    asString(pageObj?.name) ||
    asString(groupObj?.name) ||
    asString(userObj?.name) ||
    null;

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
    engagement: parseEngagement(r),
    pageUrl,
    pageName,
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
  actor: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const url = `${cfg.apiBase}/v2/acts/${encodeURIComponent(
    actor,
  )}/run-sync-get-dataset-items?token=${encodeURIComponent(cfg.apiKey)}`;

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

/** Resilient GET (timeout + transient-status backoff). Errors carry no token. */
async function apifyGetJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
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

/**
 * Fetch ALL items of an existing Apify dataset (the result of a previously-run
 * actor) via GET /v2/datasets/{id}/items, paginating in 1000-item pages until
 * the dataset is exhausted or `limit` items are collected. Used by the MANUAL
 * importer — no actor run, no charge. The token rides as a query param ONLY and
 * is scrubbed from every thrown error (never logged or stored). Returns the raw
 * item objects; the caller runs them through {@link normaliseFacebookPost}.
 */
export async function fetchApifyDatasetItems(
  token: string,
  datasetId: string,
  opts: { limit?: number; apiBase?: string; log?: (s: string) => void } = {},
): Promise<unknown[]> {
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const log = opts.log ?? (() => {});
  const hardCap = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  const PAGE = 1000;
  const items: unknown[] = [];
  let offset = 0;
  while (items.length < hardCap) {
    const want = Math.min(PAGE, hardCap - items.length);
    const url =
      `${apiBase}/v2/datasets/${encodeURIComponent(datasetId)}/items` +
      `?clean=true&format=json&offset=${offset}&limit=${want}` +
      `&token=${encodeURIComponent(token)}`;
    let batch: unknown;
    try {
      batch = await apifyGetJson(url);
    } catch (err) {
      throw new Error(
        redactToken(err instanceof Error ? err.message : String(err), token),
      );
    }
    const arr = Array.isArray(batch)
      ? batch
      : batch &&
          typeof batch === "object" &&
          Array.isArray((batch as Record<string, unknown>).items)
        ? ((batch as Record<string, unknown>).items as unknown[])
        : [];
    if (arr.length === 0) break;
    items.push(...arr);
    log(`  apify dataset: +${arr.length} item(s) (total ${items.length})`);
    if (arr.length < want) break;
    offset += arr.length;
  }
  return hardCap === Infinity ? items : items.slice(0, hardCap);
}

/**
 * Resolve the dataset id of the most recent SUCCEEDED run of an Apify
 * actor-TASK (GET /v2/actor-tasks/{id}/runs?status=SUCCEEDED&desc=1&limit=1).
 * Lets the manual importer pull a task's latest output by task id without
 * starting a new (paid) run. The token rides as a query param ONLY and is
 * scrubbed from every thrown error. Returns null when the task has no
 * successful run yet (the list endpoint returns an empty array, not an error).
 */
export async function resolveApifyTaskLatestDataset(
  token: string,
  taskId: string,
  opts: { apiBase?: string; log?: (s: string) => void } = {},
): Promise<string | null> {
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const log = opts.log ?? (() => {});
  const url =
    `${apiBase}/v2/actor-tasks/${encodeURIComponent(taskId)}/runs` +
    `?status=SUCCEEDED&desc=1&limit=1&token=${encodeURIComponent(token)}`;
  let json: unknown;
  try {
    json = await apifyGetJson(url);
  } catch (err) {
    throw new Error(
      redactToken(err instanceof Error ? err.message : String(err), token),
    );
  }
  const data =
    json && typeof json === "object"
      ? ((json as Record<string, unknown>).data as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const items = Array.isArray(data?.items) ? (data!.items as unknown[]) : [];
  const run = items.length > 0 && items[0] && typeof items[0] === "object"
    ? (items[0] as Record<string, unknown>)
    : null;
  const datasetId = run ? asString(run.defaultDatasetId) : "";
  if (!datasetId) {
    log(`  apify task ${taskId}: no SUCCEEDED run with a dataset found`);
    return null;
  }
  log(`  apify task ${taskId}: latest SUCCEEDED run dataset ${datasetId}`);
  return datasetId;
}

/** Extract + normalise the post array out of any Apify dataset shape. */
function toPosts(json: unknown): RawFacebookPost[] {
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

export interface FacebookFetchResult {
  posts: RawFacebookPost[];
  /** Per-source error strings (token already scrubbed at the run layer). */
  errors: string[];
  /** Sources attempted (pages + the optional search pass). */
  attempted: number;
  /** Sources that returned without throwing. */
  ok: number;
}

/**
 * Fetch every monitored page, then the optional keyword post-search pass. Each
 * source is isolated in its own try/catch, so one dead page / failing actor can
 * NEVER sink the others — the result reports partial success. Each post is
 * stamped with the page/search origin + that source's credibility tier; search
 * hits always carry the unverified "osint" tier.
 */
async function fetchFacebookPosts(
  cfg: FacebookOsintConfig,
): Promise<FacebookFetchResult> {
  if (cfg.provider !== "apify") {
    return {
      posts: [],
      errors: [
        `Facebook provider "${cfg.provider}" not implemented (only "apify" is supported)`,
      ],
      attempted: 0,
      ok: 0,
    };
  }

  const posts: RawFacebookPost[] = [];
  const errors: string[] = [];
  let attempted = 0;
  let ok = 0;

  for (const page of cfg.pages) {
    attempted++;
    try {
      const json = await fetchApifyDataset(cfg, cfg.actor, {
        startUrls: [{ url: page.url }],
        resultsLimit: cfg.maxItems,
        maxPosts: cfg.maxItems,
        onlyPostsNewerThanXDaysAgo: 30,
      });
      const fetched = toPosts(json);
      for (const p of fetched) {
        posts.push({
          ...p,
          pageHandle: page.handle,
          pageName: page.name,
          sourceTier: page.tier,
          origin: "page",
        });
      }
      ok++;
    } catch (err) {
      errors.push(
        `page ${page.handle}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (cfg.searchEnabled && cfg.searchTerms.length > 0) {
    attempted++;
    try {
      const json = await fetchApifyDataset(cfg, cfg.searchActor, {
        searchQueries: cfg.searchTerms,
        query: cfg.searchTerms.join(" OR "),
        resultsLimit: cfg.maxItems,
        maxPosts: cfg.maxItems,
        maxPostsPerQuery: Math.max(5, Math.ceil(cfg.maxItems / cfg.searchTerms.length)),
        onlyPostsNewerThanXDaysAgo: 30,
      });
      const fetched = toPosts(json);
      for (const p of fetched) {
        posts.push({
          ...p,
          pageHandle: SEARCH_PAGE_HANDLE,
          pageName: "Facebook post search",
          sourceTier: "osint",
          origin: "search",
        });
      }
      ok++;
    } catch (err) {
      errors.push(
        `search: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { posts, errors, attempted, ok };
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

// Curated theatre + security keyword cues for the transparency signal. These do
// NOT classify or gate anything (the shared rulebook does that) — they only
// surface, for the analyst, which security/theatre words actually appeared in
// the caption. Matched from real text only; never fabricated.
const KEYWORD_CUES: { label: string; re: RegExp }[] = [
  { label: "tribal fighting", re: /\btribal\s+(?:fight|clash|war|conflict)/i },
  { label: "clash", re: /\bclash(?:es|ed|ing)?\b/i },
  { label: "shooting", re: /\bshoot(?:ing|out)?\b|\bgunfire\b|\bshot dead\b/i },
  { label: "riot", re: /\briot(?:s|ing|ers)?\b/i },
  { label: "protest", re: /\bprotest(?:s|ers|ing)?\b|\bdemonstrat(?:ion|ors)\b|\brally\b/i },
  { label: "looting", re: /\bloot(?:ing|ers|ed)?\b|\bransack/i },
  { label: "arson", re: /\barson\b|\bset (?:on )?fire\b|\btorch(?:ed|ing)?\b/i },
  { label: "killed", re: /\bkill(?:ed|ing|ings)?\b|\bdead\b|\bfatalit/i },
  { label: "machete", re: /\bmachete|\bbush knife\b|\bbush-knife\b/i },
  { label: "firearm", re: /\bgun(?:men|man|s)?\b|\bfirearm|\brifle|\bweapon/i },
  { label: "kidnapping", re: /\bkidnap(?:ping|ped)?\b|\babduct(?:ion|ed)?\b|\bhostage/i },
  { label: "ambush", re: /\bambush(?:ed|es)?\b/i },
  { label: "police operation", re: /\bpolice (?:operation|raid|crackdown)\b|\bsecurity forces\b/i },
  { label: "roadblock", re: /\broadblock|\bblockade\b/i },
  { label: "election violence", re: /\belection(?:-related)? (?:violence|unrest|fraud)\b/i },
  { label: "separatist", re: /\bseparatist|\bwest papua liberation\b|\bOPM\b|\bTPNPB\b/i },
  { label: "highlands", re: /\bhighlands?\b|\benga\b|\bhela\b|\bporgera\b/i },
  { label: "curfew", re: /\bcurfew\b|\bstate of emergency\b/i },
  // PNG-specific security vocabulary.
  { label: "sorcery-accusation violence", re: /\bsorcery[- ]?accus\w*|\bsanguma\b|\bsorcery[- ]?related\b/i },
  { label: "raskol gang", re: /\braskol(?:s)?\b|\brascal gang\b/i },
  { label: "tribal weapons", re: /\bbows? and arrows?\b|\bhomemade gun|\bfactory[- ]?made (?:gun|firearm)|\bhigh[- ]?powered (?:gun|firearm|rifle)/i },
  // Indonesian-Papua (Bahasa) security vocabulary — captions arrive untranslated.
  { label: "security-force deployment", re: /\bbrimob\b|\bmobile squad\b|\bjoint security\b|\btroops? deploy|\bsoldiers? deployed\b|\bpasukan\b/i },
  { label: "Indonesian military", re: /\bTNI\b|\bkopassus\b|\bpolri\b|\bindonesian (?:military|army|soldiers|forces)\b/i },
  { label: "armed group (KKB)", re: /\bKKB\b|\bKST\b|\barmed criminal group\b/i },
  { label: "shooting (id)", re: /\bpenembakan\b|\bbaku ?tembak\b|\btertembak\b/i },
  { label: "armed contact (id)", re: /\bkontak (?:senjata|tembak)\b/i },
  { label: "protest (id)", re: /\bunjuk rasa\b|\bdemonstrasi\b|\baksi (?:demo|protes|massa)\b/i },
  { label: "abduction (id)", re: /\bpenyanderaan\b|\bdisandera\b|\bpenculikan\b/i },
];

/**
 * Distinct curated security/theatre keywords that actually matched the caption,
 * in cue order. Transparency only — pure, no fabrication.
 */
export function detectKeywords(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const cue of KEYWORD_CUES) {
    if (cue.re.test(text) && !out.includes(cue.label)) out.push(cue.label);
  }
  return out;
}

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
  detectedKeywords: string[];
  dedupKey: string;
  /**
   * True when the post resolved to a tracked theatre (PNG / Indonesian Papua).
   * Always true for {@link classifyPost} (it rejects out-of-scope). The BROAD
   * importer ({@link classifyPostBroad}) keeps out-of-scope posts as multi-
   * country CONTEXT with `inScope: false` — those rows are never security-
   * relevant, never review-flagged, and never promotable.
   */
  inScope: boolean;
}

/**
 * Build the full in-scope classification for a resolved theatre: derive
 * category / province / business impact / incident date from the shared theatre
 * extractors, and detect credible outbound-link domains.
 */
function classifyInScope(
  post: RawFacebookPost,
  caption: string,
  scope: ScopeResolution,
): FbClassification {
  const isPng = scope.country === "Papua New Guinea";
  const extraction = isPng
    ? extractPngItem(caption, "", null)
    : extractWestPapuaItem(caption, "", null);
  const pubDate = post.postedAt ?? new Date();
  const incidentDate = isPng
    ? derivePngIncidentDate(caption, pubDate)
    : deriveWestPapuaIncidentDate(caption, pubDate);

  const credibleDomains = detectCredibleDomains(post.outboundLinks);
  // Second-gate guard: a broad theatre vocabulary can file community chatter (a
  // lost-property notice, an eviction gripe, a governance press release) under a
  // real security category. Demote such a post to "Other security" when NEITHER
  // the caption nor its translation carries a security-event cue. At ingest only
  // the raw caption is available, so an English caption is judged now; a
  // non-English one is left untouched until the reclassify pass translates it.
  const category = applySecurityEventGuard({
    category: extraction.category,
    caption,
    captionEn: null,
  }).category;
  const location = isPng
    ? derivePngLocality(null, caption)
    : deriveWestPapuaLocality(null, caption);

  return {
    caption,
    country: scope.country,
    province: extraction.province ?? scope.province,
    location,
    category,
    businessImpact: extraction.businessImpact,
    incidentDate,
    credibleDomains,
    promotionTopic: categoryToTopic(category),
    securityRelevant: category !== "Other security",
    detectedKeywords: detectKeywords(caption),
    dedupKey: makeFacebookDedupKey(caption, post.imageUrls),
    inScope: true,
  };
}

export function classifyPost(post: RawFacebookPost): FbClassification | null {
  const caption = sanitiseCaption(post.caption);
  if (!caption) return null;
  const scope = resolveScope(caption);
  if (!scope.inScope) return null;
  return classifyInScope(post, caption, scope);
}

/**
 * BROAD classification for the manual multi-country importer. Identical to
 * {@link classifyPost} for in-scope (PNG / Indonesian-Papua) posts, but instead
 * of REJECTING an out-of-scope post it KEEPS it as multi-country CONTEXT:
 * country "Unknown", category "Other security", `inScope: false` — so it is
 * never security-relevant, never review-flagged and (via deriveEligibility)
 * never promotable. Still text-gated: an empty / sanitised-away caption is
 * dropped (returns null) so media-only or token-only posts are not stored.
 */
export function classifyPostBroad(
  post: RawFacebookPost,
): FbClassification | null {
  const caption = sanitiseCaption(post.caption);
  if (!caption) return null;
  const scope = resolveScope(caption);
  if (scope.inScope) return classifyInScope(post, caption, scope);

  return {
    caption,
    country: "Unknown",
    province: null,
    location: null,
    category: "Other security",
    businessImpact: "",
    incidentDate: null,
    credibleDomains: detectCredibleDomains(post.outboundLinks),
    promotionTopic: "flashpoint",
    securityRelevant: false,
    detectedKeywords: detectKeywords(caption),
    dedupKey: makeFacebookDedupKey(caption, post.imageUrls),
    inScope: false,
  };
}

// --- Summary -----------------------------------------------------------------

export interface FacebookOsintSummary {
  source: "facebook_osint";
  mode: "commit" | "dry-run";
  active: boolean;
  configured: boolean;
  /**
   * Why the pass ran (or did not). "cadence" = skipped because the last
   * successful pull was within FACEBOOK_OSINT_INTERVAL_HOURS (no fetch, no PAID
   * Apify call, no Source Health write). "disabled"/"no-api-key" mirror the
   * inactive states; "ok" = the fetch ran.
   */
  reason: "disabled" | "no-api-key" | "cadence" | "ok";
  pageHandle: string;
  sourceTier: SourceTier;
  /** Monitored pages configured. */
  pages: number;
  /** Post-search terms configured (0 when the search pass is off). */
  searchTerms: number;
  /** Sources (pages + search) that returned without error. */
  sourcesOk: number;
  /** Sources (pages + search) attempted. */
  sourcesAttempted: number;
  fetchOk: boolean;
  fetched: number;
  inScope: number;
  securityRelevant: number;
  credible: number;
  corroborated: number;
  promotable: number;
  /** Rows flagged for the analyst review queue (in-scope AND security-relevant). */
  reviewFlagged: number;
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
    reason: "ok",
    pageHandle: cfg.pageHandle,
    sourceTier: cfg.sourceTier,
    pages: cfg.pages.length,
    searchTerms: cfg.searchEnabled ? cfg.searchTerms.length : 0,
    sourcesOk: 0,
    sourcesAttempted: 0,
    fetchOk: true,
    fetched: 0,
    inScope: 0,
    securityRelevant: 0,
    credible: 0,
    corroborated: 0,
    promotable: 0,
    reviewFlagged: 0,
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

// --- Persist (shared) --------------------------------------------------------

/** Per-source defaults + provenance hooks for {@link persistFacebookPosts}. */
export interface PersistFacebookOptions {
  /** Write rows when true; otherwise dry-run (classify/dedup/score only). */
  commit?: boolean;
  /**
   * Classification scope. "scoped" (default) keeps ONLY in-theatre (PNG /
   * Indonesian-Papua) posts — the live ingest engine. "broad" additionally
   * stores out-of-scope posts as multi-country CONTEXT (country "Unknown",
   * never security-relevant / promotable) — the manual multi-group importer.
   */
  mode?: "scoped" | "broad";
  /** Credibility tier for posts lacking per-source metadata (default "osint"). */
  defaultSourceTier?: SourceTier;
  /** Page handle for posts lacking per-source metadata. */
  defaultPageHandle?: string;
  /** Page display name for posts lacking per-source metadata. */
  defaultPageName?: string | null;
  /** Page/group URL for posts lacking per-source metadata. */
  defaultPageUrl?: string | null;
  /** Resolve the provenance "actor"/source label stored in the minimised payload. */
  resolveActor?: (post: RawFacebookPost) => string;
  /** Optional progress log sink. */
  log?: (s: string) => void;
}

/** Counts returned by {@link persistFacebookPosts}. */
export interface PersistFacebookResult {
  inScope: number;
  securityRelevant: number;
  credible: number;
  corroborated: number;
  promotable: number;
  reviewFlagged: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  totalAfter: number;
  latestPostedAt: string | null;
}

/**
 * Classify → dedup → credibility-score → store a batch of raw Facebook posts as
 * supporting CONTEXT (never incidents). Shared by BOTH the live ingest engine
 * (runFacebookOsintIngest) and the manual Apify dataset importer so the two
 * paths run byte-identical scope/credibility/dedup logic.
 *
 * Dedup is layered: in-run by clean post URL/id (externalId) first, then the
 * content/image fingerprint (dedupKey); against the table by dedup_key (UNIQUE)
 * with external_id as a fallback. Re-fetches, re-shares and duplicate dataset
 * items therefore all collapse to a single row. Never throws on a corroboration
 * lookup failure (a soft credibility upgrade only); never closes the shared pool.
 */
export async function persistFacebookPosts(
  posts: readonly RawFacebookPost[],
  opts: PersistFacebookOptions = {},
): Promise<PersistFacebookResult> {
  const commit = opts.commit ?? false;
  const log = opts.log ?? (() => {});
  const defaultTier: SourceTier = opts.defaultSourceTier ?? "osint";
  const classify =
    opts.mode === "broad" ? classifyPostBroad : classifyPost;
  const result: PersistFacebookResult = {
    inScope: 0,
    securityRelevant: 0,
    credible: 0,
    corroborated: 0,
    promotable: 0,
    reviewFlagged: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestPostedAt: null,
  };

  // --- Classify + scope-filter.
  interface Candidate {
    post: RawFacebookPost;
    cls: FbClassification;
  }
  const candidates: Candidate[] = [];
  for (const post of posts) {
    const cls = classify(post);
    if (!cls) continue;
    candidates.push({ post, cls });
  }
  // `inScope` is the genuinely in-theatre count (the only meaningful figure in
  // broad mode, where out-of-scope context rows are also kept).
  result.inScope = candidates.filter((c) => c.cls.inScope).length;
  result.securityRelevant = candidates.filter(
    (c) => c.cls.securityRelevant,
  ).length;

  // --- In-run dedup: clean post URL/id (externalId) first, then the
  // content/image fingerprint (dedupKey). Keeps the first occurrence of either,
  // so duplicate dataset items / re-shares collapse before any DB write.
  const byKey = new Map<string, Candidate>();
  const seenExt = new Set<string>();
  for (const c of candidates) {
    if (byKey.has(c.cls.dedupKey)) continue;
    if (seenExt.has(c.post.externalId)) continue;
    byKey.set(c.cls.dedupKey, c);
    seenExt.add(c.post.externalId);
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
    result.duplicateInDb = before - unique.length;
  }
  result.newToInsert = unique.length;

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
    // Per-source credibility tier (a page's declared tier, or "osint" for the
    // search/import pass) — falls back to the caller's default only for posts
    // built without origin metadata.
    const tier = post.sourceTier ?? defaultTier;
    const eligibility = deriveEligibility({
      category: cls.category,
      sourceTier: tier,
      credibleDomainLabels: cls.credibleDomains.labels,
      corroborated: corroboration !== null,
      corroborationReason: corroboration?.reason ?? null,
    });
    const review = deriveReview({
      inScope: cls.inScope,
      securityRelevant: eligibility.securityRelevant,
      promotable: eligibility.promotable,
      category: cls.category,
    });
    const confidence = computeConfidence({
      inScope: cls.inScope,
      localityPrecise: cls.province != null,
      securityRelevant: eligibility.securityRelevant,
      credible: eligibility.credible,
      corroborated: corroboration !== null,
      hasIncidentDate: cls.incidentDate != null,
      keywordCount: cls.detectedKeywords.length,
    });
    if (corroboration) result.corroborated++;
    if (eligibility.credible) result.credible++;
    if (eligibility.promotable) result.promotable++;
    if (review.reviewFlag) result.reviewFlagged++;

    values.push({
      sourceName: SOURCE_NAME,
      platform: PLATFORM,
      pageHandle: post.pageHandle ?? opts.defaultPageHandle ?? DEFAULT_PAGE_HANDLE,
      pageName: post.pageName ?? opts.defaultPageName ?? null,
      sourceTier: tier,
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
      businessImpact: cls.businessImpact || null,
      securityRelevant: eligibility.securityRelevant,
      credible: eligibility.credible,
      credibilityReason: eligibility.credibilityReason,
      corroborated: corroboration !== null,
      corroborationReason: corroboration?.reason ?? null,
      corroboratingIncidentId: corroboration?.incidentId ?? null,
      promotionTopic: cls.promotionTopic,
      url: post.url,
      pageUrl: post.pageUrl ?? opts.defaultPageUrl ?? null,
      classification: "context",
      dedupKey: cls.dedupKey,
      engagement: post.engagement ?? null,
      detectedKeywords: cls.detectedKeywords,
      confidence,
      reviewFlag: review.reviewFlag,
      reviewReason: review.reviewReason,
      // MINIMISED, token-free provenance — never the full payload (no comments,
      // author profile, reactions, phone/email).
      rawPayload: {
        externalId: post.externalId,
        url: post.url,
        postedAt: post.postedAt ? post.postedAt.toISOString() : null,
        imageCount: post.imageUrls.length,
        linkHosts: cls.credibleDomains.hosts,
        actor: opts.resolveActor ? opts.resolveActor(post) : post.origin ?? "import",
        page: post.pageHandle ?? opts.defaultPageHandle ?? DEFAULT_PAGE_HANDLE,
        origin: post.origin ?? "page",
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
    result.inserted = inserted.length;
    log(`  committed: ${result.inserted} new row(s)`);
  } else if (!commit) {
    log("  DRY-RUN — no rows written.");
  }

  const stats = await tableStats();
  result.totalAfter = stats.total;
  result.latestPostedAt = stats.latest ? stats.latest.toISOString() : null;
  return result;
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
  summary.reason = !cfg.enabled
    ? "disabled"
    : !cfg.configured
      ? "no-api-key"
      : "ok";
  summary.logLines = logLines;
  summary.errors = errors;
  log(
    `facebook-osint — mode=${commit ? "COMMIT" : "DRY-RUN"} active=${summary.active} pages=${cfg.pages.length} search=${cfg.searchEnabled ? cfg.searchTerms.length : 0}`,
  );

  // --- Cadence gate: when active + committing, skip the (PAID) Apify fetch if
  // the last SUCCESSFUL pull was within the interval. Keyed off the Source
  // Health heartbeat (sources.last_success_at), which advances even on an
  // all-duplicate 0-insert run — social_raw's own timestamps do NOT (they use
  // onConflictDoNothing), so keying off them would re-spend the paid call every
  // boot for a quiet page. A cadence skip writes NO Source Health (leaves the
  // heartbeat untouched) and no-ops. A null heartbeat while active still runs
  // (initial population). The gate applies ONLY to the committing scheduled
  // path: a dry-run (commit=false) bypasses it and, when configured, still
  // fetches (paid) — it just writes nothing.
  if (commit && summary.active) {
    const intervalHours = facebookOsintIntervalHours();
    const lastRun = await lastSuccessfulFacebookRunAt();
    if (withinFacebookCadence(lastRun, intervalHours)) {
      const ageHours = (Date.now() - lastRun!.getTime()) / 3_600_000;
      summary.reason = "cadence";
      log(
        `  cadence: last successful run ${ageHours.toFixed(1)}h ago < ${intervalHours}h interval — skipping (no fetch, no Apify spend).`,
      );
      const stats = await tableStats();
      summary.totalAfter = stats.total;
      summary.latestPostedAt = stats.latest
        ? stats.latest.toISOString()
        : null;
      return summary;
    }
  }

  // --- Fetch (no-op when not configured). Multi-page + optional post-search;
  // partial-failure tolerant (one dead source never sinks the rest).
  const collected: RawFacebookPost[] = [];
  if (cfg.configured) {
    const result = await fetchFacebookPosts(cfg);
    summary.fetched = result.posts.length;
    summary.sourcesAttempted = result.attempted;
    summary.sourcesOk = result.ok;
    collected.push(...result.posts);
    for (const e of result.errors) {
      const msg = redactToken(e, cfg.apiKey);
      errors.push(`facebook: ${msg}`);
      log(`  facebook source error: ${msg}`);
    }
    // The fetch is "ok" when at least one source returned. All-fail → error.
    summary.fetchOk = result.ok > 0;
    if (!summary.fetchOk && result.errors.length > 0) {
      summary.error = redactToken(result.errors[0]!, cfg.apiKey);
    }
    log(
      `  facebook: ${result.posts.length} public post(s) from ${result.ok}/${result.attempted} source(s)`,
    );
  } else {
    log("  facebook: not configured (FACEBOOK_API_KEY unset or disabled)");
  }

  // --- Classify, dedup, credibility-score and persist (shared with the manual
  // Apify dataset importer so both paths run identical logic).
  const persisted = await persistFacebookPosts(collected, {
    commit,
    defaultSourceTier: cfg.sourceTier,
    defaultPageHandle: cfg.pageHandle,
    defaultPageName: cfg.pageName,
    defaultPageUrl: cfg.pageUrl,
    resolveActor: (post) =>
      post.origin === "search" ? cfg.searchActor : cfg.actor,
    log,
  });
  summary.inScope = persisted.inScope;
  summary.securityRelevant = persisted.securityRelevant;
  summary.corroborated = persisted.corroborated;
  summary.credible = persisted.credible;
  summary.promotable = persisted.promotable;
  summary.reviewFlagged = persisted.reviewFlagged;
  summary.duplicateInDb = persisted.duplicateInDb;
  summary.newToInsert = persisted.newToInsert;
  summary.inserted = persisted.inserted;

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

  summary.totalAfter = persisted.totalAfter;
  summary.latestPostedAt = persisted.latestPostedAt;
  return summary;
}

/**
 * The timestamp of the last SUCCESSFUL Facebook OSINT pull, read from the
 * Source Health heartbeat (sources.last_success_at for the FB row). Returns null
 * when the source has never run successfully. Used by the cadence gate — the
 * heartbeat only advances on a successful fetch, so a failed run leaves it
 * untouched and the next boot retries rather than waiting out the interval.
 */
async function lastSuccessfulFacebookRunAt(): Promise<Date | null> {
  const [row] = await db
    .select({
      last: sql<Date | string | null>`max(${sourcesTable.lastSuccessAt})`,
    })
    .from(sourcesTable)
    .where(eq(sourcesTable.name, FACEBOOK_OSINT_HEALTH_NAME));
  const last = row?.last ?? null;
  return last ? new Date(last) : null;
}

async function recordSourceHealthForPage(
  cfg: FacebookOsintConfig,
  summary: FacebookOsintSummary,
): Promise<void> {
  const name = FACEBOOK_OSINT_HEALTH_NAME;
  const url = cfg.pageUrl;
  const searchNote = cfg.searchEnabled
    ? ` + ${cfg.searchTerms.length} keyword post-search term(s)`
    : "";
  const notes = `${cfg.pages.length} public Facebook page(s)${searchNote} monitored as supporting OSINT CONTEXT for the PNG/Indonesian-Papua theatres — NEVER incidents. Promotion to an incident is explicit, gated (security category AND a credibility signal) and server-re-derived.`;
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
