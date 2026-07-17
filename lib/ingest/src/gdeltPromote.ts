import { db, incidentsTable, gdeltStructuredItemsTable } from "@workspace/db";
import type { InsertIncident, GdeltStructuredItem } from "@workspace/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  classifySeverity,
  maxSeverity,
  severityFromFatalities,
  type SeverityTopic,
} from "./severity";
import { geocode } from "./geocode";
import {
  RELEVANCE_RULE_VERSION,
  hitsSlopExclude,
  type RelevanceStatus,
} from "@workspace/relevance";
import { recordSourceHealth } from "./sourceHealth";
import { PROMOTE_MARKER_PREFIX, promoteMarker, markerExternalId } from "./markers";

// GDELT Cloud structured-event → incident PROMOTE pass.
//
// HISTORICAL RULE (now REVERSED): the GDELT Cloud structured layer used to be
// hard-isolated — its rows could NEVER become incidents. The owner has since
// revoked that invariant: GDELT-coded events must feed the real incident
// pipeline so they surface in the flashpoint/conflict monitors and the country
// geography reports. This pass is that bridge.
//
// It is a pure DB→DB transform over the LOCAL gdelt_structured_items table, so
// it costs ZERO GDELT query-units (the structured ingest already paid for the
// fetch). Only kind='event' rows with a tracked `lane` promote; stories
// (lane=null) never do. Each promoted incident is stamped with an idempotency
// marker in analyst_notes ("gdelt_cloud:<externalId>") so re-runs never
// double-insert.
//
// It deliberately does NOT close the shared DB pool — see runNewsTopicIngest.

// The four in-scope countries the structured layer tracks. A GDELT event filed
// under any other country (a foreign dateline that slipped GDELT's geo coding)
// is skipped — we never promote out-of-region rows into the incident pipeline.
export const IN_SCOPE_COUNTRIES = new Set<string>([
  "Indonesia",
  "Philippines",
  "Thailand",
  "Papua New Guinea",
]);

// Lane → incident promotion. Protests and civil unrest are flashpoint unrest
// (relevant, so they surface in the Protests & Civil Unrest monitor). Security
// incidents are conflict (relevant). Crime and transport disruption are stored
// as geography-only CONTEXT: relevance='irrelevant' keeps them OUT of the
// flashpoint monitor (which filters on relevance) while the country reports —
// which read includeIrrelevant and apply their own isCountryRelevant gate —
// still surface them in the geography picture. No fabrication: the lane is
// GDELT's own coding, and the relevanceReason records exactly that.
export type LanePromotion = {
  topic: SeverityTopic;
  status: RelevanceStatus;
  score: number;
};

const PROMOTE_LANE_MAP: Record<string, LanePromotion> = {
  Protests: { topic: "flashpoint", status: "relevant", score: 1 },
  "Civil unrest and riots": { topic: "flashpoint", status: "relevant", score: 1 },
  "Security incidents": { topic: "conflict", status: "relevant", score: 1 },
  Crime: { topic: "flashpoint", status: "irrelevant", score: 0 },
  "Transport disruption": { topic: "flashpoint", status: "irrelevant", score: 0 },
};

/** The promotion mapping for a lane, or null if the lane is not promotable. */
export function promotionForLane(lane: string | null | undefined): LanePromotion | null {
  if (!lane) return null;
  return PROMOTE_LANE_MAP[lane] ?? null;
}

// The stored country for a promoted row. Indonesian-Papua events are re-homed
// to "West Papua" (a valid geocode centroid key and the country tag the West
// Papua brief reads), mirroring how the rest of the pipeline treats the
// province as a distinct theatre. Jakarta stays "Indonesia" (the Jakarta city
// brief is served from the Indonesia country tag). Every other in-scope country
// is stored verbatim.
export function resolvePromoteCountry(
  gdeltCountry: string | null | undefined,
  subBucket: string | null | undefined,
): string | null {
  const c = (gdeltCountry ?? "").trim();
  if (!c) return null;
  if (c === "Indonesia" && subBucket === "Indonesian Papua") return "West Papua";
  return c;
}

// Idempotency-marker helpers now live in the pure, dependency-free ./markers
// module so browser/client code can import markerExternalId without pulling the
// db/drizzle ingest barrel into the client bundle ("Buffer is not defined").
// Re-exported here so existing consumers and the @workspace/ingest barrel keep
// working unchanged.
export { PROMOTE_MARKER_PREFIX, promoteMarker, markerExternalId };

