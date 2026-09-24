import { Router, type IRouter } from "express";
import { db, socialRawTable, incidentsTable } from "@workspace/db";
import { and, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import {
  deriveEligibility,
  pickDuplicate,
  categoryToTopic,
  normaliseSourceTier,
  classifySeverity,
  buildSocialIncidentTitle,
  buildSocialIncidentSummary,
  resolveSocialPostDate,
  socialPromoteMaxAgeDays,
  type IncidentCandidate,
  type IncidentCategory,
  type SeverityTopic,
} from "@workspace/ingest";
import {
  ListSocialRawItemsQueryParams,
  PromoteSocialRawItemParams,
  UpdateSocialRawReviewStatusParams,
  UpdateSocialRawReviewStatusBody,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

// Facebook OSINT monitoring items for the Papua New Guinea + Indonesian Papua
// theatres, stored as supporting CONTEXT.
//
// PRODUCT RULE: `social_raw` rows are OSINT CONTEXT, not incidents — no
// incident-counting surface reads this table, so a post can never inflate a
// count on its own. Two paths turn a row into an incident, BOTH re-deriving
// eligibility server-side from the stored row (never trusting a client claim —
// security-relevant AND credible, and not a duplicate): this explicit
// POST /social-raw/{id}/promote action, and the automatic scrape-time
// promote pass (`runSocialPromote`, lib/ingest) the Apify importers run.
//
// This router (like every data router) sits behind `requireOwner` — the
// workbench is OWNER-PRIVATE via Replit Auth, so both reads and the promote
// action require the owner's signed-in session. The pre-existing admin-token
// gate on admin/ingest and source mutations is additional and unchanged.
const SOURCE_NAME = "facebook_osint";
const DEFAULT_LIMIT = 100;
// Page size for the ordered scan behind the JS-side promotable/eligible filter.
const SCAN_PAGE_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
// Candidate-gather window for the duplicate-block. Wider than the strict
// duplicate window (4 days) so pickDuplicate applies the real bar; over-fetching
// a few extra rows costs nothing and keeps the gate honest.
const DUP_QUERY_WINDOW_DAYS = 6;

// Shared public projection for list + review-status reads so the GET feed and the
// PATCH response never disagree. Deliberately omits the minimised raw payload.
const LIST_COLUMNS = {
  id: socialRawTable.id,
  sourceName: socialRawTable.sourceName,
  platform: socialRawTable.platform,
  pageHandle: socialRawTable.pageHandle,
  pageName: socialRawTable.pageName,
  sourceTier: socialRawTable.sourceTier,
  externalId: socialRawTable.externalId,
  postedAt: socialRawTable.postedAt,
  incidentDate: socialRawTable.incidentDate,
  caption: socialRawTable.caption,
  captionEn: socialRawTable.captionEn,
  imageUrls: socialRawTable.imageUrls,
  links: socialRawTable.links,
  detectedCredibleDomains: socialRawTable.detectedCredibleDomains,
  country: socialRawTable.country,
  province: socialRawTable.province,
  location: socialRawTable.location,
  category: socialRawTable.category,
  businessImpact: socialRawTable.businessImpact,
  securityRelevant: socialRawTable.securityRelevant,
  credible: socialRawTable.credible,
  credibilityReason: socialRawTable.credibilityReason,
  corroborated: socialRawTable.corroborated,
  corroborationReason: socialRawTable.corroborationReason,
  corroboratingIncidentId: socialRawTable.corroboratingIncidentId,
  promotionTopic: socialRawTable.promotionTopic,
  url: socialRawTable.url,
  pageUrl: socialRawTable.pageUrl,
  classification: socialRawTable.classification,
  promotable: socialRawTable.promotable,
  engagement: socialRawTable.engagement,
  detectedKeywords: socialRawTable.detectedKeywords,
  confidence: socialRawTable.confidence,
  reviewFlag: socialRawTable.reviewFlag,
  reviewReason: socialRawTable.reviewReason,
  reviewStatus: socialRawTable.reviewStatus,
  promotedIncidentId: socialRawTable.promotedIncidentId,
  promotedAt: socialRawTable.promotedAt,
  createdAt: socialRawTable.createdAt,
};

// The stored `promotable` flag answers "security-relevant AND credible?" only —
// it is computed at ingest, before the post-date gate exists. The server also
// refuses to promote an undated or out-of-window post, so a read that reported
// those rows as promotable would invite a click the promote route then rejects.
// Re-derive the flag here, with the SAME resolver the promote route uses, so
// every reader sees the server's actual answer instead of mirroring the window
// length client-side and drifting when it is configured differently.
function withDatePolicy<T extends { promotable: boolean; postedAt: Date | null; incidentDate: Date | null }>(
  row: T,
): T {
  if (!row.promotable) return row;
  return resolveSocialPostDate(row).kind === "ok"
    ? row
    : { ...row, promotable: false };
}

router.get("/social-raw", async (req, res): Promise<void> => {
  const parsed = ListSocialRawItemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { country, category, promotable, promoted, reviewFlagged, eligible, limit } =
    parsed.data;

  const conditions = [eq(socialRawTable.sourceName, SOURCE_NAME)];
  if (country) conditions.push(eq(socialRawTable.country, country));
  if (category) conditions.push(eq(socialRawTable.category, category));
  if (promoted !== undefined)
    conditions.push(
      promoted
        ? isNotNull(socialRawTable.promotedIncidentId)
        : isNull(socialRawTable.promotedIncidentId),
    );
  if (reviewFlagged !== undefined)
    conditions.push(eq(socialRawTable.reviewFlag, reviewFlagged));

  // `promotable` and `eligible` are filtered in JS, AFTER the date policy is
  // applied — deliberately not in SQL. The stored column answers only
  // "security-relevant AND credible", so filtering on it in SQL would put
  // date-blocked rows in the actionable queue (and let them eat the limit)
  // while the complement filter lost them entirely. Re-expressing the date gate
  // in SQL would fork the rule into a second dialect that drifts, so the
  // resolver stays the ONE authority and the scan comes to it.
  const wants = limit ?? DEFAULT_LIMIT;
  const filtersInJs = promotable !== undefined || eligible !== undefined;
  const where = conditions.length > 1 ? and(...conditions) : conditions[0];

  const scan = (take: number, skip: number) =>
    db
      .select(LIST_COLUMNS)
      .from(socialRawTable)
      .where(where)
      .orderBy(desc(socialRawTable.postedAt), desc(socialRawTable.id))
      .limit(take)
      .offset(skip);

  type ListRow = Awaited<ReturnType<typeof scan>>[number];

  const matches = (r: ListRow): boolean => {
    if (promotable !== undefined && r.promotable !== promotable) return false;
    // `eligible` = promotable AND not yet promoted (the actionable queue). When
    // false, surface the complement (not promotable OR already promoted).
    if (eligible !== undefined) {
      const isEligible = r.promotable && r.promotedIncidentId === null;
      if (isEligible !== eligible) return false;
    }
    return true;
  };

  let out: ListRow[];
  if (!filtersInJs) {
    out = (await scan(wants, 0)).map(withDatePolicy);
  } else {
    // Scan in ordered pages until the caller's limit is filled or the source's
    // rows run out, so a run of date-blocked rows can never truncate the answer
    // — a fixed scan cap would underfill the page once the table outgrew it.
    out = [];
    for (let skip = 0; out.length < wants; skip += SCAN_PAGE_SIZE) {
      const page = await scan(SCAN_PAGE_SIZE, skip);
      if (page.length === 0) break;
      out.push(...page.map(withDatePolicy).filter(matches));
      if (page.length < SCAN_PAGE_SIZE) break;
    }
    out = out.slice(0, wants);
  }

  res.json(out);
});

// Set the analyst review DECISION (Ignore / Keep-as-Context / re-open). Public
// posture, in line with the rest of the workbench. This NEVER creates or touches
// an incident — it only moves the row in or out of the actionable review queue.
// "promoted" is reserved for the promote action; a row already promoted is fixed.
router.patch("/social-raw/:id/review-status", requireAdminToken, async (req, res): Promise<void> => {
  const parsedParams = UpdateSocialRawReviewStatusParams.safeParse({
    id: req.params.id,
  });
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  const parsedBody = UpdateSocialRawReviewStatusBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const id = parsedParams.data.id;
  const reviewStatus = parsedBody.data.reviewStatus;

  const [item] = await db
    .select({
      id: socialRawTable.id,
      promotedIncidentId: socialRawTable.promotedIncidentId,
    })
    .from(socialRawTable)
    .where(eq(socialRawTable.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Facebook OSINT item not found" });
    return;
  }
  if (item.promotedIncidentId !== null) {
    res.status(409).json({
      error: "Item already promoted — its review status is fixed",
      incidentId: item.promotedIncidentId,
    });
    return;
  }

  const [updated] = await db
    .update(socialRawTable)
    .set({ reviewStatus, updatedAt: new Date() })
    .where(eq(socialRawTable.id, id))
    .returning(LIST_COLUMNS);

  res.json(updated ? withDatePolicy(updated) : updated);
});

router.post("/social-raw/:id/promote", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = PromoteSocialRawItemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = parsed.data.id;

  const [item] = await db
    .select()
    .from(socialRawTable)
    .where(eq(socialRawTable.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Facebook OSINT item not found" });
    return;
  }
  if (item.promotedIncidentId !== null) {
    res.status(409).json({
      error: "Item already promoted",
      incidentId: item.promotedIncidentId,
    });
    return;
  }

  // Re-derive eligibility server-side from the STORED row — never trust a client
  // claim. Identical logic to the ingest-time pre-computation (same pure
  // deriveEligibility), so the gate is consistent between collection and promote.
  const category = (item.category ?? "Other security") as IncidentCategory;
  const elig = deriveEligibility({
    category,
    sourceTier: normaliseSourceTier(item.sourceTier),
    credibleDomainLabels: item.detectedCredibleDomains ?? [],
    corroborated: item.corroborated,
    corroborationReason: item.corroborationReason,
  });
  if (!elig.promotable) {
    res.status(409).json({
      error: !elig.securityRelevant
        ? "Item is not promotable — not a security-relevant category"
        : "Item is not promotable — no declared credible source, linked credible domain, or cross-feed corroboration",
      reason: elig.credibilityReason,
    });
    return;
  }

  // Dating honesty gate — the SAME pure resolver the batch pass uses. A post
  // with no usable timestamp, or one older than the promote window (a pinned
  // years-old group post is the classic case), must never become a current
  // incident: the old fallback would have stamped it with today's date. The row
  // stays in social_raw as reviewable context; only promotion is refused.
  const resolvedDate = resolveSocialPostDate(item);
  if (resolvedDate.kind !== "ok") {
    res.status(409).json({
      error:
        resolvedDate.kind === "no-date"
          ? "Item cannot be promoted — the post carries no usable date, so an incident would be dated today"
          : `Item cannot be promoted — the post is ${Math.round(resolvedDate.ageDays)} days old (limit ${socialPromoteMaxAgeDays()} days), so it is not a current incident`,
      reason: resolvedDate.kind,
    });
    return;
  }

  // Armed/violent-crime categories file under conflict; protest / policing /
  // governance categories under flashpoint.
  const topic = categoryToTopic(category);
  const postDate = resolvedDate.date;

  // Duplicate-block: re-derived against live incidents so a promote can never
  // double-count an event already tracked. Read-only candidate gather over a
  // same-country window; pickDuplicate applies the strict score/date/province/
  // category bar.
  const since = new Date(postDate.getTime() - DUP_QUERY_WINDOW_DAYS * DAY_MS);
  const until = new Date(postDate.getTime() + DUP_QUERY_WINDOW_DAYS * DAY_MS);
  const candRows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
      province: incidentsTable.province,
      category: incidentsTable.category,
      occurredAt: incidentsTable.occurredAt,
      incidentDate: incidentsTable.incidentDate,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.country, item.country),
        // Match on EITHER publication time or the (often more precise) event
        // date — pickDuplicate keys off incidentDate ?? occurredAt, so an
        // incident in-window by incidentDate but not occurredAt must still be
        // gathered or a genuine duplicate slips past the block.
        or(
          and(
            gte(incidentsTable.occurredAt, since),
            lte(incidentsTable.occurredAt, until),
          ),
          and(
            gte(incidentsTable.incidentDate, since),
            lte(incidentsTable.incidentDate, until),
          ),
        ),
      ),
    )
    .limit(300);
  const candidates: IncidentCandidate[] = candRows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    country: r.country,
    province: r.province,
    category: r.category,
    occurredAt: r.occurredAt,
    incidentDate: r.incidentDate,
  }));
  const dup = pickDuplicate(
    {
      text: `${item.caption ?? ""} ${item.location ?? ""}`.trim(),
      country: item.country,
      province: item.province,
      category,
      date: postDate,
    },
    candidates,
  );
  if (dup) {
    res.status(409).json({
      error: "Item duplicates an existing incident",
      incidentId: dup.incident.id,
      reason: dup.reason,
    });
    return;
  }

  const title = buildSocialIncidentTitle(item, category);
  const summary = buildSocialIncidentSummary(item);
  const severity = classifySeverity(title, summary, topic as SeverityTopic);
  const sourceUrl = item.url;
  const sourceLabel = `${item.pageName ?? item.pageHandle} (Facebook OSINT)`;

  const rel = evaluateIncidentRelevance(topic, {
    topic,
    title,
    summary,
    source: sourceLabel,
    sourceUrl,
    location: item.location ?? null,
  });

  // Insert the incident and link it back to the source post in one transaction
  // so an item is never half-promoted. The back-link UPDATE is guarded by
  // `promoted_incident_id IS NULL` and its row count checked: under two
  // concurrent promotes Postgres serialises the conflicting row update, so the
  // loser matches 0 rows, we throw, and the whole transaction (incident insert
  // included) rolls back — exactly one incident is ever created.
  let incident;
  try {
    incident = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(incidentsTable)
        .values({
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
          analystNotes: `Promoted from Facebook OSINT item #${item.id}. Credibility: ${
            elig.credibilityReason ?? "n/a"
          }.`,
          relevanceStatus: rel.status,
          relevanceScore: rel.score,
          relevanceReason: rel.reason,
          relevanceVersion: rel.version,
          relevanceEvaluatedAt: new Date(),
        })
        .returning();
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
      if (claimed.length === 0) {
        throw new AlreadyPromotedError();
      }
      return row!;
    });
  } catch (err) {
    if (err instanceof AlreadyPromotedError) {
      res.status(409).json({ error: "Item already promoted" });
      return;
    }
    throw err;
  }

  req.log.info(
    { socialRawItemId: item.id, incidentId: incident.id, topic },
    "Promoted Facebook OSINT item to incident",
  );
  res.status(201).json(incident);
});

// Thrown inside the promote transaction when a concurrent request has already
// claimed the same source item — forces a rollback so no second incident is
// created, and is translated to a 409 by the caller.
class AlreadyPromotedError extends Error {}

export default router;
