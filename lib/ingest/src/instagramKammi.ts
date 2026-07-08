import { sanitiseUrl } from "./facebookOsint";

// Shared Apify Instagram helpers — post normalisation and Apify task/actor
// dataset resolution. These are consumed by the Instagram source providers
// (`instagramSource.ts` for the Papua/separatist feed and `kammiSource.ts` for
// KAMMI Pusat) to turn a raw Apify dataset item into a minimal, PII-safe post
// shape and to locate the latest dataset for a saved task/actor.
//
// PRIVACY: only PUBLIC post fields are retained (caption/images/time/url +
// coarse public counts); comments and commenter identities are NEVER stored,
// and the Apify token travels solely as a request query param — never stored,
// logged or surfaced (scrubbed from errors).
//
// Like every ingest helper it NEVER closes the shared DB pool (only the CLI
// wrapper does).

// The monitoring focus stamped on every row's minimised provenance payload.

const API_BASE = "https://api.apify.com";
const FETCH_TIMEOUT_MS = 30000;
const FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2500;

// --- Raw post shape ----------------------------------------------------------

export interface RawInstagramPost {
  externalId: string;
  shortCode: string | null;
  url: string;
  caption: string;
  imageUrls: string[];
  ownerUsername: string | null;
  ownerFullName: string | null;
  postedAt: Date | null;
  // Coarse public engagement counts when the scraper supplies them. COUNTS ONLY
  // — never commenter identities. Null when not reported (never a fake zero).
  engagement: { reactions?: number; comments?: number } | null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse a non-negative integer count from a number or comma/space string. */
function asCount(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
  }
  return undefined;
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

/**
 * Normalise one raw Apify Instagram dataset item into a {@link RawInstagramPost}.
 * Defensive across the field names the Instagram scrapers emit. Returns null when
 * the item has neither a usable URL nor an id (media-only / malformed).
 */
export function normaliseInstagramPost(raw: unknown): RawInstagramPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const shortCode = asString(r.shortCode) || asString(r.shortcode) || null;
  let url =
    asString(r.url) || asString(r.postUrl) || asString(r.inputUrl);
  if (!url && shortCode) url = `https://www.instagram.com/p/${shortCode}/`;
  const cleanUrl =
    sanitiseUrl(url) ||
    (shortCode ? `https://www.instagram.com/p/${shortCode}/` : "");
  const id = asString(r.id) || shortCode || cleanUrl;
  if (!cleanUrl || !id) return null;
  const externalId = `ig_${id}`;

  const caption =
    asString(r.caption) || asString(r.text) || asString(r.title);

  const imageUrls = Array.from(
    new Set(
      [
        asString(r.displayUrl) ||
          asString(r.thumbnailUrl) ||
          asString(r.image),
      ]
        .map(sanitiseUrl)
        .filter(Boolean),
    ),
  ).slice(0, 6);

  const postedAt =
    parseTimestamp(r.timestamp) ??
    parseTimestamp(r.taken_at) ??
    parseTimestamp(r.takenAt);

  const reactions =
    asCount(r.likesCount) ?? asCount(r.likes) ?? asCount(r.likeCount);
  const comments =
    asCount(r.commentsCount) ?? asCount(r.comments) ?? asCount(r.commentCount);
  const engagement: { reactions?: number; comments?: number } = {};
  if (reactions !== undefined) engagement.reactions = reactions;
  if (comments !== undefined) engagement.comments = comments;

  return {
    externalId,
    shortCode,
    url: cleanUrl,
    caption,
    imageUrls,
    ownerUsername: asString(r.ownerUsername) || null,
    ownerFullName: asString(r.ownerFullName) || null,
    postedAt,
    engagement: Object.keys(engagement).length > 0 ? engagement : null,
  };
}

// --- Resilient run-metadata fetch (token redacted from every error) ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function redactToken(msg: string, token: string): string {
  if (!token) return msg;
  return msg
    .split(token)
    .join("[redacted]")
    .replace(/token=[^&\s]+/gi, "token=[redacted]");
}

async function apifyGetJson(url: string, token: string): Promise<unknown> {
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
 * Resolve the dataset id of the LATEST SUCCEEDED run behind an Apify actor-TASK,
 * WITHOUT starting a new run. Tries the task's own last SUCCEEDED run first; when
 * the task has no task-runs (the actor was run directly) it falls back to the
 * backing actor's last SUCCEEDED run. Returns null when neither exists.
 */
export async function resolveApifyTaskOrActorLatestDataset(
  token: string,
  taskId: string,
  opts: { log?: (s: string) => void } = {},
): Promise<string | null> {
  const log = opts.log ?? (() => {});
  const enc = encodeURIComponent;
  // 1. The task's own latest SUCCEEDED run.
  try {
    const j = (await apifyGetJson(
      `${API_BASE}/v2/actor-tasks/${enc(taskId)}/runs/last?status=SUCCEEDED&token=${enc(token)}`,
      token,
    )) as { data?: { defaultDatasetId?: string } } | null;
    const ds = j?.data?.defaultDatasetId;
    if (ds) {
      log(`  resolved task ${taskId} latest SUCCEEDED run → dataset ${ds}`);
      return ds;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  task-run lookup: ${redactToken(msg, token)} (falling back to actor runs)`);
  }
  // 2. Fall back to the backing actor's latest SUCCEEDED run.
  try {
    const tj = (await apifyGetJson(
      `${API_BASE}/v2/actor-tasks/${enc(taskId)}?token=${enc(token)}`,
      token,
    )) as { data?: { actId?: string } } | null;
    const actId = tj?.data?.actId;
    if (actId) {
      const aj = (await apifyGetJson(
        `${API_BASE}/v2/acts/${enc(actId)}/runs/last?status=SUCCEEDED&token=${enc(token)}`,
        token,
      )) as { data?: { defaultDatasetId?: string } } | null;
      const ds = aj?.data?.defaultDatasetId;
      if (ds) {
        log(
          `  resolved task ${taskId} actor ${actId} latest SUCCEEDED run → dataset ${ds}`,
        );
        return ds;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  actor-run lookup failed: ${redactToken(msg, token)}`);
  }
  return null;
}

