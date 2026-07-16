import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  db,
  officialMilitaryMaritimeSourcesTable,
  type InsertOfficialMilitaryMaritimeSource,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchHtmlViaCurl, fetchBodyViaCurl, sleep } from "./feedFetch";
import { isGoogleNewsRedirect, resolveGoogleNewsUrl } from "./googleNewsUrl";
import {
  parseCentcomDetail,
  parseCentcomListing,
  parseCentcomRssListing,
  filterCentcomPressReleaseItems,
  dedupeCentcomListingItems,
  bodyTextFromRssDescription,
  extractCentcomImageUrlsFromHtml,
  isCentcomPressReleaseUrl,
  type CentcomListingItem,
  CENTCOM_SITE_ORIGIN,
} from "./centcomParse";
import { assignAnalystFlags, routeOfficialSource, partitionOfficialInserts, appendCentcomImageUrls } from "./m15";
import {
  CENTCOM_HEALTH_NAME,
  CENTCOM_RSS_URL,
  CENTCOM_NEWS_RSS_URL,
  CENTCOM_GOOGLE_NEWS_RSS_URL,
  CENTCOM_SOURCE_URL,
  OFFICIAL_M15_HEALTH_TOPIC,
} from "./m15/health";
import { recordSourceHealth, categorizeFeedFailure } from "./sourceHealth";

// M1.5 — CENTCOM press releases ingest. Parses listing + detail HTML, routes to
// Watches, assigns analyst flags, and persists standalone official-source rows.
// NEVER touches spot_reports.

export {
  parseCentcomListing,
  parseCentcomDetail,
  parseCentcomRssListing,
  filterCentcomPressReleaseItems,
  dedupeCentcomListingItems,
  isCentcomPressReleaseUrl,
  resolveCentcomUrl,
  CENTCOM_SITE_ORIGIN,
} from "./centcomParse";
export type { CentcomListingItem, CentcomDetail } from "./centcomParse";

export const CENTCOM_SOURCE = "centcom" as const;
export const CENTCOM_HEALTH_TOPIC = OFFICIAL_M15_HEALTH_TOPIC;
export { CENTCOM_HEALTH_NAME, CENTCOM_SOURCE_URL, CENTCOM_RSS_URL, CENTCOM_NEWS_RSS_URL, CENTCOM_GOOGLE_NEWS_RSS_URL } from "./m15/health";

const CENTCOM_HEALTH_NOTES =
  "U.S. Central Command (CENTCOM) official press releases ingested as STANDALONE official sources (never as incidents).";
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = 2500;
const DEFAULT_MAX_DETAIL_FETCHES = 10;
const DEFAULT_FIXTURE_NAME = "centcom-press-releases-listing.html";
const DEFAULT_RSS_FIXTURE_NAME = "centcom-press-releases-rss.xml";

const CENTCOM_CURL_OPTS = {
  headers: {
    Referer: `${CENTCOM_SITE_ORIGIN}/`,
    Origin: CENTCOM_SITE_ORIGIN,
  },
} as const;

const CENTCOM_RSS_CURL_OPTS = {
  accept: "application/rss+xml, application/xml, text/xml, */*",
  headers: CENTCOM_CURL_OPTS.headers,
} as const;

const CENTCOM_GOOGLE_NEWS_CURL_OPTS = {
  accept: "application/rss+xml, application/xml, text/xml, */*",
} as const;

function articleIdFromUrl(url: string): string | null {
  return url.match(/\/Article\/(\d+)\//i)?.[1] ?? null;
}

function isCentcomBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b403\b|forbidden|blocked|cloudflare|attention required/i.test(msg);
}

function isCurlRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    /curl failed|curl exit|timed out|timeout|empty body/i.test(err.message) ||
    /curl exit [1-9]\d*/.test(err.message) ||
    /status code 429/i.test(err.message) ||
    /status code 5\d{2}/i.test(err.message)
  );
}
function isDisabled(): boolean {
  const v = process.env.CENTCOM_INGEST_ENABLED?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

function fixtureDirFromEnv(): string | null {
  const dir = process.env.CENTCOM_FIXTURE_DIR?.trim();
  if (dir) return dir;
  const flag = process.env.CENTCOM_INGEST_FIXTURES?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return join(process.cwd(), "__tests__", "fixtures", "m15");
  }
  return null;
}

function maxDetailFetchesFromEnv(): number {
  const raw = process.env.CENTCOM_INGEST_MAX_DETAIL?.trim();
  if (!raw) return DEFAULT_MAX_DETAIL_FETCHES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DETAIL_FETCHES;
}

