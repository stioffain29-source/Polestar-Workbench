import { db, incidentsTable } from "@workspace/db";
import type { InsertIncident } from "@workspace/db";
import { cleanText, sanitiseCaption } from "./text";
import { classifySeverity, type SeverityTopic } from "./severity";
import { geocode } from "./geocode";
import { detectCountry } from "./newsTopic";
import { COUNTRY_ALIASES } from "./topicConfigs";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { recordSourceHealth } from "./sourceHealth";
import { routeTopic, xDedupeKey } from "./xSearch";
import { fetchApifyDatasetItems } from "./facebookOsint";
import {
  normaliseInstagramPost,
  resolveApifyTaskOrActorLatestDataset,
  type RawInstagramPost,
} from "./instagramKammi";

// Instagram (Papua / separatist) — SOURCE PROVIDER ONLY.
//
// This is NOT a new product, page, feed, report or OSINT review queue. It reads
// the output of an EXISTING Apify Instagram scraper dataset/task, normalises each
// public post into the shared incident shape, content-routes it into an EXISTING
// incident topic, relevance-gates it, dedupes it, and (only with commit) inserts
// it into the existing `incidents` table — so the posts land directly in the
// relevant news feeds (Conflict for separatist-armed / TPNPB activity, Flashpoint
// for protest / civil-unrest, etc.), never a bespoke queue.
//
// It REUSES the X source provider's `routeTopic` (the maintained relevance engine
// as the router) and `xDedupeKey` (the shared fuzzy dedupe formula) verbatim, so
// there is ONE routing + dedup authority for every social source and no parallel
// taxonomy can drift. Manual CLI only, dry-run by default, STRICT no-fabrication:
// a post naming no tracked country in its OWN text is SKIPPED (never stamped onto
// a guessed centroid); captions are PII-scrubbed before storage. Deliberately NOT
// wired into the scheduler and deliberately does NOT close the shared DB pool
// (mirrors the other ingest runners).

// Idempotency marker written to analyst_notes so re-runs recognise an already-
// ingested post and never insert it twice. Deliberately NOT in the
// backfillRelevance marker-exclusion list: like X rows, Instagram rows are
// text-classified and MUST re-score on a RELEVANCE_RULE_VERSION bump (unlike
// lane/marker-vouched gdelt_cloud / tapa_offline rows).
export const INSTAGRAM_MARKER_PREFIX = "instagram:";

export function instagramMarker(postId: string, author: string | null): string {
  const parts = [`${INSTAGRAM_MARKER_PREFIX}${postId}`];
  if (author) parts.push(`@${author}`);
  return parts.join(" | ");
}

/** The Instagram post id encoded in an analyst_notes marker, or null. */
export function instagramMarkerPostId(
  analystNotes: string | null | undefined,
): string | null {
  if (!analystNotes || !analystNotes.startsWith(INSTAGRAM_MARKER_PREFIX)) {
    return null;
  }
  const rest = analystNotes.slice(INSTAGRAM_MARKER_PREFIX.length);
  const id = rest.split("|")[0]?.trim();
  return id || null;
}

function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

// A normalised Instagram post — the neutral shape the pure decision function
// consumes, so routing/dedupe/insert-building are unit-testable without the
// network.
export type NormalisedIgPost = {
  id: string;
  text: string;
  url: string;
  author: string | null;
  createdAt: Date | null;
};

export type IgDecision =
  | { insert: true; topic: SeverityTopic; row: InsertIncident }
  | {
      insert: false;
      reason:
        | "no-date"
        | "no-text"
        | "no-country"
        | "data-centre-hold"
        | "unroutable";
    };

/**
 * Decide whether one normalised Instagram post becomes an incident, and if so
 * build the exact InsertIncident row. Pure and side-effect free (bar `new Date()`
 * for the evaluation timestamp) so the whole mapping is unit-testable without a DB
 * or network. STRICT no-fabrication: a post with no tracked country in its text is
 * SKIPPED (never stamped onto a guessed centroid); a data-centre post is HELD.
 */