// Same fuzzy dedupe key the news-topic ingest uses, so a GDELT event that
// duplicates an already-scraped news incident (same headline, day, country,
// topic) is collapsed rather than double-counted. Mirrors dedupeKey in
// newsTopic.ts — keep the formula identical.
export function gdeltDedupeKey(
  title: string,
  when: Date,
  country: string,
  topic: string,
): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    topic,
  ].join("||");
}

function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

// Compact "Actor1 / Actor2" string from GDELT's actors[] jsonb block, matching
// the incidents.actors free-text column the rest of the pipeline uses. GDELT's
// actor objects are untrusted external data, so every field access is defensive.
function actorName(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const name = (a as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function actorRole(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const role = (a as { role?: unknown }).role;
  return typeof role === "string" ? role.toLowerCase() : null;
}

export function deriveActors(actors: unknown[] | null | undefined): string | null {
  if (!Array.isArray(actors) || actors.length === 0) return null;
  const byRole = (role: string) =>
    actorName(actors.find((a) => actorRole(a) === role));
  const primary = byRole("actor1") ?? byRole("source");
  const secondary = byRole("actor2") ?? byRole("target");
  const names: string[] = [];
  if (primary) names.push(primary);
  if (secondary && secondary !== primary) names.push(secondary);
  const hasRoleMatch = names.length > 0;
  if (!hasRoleMatch) {
    for (const a of actors) {
      const n = actorName(a);
      if (n && !names.includes(n)) {
        names.push(n);
        if (names.length === 2) break;
      }
    }
  }
  if (names.length === 0) return null;
  return names.join(" / ").slice(0, 300);
}

// The fields of a gdelt_structured_items row this pass needs. Kept as a subset
// so unit tests can build lightweight fixtures without the full row.
export type GdeltPromoteInput = Pick<
  GdeltStructuredItem,
  | "kind"
  | "externalId"
  | "lane"
  | "subBucket"
  | "country"
  | "location"
  | "latitude"
  | "longitude"
  | "sourceDate"
  | "title"
  | "summary"
  | "url"
  | "primaryStoryUrl"
  | "fatalities"
  | "actors"
>;

export type PromoteDecision =
  | { promote: true; topic: SeverityTopic; lane: string; row: InsertIncident }
  | {
      promote: false;
      reason: "not-event" | "unmapped-lane" | "no-date" | "out-of-scope";
    };

/**
 * Decide whether one structured item promotes into an incident, and if so build
 * the exact InsertIncident row. Pure and side-effect free (bar `new Date()` for
 * the evaluation timestamp) so the whole mapping is unit-testable without a DB.
 */
export function decidePromotion(item: GdeltPromoteInput): PromoteDecision {
  if (item.kind !== "event") return { promote: false, reason: "not-event" };

  const mapping = promotionForLane(item.lane);
  if (!item.lane || !mapping) return { promote: false, reason: "unmapped-lane" };

  if (!item.sourceDate) return { promote: false, reason: "no-date" };

  const gdeltCountry = (item.country ?? "").trim();
  if (!IN_SCOPE_COUNTRIES.has(gdeltCountry)) {
    return { promote: false, reason: "out-of-scope" };
  }
  const storedCountry = resolvePromoteCountry(gdeltCountry, item.subBucket);
  if (!storedCountry) return { promote: false, reason: "out-of-scope" };

  const occurredAt =
    item.sourceDate instanceof Date ? item.sourceDate : new Date(item.sourceDate);

  const title = (item.title ?? "").trim().slice(0, 500);
  const summary = ((item.summary ?? "").trim() || title).slice(0, 2000);

  // GDELT ships precise lat/lng per event; use them directly and fall back to
  // the country centroid only when GDELT gave no coordinates.
  const geo = geocode(storedCountry, `${title} ${summary}`);
  const latitude = item.latitude ?? geo?.latitude ?? null;
  const longitude = item.longitude ?? geo?.longitude ?? null;

  const severity = maxSeverity(
    classifySeverity(title, summary, mapping.topic),
    severityFromFatalities(item.fatalities ?? undefined) ?? "insignificant",
  );

  // Option A slop gate. Even a lane-vouched GDELT event must clear the SAME
  // noise EXCLUDE rules as scraped news (op-ed / metaphor / homonym). The lane
  // already vouches genuineness, so we deliberately do NOT re-apply the REQUIRED
  // allow gate — only hitsSlopExclude. A slop hit does NOT drop the row: it is
  // demoted to relevance='irrelevant' so it survives as geography-only context
  // (visible to country reports via includeIrrelevant) but is hidden from the
  // flashpoint/conflict monitors.
  const slop =
    mapping.status === "relevant"
      ? hitsSlopExclude(mapping.topic, {
          topic: mapping.topic,
          title,
          summary,
          source: "GDELT Cloud",
          sourceUrl: item.primaryStoryUrl ?? item.url ?? null,
          location: item.location ?? null,
        })
      : { relevant: true, reason: "" };
  const relevanceStatus: RelevanceStatus = slop.relevant
    ? mapping.status
    : "irrelevant";
  const relevanceScore = slop.relevant ? mapping.score : 0;
  const relevanceReason = slop.relevant
    ? `gdelt lane: ${item.lane}`
    : `gdelt lane: ${item.lane} — slop-gated (${slop.reason})`;

  const row: InsertIncident = {
    topic: mapping.topic,
    title,
    summary,
    country: storedCountry,
    location: item.location ?? geo?.location ?? null,
    latitude,
    longitude,
    occurredAt,
    severity,
    confidence: "low",
    source: "GDELT Cloud",
    sourceUrl: item.primaryStoryUrl ?? item.url ?? null,
    category: item.lane,
    fatalities: item.fatalities ?? null,
    actors: deriveActors(item.actors),
    analystNotes: promoteMarker(item.externalId),
    relevanceStatus,
    relevanceScore,
    relevanceReason,
    relevanceVersion: RELEVANCE_RULE_VERSION,
    relevanceEvaluatedAt: new Date(),
  };

  return { promote: true, topic: mapping.topic, lane: item.lane, row };
}

export type GdeltPromoteSummary = {
  mode: "commit" | "dry-run";
  /** Lane-bearing events read from the structured table. */
  eventsConsidered: number;
  /** Events that mapped, were in-scope and dated (promotable candidates). */
  promotable: number;
  skippedNotEvent: number;
  skippedUnmappedLane: number;
  skippedNoDate: number;
  skippedOutOfScope: number;
  /** Already-promoted (idempotency marker present) — skipped. */
  duplicateMarker: number;
  /** Collapsed into an existing incident by the fuzzy dedupe key. */
  duplicateKey: number;
  /** Collapsed by matching an existing incident source/resolved URL. */
  duplicateUrl: number;
  newToInsert: number;
  inserted: number;
  byTopic: Array<[string, number]>;
  byLane: Array<[string, number]>;
  /** Total GDELT-promoted incidents in the table after this run (commit only). */
  totalAfter: number | null;
  errors: string[];
  logLines: string[];
};

export function emptyGdeltPromoteSummary(): GdeltPromoteSummary {
  return {
    mode: "commit",
    eventsConsidered: 0,
    promotable: 0,
    skippedNotEvent: 0,
    skippedUnmappedLane: 0,
    skippedNoDate: 0,
    skippedOutOfScope: 0,
    duplicateMarker: 0,
    duplicateKey: 0,
    duplicateUrl: 0,
    newToInsert: 0,
    inserted: 0,
    byTopic: [],
    byLane: [],
    totalAfter: null,
    errors: [],
    logLines: [],
  };
}

/**
 * Promote GDELT Cloud structured EVENTS into incidents. Reads the local
 * gdelt_structured_items table (0 QU), builds incident rows per lane, dedupes
 * against existing incidents (idempotency marker + fuzzy key + URL) and inserts
 * the new ones. Returns a structured summary. Does NOT close the shared pool.
 */
export async function runGdeltPromote(
  opts: { commit?: boolean } = {},
): Promise<GdeltPromoteSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);

  log(`gdelt-promote — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const events = await db
    .select()
    .from(gdeltStructuredItemsTable)
    .where(
      and(
        eq(gdeltStructuredItemsTable.kind, "event"),
        isNotNull(gdeltStructuredItemsTable.lane),
      ),
    );

  let skippedNotEvent = 0;
  let skippedUnmappedLane = 0;
  let skippedNoDate = 0;
  let skippedOutOfScope = 0;
  const decided: Array<{ topic: SeverityTopic; lane: string; row: InsertIncident; externalId: string }> = [];
  for (const ev of events) {
    const d = decidePromotion(ev);
    if (!d.promote) {
      if (d.reason === "not-event") skippedNotEvent++;
      else if (d.reason === "unmapped-lane") skippedUnmappedLane++;
      else if (d.reason === "no-date") skippedNoDate++;
      else skippedOutOfScope++;
      continue;
    }
    decided.push({ topic: d.topic, lane: d.lane, row: d.row, externalId: ev.externalId });
  }

  // Dedupe against existing incidents: idempotency marker (re-runs), fuzzy key
  // (a scraped news row for the same event), and URL.
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
    const eid = markerExternalId(row.analystNotes);
    if (eid) seenMarkers.add(eid);
    existingKeys.add(gdeltDedupeKey(row.title, row.occurredAt, row.country, row.topic));
    if (row.sourceUrl) existingUrls.add(normaliseUrl(row.sourceUrl));
    if (row.resolvedUrl) existingUrls.add(normaliseUrl(row.resolvedUrl));
  }

  let duplicateMarker = 0;
  let duplicateKey = 0;
  let duplicateUrl = 0;
  const toInsert: InsertIncident[] = [];
  const byTopic = new Map<string, number>();
  const byLane = new Map<string, number>();
  for (const d of decided) {
    if (seenMarkers.has(d.externalId)) {
      duplicateMarker++;
      continue;
    }
    const key = gdeltDedupeKey(
      d.row.title,
      d.row.occurredAt as Date,
      d.row.country,
      d.row.topic,
    );
    if (existingKeys.has(key)) {
      duplicateKey++;
      continue;
    }
    const url = d.row.sourceUrl ? normaliseUrl(d.row.sourceUrl) : null;
    if (url && existingUrls.has(url)) {
      duplicateUrl++;
      continue;
    }
    toInsert.push(d.row);
    // Grow the guard sets so two structured events describing the same incident
    // in one run cannot both insert.
    seenMarkers.add(d.externalId);
    existingKeys.add(key);
    if (url) existingUrls.add(url);
    byTopic.set(d.topic, (byTopic.get(d.topic) ?? 0) + 1);
    byLane.set(d.lane, (byLane.get(d.lane) ?? 0) + 1);
  }

  log(`  events (lane-bearing) : ${events.length}`);
  log(`  promotable            : ${decided.length}`);
  log(`  out-of-scope          : ${skippedOutOfScope}`);
  log(`  no-date               : ${skippedNoDate}`);
  log(`  already promoted      : ${duplicateMarker}`);
  log(`  dupe (key)            : ${duplicateKey}`);
  log(`  dupe (url)            : ${duplicateUrl}`);
  log(`  new to insert         : ${toInsert.length}`);

  let inserted = 0;
  let totalAfter: number | null = null;
  if (commit && toInsert.length > 0) {
    try {
      await db.insert(incidentsTable).values(toInsert);
      inserted = toInsert.length;
      log(`  inserted              : ${inserted}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      log(`  INSERT FAILED         : ${msg}`);
    }
  } else if (!commit) {
    log("  DRY-RUN — no rows written. Re-run with commit to insert.");
  }

  if (commit) {
    const res = await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM incidents WHERE analyst_notes LIKE ${
        PROMOTE_MARKER_PREFIX + "%"
      }`,
    );
    totalAfter = (res.rows[0] as { count: number } | undefined)?.count ?? null;

    // Record the pass in Source Health. It is a derived internal transform (no
    // external fetch), so the URL is GDELT Cloud's home and the method names it
    // as an internal pass — never presented as a live feed.
    if (errors.length === 0) {
      await recordSourceHealth(
        "flashpoint",
        [
          {
            name: "GDELT Cloud — promoted events",
            url: "https://gdeltcloud.com",
            ok: true,
            collected: events.length,
            retained: inserted,
            rejected:
              skippedOutOfScope + skippedNoDate + duplicateMarker + duplicateKey + duplicateUrl,
          },
        ],
        {
          sourceType: "derived",
          reliability: 3,
          notes:
            "GDELT Cloud structured events promoted into flashpoint/conflict incidents. Crime and transport lanes are stored relevance='irrelevant' (geography-only context).",
          scrapeMethod: "Internal promote pass",
        },
      );
    }
  }

  return {
    mode: commit ? "commit" : "dry-run",
    eventsConsidered: events.length,
    promotable: decided.length,
    skippedNotEvent,
    skippedUnmappedLane,
    skippedNoDate,
    skippedOutOfScope,
    duplicateMarker,
    duplicateKey,
    duplicateUrl,
    newToInsert: toInsert.length,
    inserted,
    byTopic: [...byTopic.entries()].sort((a, b) => b[1] - a[1]),
    byLane: [...byLane.entries()].sort((a, b) => b[1] - a[1]),
    totalAfter,
    errors,
    logLines,
  };
}
