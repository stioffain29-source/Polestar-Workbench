// Social OSINT → incidents promote pass (DB → DB).
//
// Mirrors gdeltPromote.ts: a free, DB-only pass that turns already-collected
// `social_raw` rows (the isolated OSINT context table fed by BOTH Apify
// importers — Facebook `facebook_osint` and Instagram `instagram_kammi`) into
// real incidents, WITHOUT any external fetch or attacker-controlled trigger. It
// runs only from the CLI importers and the standalone `promote:social` script
// (never a user-facing route). The gated, single-row promote route
// (routes/socialRaw.ts) is UNCHANGED and still available for manual promotion.
//
// Eligibility is RE-DERIVED here from the stored row via the SAME pure
// deriveEligibility used at collection + the manual route — a client claim is
// never trusted. One deliberate enhancement over the collection-time flags:
// the pass RE-RUNS the soft cross-feed corroboration scorer LIVE against the
// current incidents, so a row the collector stamped non-credible (every
// Instagram/KAMMI row is hard-stamped credible=false/promotable=false in
// instagramKammi.ts) can promote ONLY once a real news incident now
// corroborates it. Rows with no declared credible source, no linked credible
// domain, and no live corroboration stay context-only, exactly as before.
//
// Idempotent on two axes: it selects only rows whose `promoted_incident_id` is
// still NULL, and it stamps each minted incident with a parseable marker
// (`social_raw:<id> …`) so a second run recognises an already-promoted row even
// if its back-link were cleared. The back-link UPDATE is guarded by
// `promoted_incident_id IS NULL` inside the insert transaction, so two
// concurrent passes can never double-count a row.

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  incidentsTable,
  socialRawTable,
  type InsertIncident,
  type SocialRawItem,
} from "@workspace/db";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { classifySeverity, type SeverityTopic } from "./severity";
import type { IncidentCategory } from "./structuredExtract";
import {
  categoryToTopic,
  deriveEligibility,
  normaliseSourceTier,
  pickCorroboration,
  pickDuplicate,
  type IncidentCandidate,
} from "./facebookOsintEligibility";

// ---------------------------------------------------------------------------
// Idempotency marker (incident-side)
// ---------------------------------------------------------------------------
// The primary idempotency guard is the `promoted_incident_id` back-link on the
// source row; this marker is a secondary, incident-side guard + audit trail so
// a promoted row is still recognised if its back-link is ever cleared. Kept as
// the LEADING token so it parses out of the human-readable credibility note.
export const SOCIAL_PROMOTE_MARKER_PREFIX = "social_raw:";

export function socialPromoteMarker(
  id: number,
  opts: { platformLabel: string; pageHandle: string; credibilityReason: string | null },
): string {
  return `${SOCIAL_PROMOTE_MARKER_PREFIX}${id} — Promoted from ${opts.platformLabel} OSINT (${opts.pageHandle}). Credibility: ${
    opts.credibilityReason ?? "n/a"
  }.`;
}

