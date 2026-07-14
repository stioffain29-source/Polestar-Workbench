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
  assignAnalystFlags,
  routeOfficialSource,
  partitionOfficialInserts,
} from "./m15";
import {
  OFFICIAL_M15_HEALTH_TOPIC,
  type PartnerProviderKey,
} from "./m15/health";
import {
  partnerSourceByKey,
  PARTNER_SOURCES,
  type PartnerSourceDef,
} from "./m15/partnerSources";
import {
  discoverPartnerProducts,
  mergeFixturePartnerProducts,
  PARTNER_DETAIL_FIXTURES,
  PARTNER_LISTING_FIXTURES,
  PARTNER_PDF_FIXTURES,
  type PartnerListingItem,
} from "./partnerDiscover";
import { parsePartnerProduct } from "./partnerParse";
import { parsePartnerPdf } from "./partnerPdf";
import { fetchPdfBytes } from "./ukmtoPdf";
import { recordSourceHealth } from "./sourceHealth";

// M1.5 — JMIC / CMF partner product ingest. Parses listing + detail HTML/PDF,
// routes to Watches, assigns analyst flags, and persists standalone official rows.
// NEVER touches spot_reports.

export {
  discoverPartnerProducts,
  mergeFixturePartnerProducts,
  partnerExternalIdFromUrl,
  PARTNER_FIXTURE_LISTING_ITEMS,
  PARTNER_LISTING_FIXTURES,
} from "./partnerDiscover";
export type { PartnerListingItem } from "./partnerDiscover";
export { parsePartnerProduct } from "./partnerParse";
export { parsePartnerPdf } from "./partnerPdf";

export const PARTNER_HEALTH_TOPIC = OFFICIAL_M15_HEALTH_TOPIC;

const PARTNER_HEALTH_NOTES =
  "JMIC / CMF partner maritime products ingested as STANDALONE official sources (never as incidents).";
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = 2500;
const DEFAULT_MAX_DETAIL_FETCHES = 10;

function isProviderDisabled(def: PartnerSourceDef): boolean {
  const v = process.env[def.envVar]?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

function fixtureDirFromEnv(): string | null {
  const dir = process.env.PARTNER_FIXTURE_DIR?.trim();
  if (dir) return dir;
  const flag = process.env.PARTNER_INGEST_FIXTURES?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return join(process.cwd(), "__tests__", "fixtures", "m15");
  }
  return null;
}

function maxDetailFetchesFromEnv(): number {
  const raw = process.env.PARTNER_INGEST_MAX_DETAIL?.trim();
  if (!raw) return DEFAULT_MAX_DETAIL_FETCHES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DETAIL_FETCHES;
}

export type PartnerProviderIngestSummary = {
  provider: PartnerProviderKey;
  mode: "commit" | "dry-run";
  configured: boolean;
  disabled: boolean;
  ran: boolean;
  itemsDiscovered: number;
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

export type MaritimePartnerProductsIngestSummary = {
  mode: "commit" | "dry-run";
  configured: boolean;
  disabled: boolean;
  ran: boolean;
  providers: Record<PartnerProviderKey, PartnerProviderIngestSummary>;
  itemsDiscovered: number;
  itemsFetched: number;
  inserted: number;
  duplicateInDb: number;
  newsEchoSkipped: number;
  pdfExtracted: number;
  pdfPartial: number;
  errors: string[];
  logLines: string[];
};

export type MaritimePartnerProductsIngestOptions = {
  commit?: boolean;
  /** Per-provider listing HTML overrides (tests). */
  listingHtmlByProvider?: Partial<Record<PartnerProviderKey, string>>;
  fetchDetailHtml?: (
    item: PartnerListingItem,
  ) => Promise<{ html: string | null; pdfBytes?: Buffer | null }>;
  fetchPdfBytes?: (item: PartnerListingItem, pdfUrl: string) => Promise<Buffer | null>;
  maxDetailFetches?: number;
  externalIds?: string[];
  sincePublishedAt?: Date | null;
  lookupNewsEchoUrls?: (urls: string[]) => Promise<Set<string>>;
  /** Limit to specific providers (default: all registered). */
  providers?: PartnerProviderKey[];
};

type PreparedPartnerProduct = {
  externalId: string;
  sourceName: PartnerProviderKey;
  title: string;
  publishedAt: Date | null;
  sourceUrl: string;
  bodyText: string;
  hasPdf: boolean;
};

function emptyProviderSummary(
  provider: PartnerProviderKey,
  mode: "commit" | "dry-run",
  disabled = false,
): PartnerProviderIngestSummary {
  return {
    provider,
    mode,
    configured: true,
    disabled,
    ran: !disabled,
    itemsDiscovered: 0,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    newsEchoSkipped: 0,
    totalAfter: 0,
    pdfExtracted: 0,
    pdfPartial: 0,
    errors: [],
    logLines: [],
  };
}

export function emptyMaritimePartnerProductsIngestSummary(
  err?: unknown,
): MaritimePartnerProductsIngestSummary {
  const mode = "dry-run" as const;
  const providers = {
    jmic: emptyProviderSummary("jmic", mode),
    cmf: emptyProviderSummary("cmf", mode),
  };
  return {
    mode,
    configured: true,
    disabled: false,
    ran: false,
    providers,
    itemsDiscovered: 0,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    newsEchoSkipped: 0,
    pdfExtracted: 0,
    pdfPartial: 0,
    errors: err ? [err instanceof Error ? err.message : String(err)] : [],
    logLines: [],
  };
}

function buildPartnerBodyText(product: ReturnType<typeof parsePartnerProduct>): string {
  const lines = [
    `Provider: ${product.provider.toUpperCase()}`,
    `Region: ${product.region}`,
    product.threatLevel ? `Threat level: ${product.threatLevel}` : null,
    "",
    product.summary,
  ].filter((line) => line !== null);
  return lines.join("\n").trim();
}

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

async function loadListingHtml(
  provider: PartnerProviderKey,
  opts: MaritimePartnerProductsIngestOptions,
): Promise<string> {
  const override = opts.listingHtmlByProvider?.[provider];
  if (override) return override;
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    return readFileSync(
      join(fixtureDir, PARTNER_LISTING_FIXTURES[provider]),
      "utf8",
    );
  }
  return fetchHtmlWithRetry(partnerSourceByKey(provider).listingUrl);
}

