// Resolve Google News RSS redirect links to their real publisher URLs.
//
// Most flashpoint feeds are Google News RSS aggregators, so the `<link>` they
// emit (stored verbatim in incidents.source_url) is an opaque redirect of the
// form `https://news.google.com/rss/articles/CBMi...?oc=5`, NOT the publisher's
// article URL. That defeats the GDELT enrichment URL-match (gdeltEnrich.ts),
// which compares our source_url against GDELT's resolved source_urls[]: the two
// can never be equal while ours is a Google redirect. Resolving the redirect to
// the underlying publisher URL lets that definitive URL match fire far more
// often.
//
// The original `source_url` is left UNTOUCHED (UI links + dedupe keep working);
// the resolved publisher URL is stored additively on `incidents.resolved_url`
// and every consumer reads `resolved_url ?? source_url`. This mirrors the
// nullable-enrichment pattern of `display_title` (titleTranslate.ts).
//
// Two URL formats exist:
//   - OLD: the base64 segment after /articles/ embeds the publisher URL
//     directly — a cheap local decode, no network call.
//   - NEW (current default): the segment is an opaque article id that must be
//     exchanged via Google's `batchexecute` endpoint. That costs two HTTP
//     calls (one to read the per-article signature + timestamp, one to POST the
//     exchange). Verified working from this environment's egress.
//
// Every failure path returns null and is non-fatal — a row simply keeps its
// Google redirect in source_url and is retried on a later pass.

import { sql } from "drizzle-orm";
import { db, incidentsTable } from "@workspace/db";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Matches the redirect links we store: news.google.com/articles/<id> or the
// /rss/articles/<id> RSS variant. Used by both the JS guard and (as a Postgres
// regex via bound parameter) the candidate-selection WHERE clause so they agree.
const GOOGLE_NEWS_REDIRECT_SOURCE = `news\\.google\\.com/(rss/)?articles/`;
const GOOGLE_NEWS_REDIRECT_RE = new RegExp(GOOGLE_NEWS_REDIRECT_SOURCE);

/** True when a URL is a Google News redirect that needs resolving. */
export function isGoogleNewsRedirect(url: string | null | undefined): boolean {
  if (!url) return false;
  return GOOGLE_NEWS_REDIRECT_RE.test(url);
}

export function extractArticleId(url: string): string | null {
  const m = url.match(/\/(?:rss\/)?articles\/([^?/]+)/);
  return m ? m[1] : null;
}

