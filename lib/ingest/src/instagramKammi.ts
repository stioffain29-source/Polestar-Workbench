import {
  db,
  socialRawTable,
  type InsertSocialRawItem,
} from "@workspace/db";
import { eq, inArray, or, sql } from "drizzle-orm";
import { sanitiseCaption, isProtestRelevant } from "./socialWatch";
import { sanitiseUrl } from "./facebookOsint";

// Instagram KAMMI watch — monitoring the official KAMMI (Kesatuan Aksi Mahasiswa
// Muslim Indonesia) public Instagram account as additive CONTEXT in `social_raw`,
// modelled EXACTLY on the Facebook OSINT pipeline.
//
// CRITICAL PRODUCT RULE: an Instagram post is NEVER an incident. Like every
// social_raw row it lives in its own table precisely so a post can never inflate
// any incident count (dashboard, topic monitors, reports). The ONLY path into
// `incidents` is the explicit, gated, server-RE-DERIVED promote action. These
// rows are stored as CONTEXT only — credible=false and promotable=false (a single
// advocacy account is not a config-declared credible source), so none is ever
// auto-promotable.
//
// PRIVACY: only PUBLIC posts are read. Captions are sanitised (sanitiseCaption
// strips phone/email/WhatsApp); comments and commenter identities are NEVER
// stored (only coarse public counts); and the Apify token travels solely as a
// request query param — never stored, logged or surfaced (scrubbed from errors).
//
// Like every ingest helper it NEVER closes the shared DB pool (only the CLI
// wrapper does).

const SOURCE_NAME = "instagram_kammi";
const PLATFORM = "instagram";
const DEFAULT_COUNTRY = "Indonesia";
const DEFAULT_HANDLE = "kammi.pusat";
// The monitoring focus stamped on every row's minimised provenance payload.
const FOCUS = "KAMMI protest monitoring";

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

// --- Persist -----------------------------------------------------------------

export interface PersistInstagramKammiOptions {
  /** Write rows when true; otherwise dry-run (classify/dedup only). */
  commit?: boolean;
  /** Resolve the provenance "actor"/source label stored in the minimised payload. */
  resolveActor?: (post: RawInstagramPost) => string;
  /** Optional progress log sink. */
  log?: (s: string) => void;
}

export interface PersistInstagramKammiResult {
  /** Posts with a usable sanitised caption (the only ones considered). */
  considered: number;
  /** Considered posts whose caption is protest-relevant (KAMMI focus signal). */
  protestRelevant: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  totalAfter: number;
  latestPostedAt: string | null;
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

/**
 * Classify → dedup → store a batch of raw KAMMI Instagram posts as supporting
 * CONTEXT (never incidents) in `social_raw`. Text-gated (an empty / sanitised-away
 * caption is dropped). Country is stamped "Indonesia", the focus is recorded in
 * the minimised payload, and every row is kept credible=false / promotable=false
 * so it remains non-promotable context. Dedup is layered: in-run by dedupKey then
 * externalId; against the table by dedup_key (UNIQUE) with external_id fallback,
 * so re-imports collapse to a single row. Never closes the shared pool.
 */
export async function persistInstagramKammiPosts(
  posts: readonly RawInstagramPost[],
  opts: PersistInstagramKammiOptions = {},
): Promise<PersistInstagramKammiResult> {
  const commit = opts.commit ?? false;
  const log = opts.log ?? (() => {});
  const result: PersistInstagramKammiResult = {
    considered: 0,
    protestRelevant: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestPostedAt: null,
  };

  interface Candidate {
    post: RawInstagramPost;
    caption: string;
    dedupKey: string;
    protest: boolean;
  }
  const candidates: Candidate[] = [];
  for (const post of posts) {
    const caption = sanitiseCaption(post.caption);
    if (!caption) continue;
    candidates.push({
      post,
      caption,
      dedupKey: `igk_${post.shortCode ?? post.externalId}`,
      protest: isProtestRelevant(caption),
    });
  }
  result.considered = candidates.length;
  result.protestRelevant = candidates.filter((c) => c.protest).length;

  // In-run dedup (dedupKey first, then externalId).
  const byKey = new Map<string, Candidate>();
  const seenExt = new Set<string>();
  for (const c of candidates) {
    if (byKey.has(c.dedupKey) || seenExt.has(c.post.externalId)) continue;
    byKey.set(c.dedupKey, c);
    seenExt.add(c.post.externalId);
  }
  let unique = Array.from(byKey.values());

  // Dedup against the table (dedup_key primary; external_id fallback).
  if (unique.length > 0) {
    const keys = unique.map((u) => u.dedupKey);
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
      (u) => !haveKey.has(u.dedupKey) && !haveExt.has(u.post.externalId),
    );
    result.duplicateInDb = before - unique.length;
  }
  result.newToInsert = unique.length;

  const values: InsertSocialRawItem[] = unique.map(
    ({ post, caption, dedupKey, protest }) => {
      // A protest-relevant caption carries the civil-unrest category (a true
      // signal for the KAMMI protest-monitoring focus); everything else stays the
      // neutral default. securityRelevant tracks the category, BUT credible=false
      // (a single advocacy account is not a config-declared credible source) so
      // the re-derived gate keeps EVERY row non-promotable context.
      const category = protest ? "Civil unrest / protest" : "Other security";
      return {
        sourceName: SOURCE_NAME,
        platform: PLATFORM,
        pageHandle: post.ownerUsername ?? DEFAULT_HANDLE,
        pageName: post.ownerFullName ?? null,
        sourceTier: "osint",
        externalId: post.externalId,
        postedAt: post.postedAt,
        caption,
        imageUrls: post.imageUrls,
        country: DEFAULT_COUNTRY,
        category,
        securityRelevant: protest,
        credible: false,
        promotable: false,
        promotionTopic: "flashpoint",
        url: post.url,
        pageUrl: post.ownerUsername
          ? `https://www.instagram.com/${post.ownerUsername}/`
          : null,
        classification: "context",
        dedupKey,
        engagement: post.engagement ?? null,
        reviewFlag: protest,
        reviewReason: protest
          ? "KAMMI protest-monitoring focus (Indonesia, protest-relevant caption)"
          : null,
        // MINIMISED, token-free provenance — never the full payload (no comments,
        // commenter profiles, phone/email).
        rawPayload: {
          externalId: post.externalId,
          shortCode: post.shortCode,
          url: post.url,
          postedAt: post.postedAt ? post.postedAt.toISOString() : null,
          imageCount: post.imageUrls.length,
          owner: post.ownerUsername,
          focus: FOCUS,
          actor: opts.resolveActor
            ? opts.resolveActor(post)
            : "apify-instagram-import",
        },
        lastCheckedAt: new Date(),
        fetchedAt: new Date(),
      };
    },
  );

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
