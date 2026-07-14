import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  db,
  officialMilitaryMaritimeSourcesTable,
  type InsertOfficialMilitaryMaritimeSource,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchHtmlBody, sleep } from "./feedFetch";
import { assignAnalystFlags, routeOfficialSource, partitionOfficialInserts } from "./m15";
import {
  OFFICIAL_M15_HEALTH_TOPIC,
  UKMTO_HEALTH_NAME,
  UKMTO_SOURCE_URL,
} from "./m15/health";
import {
  parseUkmtoDetail,
  parseUkmtoListing,
  type UkmtoListingItem,
  UKMTO_SITE_ORIGIN,
} from "./ukmtoParse";
import {
  extractUkmtoPdfText,
  fetchPdfBytes,
  loadUkmtoPdfFixture,
  mergeUkmtoBodyWithPdf,
  type UkmtoPdfExtractResult,
} from "./ukmtoPdf";
import {
  fetchUkmtoIncidentIndex,
  fetchUkmtoLiveListing,
  matchIncidentForListingItem,
  ukmtoDetailFromApiListing,
  type UkmtoApiIncident,
} from "./ukmtoApi";
import { recordSourceHealth, categorizeFeedFailure } from "./sourceHealth";

// M1.5 — UKMTO official products ingest. Parses listing + detail HTML, merges
// linked PDF text, routes to Watches, assigns analyst flags, and persists rows.
// NEVER touches spot_reports.

export {
  parseUkmtoListing,
  parseUkmtoDetail,
  resolveUkmtoUrl,
  UKMTO_SITE_ORIGIN,
} from "./ukmtoParse";
export type {
  UkmtoListingItem,
  UkmtoDetail,
  UkmtoProductType,
} from "./ukmtoParse";
export {
  extractUkmtoPdfText,
  mergeUkmtoBodyWithPdf,
  extractPdfTextFallback,
} from "./ukmtoPdf";
export type { UkmtoPdfExtractResult } from "./ukmtoPdf";

export const UKMTO_SOURCE = "ukmto" as const;
export const UKMTO_HEALTH_TOPIC = OFFICIAL_M15_HEALTH_TOPIC;
export { UKMTO_HEALTH_NAME, UKMTO_SOURCE_URL } from "./m15/health";

const UKMTO_HEALTH_NOTES =
  "UK Maritime Trade Operations (UKMTO) — official warnings, advisories and PDF products ingested as STANDALONE official sources (never as incidents).";
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = 2500;
const DEFAULT_MAX_DETAIL_FETCHES = 10;
const DEFAULT_FIXTURE_LISTING = "ukmto-products-listing.html";

function isDisabled(): boolean {
  const v = process.env.UKMTO_INGEST_ENABLED?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

function fixtureDirFromEnv(): string | null {
  const dir = process.env.UKMTO_FIXTURE_DIR?.trim();
  if (dir) return dir;
  const flag = process.env.UKMTO_INGEST_FIXTURES?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return join(process.cwd(), "__tests__", "fixtures", "m15");
  }
  return null;
}

function maxDetailFetchesFromEnv(): number {
  const raw = process.env.UKMTO_INGEST_MAX_DETAIL?.trim();
  if (!raw) return DEFAULT_MAX_DETAIL_FETCHES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DETAIL_FETCHES;
}

function detailFixturePath(fixtureDir: string, externalId: string): string {
  if (externalId === "003-26-update-002") {
    return join(fixtureDir, "ukmto-advisory-003-26-update-002.html");
  }
  if (externalId === "038-26-attack") {
    return join(fixtureDir, "ukmto-warning-038-26-attack.html");
  }
  return join(fixtureDir, `ukmto-${externalId}.html`);
}

export type UkmtoIngestSummary = {
  source: typeof UKMTO_SOURCE;
  mode: "commit" | "dry-run";
  configured: boolean;
  disabled: boolean;
  ran: boolean;
  itemsFetched: number;
  inserted: number;
  duplicateInDb: number;
  newsEchoSkipped: number;
  totalAfter: number;
  pdfExtracted: number;
  pdfPartial: number;
  errors: string[];
  logLines: string[];
};

export type UkmtoIngestOptions = {
  commit?: boolean;
  listingHtml?: string;
  fetchDetailHtml?: (item: UkmtoListingItem) => Promise<string | null>;
  fetchPdfBytes?: (item: UkmtoListingItem, pdfUrl: string) => Promise<Buffer | null>;
  maxDetailFetches?: number;
  externalIds?: string[];
  sincePublishedAt?: Date | null;
  /** Override news-echo lookup (tests). */
  lookupNewsEchoUrls?: (urls: string[]) => Promise<Set<string>>;
};

