import { Router, type IRouter } from "express";
import { db, socialWatchItemsTable, incidentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import {
  isPromotable,
  sanitiseCaption,
  classifyStatus,
  extractLocation,
  extractIssue,
  extractEventDateTime,
  detectAlertReasons,
  makeDedupKey,
  type SocialWatchStatus,
} from "@workspace/ingest";
import {
  ListSocialWatchItemsQueryParams,
  PromoteSocialWatchItemParams,
  CreateSocialWatchItemBody,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

// Shared public projection so the list read and the manual-create response never
// disagree. Deliberately omits internal bookkeeping columns (dedupKey, fetchedAt).
const LIST_COLUMNS = {
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
};

// KAMMI Pusat public Instagram protest-watch items, stored as
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
    .select(LIST_COLUMNS)
    .from(socialWatchItemsTable)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(desc(socialWatchItemsTable.postedAt), desc(socialWatchItemsTable.id))
    .limit(limit ?? DEFAULT_LIMIT);

  res.json(rows);
});

// Manually add a KAMMI protest-watch item by hand (analyst paste — no scraping,
// no API keys). The pasted row is stored ONLY as supporting CONTEXT in the
// social-watch table; it NEVER becomes or inflates an incident. Exactly like a
// scraped item, the server sanitises the caption and RE-DERIVES status,
// promotability, location, issue, event date/time and watch-alerts from the
// text — a client cannot claim an item is promotable. Re-pasting identical
// content is idempotent (deduped to one row via the UNIQUE dedup key).
//
// Auth mirrors the promote action (requireAdminToken) — this is a mutating
// operator action.
router.post("/social-watch", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateSocialWatchItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const caption = sanitiseCaption(body.caption);
  const imageUrls = (body.imageUrls ?? []).slice(0, 6);
  const hasImages = imageUrls.length > 0;

  // Analyst-entered fields (event date/time, location, issue, etc.) are treated
  // as authoritative when present and fall back to the same text extractors the
  // scraper uses. Promotability is NEVER taken from the client — always
  // re-derived from the (possibly analyst-chosen) status + caption.
  const status: SocialWatchStatus = body.status ?? classifyStatus(caption, hasImages);
  const parsedLoc = extractLocation(caption);
  const loc = {
    location: nonEmpty(body.location) ?? parsedLoc.location,
    city: nonEmpty(body.city) ?? parsedLoc.city,
    province: nonEmpty(body.province) ?? parsedLoc.province,
  };
  const issue = nonEmpty(body.issue) ?? extractIssue(caption);
  const postedAt = body.postedAt ?? new Date();
  const parsedEvent = extractEventDateTime(caption, postedAt);
  const eventDate = body.eventDate ? new Date(body.eventDate) : parsedEvent.eventDate;
  const eventTimeText = nonEmpty(body.eventTimeText) ?? parsedEvent.eventTimeText;
  // Promotability is ALWAYS re-derived server-side, never trusted from client.
  const promotable = isPromotable(status, caption);
  // Alert parity with the scraper: diff against the most recent prior item for
  // the same issue so "location changed" / "start time changed" alerts fire for
  // hand-entered items too.
  let prior: { location: string | null; eventTimeText: string | null } | null = null;
  if (issue) {
    const [row] = await db
      .select({
        location: socialWatchItemsTable.location,
        eventTimeText: socialWatchItemsTable.eventTimeText,
      })
      .from(socialWatchItemsTable)
      .where(
        and(
          eq(socialWatchItemsTable.sourceName, "social_watch"),
          eq(socialWatchItemsTable.issue, issue),
        ),
      )
      .orderBy(desc(socialWatchItemsTable.postedAt))
      .limit(1);
    prior = row ?? null;
  }
  const alertReasons = detectAlertReasons(
    caption,
    hasImages,
    loc,
    eventTimeText,
    status,
    prior,
  );
  const dedupKey = makeDedupKey(caption, imageUrls);

  const confidence = normaliseConfidence(body.confidence);
  const channel =
    body.channel?.trim() ||
    (body.platform === "telegram" ? "kammi_pusat (Telegram)" : "kammi.pusat");
  const externalId = `manual_${body.platform}_${hashId(body.url || caption)}`;

  const inserted = await db
    .insert(socialWatchItemsTable)
    .values({
      sourceName: "social_watch",
      platform: body.platform,
      channel,
      actor: body.actor?.trim() || "KAMMI Pusat",
      externalId,
      postedAt,
      eventDate,
      eventTimeText,
      caption,
      imageUrls,
      location: loc.location,
      city: loc.city,
      province: loc.province,
      issue,
      status,
      confidence,
      url: body.url,
      country: "Indonesia",
      topic: "flashpoint",
      classification: "context",
      dedupKey,
      alertReasons,
      promotable,
    })
    .onConflictDoNothing()
    .returning(LIST_COLUMNS);

  // Idempotent re-paste: an item with the same content fingerprint already
  // exists, so return it unchanged (200) rather than creating a duplicate.
  if (inserted.length === 0) {
    const [existing] = await db
      .select(LIST_COLUMNS)
      .from(socialWatchItemsTable)
      .where(eq(socialWatchItemsTable.dedupKey, dedupKey))
      .limit(1);
    if (existing) {
      res.status(200).json(existing);
      return;
    }
    // Extremely unlikely (conflict on a non-dedup constraint) — surface it.
    res.status(409).json({ error: "Could not store the watch item" });
    return;
  }

  req.log.info(
    { socialWatchItemId: inserted[0]!.id, platform: body.platform, status },
    "Manually added KAMMI social-watch item (context only)",
  );
  res.status(201).json(inserted[0]);
});

// Trim an optional analyst string input; return undefined when blank so the
// caption-derived fallback is used instead of storing an empty string.
function nonEmpty(raw: string | null | undefined): string | undefined {
  const t = raw?.trim();
  return t ? t : undefined;
}

// Confidence is a display/hint field — clamp to the known set, default medium.
function normaliseConfidence(raw: string | undefined): string {
  const t = (raw ?? "").trim().toLowerCase();
  return t === "high" || t === "low" ? t : "medium";
}

// Small stable non-cryptographic hash so a re-paste of the same URL/caption
// yields the same synthesized external id (dedup is by dedupKey; this just
// keeps the external id deterministic and collision-resistant enough).
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

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
        source: "KAMMI Instagram (Social Watch)",
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