function detailFixturePath(fixtureDir: string, externalId: string): string {
  return join(fixtureDir, `centcom-press-release-${externalId}.html`);
}

export type CentcomIngestSummary = {
  source: typeof CENTCOM_SOURCE;
  mode: "commit" | "dry-run";
  configured: boolean;
  disabled: boolean;
  ran: boolean;
  itemsFetched: number;
  inserted: number;
  duplicateInDb: number;
  newsEchoSkipped: number;
  totalAfter: number;
  errors: string[];
  logLines: string[];
};

export type CentcomIngestOptions = {
  commit?: boolean;
  /** Pre-loaded listing HTML (fixture tests). */
  listingHtml?: string;
  /** Pre-parsed listing items (tests — bypasses live fetch). */
  listingItems?: CentcomListingItem[];
  /** Override detail fetch — return null to skip an item. */
  fetchDetailHtml?: (item: CentcomListingItem) => Promise<string | null>;
  /** Cap detail HTTP fetches (defaults to CENTCOM_INGEST_MAX_DETAIL or 10). */
  maxDetailFetches?: number;
  /** Process only these listing external ids. */
  externalIds?: string[];
  /** Skip items at or before this published_at (live incremental ingest). */
  sincePublishedAt?: Date | null;
  /** Override news-echo lookup (tests). */
  lookupNewsEchoUrls?: (urls: string[]) => Promise<Set<string>>;
};

/** Select newest listing items for detail fetch, respecting since/max/existing. */
export function selectCentcomListingForFetch(
  listing: CentcomListingItem[],
  opts: {
    maxItems: number;
    sincePublishedAt?: Date | null;
    existingExternalIds?: ReadonlySet<string>;
  },
): CentcomListingItem[] {
  let items = [...listing];
  items.sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    return bt - at;
  });

  if (opts.sincePublishedAt) {
    const sinceMs = opts.sincePublishedAt.getTime();
    items = items.filter((item) => {
      const t = item.publishedAt?.getTime();
      return t == null || t > sinceMs;
    });
  }

  if (opts.existingExternalIds?.size) {
    items = items.filter((item) => !opts.existingExternalIds!.has(item.externalId));
  }

  return items.slice(0, Math.max(0, opts.maxItems));
}

export function emptyCentcomIngestSummary(
  err?: unknown,
): CentcomIngestSummary {
  return {
    source: CENTCOM_SOURCE,
    mode: "dry-run",
    configured: true,
    disabled: false,
    ran: false,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    newsEchoSkipped: 0,
    totalAfter: 0,
    errors: err ? [err instanceof Error ? err.message : String(err)] : [],
    logLines: [],
  };
}

type PreparedRelease = {
  externalId: string;
  title: string;
  publishedAt: Date | null;
  sourceUrl: string;
  bodyText: string;
  imageUrls?: string[];
  ingestedViaRssBody?: boolean;
};