/** Select newest listing items for detail fetch, respecting since/max/existing. */
export function selectUkmtoListingForFetch(
  listing: UkmtoListingItem[],
  opts: {
    maxItems: number;
    sincePublishedAt?: Date | null;
    existingExternalIds?: ReadonlySet<string>;
  },
): UkmtoListingItem[] {
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

export function emptyUkmtoIngestSummary(err?: unknown): UkmtoIngestSummary {
  return {
    source: UKMTO_SOURCE,
    mode: "dry-run",
    configured: true,
    disabled: false,
    ran: false,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    newsEchoSkipped: 0,
    totalAfter: 0,
    pdfExtracted: 0,
    pdfPartial: 0,
    errors: err ? [err instanceof Error ? err.message : String(err)] : [],
    logLines: [],
  };
}

type PreparedProduct = {
  externalId: string;
  title: string;
  publishedAt: Date | null;
  sourceUrl: string;
  bodyText: string;
  hasPdf: boolean;
};

async function fetchHtmlWithRetry(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchHtmlBody(url, FETCH_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function loadListingItems(opts: UkmtoIngestOptions): Promise<UkmtoListingItem[]> {
  if (opts.listingHtml) {
    return parseUkmtoListing(opts.listingHtml);
  }
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    return parseUkmtoListing(
      readFileSync(join(fixtureDir, DEFAULT_FIXTURE_LISTING), "utf8"),
    );
  }
  // Live UKMTO migrated to Next.js — listing HTML no longer contains product
  // rows. Pull warnings/advisories from the Sitecore Content Delivery API.
  return fetchUkmtoLiveListing({
    maxProducts: maxDetailFetchesFromEnv() * 4,
  });
}

async function latestUkmtoPublishedAt(): Promise<Date | null> {
  const [row] = await db
    .select({
      latest: sql<Date | null>`max(${officialMilitaryMaritimeSourcesTable.publishedAt})`,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, UKMTO_SOURCE));
  if (!row?.latest) return null;
  const d = new Date(row.latest);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function existingUkmtoExternalIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({
      externalId: officialMilitaryMaritimeSourcesTable.externalId,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(
      and(
        eq(officialMilitaryMaritimeSourcesTable.sourceName, UKMTO_SOURCE),
        inArray(officialMilitaryMaritimeSourcesTable.externalId, ids),
      ),
    );
  return new Set(rows.map((r) => r.externalId));
}

async function defaultFetchDetail(item: UkmtoListingItem): Promise<string | null> {
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    try {
      return readFileSync(detailFixturePath(fixtureDir, item.externalId), "utf8");
    } catch {
      return null;
    }
  }
  return fetchHtmlWithRetry(item.sourceUrl);
}

async function defaultFetchPdf(
  item: UkmtoListingItem,
  pdfUrl: string,
): Promise<Buffer | null> {
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    return loadUkmtoPdfFixture(fixtureDir, item.externalId);
  }
  try {
    return await fetchPdfBytes(pdfUrl);
  } catch {
    return null;
  }
}

function buildInsertRow(product: PreparedProduct): InsertOfficialMilitaryMaritimeSource {
  const routed = routeOfficialSource({
    source: UKMTO_SOURCE,
    title: product.title,
    body: product.bodyText,
  });
  const flags = assignAnalystFlags({
    source: UKMTO_SOURCE,
    title: product.title,
    body: product.bodyText,
    hasOfficialUrl: true,
    hasPdf: product.hasPdf,
  });

  return {
    sourceName: UKMTO_SOURCE,
    externalId: product.externalId,
    title: product.title,
    publishedAt: product.publishedAt,
    sourceUrl: product.sourceUrl,
    bodyText: product.bodyText,
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
    .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, UKMTO_SOURCE));
  return row?.n ?? 0;
}

export async function runUkmtoIngest(
  opts: UkmtoIngestOptions = {},
): Promise<UkmtoIngestSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  const disabled = isDisabled();

  log(
    `UKMTO official ingest — mode=${commit ? "COMMIT" : "DRY-RUN"}${disabled ? " (DISABLED)" : ""}`,
  );

  const base: UkmtoIngestSummary = {
    source: UKMTO_SOURCE,
    mode: commit ? "commit" : "dry-run",
    configured: true,
    disabled,
    ran: !disabled,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    newsEchoSkipped: 0,
    totalAfter: 0,
    pdfExtracted: 0,
    pdfPartial: 0,
    errors,
    logLines,
  };

  if (disabled) {
    log("  skipped — UKMTO_INGEST_ENABLED=false");
    return base;
  }

  try {
    const usingFixtures = !!opts.listingHtml || !!fixtureDirFromEnv();
    if (!usingFixtures) {
      log(`  live fetch — Sitecore API (warnings + advisories)`);
    }

    let listing = await loadListingItems(opts);
    log(`  parsed ${listing.length} listing item(s)`);

    if (opts.externalIds?.length) {
      const allow = new Set(opts.externalIds);
      listing = listing.filter((item) => allow.has(item.externalId));
    }

    const sincePublishedAt =
      opts.sincePublishedAt !== undefined
        ? opts.sincePublishedAt
        : await latestUkmtoPublishedAt();
    const maxDetailFetches = opts.maxDetailFetches ?? maxDetailFetchesFromEnv();
    const existingIds = await existingUkmtoExternalIds(
      listing.map((item) => item.externalId),
    );
    const beforeSelect = listing.length;
    listing = selectUkmtoListingForFetch(listing, {
      maxItems: maxDetailFetches,
      sincePublishedAt,
      existingExternalIds: existingIds,
    });
    const prefetchDuplicates = beforeSelect - listing.length;

    if (sincePublishedAt) {
      log(`  incremental since ${sincePublishedAt.toISOString()}`);
    }
    log(`  selected ${listing.length} product(s) for detail fetch (max ${maxDetailFetches})`);

    base.itemsFetched = listing.length;

    const fetchDetail = opts.fetchDetailHtml ?? defaultFetchDetail;
    const fetchPdf = opts.fetchPdfBytes ?? defaultFetchPdf;
    const prepared: PreparedProduct[] = [];
    let incidentIndex: Map<number, UkmtoApiIncident> | null = null;
    if (!usingFixtures) {
      try {
        incidentIndex = await fetchUkmtoIncidentIndex();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  incident index unavailable (continuing without): ${msg}`);
      }
    }

    for (const item of listing) {
      try {
        let detail;
        if (item.apiReference) {
          const incident = incidentIndex
            ? matchIncidentForListingItem(item, incidentIndex)
            : null;
          detail = ukmtoDetailFromApiListing(item, incident);
        } else {
          const detailHtml = await fetchDetail(item);
          if (!detailHtml) {
            log(`  skip ${item.externalId} — no detail HTML`);
            continue;
          }
          detail = parseUkmtoDetail(detailHtml, item.sourceUrl);
        }
        const pdfUrl = detail.pdfUrl ?? item.pdfUrl;
        let pdfResult: UkmtoPdfExtractResult | null = null;

        if (pdfUrl) {
          try {
            const bytes = await fetchPdf(item, pdfUrl);
            if (bytes) {
              pdfResult = await extractUkmtoPdfText(bytes, { maxPages: 1 });
              if (pdfResult.text) {
                base.pdfExtracted += 1;
                if (pdfResult.partial) base.pdfPartial += 1;
              } else {
                base.pdfPartial += 1;
                log(`  PDF partial ${item.externalId} — no text extracted`);
              }
            }
          } catch (err) {
            base.pdfPartial += 1;
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`pdf ${item.externalId}: ${msg}`);
            log(`  PDF ERROR ${item.externalId}: ${msg}`);
          }
        }

        const merged = mergeUkmtoBodyWithPdf(detail.bodyText, pdfResult);
        prepared.push({
          externalId: item.externalId,
          title: detail.title || item.title,
          publishedAt: detail.publishedAt ?? item.publishedAt,
          sourceUrl: detail.sourceUrl || item.sourceUrl,
          bodyText: merged.bodyText,
          hasPdf: !!pdfUrl,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`detail ${item.externalId}: ${msg}`);
        log(`  detail ERROR ${item.externalId}: ${msg}`);
      }
    }

    log(`  prepared ${prepared.length} product(s) for persist`);

    let toInsert = prepared;
    let newsEchoSkipped = 0;
    if (prepared.length > 0) {
      const partitioned = await partitionOfficialInserts(prepared, UKMTO_SOURCE, {
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
      `  ${prepared.length} product(s); ${base.duplicateInDb} duplicate(s); ${newsEchoSkipped} news echo(s); ${toInsert.length} new`,
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
      const rawError = feedOk ? null : errors[0] ?? "UKMTO ingest completed with errors";
      const failureReason = rawError ? categorizeFeedFailure(rawError) : null;
      const blockedUpstream = failureReason === "blocked_upstream";
      await recordSourceHealth(
        UKMTO_HEALTH_TOPIC,
        [
          {
            name: UKMTO_HEALTH_NAME,
            url: UKMTO_SOURCE_URL,
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
          scrapeMethod: "Sitecore API (warnings + advisories + PDF)",
          notes: UKMTO_HEALTH_NOTES,
          pending: !feedOk || blockedUpstream,
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
        UKMTO_HEALTH_TOPIC,
        [
          {
            name: UKMTO_HEALTH_NAME,
            url: UKMTO_SOURCE_URL,
            ok: false,
            error: msg,
            failureReason,
          },
        ],
        {
          sourceType: "html",
          notes: UKMTO_HEALTH_NOTES,
          pending: failureReason === "blocked_upstream",
        },
      );
    }
    return base;
  }
}
