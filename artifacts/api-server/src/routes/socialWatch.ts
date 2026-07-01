import { Router, type IRouter } from "express";
import { db, socialWatchItemsTable, incidentsTable } from "@workspace/db";
import { and, desc, eq, ne } from "drizzle-orm";
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
  DeleteSocialWatchItemParams,
  UpdateSocialWatchItemParams,
  CreateSocialWatchItemBody,
  UpdateSocialWatchItemBody,
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

  const postedAt = body.postedAt ?? new Date();
  const derived = await deriveWatchFields({
    platform: body.platform,
    url: body.url,
    caption: body.caption,
    imageUrls: body.imageUrls,
    channel: body.channel,
    postedAt,
    eventDate: body.eventDate,
    eventTimeText: body.eventTimeText,
    location: body.location,
    city: body.city,
    province: body.province,
    issue: body.issue,
    status: body.status,
    confidence: body.confidence,
  });

  const inserted = await db
    .insert(socialWatchItemsTable)
    .values({
      sourceName: "social_watch",
      platform: body.platform,
      channel: derived.channel,
      actor: body.actor?.trim() || "KAMMI Pusat",
      externalId: derived.externalId,
      postedAt,
      eventDate: derived.eventDate,
      eventTimeText: derived.eventTimeText,
      caption: derived.caption,
      imageUrls: derived.imageUrls,
      location: derived.loc.location,
      city: derived.loc.city,
      province: derived.loc.province,
      issue: derived.issue,
      status: derived.status,
      confidence: derived.confidence,
      url: body.url,
      country: "Indonesia",
      topic: "flashpoint",
      classification: "context",
      dedupKey: derived.dedupKey,
      alertReasons: derived.alertReasons,
      promotable: derived.promotable,
    })
    .onConflictDoNothing()
    .returning(LIST_COLUMNS);

  // Idempotent re-paste: an item with the same content fingerprint already
  // exists, so return it unchanged (200) rather than creating a duplicate.
  if (inserted.length === 0) {
    const [existing] = await db
      .select(LIST_COLUMNS)
      .from(socialWatchItemsTable)
      .where(eq(socialWatchItemsTable.dedupKey, derived.dedupKey))
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
    { socialWatchItemId: inserted[0]!.id, platform: body.platform, status: derived.status },
    "Manually added KAMMI social-watch item (context only)",
  );
  res.status(201).json(inserted[0]);
});