async function fetchHtmlWithRetry(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return fetchHtmlViaCurl(url, FETCH_TIMEOUT_MS, CENTCOM_CURL_OPTS);
    } catch (err) {
      lastErr = err;
      if (isCurlRetryable(err) && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchRssXmlWithRetry(
  url: string,
  opts: { accept: string; headers?: Readonly<Record<string, string>> },
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return fetchBodyViaCurl(url, FETCH_TIMEOUT_MS, opts);
    } catch (err) {
      lastErr = err;
      if (isCurlRetryable(err) && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchOfficialRssListing(
  url: string,
  filterPressReleases: boolean,
): Promise<CentcomListingItem[]> {
  const xml = await fetchRssXmlWithRetry(url, CENTCOM_RSS_CURL_OPTS);
  const items = parseCentcomRssListing(xml, CENTCOM_SITE_ORIGIN);
  return filterPressReleases ? filterCentcomPressReleaseItems(items) : items;
}

async function fetchGoogleNewsCentcomListing(
  log: (s: string) => void,
): Promise<CentcomListingItem[]> {
  const xml = await fetchRssXmlWithRetry(
    CENTCOM_GOOGLE_NEWS_RSS_URL,
    CENTCOM_GOOGLE_NEWS_CURL_OPTS,
  );
  const raw = parseCentcomRssListing(xml, CENTCOM_SITE_ORIGIN);
  const resolved: CentcomListingItem[] = [];

  for (const item of raw) {
    let sourceUrl = item.sourceUrl;
    if (isGoogleNewsRedirect(sourceUrl)) {
      const publisher = await resolveGoogleNewsUrl(sourceUrl);
      if (!publisher) {
        log(`  Google News — could not resolve redirect for ${item.title.slice(0, 60)}`);
        continue;
      }
      sourceUrl = publisher;
    }
    if (!isCentcomPressReleaseUrl(sourceUrl)) continue;

    const externalId = articleIdFromUrl(sourceUrl) ?? item.externalId;
    if (!externalId) continue;

    resolved.push({
      ...item,
      externalId,
      sourceUrl,
    });
  }

  return dedupeCentcomListingItems(resolved);
}

function preparedFromRssListingItem(item: CentcomListingItem): PreparedRelease | null {
  const bodyText = item.rssDescriptionHtml
    ? bodyTextFromRssDescription(item.rssDescriptionHtml)
    : item.summary?.trim() ?? "";
  if (!bodyText) return null;

  const imageUrls = item.rssDescriptionHtml
    ? extractCentcomImageUrlsFromHtml(item.rssDescriptionHtml, CENTCOM_SITE_ORIGIN)
    : undefined;

  return {
    externalId: item.externalId,
    title: item.title,
    publishedAt: item.publishedAt,
    sourceUrl: item.sourceUrl,
    bodyText,
    imageUrls: imageUrls?.length ? imageUrls : undefined,
    ingestedViaRssBody: true,
  };
}

async function prepareReleaseFromItem(
  item: CentcomListingItem,
  fetchDetail: (item: CentcomListingItem) => Promise<string | null>,
  log: (s: string) => void,
): Promise<PreparedRelease | null> {
  try {
    const detailHtml = await fetchDetail(item);
    if (detailHtml) {
      const detail = parseCentcomDetail(detailHtml, item.sourceUrl);
      return {
        externalId: item.externalId,
        title: detail.title || item.title,
        publishedAt: detail.publishedAt ?? item.publishedAt,
        sourceUrl: detail.sourceUrl || item.sourceUrl,
        bodyText: detail.bodyText,
        imageUrls: detail.imageUrls,
      };
    }
  } catch (err) {
    if (!isCentcomBlockedError(err)) throw err;
    log(`  detail blocked ${item.externalId} — using RSS body fallback`);
  }

  const fromRss = preparedFromRssListingItem(item);
  if (fromRss) return fromRss;

  log(`  skip ${item.externalId} — no detail HTML and no RSS body`);
  return null;
}

async function loadListingItems(
  opts: CentcomIngestOptions,
  log: (s: string) => void,
): Promise<CentcomListingItem[]> {
  if (opts.listingItems?.length) {
    return opts.listingItems;
  }
  if (opts.listingHtml) {
    return parseCentcomListing(opts.listingHtml, CENTCOM_SITE_ORIGIN);
  }

  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    const rssPath = join(fixtureDir, DEFAULT_RSS_FIXTURE_NAME);
    try {
      const rssXml = readFileSync(rssPath, "utf8");
      const fromRss = parseCentcomRssListing(rssXml, CENTCOM_SITE_ORIGIN);
      if (fromRss.length > 0) return fromRss;
    } catch {
      // Fall back to saved HTML listing fixture.
    }
    return parseCentcomListing(
      readFileSync(join(fixtureDir, DEFAULT_FIXTURE_NAME), "utf8"),
      CENTCOM_SITE_ORIGIN,
    );
  }

  const merged: CentcomListingItem[] = [];

  const trySource = async (
    label: string,
    loader: () => Promise<CentcomListingItem[]>,
  ) => {
    try {
      log(`  live fetch — ${label}`);
      const items = await loader();
      if (items.length > 0) {
        log(`  ${label}: ${items.length} press release(s)`);
        merged.push(...items);
      } else {
        log(`  ${label}: no press releases`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ${label} failed (${msg})`);
    }
  };

  await trySource("official press RSS", () =>
    fetchOfficialRssListing(CENTCOM_RSS_URL, false),
  );
  await trySource("official news RSS (press-release filter)", () =>
    fetchOfficialRssListing(CENTCOM_NEWS_RSS_URL, true),
  );
  await trySource("Google News site-scope RSS", () =>
    fetchGoogleNewsCentcomListing(log),
  );

  const listing = dedupeCentcomListingItems(merged);
  if (listing.length > 0) return listing;

  try {
    log(`  live fetch — HTML listing ${CENTCOM_SOURCE_URL}`);
    const listingHtml = await fetchHtmlWithRetry(CENTCOM_SOURCE_URL);
    const fromHtml = parseCentcomListing(listingHtml, CENTCOM_SITE_ORIGIN);
    if (fromHtml.length > 0) return fromHtml;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isCentcomBlockedError(err)) {
      throw new Error(
        `CENTCOM press releases unavailable — official RSS empty and centcom.mil HTML blocked (${msg})`,
      );
    }
    throw err;
  }

  throw new Error(
    "CENTCOM press releases unavailable — all RSS sources returned no items and HTML listing was empty",
  );
}

async function latestCentcomPublishedAt(): Promise<Date | null> {
  const [row] = await db
    .select({
      latest: sql<Date | null>`max(${officialMilitaryMaritimeSourcesTable.publishedAt})`,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, CENTCOM_SOURCE));
  if (!row?.latest) return null;
  const d = new Date(row.latest);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function existingCentcomExternalIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({
      externalId: officialMilitaryMaritimeSourcesTable.externalId,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(
      and(
        eq(officialMilitaryMaritimeSourcesTable.sourceName, CENTCOM_SOURCE),
        inArray(officialMilitaryMaritimeSourcesTable.externalId, ids),
      ),
    );
  return new Set(rows.map((r) => r.externalId));
}

async function defaultFetchDetail(
  item: CentcomListingItem,
): Promise<string | null> {
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    const path = detailFixturePath(fixtureDir, item.externalId);
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
  return fetchHtmlWithRetry(item.sourceUrl);
}

function buildInsertRow(release: PreparedRelease): InsertOfficialMilitaryMaritimeSource {
  const bodyText = appendCentcomImageUrls(release.bodyText, release.imageUrls);
  const routed = routeOfficialSource({
    source: CENTCOM_SOURCE,
    title: release.title,
    body: bodyText,
  });
  const flags = assignAnalystFlags({
    source: CENTCOM_SOURCE,
    title: release.title,
    body: bodyText,
    hasOfficialUrl: true,
    hasPdf: false,
    hasImages: (release.imageUrls?.length ?? 0) > 0,
  });

  return {
    sourceName: CENTCOM_SOURCE,
    externalId: release.externalId,
    title: release.title,
    publishedAt: release.publishedAt,
    sourceUrl: release.sourceUrl,
    bodyText,
    classification: "official_military_maritime",
    primaryWatch: routed.primaryWatch,
    watchTags: routed.watchTags,
    flagSignificantIncident: flags.flagSignificantIncident,
    flagEscalationIndicator: flags.flagEscalationIndicator,
    flagMaritimeDisruption: flags.flagMaritimeDisruption,
    flagEvidenceAvailable: flags.flagEvidenceAvailable,
    flagPossibleSpotReport: flags.flagPossibleSpotReport,
  };
}

async function tableStats(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, CENTCOM_SOURCE));
  return row?.n ?? 0;
}

export async function runCentcomIngest(
  opts: CentcomIngestOptions = {},
): Promise<CentcomIngestSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  const disabled = isDisabled();

  log(
    `CENTCOM official ingest — mode=${commit ? "COMMIT" : "DRY-RUN"}${disabled ? " (DISABLED)" : ""}`,
  );

  const base: CentcomIngestSummary = {
    source: CENTCOM_SOURCE,
    mode: commit ? "commit" : "dry-run",
    configured: true,
    disabled,
    ran: !disabled,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    newsEchoSkipped: 0,
    totalAfter: 0,
    errors,
    logLines,
  };

  if (disabled) {
    log("  skipped — CENTCOM_INGEST_ENABLED=false");
    return base;
  }

  try {
    const usingFixtures = !!opts.listingHtml || !!fixtureDirFromEnv();
    if (!usingFixtures) {
      log(`  live fetch — primary RSS, HTML listing fallback`);
    }

    const parsedListing = await loadListingItems(opts, log);
    log(`  parsed ${parsedListing.length} listing tile(s)`);

    let listing = parsedListing;
    if (opts.externalIds?.length) {
      const allow = new Set(opts.externalIds);
      listing = listing.filter((item) => allow.has(item.externalId));
    }

    const sincePublishedAt =
      opts.sincePublishedAt !== undefined
        ? opts.sincePublishedAt
        : await latestCentcomPublishedAt();
    const maxDetailFetches = opts.maxDetailFetches ?? maxDetailFetchesFromEnv();
    const existingIds = await existingCentcomExternalIds(
      listing.map((item) => item.externalId),
    );
    const beforeSelect = listing.length;
    listing = selectCentcomListingForFetch(listing, {
      maxItems: maxDetailFetches,
      sincePublishedAt,
      existingExternalIds: existingIds,
    });
    const prefetchDuplicates = beforeSelect - listing.length;

    if (sincePublishedAt) {
      log(`  incremental since ${sincePublishedAt.toISOString()}`);
    }
    log(`  selected ${listing.length} release(s) for detail fetch (max ${maxDetailFetches})`);

    base.itemsFetched = listing.length;

    const fetchDetail = opts.fetchDetailHtml ?? defaultFetchDetail;
    const prepared: PreparedRelease[] = [];

    for (const item of listing) {
      try {
        const release = await prepareReleaseFromItem(item, fetchDetail, log);
        if (!release) continue;
        prepared.push(release);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`detail ${item.externalId}: ${msg}`);
        log(`  detail ERROR ${item.externalId}: ${msg}`);
      }
    }

    const usedRssBodyFallback = prepared.some((r) => r.ingestedViaRssBody);

    log(`  prepared ${prepared.length} release(s) for persist`);

    let toInsert = prepared;
    let newsEchoSkipped = 0;
    if (prepared.length > 0) {
      const partitioned = await partitionOfficialInserts(prepared, CENTCOM_SOURCE, {
        lookupNewsEcho: opts.lookupNewsEchoUrls,
      });
      toInsert = partitioned.toInsert;
      base.duplicateInDb = partitioned.duplicateInDb + prefetchDuplicates;
      newsEchoSkipped = partitioned.newsEchoSkipped;
    } else {
      base.duplicateInDb = prefetchDuplicates;
    }
    base.newsEchoSkipped = newsEchoSkipped;
    log(
      `  ${prepared.length} release(s); ${base.duplicateInDb} duplicate(s); ${newsEchoSkipped} news echo(s); ${toInsert.length} new`,
    );

    if (commit && toInsert.length > 0) {
      const values = toInsert.map(buildInsertRow);
      const inserted = await db
        .insert(officialMilitaryMaritimeSourcesTable)
        .values(values)
        .onConflictDoNothing({
          target: [
            officialMilitaryMaritimeSourcesTable.sourceName,
            officialMilitaryMaritimeSourcesTable.externalId,
          ],
        })
        .returning({ id: officialMilitaryMaritimeSourcesTable.id });
      base.inserted = inserted.length;
      log(`  committed: ${base.inserted} new row(s)`);
    } else if (!commit) {
      log("  DRY-RUN — no rows written");
    }

    if (commit) {
      const feedOk = errors.length === 0 && prepared.length > 0;
      const rawError = feedOk
        ? null
        : errors[0] ??
          (prepared.length === 0
            ? "CENTCOM ingest found no ingestible press releases"
            : "CENTCOM ingest completed with errors");
      const failureReason = rawError ? categorizeFeedFailure(rawError) : null;
      const blockedUpstream = failureReason === "blocked_upstream";
      const scrapeMethod = usedRssBodyFallback
        ? "RSS listing + RSS body (detail pages blocked)"
        : "RSS listing + HTML detail";
      await recordSourceHealth(
        CENTCOM_HEALTH_TOPIC,
        [
          {
            name: CENTCOM_HEALTH_NAME,
            url: CENTCOM_SOURCE_URL,
            ok: feedOk,
            collected: prepared.length,
            retained: base.inserted,
            rejected: prepared.length - toInsert.length + newsEchoSkipped,
            error: rawError,
            failureReason,
          },
        ],
        {
          sourceType: "html",
          scrapeMethod,
          notes: CENTCOM_HEALTH_NOTES,
          pending: !feedOk && (blockedUpstream || prepared.length === 0),
        },
      );
    }

    base.totalAfter = await tableStats();
    return base;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    log(`  UNEXPECTED ERROR: ${msg}`);
    try {
      base.totalAfter = await tableStats();
    } catch {
      // best effort
    }
    if (commit) {
      const failureReason = categorizeFeedFailure(msg);
      await recordSourceHealth(
        CENTCOM_HEALTH_TOPIC,
        [
          {
            name: CENTCOM_HEALTH_NAME,
            url: CENTCOM_SOURCE_URL,
            ok: false,
            error: msg,
            failureReason,
          },
        ],
        {
          sourceType: "html",
          notes: CENTCOM_HEALTH_NOTES,
          pending: failureReason === "blocked_upstream",
        },
      );
    }
    return base;
  }
}
