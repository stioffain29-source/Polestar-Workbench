import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  db,
  officialMilitaryMaritimeSourcesTable,
  type InsertOfficialMilitaryMaritimeSource,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchBody } from "./feedFetch";
import {
  parseCentcomDetail,
  parseCentcomListing,
  type CentcomListingItem,
  CENTCOM_SITE_ORIGIN,
} from "./centcomParse";
import { assignAnalystFlags, routeOfficialSource } from "./m15";
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
  /** Cap items processed (tests / dry runs). */
  maxItems?: number;
  /** Process only these listing external ids. */
  externalIds?: string[];
};

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
};

async function loadListingHtml(opts: CentcomIngestOptions): Promise<string> {
  if (opts.listingHtml) return opts.listingHtml;
  const fixtureDir = fixtureDirFromEnv();
  if (fixtureDir) {
    return readFileSync(join(fixtureDir, DEFAULT_FIXTURE_NAME), "utf8");
  }
  return fetchBody(CENTCOM_SOURCE_URL, FETCH_TIMEOUT_MS);
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
  return fetchBody(item.sourceUrl, FETCH_TIMEOUT_MS);
}

function buildInsertRow(release: PreparedRelease): InsertOfficialMilitaryMaritimeSource {
  const routed = routeOfficialSource({
    source: CENTCOM_SOURCE,
    title: release.title,
    body: release.bodyText,
  });
  const flags = assignAnalystFlags({
    source: CENTCOM_SOURCE,
    title: release.title,
    body: release.bodyText,
    hasOfficialUrl: true,
    hasPdf: false,
  });

  return {
    sourceName: CENTCOM_SOURCE,
    externalId: release.externalId,
    title: release.title,
    publishedAt: release.publishedAt,
    sourceUrl: release.sourceUrl,
    bodyText: release.bodyText,
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
    const listingHtml = await loadListingHtml(opts);
    let listing = parseCentcomListing(listingHtml, CENTCOM_SITE_ORIGIN);

    if (opts.externalIds?.length) {
      const allow = new Set(opts.externalIds);
      listing = listing.filter((item) => allow.has(item.externalId));
    }
    if (opts.maxItems != null && opts.maxItems >= 0) {
      listing = listing.slice(0, opts.maxItems);
    }

    base.itemsFetched = listing.length;
    log(`  parsed ${listing.length} listing item(s)`);

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
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`detail ${item.externalId}: ${msg}`);
        log(`  detail ERROR ${item.externalId}: ${msg}`);
      }
    }

    log(`  prepared ${prepared.length} release(s) for persist`);

    let toInsert = prepared;
    if (prepared.length > 0) {
      const ids = prepared.map((r) => r.externalId);
      const urls = prepared.map((r) => r.sourceUrl);

      const existingById = await db
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

      const existingByUrl = await db
        .select({
          sourceUrl: officialMilitaryMaritimeSourcesTable.sourceUrl,
        })
        .from(officialMilitaryMaritimeSourcesTable)
        .where(
          and(
            eq(officialMilitaryMaritimeSourcesTable.sourceName, CENTCOM_SOURCE),
            inArray(officialMilitaryMaritimeSourcesTable.sourceUrl, urls),
          ),
        );

      const haveIds = new Set(existingById.map((r) => r.externalId));
      const haveUrls = new Set(existingByUrl.map((r) => r.sourceUrl));
      toInsert = prepared.filter(
        (r) => !haveIds.has(r.externalId) && !haveUrls.has(r.sourceUrl),
      );
    }

    base.duplicateInDb = prepared.length - toInsert.length;
    log(
      `  ${prepared.length} release(s); ${base.duplicateInDb} duplicate(s); ${toInsert.length} new`,
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
      await recordSourceHealth(
        CENTCOM_HEALTH_TOPIC,
        [
          {
            name: CENTCOM_HEALTH_NAME,
            url: CENTCOM_SOURCE_URL,
            ok: true,
            collected: prepared.length,
            retained: base.inserted,
            rejected: prepared.length - toInsert.length,
          },
        ],
        {
          sourceType: "html",
          scrapeMethod: "HTML listing + detail",
          notes: CENTCOM_HEALTH_NOTES,
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