export function selectPartnerListingForFetch(
  listing: PartnerListingItem[],
  opts: {
    maxItems: number;
    sincePublishedAt?: Date | null;
    existingExternalIds?: ReadonlySet<string>;
  },
): PartnerListingItem[] {
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

async function latestPartnerPublishedAt(
  provider: PartnerProviderKey,
): Promise<Date | null> {
  const [row] = await db
    .select({
      latest: sql<Date | null>`max(${officialMilitaryMaritimeSourcesTable.publishedAt})`,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, provider));
  if (!row?.latest) return null;
  const d = new Date(row.latest);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function existingPartnerExternalIds(
  provider: PartnerProviderKey,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({
      externalId: officialMilitaryMaritimeSourcesTable.externalId,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(
      and(
        eq(officialMilitaryMaritimeSourcesTable.sourceName, provider),
        inArray(officialMilitaryMaritimeSourcesTable.externalId, ids),
      ),
    );
  return new Set(rows.map((r) => r.externalId));
}

async function providerTableStats(provider: PartnerProviderKey): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, provider));
  return row?.n ?? 0;
}

function detailFixturePath(
  fixtureDir: string,
  provider: PartnerProviderKey,
  externalId: string,
): string | null {
  const name = PARTNER_DETAIL_FIXTURES[provider]?.[externalId];
  return name ? join(fixtureDir, name) : null;
}

function pdfFixturePath(
  fixtureDir: string,
  provider: PartnerProviderKey,
  externalId: string,
): string | null {
  const name = PARTNER_PDF_FIXTURES[provider]?.[externalId];
  return name ? join(fixtureDir, name) : null;
}

async function defaultFetchDetail(
  item: PartnerListingItem,
): Promise<{ html: string | null; pdfBytes?: Buffer | null }> {
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    const detailPath = detailFixturePath(fixtureDir, item.provider, item.externalId);
    const pdfPath = pdfFixturePath(fixtureDir, item.provider, item.externalId);
    const html = detailPath
      ? readFileSync(detailPath, "utf8")
      : item.contentType === "html"
        ? null
        : null;
    const pdfBytes = pdfPath ? readFileSync(pdfPath) : null;
    if (html || pdfBytes) return { html, pdfBytes };
    if (item.contentType === "pdf" && item.pdfUrl) {
      try {
        return { html: null, pdfBytes: await fetchPdfBytes(item.pdfUrl) };
      } catch {
        return { html: null, pdfBytes: null };
      }
    }
    return { html: null, pdfBytes: null };
  }

  if (item.contentType === "pdf" && item.pdfUrl) {
    try {
      return { html: null, pdfBytes: await fetchPdfBytes(item.pdfUrl) };
    } catch {
      return { html: null, pdfBytes: null };
    }
  }

  try {
    return { html: await fetchHtmlWithRetry(item.sourceUrl), pdfBytes: null };
  } catch {
    return { html: null, pdfBytes: null };
  }
}