export function decideInstagramIncident(post: NormalisedIgPost): IgDecision {
  // PII-scrub (phone / email / messaging handles) BEFORE any storage, then clean.
  const text = cleanText(sanitiseCaption(post.text));
  if (!text) return { insert: false, reason: "no-text" };
  if (!post.createdAt) return { insert: false, reason: "no-date" };

  const source = "Instagram";
  const route = routeTopic({
    title: text,
    summary: text,
    source,
    sourceUrl: post.url,
  });
  if (route.kind === "data_centre_candidate") {
    return { insert: false, reason: "data-centre-hold" };
  }
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
    analystNotes: instagramMarker(post.id, post.author),
    relevanceStatus: rel.status,
    relevanceScore: rel.score,
    relevanceReason: rel.reason,
    relevanceVersion: rel.version,
    relevanceEvaluatedAt: new Date(),
  };

  return { insert: true, topic, row };
}

export interface InstagramSourceConfig {
  token: string;
}

/** Resolved Apify credentials, or null when no token is set. */
export function readInstagramSourceConfig(): InstagramSourceConfig | null {
  const token =
    process.env.APIFY_TOKEN?.trim() ||
    process.env.INSTAGRAM_PAPUA_APIFY_TOKEN?.trim();
  if (!token) return null;
  return { token };
}

export function isInstagramSourceConfigured(): boolean {
  return readInstagramSourceConfig() !== null;
}

