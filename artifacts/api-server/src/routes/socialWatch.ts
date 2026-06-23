import { Router, type IRouter } from "express";
import { db, socialWatchItemsTable, incidentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { isPromotable, type SocialWatchStatus } from "@workspace/ingest";
import {
  ListSocialWatchItemsQueryParams,
  PromoteSocialWatchItemParams,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

// KAMMI Pusat public Instagram + Telegram protest-watch items, stored as
// supporting CONTEXT.
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents — they live in their own
// table and no incident-counting surface reads them, so a "planned protest" or
// mobilisation post can never inflate any incident count. The ONLY path into
// `incidents` is the explicit /social-watch/{id}/promote action below, and only
// for an item whose text/image confirms the protest is actually active.
//
// Read is PUBLIC (in line with the rest of the workbench). The promote action
// mirrors the existing public POST /incidents posture — the workbench is
// intentionally open for view + edit; the only token-gated writes are
// admin/ingest and source mutations.
const DEFAULT_LIMIT = 100;

router.get("/social-watch", async (req, res): Promise<void> => {
  const parsed = ListSocialWatchItemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, platform, promotable, limit } = parsed.data;

  const conditions = [eq(socialWatchItemsTable.sourceName, "social_watch")];
  if (status) conditions.push(eq(socialWatchItemsTable.status, status));
  if (platform) conditions.push(eq(socialWatchItemsTable.platform, platform));
  if (promotable !== undefined)
    conditions.push(eq(socialWatchItemsTable.promotable, promotable));

  const rows = await db
    .select({
      id: socialWatchItemsTable.id,
      platform: socialWatchItemsTable.platform,
      channel: socialWatchItemsTable.channel,
      actor: socialWatchItemsTable.actor,
      externalId: socialWatchItemsTable.externalId,
      postedAt: socialWatchItemsTable.postedAt,
      eventDate: socialWatchItemsTable.eventDate,
      eventTimeText: socialWatchItemsTable.eventTimeText,
      caption: socialWatchItemsTable.caption,
      imageUrls: socialWatchItemsTable.imageUrls,
      location: socialWatchItemsTable.location,
      city: socialWatchItemsTable.city,
      province: socialWatchItemsTable.province,
      issue: socialWatchItemsTable.issue,
      status: socialWatchItemsTable.status,
      confidence: socialWatchItemsTable.confidence,
      url: socialWatchItemsTable.url,
      country: socialWatchItemsTable.country,
      topic: socialWatchItemsTable.topic,
      classification: socialWatchItemsTable.classification,
      alertReasons: socialWatchItemsTable.alertReasons,
      promotable: socialWatchItemsTable.promotable,
      promotedIncidentId: socialWatchItemsTable.promotedIncidentId,
      promotedAt: socialWatchItemsTable.promotedAt,
    })
    .from(socialWatchItemsTable)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(desc(socialWatchItemsTable.postedAt), desc(socialWatchItemsTable.id))
    .limit(limit ?? DEFAULT_LIMIT);

  res.json(rows);
});

router.post("/social-watch/:id/promote", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = PromoteSocialWatchItemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = parsed.data.id;

  const [item] = await db
    .select()
    .from(socialWatchItemsTable)
    .where(eq(socialWatchItemsTable.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Social-watch item not found" });
    return;
  }
  if (item.promotedIncidentId !== null) {
    res
      .status(409)
      .json({ error: "Item already promoted", incidentId: item.promotedIncidentId });
    return;
  }
  // Re-derive eligibility server-side from the stored status/caption — never
  // trust a client claim. Only confirmed-active items are promotable.
  if (!isPromotable(item.status as SocialWatchStatus, item.caption ?? "")) {
    res.status(409).json({
      error:
        "Item is not promotable — only protests confirmed active (active/dispersed/arrest) can become incidents",
    });
    return;
  }

  const title = buildIncidentTitle(item);
  const summary = buildIncidentSummary(item);
  const occurredAt = item.eventDate ?? item.postedAt ?? new Date();
  const sourceUrl = item.url;

  const rel = evaluateIncidentRelevance("flashpoint", {
    topic: "flashpoint",
    title,
    summary,
    source: item.channel,
    sourceUrl,
    location: item.location ?? null,
  });

  // Insert the incident and link it back to the source post in one transaction
  // so a watch item is never half-promoted.
  const incident = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incidentsTable)
      .values({
        topic: "flashpoint",
        title,
        summary,
        country: "Indonesia",
        location: item.location,
        occurredAt,
        severity: "Low",
        confidence: item.confidence,
        source: `KAMMI ${item.platform === "telegram" ? "Telegram" : "Instagram"} (Social Watch)`,
        sourceUrl,
        analystNotes: `Promoted from KAMMI social-watch item #${item.id} (${item.status}).`,
        relevanceStatus: rel.status,
        relevanceScore: rel.score,
        relevanceReason: rel.reason,
        relevanceVersion: rel.version,
        relevanceEvaluatedAt: new Date(),
      })
      .returning();
    await tx
      .update(socialWatchItemsTable)
      .set({ promotedIncidentId: row!.id, promotedAt: new Date(), updatedAt: new Date() })
      .where(eq(socialWatchItemsTable.id, item.id));
    return row!;
  });

  req.log.info(
    { socialWatchItemId: item.id, incidentId: incident.id },
    "Promoted social-watch item to flashpoint incident",
  );
  res.status(201).json(incident);
});

function buildIncidentTitle(item: {
  issue: string | null;
  city: string;
  location: string | null;
  status: string;
}): string {
  const where = item.location || item.city;
  const subject = item.issue ? `${item.issue} protest` : "Protest";
  const verb =
    item.status === "dispersed" ? "dispersed" : "under way";
  return `${subject} ${verb} — ${where}, Indonesia`;
}

function buildIncidentSummary(item: {
  caption: string | null;
  eventTimeText: string | null;
  location: string | null;
  city: string;
  actor: string | null;
}): string {
  const parts: string[] = [];
  const where = item.location || item.city;
  parts.push(
    `${item.actor ?? "KAMMI"} protest activity reported at ${where}${item.eventTimeText ? ` (${item.eventTimeText})` : ""}.`,
  );
  if (item.caption) {
    const trimmed = item.caption.replace(/\s+/g, " ").trim().slice(0, 400);
    if (trimmed) parts.push(trimmed);
  }
  return parts.join(" ");
}

export default router;