function buildInsertRow(product: PreparedPartnerProduct): InsertOfficialMilitaryMaritimeSource {
  const routed = routeOfficialSource({
    source: "partner",
    title: product.title,
    body: product.bodyText,
  });
  const flags = assignAnalystFlags({
    source: "partner",
    title: product.title,
    body: product.bodyText,
    hasOfficialUrl: true,
    hasPdf: product.hasPdf,
  });

  return {
    sourceName: product.sourceName,
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

async function runPartnerProviderIngest(
  provider: PartnerProviderKey,
  opts: MaritimePartnerProductsIngestOptions,
): Promise<PartnerProviderIngestSummary> {
  const commit = opts.commit ?? false;
  const def = partnerSourceByKey(provider);
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  const disabled = isProviderDisabled(def);

  log(
    `${def.displayName} ingest — mode=${commit ? "COMMIT" : "DRY-RUN"}${disabled ? " (DISABLED)" : ""}`,
  );

  const summary = emptyProviderSummary(provider, commit ? "commit" : "dry-run", disabled);
  summary.logLines = logLines;
  summary.errors = errors;

  if (disabled) {
    log(`  skipped — ${def.envVar}=false`);
    if (commit) {
      await recordSourceHealth(
        PARTNER_HEALTH_TOPIC,
        [
          {
            name: def.healthName,
            url: def.listingUrl,
            ok: false,
            error: `Switched off (${def.envVar}=false)`,
          },
        ],
        { sourceType: "html", notes: PARTNER_HEALTH_NOTES },
      );
    }
    return summary;
  }

  try {
    const usingFixtures =
      !!opts.listingHtmlByProvider?.[provider] || !!fixtureDirFromEnv();
    if (!usingFixtures) {
      log(`  live fetch — listing ${def.listingUrl}`);
    }

    const listingHtml = await loadListingHtml(provider, opts);
    let discovered = discoverPartnerProducts(provider, listingHtml);
    if (usingFixtures) {
      discovered = mergeFixturePartnerProducts(provider, discovered);
    }
    log(`  discovered ${discovered.length} product(s)`);
    summary.itemsDiscovered = discovered.length;

    let listing = discovered;
    if (opts.externalIds?.length) {
      const allow = new Set(opts.externalIds);
      listing = listing.filter((item) => allow.has(item.externalId));
    }

    const sincePublishedAt =
      opts.sincePublishedAt !== undefined
        ? opts.sincePublishedAt
        : await latestPartnerPublishedAt(provider);
    const maxDetailFetches = opts.maxDetailFetches ?? maxDetailFetchesFromEnv();
    const existingIds = await existingPartnerExternalIds(
      provider,
      listing.map((item) => item.externalId),
    );
    const beforeSelect = listing.length;
    listing = selectPartnerListingForFetch(listing, {
      maxItems: maxDetailFetches,
      sincePublishedAt,
      existingExternalIds: existingIds,
    });
    const prefetchDuplicates = beforeSelect - listing.length;

    if (sincePublishedAt) {
      log(`  incremental since ${sincePublishedAt.toISOString()}`);
    }
    log(`  selected ${listing.length} product(s) for detail fetch (max ${maxDetailFetches})`);
    summary.itemsFetched = listing.length;

    const fetchDetail = opts.fetchDetailHtml ?? defaultFetchDetail;
    const fetchPdf = opts.fetchPdfBytes ?? (async (item, pdfUrl) => {
      const fixtureDir = fixtureDirFromEnv();
      if (fixtureDir) {
        const path = pdfFixturePath(fixtureDir, item.provider, item.externalId);
        if (path) return readFileSync(path);
      }
      try {
        return await fetchPdfBytes(pdfUrl);
      } catch {
        return null;
      }
    });

    const prepared: PreparedPartnerProduct[] = [];

    for (const item of listing) {
      try {
        const detail = await fetchDetail(item);
        let html = detail.html;
        let pdfBytes = detail.pdfBytes ?? null;
        if (!pdfBytes && item.pdfUrl) {
          pdfBytes = await fetchPdf(item, item.pdfUrl);
        }

        let text = "";
        let hasPdf = false;
        let pdfPartial = false;
        if (pdfBytes) {
          const pdf = await parsePartnerPdf(pdfBytes);
          text = pdf.text;
          hasPdf = true;
          pdfPartial = pdf.partial;
          summary.pdfExtracted += 1;
          if (pdf.partial) summary.pdfPartial += 1;
        }
        if (html) {
          text = `${text}\n\n${html.replace(/<[^>]+>/g, " ")}`.trim();
        }
        if (!text.trim()) {
          log(`  skip ${item.externalId} — no detail text`);
          continue;
        }

        const parsed = parsePartnerProduct({
          provider: item.provider,
          html: html ?? undefined,
          text,
          title: item.title,
          date: item.publishedAt,
          sourceUrl: item.sourceUrl,
          pdfUrl: item.pdfUrl,
        });

        let bodyText = buildPartnerBodyText(parsed);
        if (pdfBytes && text.trim()) {
          const label = pdfPartial ? "PDF excerpt (partial parse)" : "PDF text";
          bodyText = `${bodyText}\n\n---\n[${label}]\n${text.trim()}`;
        }

        prepared.push({
          externalId: item.externalId,
          sourceName: item.provider,
          title: parsed.productTitle,
          publishedAt: parsed.date,
          sourceUrl: parsed.sourceUrl,
          bodyText,
          hasPdf,
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
      const partitioned = await partitionOfficialInserts(prepared, provider, {
        lookupNewsEcho: opts.lookupNewsEchoUrls,
      });
      toInsert = partitioned.toInsert;
      summary.duplicateInDb = partitioned.duplicateInDb + prefetchDuplicates;
      newsEchoSkipped = partitioned.newsEchoSkipped;
    } else {
      summary.duplicateInDb = prefetchDuplicates;
    }
    summary.newsEchoSkipped = newsEchoSkipped;
    log(
      `  ${prepared.length} product(s); ${summary.duplicateInDb} duplicate(s); ${newsEchoSkipped} news echo(s); ${toInsert.length} new`,
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
      summary.inserted = inserted.length;
      log(`  committed: ${summary.inserted} new row(s)`);
    } else if (!commit) {
      log("  DRY-RUN — no rows written");
    }

    if (commit) {
      const feedOk = errors.length === 0;
      await recordSourceHealth(
        PARTNER_HEALTH_TOPIC,
        [
          {
            name: def.healthName,
            url: def.listingUrl,
            ok: feedOk,
            collected: prepared.length,
            retained: summary.inserted,
            rejected: prepared.length - toInsert.length + newsEchoSkipped,
            error: feedOk ? null : errors[0] ?? `${def.displayName} ingest completed with errors`,
          },
        ],
        {
          sourceType: "html",
          scrapeMethod: "Partner listing + HTML/PDF detail",
          notes: PARTNER_HEALTH_NOTES,
          pending: !feedOk,
        },
      );
    }

    summary.totalAfter = await providerTableStats(provider);
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    log(`  UNEXPECTED ERROR: ${msg}`);
    try {
      summary.totalAfter = await providerTableStats(provider);
    } catch {
      // best effort
    }
    if (commit) {
      await recordSourceHealth(
        PARTNER_HEALTH_TOPIC,
        [
          {
            name: def.healthName,
            url: def.listingUrl,
            ok: false,
            error: msg,
          },
        ],
        { sourceType: "html", notes: PARTNER_HEALTH_NOTES, pending: true },
      );
    }
    return summary;
  }
}

export async function runMaritimePartnerProductsIngest(
  opts: MaritimePartnerProductsIngestOptions = {},
): Promise<MaritimePartnerProductsIngestSummary> {
  const commit = opts.commit ?? false;
  const providerKeys =
    opts.providers ?? PARTNER_SOURCES.map((def) => def.key);
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);

  log(
    `Maritime partner products ingest — mode=${commit ? "COMMIT" : "DRY-RUN"}`,
  );

  const providers = {
    jmic: emptyProviderSummary("jmic", commit ? "commit" : "dry-run"),
    cmf: emptyProviderSummary("cmf", commit ? "commit" : "dry-run"),
  };

  for (const key of providerKeys) {
    const result = await runPartnerProviderIngest(key, opts);
    providers[key] = result;
    logLines.push(...result.logLines);
    errors.push(...result.errors);
  }

  const allDisabled = providerKeys.every((key) => providers[key].disabled);

  return {
    mode: commit ? "commit" : "dry-run",
    configured: true,
    disabled: allDisabled,
    ran: providerKeys.some((key) => providers[key].ran),
    providers,
    itemsDiscovered: providerKeys.reduce(
      (n, key) => n + providers[key].itemsDiscovered,
      0,
    ),
    itemsFetched: providerKeys.reduce(
      (n, key) => n + providers[key].itemsFetched,
      0,
    ),
    inserted: providerKeys.reduce((n, key) => n + providers[key].inserted, 0),
    duplicateInDb: providerKeys.reduce(
      (n, key) => n + providers[key].duplicateInDb,
      0,
    ),
    newsEchoSkipped: providerKeys.reduce(
      (n, key) => n + providers[key].newsEchoSkipped,
      0,
    ),
    pdfExtracted: providerKeys.reduce(
      (n, key) => n + providers[key].pdfExtracted,
      0,
    ),
    pdfPartial: providerKeys.reduce(
      (n, key) => n + providers[key].pdfPartial,
      0,
    ),
    errors,
    logLines,
  };
}
