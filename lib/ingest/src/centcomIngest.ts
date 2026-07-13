import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  db,
  officialMilitaryMaritimeSourcesTable,
  type InsertOfficialMilitaryMaritimeSource,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchBody, sleep } from "./feedFetch";
import {
  parseCentcomDetail,
  parseCentcomListing,
  type CentcomListingItem,
  CENTCOM_SITE_ORIGIN,
} from "./centcomParse";
import { assignAnalystFlags, routeOfficialSource, partitionOfficialInserts, appendCentcomImageUrls } from "./m15";
import {
  CENTCOM_HEALTH_NAME,
  CENTCOM_SOURCE_URL,
  OFFICIAL_M15_HEALTH_TOPIC,
} from "./m15/health";
import { recordSourceHealth } from "./sourceHealth";

// M1.5 — CENTCOM press releases ingest. Parses listing + detail HTML, routes to
// Watches, assigns analyst flags, and persists standalone official-source rows.
// NEVER touches spot_reports.

export {
  parseCentcomListing,
  parseCentcomDetail,
  resolveCentcomUrl,
  CENTCOM_SITE_ORIGIN,
} from "./centcomParse";
export type { CentcomListingItem, CentcomDetail } from "./centcomParse";

export const CENTCOM_SOURCE = "centcom" as const;
export const CENTCOM_HEALTH_TOPIC = OFFICIAL_M15_HEALTH_TOPIC;
export { CENTCOM_HEALTH_NAME, CENTCOM_SOURCE_URL } from "./m15/health";

const CENTCOM_HEALTH_NOTES =
  "U.S. Central Command (CENTCOM) official press releases ingested as STANDALONE official sources (never as incidents).";
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = 2500;
const DEFAULT_MAX_DETAIL_FETCHES = 10;
const DEFAULT_FIXTURE_NAME = "centcom-press-releases-listing.html";

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
};

async function fetchHtmlWithRetry(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchBody(url, FETCH_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function loadListingHtml(opts: CentcomIngestOptions): Promise<string> {
  if (opts.listingHtml) return opts.listingHtml;
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    return readFileSync(join(fixtureDir, DEFAULT_FIXTURE_NAME), "utf8");
  }
  return fetchHtmlWithRetry(CENTCOM_SOURCE_URL);
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
    if (commit) {
      await recordSourceHealth(
        CENTCOM_HEALTH_TOPIC,
        [
          {
            name: CENTCOM_HEALTH_NAME,
            url: CENTCOM_SOURCE_URL,
            ok: false,
            error: "Switched off (CENTCOM_INGEST_ENABLED=false)",
          },
        ],
        { sourceType: "html", notes: CENTCOM_HEALTH_NOTES },
      );
    }
    return base;
  }

  try {
    const usingFixtures = !!opts.listingHtml || !!fixtureDirFromEnv();
    if (!usingFixtures) {
      log(`  live fetch — listing ${CENTCOM_SOURCE_URL}`);
    }

    const listingHtml = await loadListingHtml(opts);
    const parsedListing = parseCentcomListing(listingHtml, CENTCOM_SITE_ORIGIN);
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
        const detailHtml = await fetchDetail(item);
        if (!detailHtml) {
          log(`  skip ${item.externalId} — no detail HTML`);
          continue;
        }
        const detail = parseCentcomDetail(detailHtml, item.sourceUrl);
        prepared.push({
          externalId: item.externalId,
          title: detail.title || item.title,
          publishedAt: detail.publishedAt ?? item.publishedAt,
          sourceUrl: detail.sourceUrl || item.sourceUrl,
          bodyText: detail.bodyText,
          imageUrls: detail.imageUrls,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`detail ${item.externalId}: ${msg}`);
        log(`  detail ERROR ${item.externalId}: ${msg}`);
      }
    }

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
      const feedOk = errors.length === 0;
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
            error: feedOk
              ? null
              : errors[0] ?? "CENTCOM ingest completed with errors",
          },
        ],
        {
          sourceType: "html",
          scrapeMethod: "HTML listing + detail",
          notes: CENTCOM_HEALTH_NOTES,
          pending: !feedOk,
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
      await recordSourceHealth(
        CENTCOM_HEALTH_TOPIC,
        [
          {
            name: CENTCOM_HEALTH_NAME,
            url: CENTCOM_SOURCE_URL,
            ok: false,
            error: msg,
          },
        ],
        { sourceType: "html", notes: CENTCOM_HEALTH_NOTES, pending: true },
      );
    }
    return base;
  }
}