// Correct a single hand-entered social-watch CONTEXT row IN PLACE (fix a typo,
// a wrong location, a missing URL, the event date/time or status) instead of
// deleting and re-pasting — which would lose any watch-alert history. Omitted
// fields keep their stored value; the caption and every derived field are
// re-sanitised / RE-DERIVED server-side exactly like create, so a client can
// never claim an item is promotable. This only ever touches the context row —
// it NEVER touches `incidents`, so no incident count can change. Refused (409)
// once the item has been promoted to an incident (the incident is then the
// source of truth). Auth mirrors the create/delete/promote actions.
router.patch("/social-watch/:id", requireAdminToken, async (req, res): Promise<void> => {
  const idParsed = UpdateSocialWatchItemParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: idParsed.error.message });
    return;
  }
  const id = idParsed.data.id;

  const bodyParsed = UpdateSocialWatchItemBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const body = bodyParsed.data;

  const [existing] = await db
    .select()
    .from(socialWatchItemsTable)
    .where(eq(socialWatchItemsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Social-watch item not found" });
    return;
  }
  if (existing.promotedIncidentId !== null) {
    res.status(409).json({
      error: "Item already promoted to an incident — edit the incident instead",
      incidentId: existing.promotedIncidentId,
    });
    return;
  }

  // Merge the edit over the stored row: any omitted field keeps its stored
  // value. Everything derivable is then re-derived from the merged text.
  const platform = body.platform ?? existing.platform;
  const url = nonEmpty(body.url) ?? existing.url;
  const caption = body.caption !== undefined ? body.caption : (existing.caption ?? "");
  const postedAt = body.postedAt ? new Date(body.postedAt) : (existing.postedAt ?? new Date());

  // For every optional field, an OMITTED value must KEEP the stored value —
  // never silently re-derive from the caption and overwrite a curated analyst
  // entry. So each field falls back to `existing.*` before deriveWatchFields
  // (which itself only re-derives from the caption when its input is blank).
  const derived = await deriveWatchFields(
    {
      platform,
      url,
      caption,
      imageUrls: body.imageUrls ?? existing.imageUrls,
      channel: body.channel ?? existing.channel,
      postedAt,
      eventDate: body.eventDate ?? existing.eventDate,
      eventTimeText: body.eventTimeText ?? existing.eventTimeText ?? undefined,
      location: body.location ?? existing.location ?? undefined,
      city: body.city ?? existing.city ?? undefined,
      province: body.province ?? existing.province ?? undefined,
      issue: body.issue ?? existing.issue ?? undefined,
      status: body.status ?? (existing.status as SocialWatchStatus),
      confidence: body.confidence ?? existing.confidence,
    },
    id,
  );

  let updated;
  try {
    [updated] = await db
      .update(socialWatchItemsTable)
      .set({
        platform,
        channel: derived.channel,
        actor: nonEmpty(body.actor) ?? existing.actor,
        externalId: derived.externalId,
        postedAt,
        eventDate: derived.eventDate,
        eventTimeText: derived.eventTimeText,
        caption: derived.caption,
        imageUrls: derived.imageUrls,
        location: derived.loc.location,
        city: derived.loc.city,
        province: derived.loc.province,
        issue: derived.issue,
        status: derived.status,
        confidence: derived.confidence,
        url,
        dedupKey: derived.dedupKey,
        alertReasons: derived.alertReasons,
        promotable: derived.promotable,
        updatedAt: new Date(),
      })
      .where(eq(socialWatchItemsTable.id, id))
      .returning(LIST_COLUMNS);
  } catch (e) {
    // The edited content collides with a DIFFERENT existing row's dedup key —
    // the same post already exists as context. Surface it rather than 500.
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: "Another watch item already has this exact content",
      });
      return;
    }
    throw e;
  }

  req.log.info(
    { socialWatchItemId: id, status: derived.status },
    "Edited KAMMI social-watch item (context only)",
  );
  res.status(200).json(updated);
});

// Remove a single hand-entered social-watch CONTEXT row (wrong URL, duplicate
// that dodged dedupe, off-topic paste). This deletes ONLY the context row in
// the social-watch table — it NEVER touches `incidents`, so no incident count
// can change. If the item was already promoted to an incident it is refused
// (409): the incident is the source of truth at that point, so the analyst must
// delete the incident first. Auth mirrors the create/promote actions.
router.delete("/social-watch/:id", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = DeleteSocialWatchItemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = parsed.data.id;

  const [item] = await db
    .select({ id: socialWatchItemsTable.id, promotedIncidentId: socialWatchItemsTable.promotedIncidentId })
    .from(socialWatchItemsTable)
    .where(eq(socialWatchItemsTable.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Social-watch item not found" });
    return;
  }
  if (item.promotedIncidentId !== null) {
    res.status(409).json({
      error: "Item already promoted to an incident — delete the incident first",
      incidentId: item.promotedIncidentId,
    });
    return;
  }

  await db.delete(socialWatchItemsTable).where(eq(socialWatchItemsTable.id, id));

  req.log.info({ socialWatchItemId: id }, "Deleted KAMMI social-watch item (context only)");
  res.status(204).end();
});

