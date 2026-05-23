import { Router, type IRouter } from "express";
import { db, incidentsTable } from "@workspace/db";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import {
  CreateIncidentBody,
  UpdateIncidentBody,
  ListIncidentsQueryParams,
  GetRecentIncidentsQueryParams,
  GetIncidentCountsByTopicQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/incidents", async (req, res): Promise<void> => {
  const parsed = ListIncidentsQueryParams.safeParse({ ...req.query, days: req.query.days ? Number(req.query.days) : undefined });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { topic, country, severity, days, search } = parsed.data;
  const conditions = [];
  if (topic) conditions.push(eq(incidentsTable.topic, topic));
  if (country) conditions.push(eq(incidentsTable.country, country));
  if (severity) conditions.push(eq(incidentsTable.severity, severity));
  if (days) {
    const since = new Date(Date.now() - days * 86400000);
    conditions.push(gte(incidentsTable.occurredAt, since));
  }
  if (search) {
    conditions.push(
      or(
        ilike(incidentsTable.title, `%${search}%`),
        ilike(incidentsTable.summary, `%${search}%`),
        ilike(incidentsTable.country, `%${search}%`),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(incidentsTable.occurredAt));
  res.json(rows);
});

router.get("/incidents/recent", async (req, res): Promise<void> => {
  const parsed = GetRecentIncidentsQueryParams.safeParse({ ...req.query, limit: req.query.limit ? Number(req.query.limit) : undefined });
  const limit = parsed.success ? parsed.data.limit ?? 10 : 10;
  const rows = await db
    .select()
    .from(incidentsTable)
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(limit);
  res.json(rows);
});

router.get("/incidents/by-topic", async (req, res): Promise<void> => {
  const parsed = GetIncidentCountsByTopicQueryParams.safeParse({ ...req.query, days: req.query.days ? Number(req.query.days) : undefined });
  const days = parsed.success ? parsed.data.days ?? 30 : 30;
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select({
      topic: incidentsTable.topic,
      count: sql<number>`count(*)::int`,
      criticalCount: sql<number>`sum(case when ${incidentsTable.severity} = 'extreme' then 1 else 0 end)::int`,
    })
    .from(incidentsTable)
    .where(gte(incidentsTable.occurredAt, since))
    .groupBy(incidentsTable.topic);
  res.json(rows);
});

router.get("/incidents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/incidents", async (req, res): Promise<void> => {
  const parsed = CreateIncidentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(incidentsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/incidents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateIncidentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(incidentsTable)
    .set(parsed.data)
    .where(eq(incidentsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/incidents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(incidentsTable).where(eq(incidentsTable.id, id));
  res.status(204).end();
});

export default router;