export function markerSocialRawId(
  analystNotes: string | null | undefined,
): number | null {
  if (!analystNotes) return null;
  const m = /^social_raw:(\d+)\b/.exec(analystNotes.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Incident title / summary builders (shared with the manual promote route)
// ---------------------------------------------------------------------------
// Extracted verbatim from routes/socialRaw.ts so the route and this pass mint
// byte-identical incident text from the same stored row. The route imports
// these instead of re-defining them.
export function buildSocialIncidentTitle(
  item: {
    location: string | null;
    province: string | null;
    country: string;
  },
  category: IncidentCategory,
): string {
  const where = item.location || item.province || item.country;
  return `${category} — ${where}`;
}

export function buildSocialIncidentSummary(item: {
  caption: string | null;
  location: string | null;
  province: string | null;
  country: string;
  businessImpact: string | null;
}): string {
  const parts: string[] = [];
  const where = item.location || item.province || item.country;
  if (item.caption) {
    const trimmed = item.caption.replace(/\s+/g, " ").trim().slice(0, 400);
    if (trimmed) parts.push(trimmed);
  }
  if (parts.length === 0) parts.push(`Security incident reported at ${where}.`);
  if (item.businessImpact) parts.push(item.businessImpact);
  return parts.join(" ");
}

function platformLabelFor(platform: string | null | undefined): string {
  if (platform === "instagram") return "Instagram";
  if (platform === "facebook") return "Facebook";
  return "Social";
}

// ---------------------------------------------------------------------------
// Pure decision (given the candidate incidents)
// ---------------------------------------------------------------------------
export type SocialPromoteInput = Pick<
  SocialRawItem,
  | "id"
  | "sourceName"
  | "platform"
  | "pageHandle"
  | "pageName"
  | "sourceTier"
  | "category"
  | "detectedCredibleDomains"
  | "corroborated"
  | "corroborationReason"
  | "country"
  | "province"
  | "location"
  | "caption"
  | "businessImpact"
  | "incidentDate"
  | "postedAt"
  | "createdAt"
  | "url"
>;

export type SocialPromoteDecision =
  | {
      promote: true;
      topic: "flashpoint" | "conflict";
      socialRawId: number;
      credibilityReason: string | null;
      row: InsertIncident;
    }
  | {
      promote: false;
      reason: "not-security" | "not-credible" | "duplicate";
      duplicateOf?: number;
    };

/**
 * Decide whether a single social_raw row should become an incident, RE-DERIVING
 * eligibility from the stored row and re-running the live corroboration +
 * duplicate scorers against the supplied candidate incidents. Pure given
 * `candidates` (no DB access) so it can be unit-tested with fixtures.
 */
export function decideSocialPromotion(
  item: SocialPromoteInput,
  candidates: readonly IncidentCandidate[],
): SocialPromoteDecision {
  const category = (item.category ?? "Other security") as IncidentCategory;
  const postDate =
    item.incidentDate ?? item.postedAt ?? item.createdAt ?? new Date();

  const post = {
    text: `${item.caption ?? ""} ${item.location ?? ""}`.trim(),
    country: item.country,
    province: item.province,
    category,
    date: postDate,
  };

  // Live corroboration re-run: a soft cross-feed match that UPGRADES
  // credibility (never blocks). This is the ONLY path by which a collector-
  // stamped non-credible row (all Instagram/KAMMI rows) can become promotable —
  // a real news incident must now support it.
  const liveCorr = pickCorroboration(post, candidates);
  const corroborated = item.corroborated || liveCorr !== null;
  const corroborationReason = liveCorr?.reason ?? item.corroborationReason ?? null;

  const elig = deriveEligibility({
    category,
    sourceTier: normaliseSourceTier(item.sourceTier),
    credibleDomainLabels: item.detectedCredibleDomains ?? [],
    corroborated,
    corroborationReason,
  });
  if (!elig.securityRelevant) return { promote: false, reason: "not-security" };
  if (!elig.promotable) return { promote: false, reason: "not-credible" };

  const topic = categoryToTopic(category);

  // Duplicate-block against live incidents so a promote can never double-count
  // an event already tracked.
  const dup = pickDuplicate(post, candidates);
  if (dup) {
    return { promote: false, reason: "duplicate", duplicateOf: dup.incident.id };
  }

  const title = buildSocialIncidentTitle(item, category);
  const summary = buildSocialIncidentSummary(item);
  const severity = classifySeverity(title, summary, topic as SeverityTopic);
  const platformLabel = platformLabelFor(item.platform);
  const sourceLabel = `${item.pageName ?? item.pageHandle} (${platformLabel} OSINT)`;
  const sourceUrl = item.url;

  const rel = evaluateIncidentRelevance(topic, {
    topic,
    title,
    summary,
    source: sourceLabel,
    sourceUrl,
    location: item.location ?? null,
  });

  const row: InsertIncident = {
    topic,
    title,
    summary,
    country: item.country,
    province: item.province,
    category,
    businessImpact: item.businessImpact,
    location: item.location,
    occurredAt: postDate,
    incidentDate: item.incidentDate,
    severity,
    confidence: "low",
    source: sourceLabel,
    sourceUrl,
    analystNotes: socialPromoteMarker(item.id, {
      platformLabel,
      pageHandle: item.pageHandle,
      credibilityReason: elig.credibilityReason,
    }),
    relevanceStatus: rel.status,
    relevanceScore: rel.score,
    relevanceReason: rel.reason,
    relevanceVersion: rel.version,
    relevanceEvaluatedAt: new Date(),
  };

  return {
    promote: true,
    topic,
    socialRawId: item.id,
    credibilityReason: elig.credibilityReason,
    row,
  };
}

// ---------------------------------------------------------------------------
// Runner (DB → DB)
// ---------------------------------------------------------------------------
export interface SocialPromoteSummary {
  mode: "commit" | "dry-run";
  unpromotedConsidered: number;
  skippedAlreadyPromoted: number;
  skippedNotSecurity: number;
  skippedNotCredible: number;
  skippedDuplicate: number;
  newToInsert: number;
  inserted: number;
  byTopic: Array<[string, number]>;
  bySource: Array<[string, number]>;
  totalAfter: number | null;
  // Audit trail of each incident this run actually minted (commit only): the
  // new incident id, its source social_raw id, the routed topic, and the
  // parseable analyst-notes marker. Lets a monitor name exactly what was
  // created without a full DB dump. Empty on dry-run or when nothing promoted.
  minted: Array<{
    incidentId: number;
    socialRawId: number;
    topic: string;
    marker: string;
  }>;
  errors: string[];
  logLines: string[];
}

export function emptySocialPromoteSummary(
  mode: "commit" | "dry-run",
): SocialPromoteSummary {
  return {
    mode,
    unpromotedConsidered: 0,
    skippedAlreadyPromoted: 0,
    skippedNotSecurity: 0,
    skippedNotCredible: 0,
    skippedDuplicate: 0,
    newToInsert: 0,
    inserted: 0,
    byTopic: [],
    bySource: [],
    totalAfter: null,
    minted: [],
    errors: [],
    logLines: [],
  };
}

// Thrown when the guarded back-link UPDATE matches 0 rows (another pass claimed
// the same source row first). Rolls the transaction back so no incident leaks.
class AlreadyPromotedError extends Error {}

/**
 * Promote every eligible, not-yet-promoted `social_raw` row into an incident.
 * DB-only: no external fetch, no request input. Dry-run by default; pass
 * `{ commit: true }` to write. NEVER closes the shared pool (the caller owns
 * the pool lifecycle).
 */
export async function runSocialPromote(
  opts: { commit?: boolean; log?: (s: string) => void } = {},
): Promise<SocialPromoteSummary> {
  const commit = opts.commit ?? false;
  const summary = emptySocialPromoteSummary(commit ? "commit" : "dry-run");
  const log = (s: string) => {
    summary.logLines.push(s);
    opts.log?.(s);
  };

  log(`social-promote — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  // Source rows still awaiting promotion.
  const rows = await db
    .select()
    .from(socialRawTable)
    .where(isNull(socialRawTable.promotedIncidentId));
  summary.unpromotedConsidered = rows.length;

  // Candidate incidents, gathered ONCE and grouped by country. The matching
  // scorers gate on same-country, so grouping keeps the per-row work small.
  const incs = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
      province: incidentsTable.province,
      category: incidentsTable.category,
      occurredAt: incidentsTable.occurredAt,
      incidentDate: incidentsTable.incidentDate,
      analystNotes: incidentsTable.analystNotes,
    })
    .from(incidentsTable);

  const byCountry = new Map<string, IncidentCandidate[]>();
  const alreadyPromotedIds = new Set<number>();
  for (const inc of incs) {
    const key = inc.country.trim().toLowerCase();
    let bucket = byCountry.get(key);
    if (!bucket) {
      bucket = [];
      byCountry.set(key, bucket);
    }
    bucket.push({
      id: inc.id,
      title: inc.title,
      summary: inc.summary,
      country: inc.country,
      province: inc.province,
      category: inc.category,
      occurredAt: inc.occurredAt,
      incidentDate: inc.incidentDate,
    });
    const sid = markerSocialRawId(inc.analystNotes);
    if (sid !== null) alreadyPromotedIds.add(sid);
  }

  const byTopic = new Map<string, number>();
  const bySource = new Map<string, number>();
  const toInsert: Array<{ item: SocialRawItem; decision: SocialPromoteDecision & { promote: true } }> = [];

  for (const item of rows) {
    // Secondary idempotency guard: a marker already exists for this row.
    if (alreadyPromotedIds.has(item.id)) {
      summary.skippedAlreadyPromoted++;
      continue;
    }
    const key = item.country.trim().toLowerCase();
    const candidates = byCountry.get(key) ?? [];
    const decision = decideSocialPromotion(item, candidates);
    if (!decision.promote) {
      if (decision.reason === "not-security") summary.skippedNotSecurity++;
      else if (decision.reason === "not-credible") summary.skippedNotCredible++;
      else summary.skippedDuplicate++;
      continue;
    }
    toInsert.push({ item, decision });
    byTopic.set(decision.topic, (byTopic.get(decision.topic) ?? 0) + 1);
    bySource.set(item.sourceName, (bySource.get(item.sourceName) ?? 0) + 1);

    // Grow the candidate pool in-run so a later near-identical row dup-blocks
    // against this one instead of promoting a second copy of the same event.
    let bucket = byCountry.get(key);
    if (!bucket) {
      bucket = [];
      byCountry.set(key, bucket);
    }
    bucket.push({
      id: -item.id,
      title: decision.row.title,
      summary: (decision.row.summary as string | null) ?? null,
      country: decision.row.country,
      province: (decision.row.province as string | null) ?? null,
      category: (decision.row.category as string | null) ?? null,
      occurredAt: decision.row.occurredAt as Date,
      incidentDate: (decision.row.incidentDate as Date | null) ?? null,
    });
  }

  summary.newToInsert = toInsert.length;
  summary.byTopic = [...byTopic.entries()].sort();
  summary.bySource = [...bySource.entries()].sort();

  log(
    `  considered=${summary.unpromotedConsidered} already-promoted=${summary.skippedAlreadyPromoted} not-security=${summary.skippedNotSecurity} not-credible=${summary.skippedNotCredible} duplicate=${summary.skippedDuplicate} new=${summary.newToInsert}`,
  );

  if (commit && toInsert.length > 0) {
    for (const { item, decision } of toInsert) {
      try {
        const insertedId = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(incidentsTable)
            .values(decision.row)
            .returning({ id: incidentsTable.id });
          const claimed = await tx
            .update(socialRawTable)
            .set({
              promotedIncidentId: row!.id,
              promotedAt: new Date(),
              reviewStatus: "promoted",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(socialRawTable.id, item.id),
                isNull(socialRawTable.promotedIncidentId),
              ),
            )
            .returning({ id: socialRawTable.id });
          if (claimed.length === 0) throw new AlreadyPromotedError();
          return row!.id;
        });
        summary.inserted++;
        summary.minted.push({
          incidentId: insertedId,
          socialRawId: decision.socialRawId,
          topic: decision.topic,
          marker: (decision.row.analystNotes as string | null) ?? "",
        });
      } catch (err) {
        if (err instanceof AlreadyPromotedError) {
          summary.skippedAlreadyPromoted++;
          log(`  row #${item.id} claimed by a concurrent pass — skipped`);
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`row #${item.id}: ${msg}`);
        log(`  ERROR promoting row #${item.id}: ${msg}`);
      }
    }

    const countRes = (await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM incidents WHERE analyst_notes LIKE ${
        SOCIAL_PROMOTE_MARKER_PREFIX + "%"
      }`,
    )) as unknown as { rows: Array<{ count: number }> };
    summary.totalAfter = countRes.rows[0]?.count ?? 0;
    log(`  inserted=${summary.inserted} social-promoted-total=${summary.totalAfter}`);
    for (const m of summary.minted) {
      log(
        `  minted incident #${m.incidentId} (topic=${m.topic}, social_raw=${m.socialRawId}) — ${m.marker}`,
      );
    }
  } else if (!commit) {
    log("  DRY-RUN — re-run with --commit to write.");
  }

  return summary;
}
