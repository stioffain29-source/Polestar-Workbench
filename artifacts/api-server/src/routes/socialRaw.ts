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
  type IncidentCandidate,
  type IncidentCategory,
  type SeverityTopic,
} from "@workspace/ingest";
import {
  ListSocialRawItemsQueryParams,
  PromoteSocialRawItemParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Facebook OSINT monitoring items for the Papua New Guinea + Indonesian Papua
// theatres, stored as supporting CONTEXT.
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents — they live in their own
// table (`social_raw`) and no incident-counting surface reads them, so a
// Facebook post can never inflate any incident count. The ONLY path into
// `incidents` is the explicit POST /social-raw/{id}/promote action below, which
// the server RE-DERIVES from the stored row (never trusting a client claim):
// the item must be security-relevant AND credible, and must not duplicate an
// already-tracked incident.
//
// Read is PUBLIC (in line with the rest of the workbench). The promote action
// mirrors the existing public POST /incidents posture — the workbench is
// intentionally open for view + edit; the only token-gated writes are
// admin/ingest and source mutations.
const SOURCE_NAME = "facebook_osint";
const DEFAULT_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
// Candidate-gather window for the duplicate-block. Wider than the strict
// duplicate window (4 days) so pickDuplicate applies the real bar; over-fetching
// a few extra rows costs nothing and keeps the gate honest.
const DUP_QUERY_WINDOW_DAYS = 6;

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
  if (promotable !== undefined)
    conditions.push(eq(socialRawTable.promotable, promotable));
  if (promoted !== undefined)
    conditions.push(
      promoted
        ? isNotNull(socialRawTable.promotedIncidentId)
        : isNull(socialRawTable.promotedIncidentId),
    );
  if (reviewFlagged !== undefined)
    conditions.push(eq(socialRawTable.reviewFlag, reviewFlagged));
  // `eligible` = promotable AND not yet promoted (the actionable queue). When
  // false, surface the complement (not promotable OR already promoted).
  if (eligible !== undefined)
    conditions.push(
      eligible
        ? and(
            eq(socialRawTable.promotable, true),
            isNull(socialRawTable.promotedIncidentId),
          )!
        : or(
            eq(socialRawTable.promotable, false),
            isNotNull(socialRawTable.promotedIncidentId),
          )!,
    );

  const rows = await db
    .select({
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
      classification: socialRawTable.classification,
      promotable: socialRawTable.promotable,
      engagement: socialRawTable.engagement,
      detectedKeywords: socialRawTable.detectedKeywords,
      confidence: socialRawTable.confidence,
      reviewFlag: socialRawTable.reviewFlag,
      reviewReason: socialRawTable.reviewReason,
      promotedIncidentId: socialRawTable.promotedIncidentId,
      promotedAt: socialRawTable.promotedAt,
      createdAt: socialRawTable.createdAt,
    })
    .from(socialRawTable)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(desc(socialRawTable.postedAt), desc(socialRawTable.id))
    .limit(limit ?? DEFAULT_LIMIT);

  res.json(rows);
});

router.post("/social-raw/:id/promote", async (req, res): Promise<void> => {
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

  // Armed/violent-crime categories file under conflict; protest / policing /
  // governance categories under flashpoint.
  const topic = categoryToTopic(category);
  const postDate =
    item.incidentDate ?? item.postedAt ?? item.createdAt ?? new Date();

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

  const title = buildIncidentTitle(item, category);
  const summary = buildIncidentSummary(item);
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

function buildIncidentTitle(
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

function buildIncidentSummary(item: {
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
  if (parts.length === 0) {
    parts.push(`Security incident reported at ${where}.`);
  }
  if (item.businessImpact) parts.push(item.businessImpact);
  return parts.join(" ");
}

export default router;
