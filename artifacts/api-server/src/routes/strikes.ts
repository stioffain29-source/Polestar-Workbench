import { Router, type IRouter } from "express";
import { db, strikesTable } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  CreateStrikeBody,
  UpdateStrikeBody,
  ListStrikesQueryParams,
  GetStrikeSummaryQueryParams,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/strikes", async (req, res): Promise<void> => {
  const q = { ...req.query, days: req.query.days ? Number(req.query.days) : undefined };
  const parsed = ListStrikesQueryParams.safeParse(q);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { theatre, country, days, munition } = parsed.data;
  const conds = [];
  if (theatre) conds.push(eq(strikesTable.theatre, theatre));
  if (country) conds.push(eq(strikesTable.country, country));
  if (munition) conds.push(eq(strikesTable.munition, munition));
  if (days) conds.push(gte(strikesTable.occurredAt, new Date(Date.now() - days * 86400000)));
  const rows = await db
    .select()
    .from(strikesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(strikesTable.occurredAt));
  res.json(rows);
});

router.get("/strikes/summary", async (req, res): Promise<void> => {
  const q = { ...req.query, days: req.query.days ? Number(req.query.days) : undefined };
  const parsed = GetStrikeSummaryQueryParams.safeParse(q);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { theatre, days } = parsed.data;
  const conds = [];
  if (theatre) conds.push(eq(strikesTable.theatre, theatre));
  if (days) conds.push(gte(strikesTable.occurredAt, new Date(Date.now() - days * 86400000)));
  const where = conds.length ? and(...conds) : undefined;

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      totalCasualties: sql<number>`coalesce(sum(${strikesTable.casualties}),0)::int`,
    })
    .from(strikesTable)
    .where(where);

  const byMunition = await db
    .select({ key: strikesTable.munition, count: sql<number>`count(*)::int` })
    .from(strikesTable)
    .where(where)
    .groupBy(strikesTable.munition);

  const byInfrastructure = await db
    .select({ key: strikesTable.infrastructure, count: sql<number>`count(*)::int` })
    .from(strikesTable)
    .where(where)
    .groupBy(strikesTable.infrastructure);

  const byCountry = await db
    .select({ key: strikesTable.country, count: sql<number>`count(*)::int` })
    .from(strikesTable)
    .where(where)
    .groupBy(strikesTable.country);

  const timeline = await db
    .select({
      date: sql<string>`to_char(${strikesTable.occurredAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(strikesTable)
    .where(where)
    .groupBy(sql`to_char(${strikesTable.occurredAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${strikesTable.occurredAt}, 'YYYY-MM-DD')`);

  res.json({
    total: totals?.total ?? 0,
    totalCasualties: totals?.totalCasualties ?? 0,
    byMunition,
    byInfrastructure,
    byCountry,
    timeline,
  });
});

router.get("/strikes/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(strikesTable).where(eq(strikesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/strikes", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateStrikeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(strikesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/strikes/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateStrikeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(strikesTable)
    .set(parsed.data)
    .where(eq(strikesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/strikes/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(strikesTable).where(eq(strikesTable.id, id));
  res.status(204).end();
});

export default router;