export type InstagramSourceSummary = {
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

export function emptyInstagramSourceSummary(): InstagramSourceSummary {
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

export interface IgDedupeInsertResult {
  duplicateMarker: number;
  duplicateKey: number;
  duplicateUrl: number;
  newToInsert: number;
  inserted: number;
  byTopic: Array<[string, number]>;
  errors: string[];
}

/**
 * The ONE dedupe + insert authority shared by every Instagram-shaped social
 * source (Papua/separatist OSINT and KAMMI). Dedupes the decided rows against
 * existing incidents by idempotency marker (re-runs), the fuzzy same-day key (a
 * scraped/other-source row for the same event) and URL, then inserts the new
 * ones (commit only). Grows the guard sets in-run so two posts describing the
 * same event cannot both insert. Never closes the shared DB pool.
 */
export async function dedupeAndInsertIgIncidents(
  decided: Array<{ topic: SeverityTopic; row: InsertIncident; id: string }>,
  opts: { commit: boolean; log: (s: string) => void },
): Promise<IgDedupeInsertResult> {
  const { commit, log } = opts;
  const result: IgDedupeInsertResult = {
    duplicateMarker: 0,
    duplicateKey: 0,
    duplicateUrl: 0,
    newToInsert: 0,
    inserted: 0,
    byTopic: [],
    errors: [],
  };

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
    const pid = instagramMarkerPostId(row.analystNotes);
    if (pid) seenMarkers.add(pid);
    existingKeys.add(xDedupeKey(row.title, row.occurredAt, row.country, row.topic));
    if (row.sourceUrl) existingUrls.add(normaliseUrl(row.sourceUrl));
    if (row.resolvedUrl) existingUrls.add(normaliseUrl(row.resolvedUrl));
  }

  const toInsert: InsertIncident[] = [];
  const byTopic = new Map<string, number>();
  for (const d of decided) {
    if (seenMarkers.has(d.id)) {
      result.duplicateMarker++;
      continue;
    }
    const key = xDedupeKey(
      d.row.title,
      d.row.occurredAt as Date,
      d.row.country,
      d.row.topic,
    );
    if (existingKeys.has(key)) {
      result.duplicateKey++;
      continue;
    }
    const url = d.row.sourceUrl ? normaliseUrl(d.row.sourceUrl) : null;
    if (url && existingUrls.has(url)) {
      result.duplicateUrl++;
      continue;
    }
    toInsert.push(d.row);
    seenMarkers.add(d.id);
    existingKeys.add(key);
    if (url) existingUrls.add(url);
    byTopic.set(d.topic, (byTopic.get(d.topic) ?? 0) + 1);
  }
  result.newToInsert = toInsert.length;
  result.byTopic = [...byTopic.entries()].sort((a, b) => b[1] - a[1]);

  log(`  already ingested   : ${result.duplicateMarker}`);
  log(`  dupe (key)         : ${result.duplicateKey}`);
  log(`  dupe (url)         : ${result.duplicateUrl}`);
  log(`  new to insert      : ${result.newToInsert}`);

  if (commit && toInsert.length > 0) {
    try {
      await db.insert(incidentsTable).values(toInsert);
      result.inserted = toInsert.length;
      log(`  inserted           : ${result.inserted}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
      log(`  INSERT FAILED      : ${msg}`);
    }
  } else if (!commit) {
    log("  DRY-RUN — no rows written. Re-run with --commit to insert.");
  }

  return result;
}

export type InstagramSourceOptions = {
  commit?: boolean;
  /** Import a specific Apify dataset directly. */
  datasetId?: string;
  /** Resolve the LATEST SUCCEEDED run of an Apify actor-TASK (no new run). */
  taskId?: string;
  /** Max dataset items to pull. */
  limit?: number;
  /**
   * Restrict to specific owner handles (case-insensitive, without a leading @).
   * A reused backing actor could resolve an unrelated dataset, so an analyst can
   * pin the expected Papua accounts here. Empty = accept every owner (routing +
   * country gates still apply downstream).
   */
  expectHandles?: string[];
  log?: (s: string) => void;
};

/**
 * Read an existing Apify Instagram dataset, route the posts into existing incident
 * topics, relevance-gate, dedupe (marker + fuzzy key + URL) and insert the new
 * ones (commit only). Returns a structured summary. Does NOT close the shared DB
 * pool. No-ops gracefully when no Apify token is set or no dataset/task is given.
 */
export async function runInstagramSourceIngest(
  opts: InstagramSourceOptions = {},
): Promise<InstagramSourceSummary> {
  const commit = opts.commit ?? false;
  const summary = emptyInstagramSourceSummary();
  summary.mode = commit ? "commit" : "dry-run";
  const log = (s: string) => {
    summary.logLines.push(s);
    opts.log?.(s);
  };

  log(`instagram-source — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const cfg = readInstagramSourceConfig();
  if (!cfg) {
    log("  APIFY_TOKEN not set — no-op.");
    return summary;
  }
  summary.configured = true;

  if (!opts.datasetId && !opts.taskId) {
    log("  no --datasetId or --taskId given — nothing to import.");
    return summary;
  }
  if (opts.datasetId && opts.taskId) {
    summary.errors.push("pass only one of datasetId or taskId");
    log("  pass only one of --datasetId or --taskId, not both.");
    return summary;
  }

  // Resolve the dataset id (directly, or from the task's latest SUCCEEDED run).
  let datasetId = opts.datasetId ?? null;
  if (!datasetId && opts.taskId) {
    try {
      datasetId = await resolveApifyTaskOrActorLatestDataset(
        cfg.token,
        opts.taskId,
        { log },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(msg);
      log(`  task resolve ERROR: ${msg}`);
      return summary;
    }
    if (!datasetId) {
      log(`  task ${opts.taskId} has no SUCCEEDED run with a dataset yet.`);
      return summary;
    }
  }

  let raw: unknown[];
  try {
    raw = await fetchApifyDatasetItems(cfg.token, datasetId!, {
      limit: opts.limit,
      log,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(msg);
    log(`  dataset fetch ERROR: ${msg}`);
    return summary;
  }

  let posts: RawInstagramPost[] = [];
  for (const item of raw) {
    const norm = normaliseInstagramPost(item);
    if (norm) posts.push(norm);
  }

  // Optional owner-handle focus guard (a reused backing actor can resolve an
  // unrelated dataset). Drops off-account posts before any classification.
  const wantHandles = (opts.expectHandles ?? [])
    .map((h) => h.replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  if (wantHandles.length > 0) {
    const before = posts.length;
    posts = posts.filter((p) =>
      wantHandles.includes((p.ownerUsername ?? "").toLowerCase()),
    );
    const dropped = before - posts.length;
    if (dropped > 0) log(`  handle guard: dropped ${dropped} off-account post(s)`);
  }
  summary.fetched = posts.length;

  const decided: Array<{ topic: SeverityTopic; row: InsertIncident; id: string }> =
    [];
  for (const p of posts) {
    const normalised: NormalisedIgPost = {
      id: p.externalId,
      text: p.caption,
      url: p.url,
      author: p.ownerUsername,
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

  log(`  fetched            : ${summary.fetched}`);
  log(`  no text            : ${summary.skippedNoText}`);
  log(`  no date            : ${summary.skippedNoDate}`);
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
          name: "Instagram (Papua/separatist) OSINT",
          url: "https://www.instagram.com",
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
        sourceType: "social",
        reliability: 2,
        notes:
          "Instagram (Papua / separatist) source provider. Manual CLI only (not scheduled). Public posts from an existing Apify dataset content-routed into existing incident topics (Conflict / Flashpoint); data-centre posts held, never committed. Captions PII-scrubbed; a post naming no tracked country is skipped.",
        scrapeMethod: "Apify Instagram dataset",
      },
    );
  }

  return summary;
}
