import {
  db,
  gdeltStructuredItemsTable,
  incidentsTable,
  officialMilitaryMaritimeSourcesTable,
} from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";

// M1.5 cross-source dedupe — official-table URL/id dedupe plus news-echo skip when
// the same canonical URL already exists in the news/incidents pipeline.

export type OfficialPreparedItem = {
  externalId: string;
  sourceUrl: string;
};

export type OfficialInsertPartition<T extends OfficialPreparedItem> = {
  toInsert: T[];
  duplicateInDb: number;
  newsEchoSkipped: number;
};

/** Normalise a URL for equality matching (scheme, www, query, trailing slash). */
export function normalizeOfficialSourceUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let s = url.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/\/+$/, "");
  return s || null;
}

/** Raw URL variants worth probing in SQL IN clauses. */
export function expandOfficialSourceUrlVariants(url: string): string[] {
  const trimmed = url.trim();
  const norm = normalizeOfficialSourceUrl(trimmed);
  const variants = new Set<string>();
  if (trimmed) variants.add(trimmed);
  if (!norm) return [...variants];

  variants.add(norm);
  variants.add(`https://${norm}`);
  variants.add(`http://${norm}`);
  variants.add(`https://www.${norm}`);
  variants.add(`http://www.${norm}`);
  if (trimmed.endsWith("/")) {
    variants.add(trimmed.replace(/\/+$/, ""));
  } else {
    variants.add(`${trimmed}/`);
  }
  return [...variants];
}

function collectNormalizedUrls(
  rows: Array<{ sourceUrl?: string | null; resolvedUrl?: string | null; url?: string | null; primaryStoryUrl?: string | null }>,
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    for (const raw of [row.sourceUrl, row.resolvedUrl, row.url, row.primaryStoryUrl]) {
      const norm = normalizeOfficialSourceUrl(raw);
      if (norm) out.add(norm);
    }
  }
  return out;
}

/**
 * Return normalized URLs already present in incidents / GDELT structured news tables.
 */
export async function lookupNewsEchoNormalizedUrls(
  candidateUrls: string[],
): Promise<Set<string>> {
  const variants = [
    ...new Set(candidateUrls.flatMap((url) => expandOfficialSourceUrlVariants(url))),
  ];
  if (variants.length === 0) return new Set();

  const [incidentRows, gdeltRows] = await Promise.all([
    db
      .select({
        sourceUrl: incidentsTable.sourceUrl,
        resolvedUrl: incidentsTable.resolvedUrl,
      })
      .from(incidentsTable)
      .where(
        or(
          inArray(incidentsTable.sourceUrl, variants),
          inArray(incidentsTable.resolvedUrl, variants),
        ),
      ),
    db
      .select({
        url: gdeltStructuredItemsTable.url,
        primaryStoryUrl: gdeltStructuredItemsTable.primaryStoryUrl,
      })
      .from(gdeltStructuredItemsTable)
      .where(
        or(
          inArray(gdeltStructuredItemsTable.url, variants),
          inArray(gdeltStructuredItemsTable.primaryStoryUrl, variants),
        ),
      ),
  ]);

  return new Set([
    ...collectNormalizedUrls(incidentRows),
    ...collectNormalizedUrls(gdeltRows),
  ]);
}

/**
 * Partition prepared official items into inserts vs official-table duplicates vs
 * news echoes. Does not include prefetch listing skips (add those separately).
 */
export async function partitionOfficialInserts<T extends OfficialPreparedItem>(
  items: T[],
  sourceName: string,
  opts?: {
    lookupNewsEcho?: (urls: string[]) => Promise<Set<string>>;
  },
): Promise<OfficialInsertPartition<T>> {
  if (items.length === 0) {
    return { toInsert: [], duplicateInDb: 0, newsEchoSkipped: 0 };
  }

  const ids = items.map((r) => r.externalId);
  const urlVariants = [
    ...new Set(items.flatMap((r) => expandOfficialSourceUrlVariants(r.sourceUrl))),
  ];

  const [existingById, existingByUrl] = await Promise.all([
    db
      .select({
        externalId: officialMilitaryMaritimeSourcesTable.externalId,
      })
      .from(officialMilitaryMaritimeSourcesTable)
      .where(
        and(
          eq(officialMilitaryMaritimeSourcesTable.sourceName, sourceName),
          inArray(officialMilitaryMaritimeSourcesTable.externalId, ids),
        ),
      ),
    db
      .select({
        sourceUrl: officialMilitaryMaritimeSourcesTable.sourceUrl,
      })
      .from(officialMilitaryMaritimeSourcesTable)
      .where(
        and(
          eq(officialMilitaryMaritimeSourcesTable.sourceName, sourceName),
          inArray(officialMilitaryMaritimeSourcesTable.sourceUrl, urlVariants),
        ),
      ),
  ]);

  const haveIds = new Set(existingById.map((r) => r.externalId));
  const haveNormUrls = collectNormalizedUrls(
    existingByUrl.map((r) => ({ sourceUrl: r.sourceUrl })),
  );

  const afterOfficial: T[] = [];
  let duplicateInDb = 0;
  for (const item of items) {
    const norm = normalizeOfficialSourceUrl(item.sourceUrl);
    if (haveIds.has(item.externalId) || (norm != null && haveNormUrls.has(norm))) {
      duplicateInDb += 1;
      continue;
    }
    afterOfficial.push(item);
  }

  const lookupNewsEcho = opts?.lookupNewsEcho ?? lookupNewsEchoNormalizedUrls;
  const newsEcho = await lookupNewsEcho(afterOfficial.map((item) => item.sourceUrl));

  const toInsert: T[] = [];
  let newsEchoSkipped = 0;
  for (const item of afterOfficial) {
    const norm = normalizeOfficialSourceUrl(item.sourceUrl);
    if (norm != null && newsEcho.has(norm)) {
      newsEchoSkipped += 1;
      continue;
    }
    toInsert.push(item);
  }

  return { toInsert, duplicateInDb, newsEchoSkipped };
}
