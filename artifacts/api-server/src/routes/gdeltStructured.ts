import { Router, type IRouter } from "express";
import { db, gdeltStructuredItemsTable } from "@workspace/db";
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import { ListGdeltStructuredItemsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GDELT Cloud structured event layer — structured context + promote bridge.
//
// Rows land in gdelt_structured_items first. Lane-bearing events are promoted
// into incidents (see gdeltPromote.ts) and feed country/topic reports via the
// normal incident pipeline. Stories stay context-only and surface in the GDELT
// Open-Source Context section of GDELT-monitored country reports.
//
// Owner-private (mounted below requireOwner in routes/index.ts), like every
// other data router. Returns the most recent items first, optionally narrowed
// by lane, country, sub-bucket, kind, and an age window.
const DEFAULT_LIMIT = 200;

router.get("/gdelt-structured-items", async (req, res): Promise<void> => {
  const parsed = ListGdeltStructuredItemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { lane, country, subBucket, kind, days, limit } = parsed.data;

  const conditions: SQL[] = [];
  if (lane) conditions.push(eq(gdeltStructuredItemsTable.lane, lane));
  if (country) conditions.push(eq(gdeltStructuredItemsTable.country, country));
  if (subBucket)
    conditions.push(eq(gdeltStructuredItemsTable.subBucket, subBucket));
  if (kind) conditions.push(eq(gdeltStructuredItemsTable.kind, kind));
  if (days) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    conditions.push(gte(gdeltStructuredItemsTable.sourceDate, cutoff));
  }

  const rows = await db
    .select()
    .from(gdeltStructuredItemsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(gdeltStructuredItemsTable.sourceDate),
      desc(gdeltStructuredItemsTable.id),
    )
    .limit(limit ?? DEFAULT_LIMIT);

  res.json(rows);
});

export default router;