// OLD-format decode: the base64 segment may embed the publisher URL directly.
// Returns the URL if found, else null (new-format ids decode to an opaque blob
// containing no http(s) URL, so this cleanly falls through).
export function decodeOldFormat(id: string): string | null {
  try {
    let b = id.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const dec = Buffer.from(b, "base64").toString("latin1");
    const m = dec.match(/https?:\/\/[^\s"'\\]+/);
    if (m && !m[0].includes("news.google.com")) return m[0];
  } catch {
    /* not decodable — fall through to the network exchange */
  }
  return null;
}

/**
 * Resolve a single Google News redirect link to its publisher URL.
 * Returns null on any failure (bad input, network error, timeout, parse
 * failure) so callers can degrade gracefully and retry later. Non-redirect
 * URLs return null too — callers should guard with isGoogleNewsRedirect first.
 */
export async function resolveGoogleNewsUrl(
  url: string,
  timeoutMs = 15000,
): Promise<string | null> {
  const id = extractArticleId(url);
  if (!id) return null;

  const old = decodeOldFormat(id);
  if (old) return old;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // 1) Read the article page for the per-article signature + timestamp.
    const r1 = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: ac.signal,
    });
    const html = await r1.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/);
    const ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sg || !ts) return null;

    // 2) Exchange id + signature + timestamp for the publisher URL.
    const payload = [
      "Fbv4je",
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts[1]},"${sg[1]}"]`,
    ];
    const body = "f.req=" + encodeURIComponent(JSON.stringify([[payload]]));
    const r2 = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": USER_AGENT,
        },
        body,
        signal: ac.signal,
      },
    );
    const txt = await r2.text();
    // Response: )]}'\n\n<len>\n[["wrb.fr","Fbv4je","[\"...\",\"<URL>\",...]" ...]]
    const chunk = txt.split("\n\n")[1];
    if (!chunk) return null;
    const arr = JSON.parse(chunk) as unknown[];
    for (const row of arr) {
      if (
        Array.isArray(row) &&
        row[0] === "wrb.fr" &&
        typeof row[2] === "string"
      ) {
        const inner = JSON.parse(row[2]) as unknown[];
        const u = inner[1];
        if (typeof u === "string" && /^https?:\/\//.test(u)) return u;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveUrlSummary {
  candidates: number;
  resolved: number;
  failed: number;
  /** Per-topic resolved/failed/candidate breakdown for visibility. */
  byTopic: Record<string, { candidates: number; resolved: number; failed: number }>;
  logLines: string[];
}

interface Candidate {
  id: number;
  sourceUrl: string | null;
  topic: string;
}

/**
 * Backfill / refresh `resolved_url` for incidents whose `source_url` is a
 * Google News redirect. The SQL WHERE selects ONLY rows that still need
 * resolving (redirect source_url + NULL resolved_url), newest first, so the
 * per-run `limit` is spent on genuine candidates and the work converges across
 * runs: every successfully resolved row leaves the candidate set. Already
 * resolved rows and non-redirect rows never match and so are never re-scanned.
 *
 * Covers ALL news topics, not just flashpoint. The GDELT enrichment was the
 * first consumer (flashpoint only), but the workbench UI and future enrichment
 * want clean publisher URLs for every topic (shipping/energy/conflict/fuel/…).
 * To stop a high-volume topic (shipping/flashpoint) from starving the smaller
 * ones out of a bounded run, the global `limit` is split across topics with a
 * fair ROUND-ROBIN: each topic contributes its newest candidate in turn until
 * the budget is spent. A topic with fewer candidates than its share simply
 * drops out and its slots go to topics that still have work, so no budget is
 * wasted and no topic starves. Pass `topics` to restrict the set; otherwise the
 * pass discovers every topic that currently has redirect candidates.
 *
 * Failures leave resolved_url NULL and are retried on a later pass (so a
 * transient Google rate-limit never permanently poisons a row). Safe to run
 * repeatedly.
 *
 * Does NOT close the shared DB pool — the long-lived server keeps it open; CLI
 * wrappers call pool.end() themselves (mirrors the other ingest passes).
 */
export async function runResolveGoogleNewsUrls(
  opts: {
    commit?: boolean;
    limit?: number;
    concurrency?: number;
    topics?: string[];
  } = {},
): Promise<ResolveUrlSummary> {
  const commit = opts.commit ?? false;
  const limit = Math.max(1, opts.limit ?? 80);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const logLines: string[] = [];
  const log = (line: string) => logLines.push(line);

  // Redirect detection lives in the WHERE so only real candidates return. The
  // pattern is a bound parameter (no SQL-text interpolation); `~` is a
  // case-sensitive Postgres regex match — the host + path are lowercase.
  const redirectMatch = sql`${incidentsTable.resolvedUrl} IS NULL AND ${incidentsTable.sourceUrl} ~ ${GOOGLE_NEWS_REDIRECT_SOURCE}`;

  // Resolve the topic set: explicit override, else discover every topic that
  // currently has redirect candidates so "all news topics" stays correct as
  // topics are added/removed without editing a hardcoded list.
  let topics: string[];
  if (opts.topics && opts.topics.length > 0) {
    topics = opts.topics;
  } else {
    const rows = await db
      .selectDistinct({ topic: incidentsTable.topic })
      .from(incidentsTable)
      .where(redirectMatch);
    topics = rows.map((r) => r.topic).sort();
  }

  // Fetch each topic's newest candidates independently (capped at the global
  // `limit`, so a single non-empty topic can still consume the whole budget),
  // then round-robin them into the bounded candidate list. This gives every
  // topic a fair turn while redistributing the slack from topics that have
  // fewer candidates than their even share.
  const perTopic: Candidate[][] = await Promise.all(
    topics.map((topic) =>
      db
        .select({
          id: incidentsTable.id,
          sourceUrl: incidentsTable.sourceUrl,
          topic: incidentsTable.topic,
        })
        .from(incidentsTable)
        .where(sql`${incidentsTable.topic} = ${topic} AND ${redirectMatch}`)
        .orderBy(sql`${incidentsTable.createdAt} DESC`)
        .limit(limit),
    ),
  );

  const candidates: Candidate[] = [];
  for (let i = 0; candidates.length < limit; i++) {
    let added = false;
    for (const list of perTopic) {
      if (i < list.length) {
        candidates.push(list[i]);
        added = true;
        if (candidates.length >= limit) break;
      }
    }
    if (!added) break;
  }

  const byTopic: ResolveUrlSummary["byTopic"] = {};
  for (const c of candidates) {
    (byTopic[c.topic] ??= { candidates: 0, resolved: 0, failed: 0 }).candidates++;
  }

  log(
    `resolve-urls: ${candidates.length} Google News redirect candidate(s) across ${topics.length} topic(s): ${topics.join(", ")}`,
  );

  let resolved = 0;
  let failed = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const r = candidates[next++];
      const bucket = byTopic[r.topic];
      if (!r.sourceUrl) {
        failed++;
        bucket.failed++;
        continue;
      }
      const publisher = await resolveGoogleNewsUrl(r.sourceUrl);
      if (!publisher) {
        failed++;
        bucket.failed++;
        log(`  id=${r.id} (${r.topic}) FAILED`);
        continue;
      }
      resolved++;
      bucket.resolved++;
      if (commit) {
        await db
          .update(incidentsTable)
          .set({ resolvedUrl: publisher })
          .where(
            sql`${incidentsTable.id} = ${r.id} AND ${incidentsTable.resolvedUrl} IS NULL`,
          );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker),
  );

  for (const topic of topics) {
    const b = byTopic[topic];
    if (b) log(`  ${topic}: resolved ${b.resolved}/${b.candidates}, failed ${b.failed}`);
  }
  log(
    `resolve-urls: ${commit ? "committed" : "dry-run"} — resolved ${resolved}, failed ${failed}`,
  );
  return { candidates: candidates.length, resolved, failed, byTopic, logLines };
}
