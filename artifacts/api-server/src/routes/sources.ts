import { Router, type IRouter } from "express";
import { db, sourcesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CreateSourceBody,
  UpdateSourceBody,
  ListSourcesQueryParams,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth.js";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/sources", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = ListSourcesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { topic, status } = parsed.data;
  const conds = [];
  if (topic) conds.push(eq(sourcesTable.topic, topic));
  if (status) conds.push(eq(sourcesTable.status, status));
  const rows = await db
    .select()
    .from(sourcesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sourcesTable.createdAt));
  res.json(rows);
});

router.get("/sources/health", requireAdminToken, async (_req, res): Promise<void> => {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      manualReviewCount: sql<number>`sum(case when ${sourcesTable.manualReviewRequired} then 1 else 0 end)::int`,
    })
    .from(sourcesTable);
  const byStatus = await db
    .select({ status: sourcesTable.status, count: sql<number>`count(*)::int` })
    .from(sourcesTable)
    .groupBy(sourcesTable.status);
  res.json({
    total: totals?.total ?? 0,
    manualReviewCount: totals?.manualReviewCount ?? 0,
    byStatus,
  });
});

router.post("/sources", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(sourcesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/sources/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(sourcesTable)
    .set(parsed.data)
    .where(eq(sourcesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/sources/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(sourcesTable).where(eq(sourcesTable.id, id));
  res.status(204).end();
});

export default router;