// Shared re-derivation seam for BOTH create and edit so an in-place edit can
// never behave differently from a fresh paste. Analyst-entered fields (event
// date/time, location, issue, etc.) are treated as authoritative when present
// and fall back to the same text extractors the scraper uses. Status,
// promotability, location, issue, event date/time, watch-alerts and the dedup
// key are ALWAYS re-derived server-side — a client can never claim an item is
// promotable. `excludeId` drops the row being edited from the alert-diff prior
// lookup so an item is never compared against itself.
async function deriveWatchFields(
  input: {
    platform: string;
    url: string;
    caption: string;
    imageUrls: string[] | undefined;
    channel: string | undefined;
    postedAt: Date;
    eventDate: Date | null | undefined;
    eventTimeText: string | undefined;
    location: string | undefined;
    city: string | undefined;
    province: string | undefined;
    issue: string | undefined;
    status: SocialWatchStatus | undefined;
    confidence: string | undefined;
  },
  excludeId?: number,
): Promise<{
  caption: string;
  imageUrls: string[];
  status: SocialWatchStatus;
  loc: { location: string | null; city: string; province: string | null };
  issue: string | null;
  eventDate: Date | null;
  eventTimeText: string | null;
  promotable: boolean;
  alertReasons: string[];
  dedupKey: string;
  confidence: string;
  channel: string;
  externalId: string;
}> {
  const caption = sanitiseCaption(input.caption);
  const imageUrls = (input.imageUrls ?? []).slice(0, 6);
  const hasImages = imageUrls.length > 0;

  const status: SocialWatchStatus = input.status ?? classifyStatus(caption, hasImages);
  const parsedLoc = extractLocation(caption);
  const loc = {
    location: nonEmpty(input.location) ?? parsedLoc.location,
    city: nonEmpty(input.city) ?? parsedLoc.city,
    province: nonEmpty(input.province) ?? parsedLoc.province,
  };
  const issue = nonEmpty(input.issue) ?? extractIssue(caption);
  const parsedEvent = extractEventDateTime(caption, input.postedAt);
  const eventDate = input.eventDate ? new Date(input.eventDate) : parsedEvent.eventDate;
  const eventTimeText = nonEmpty(input.eventTimeText) ?? parsedEvent.eventTimeText;
  // Promotability is ALWAYS re-derived server-side, never trusted from client.
  const promotable = isPromotable(status, caption);
  // Alert parity with the scraper: diff against the most recent prior item for
  // the same issue so "location changed" / "start time changed" alerts fire for
  // hand-entered items too. On edit, exclude the row itself.
  let prior: { location: string | null; eventTimeText: string | null } | null = null;
  if (issue) {
    const conditions = [
      eq(socialWatchItemsTable.sourceName, "social_watch"),
      eq(socialWatchItemsTable.issue, issue),
    ];
    if (excludeId != null) conditions.push(ne(socialWatchItemsTable.id, excludeId));
    const [row] = await db
      .select({
        location: socialWatchItemsTable.location,
        eventTimeText: socialWatchItemsTable.eventTimeText,
      })
      .from(socialWatchItemsTable)
      .where(and(...conditions))
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
  const confidence = normaliseConfidence(input.confidence);
  const channel =
    input.channel?.trim() ||
    (input.platform === "telegram" ? "kammi_pusat (Telegram)" : "kammi.pusat");
  const externalId = `manual_${input.platform}_${hashId(input.url || caption)}`;

  return {
    caption,
    imageUrls,
    status,
    loc,
    issue,
    eventDate,
    eventTimeText,
    promotable,
    alertReasons,
    dedupKey,
    confidence,
    channel,
    externalId,
  };
}

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

// A Postgres unique-constraint violation (code 23505) — used to turn a dedup
// collision on edit into a clean 409 rather than a 500.
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "23505"
  );
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
        // Carry the pasted provenance (organiser + channel/account) onto the
        // incident so a Telegram paste is not mislabelled as Instagram and the
        // captured channel survives into published intelligence.
        source: buildIncidentSource(item),
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

export function buildIncidentTitle(item: {
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

// Preserve the pasted provenance (organiser + channel/account) on the promoted
// incident's source line. A Telegram paste must not be relabelled "Instagram",
// and the captured channel/actor must survive into published intelligence.
// Falls back to a stable Social Watch label when neither was captured.
export function buildIncidentSource(item: {
  channel: string | null;
  actor: string | null;
}): string {
  const actor = item.actor?.trim();
  const channel = item.channel?.trim();
  if (actor && channel) return `${actor} — ${channel} (Social Watch)`;
  if (channel) return `${channel} (Social Watch)`;
  if (actor) return `${actor} (Social Watch)`;
  return "KAMMI Social Watch";
}

export function buildIncidentSummary(item: {
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
