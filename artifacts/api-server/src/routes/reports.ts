import { Router, type IRouter } from "express";
import { db, reportsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateReportBody,
  UpdateReportBody,
  ListReportsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/reports", async (req, res): Promise<void> => {
  const parsed = ListReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { topic, status } = parsed.data;
  const conds = [];
  if (topic) conds.push(eq(reportsTable.topic, topic));
  if (status) conds.push(eq(reportsTable.status, status));
  const rows = await db
    .select()
    .from(reportsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(reportsTable.issueDate));
  res.json(rows);
});

router.get("/reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/reports", async (req, res): Promise<void> => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const [row] = await db
    .insert(reportsTable)
    .values({
      ...data,
      issueDate:
        data.issueDate instanceof Date
          ? data.issueDate.toISOString().slice(0, 10)
          : data.issueDate,
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const updateData: Record<string, unknown> = { ...data };
  if (data.issueDate !== undefined) {
    updateData.issueDate =
      data.issueDate instanceof Date
        ? data.issueDate.toISOString().slice(0, 10)
        : data.issueDate;
  }
  const [row] = await db
    .update(reportsTable)
    .set(updateData)
    .where(eq(reportsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(reportsTable).where(eq(reportsTable.id, id));
  res.status(204).end();
});

export default router;
