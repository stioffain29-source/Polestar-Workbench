import { Router, type IRouter } from "express";
import { db, spotReportsTable } from "@workspace/db";
import type { InsertSpotReport, SpotReportExportEntry } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateSpotReportBody,
  UpdateSpotReportBody,
  ListSpotReportsQueryParams,
  AppendSpotReportExportBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/spot-reports", async (req, res): Promise<void> => {
  const parsed = ListSpotReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status } = parsed.data;
  const conds = [];
  if (status) conds.push(eq(spotReportsTable.status, status));
  const rows = await db
    .select()
    .from(spotReportsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(spotReportsTable.reportDate));
  res.json(rows);
});

router.get("/spot-reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(spotReportsTable).where(eq(spotReportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/spot-reports", async (req, res): Promise<void> => {
  const parsed = CreateSpotReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // reportDate/incidentDate arrive as Date instances (orval `useDates`); the
  // Drizzle timestamp columns accept Date directly. Undefined fields are
  // skipped by Drizzle, so column defaults (status, reportDate, [] arrays)
  // apply for anything the analyst left blank in a draft.
  const insertValues = parsed.data as InsertSpotReport;
  const [row] = await db.insert(spotReportsTable).values(insertValues).returning();
  res.status(201).json(row);
});

router.patch("/spot-reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateSpotReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData = {
    ...parsed.data,
    lastEditedAt: new Date(),
  } as Partial<InsertSpotReport>;
  const [row] = await db
    .update(spotReportsTable)
    .set(updateData)
    .where(eq(spotReportsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/spot-reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(spotReportsTable).where(eq(spotReportsTable.id, id));
  res.status(204).end();
});

// Append an export-history entry (one per PDF / Word / plain-text export).
router.post("/spot-reports/:id/exports", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = AppendSpotReportExportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(spotReportsTable)
    .where(eq(spotReportsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const entry: SpotReportExportEntry = {
    format: parsed.data.format,
    exportedAt: new Date().toISOString(),
    ...(parsed.data.exportedBy ? { exportedBy: parsed.data.exportedBy } : {}),
  };
  const exportHistory: SpotReportExportEntry[] = [
    ...(existing.exportHistory ?? []),
    entry,
  ];
  const [row] = await db
    .update(spotReportsTable)
    .set({ exportHistory })
    .where(eq(spotReportsTable.id, id))
    .returning();
  res.json(row);
});

export default router;
