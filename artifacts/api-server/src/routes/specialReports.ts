import { Router, type IRouter } from "express";
import { db, specialReportsTable } from "@workspace/db";
import type { InsertSpecialReport, SpotReportExportEntry } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateSpecialReportBody,
  UpdateSpecialReportBody,
  ListSpecialReportsQueryParams,
  AppendSpecialReportExportBody,
} from "@workspace/api-zod";
// Photo + cover ceilings and validation live in ONE shared module so the client
// editor's pre-save guard and this server-side check can never drift apart.
import {
  validateSpotReportPhotos,
  validateCoverDataUrl,
  validateSpecialReportBlocks,
} from "@workspace/db/spot-report-limits";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/special-reports", async (req, res): Promise<void> => {
  const parsed = ListSpecialReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status } = parsed.data;
  const conds = [];
  if (status) conds.push(eq(specialReportsTable.status, status));
  const rows = await db
    .select()
    .from(specialReportsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(specialReportsTable.reportDate));
  res.json(rows);
});

router.get("/special-reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db
    .select()
    .from(specialReportsTable)
    .where(eq(specialReportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/special-reports", async (req, res): Promise<void> => {
  const parsed = CreateSpecialReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const photoError = validateSpotReportPhotos(
    (parsed.data as { photos?: unknown }).photos,
  );
  if (photoError) {
    res.status(400).json({ error: photoError });
    return;
  }
  const coverError = validateCoverDataUrl(
    (parsed.data as { coverImageDataUrl?: unknown }).coverImageDataUrl,
  );
  if (coverError) {
    res.status(400).json({ error: coverError });
    return;
  }
  const blocksError = validateSpecialReportBlocks(
    (parsed.data as { blocks?: unknown }).blocks,
  );
  if (blocksError) {
    res.status(400).json({ error: blocksError });
    return;
  }
  // reportDate/incidentDate arrive as Date instances (orval `useDates`); the
  // Drizzle timestamp columns accept Date directly. Undefined fields are
  // skipped by Drizzle, so column defaults (status, reportDate, [] arrays)
  // apply for anything the analyst left blank in a draft.
  const insertValues = parsed.data as InsertSpecialReport;
  const [row] = await db
    .insert(specialReportsTable)
    .values(insertValues)
    .returning();
  res.status(201).json(row);
});

router.patch("/special-reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateSpecialReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const photoError = validateSpotReportPhotos(
    (parsed.data as { photos?: unknown }).photos,
  );
  if (photoError) {
    res.status(400).json({ error: photoError });
    return;
  }
  const coverError = validateCoverDataUrl(
    (parsed.data as { coverImageDataUrl?: unknown }).coverImageDataUrl,
  );
  if (coverError) {
    res.status(400).json({ error: coverError });
    return;
  }
  const blocksError = validateSpecialReportBlocks(
    (parsed.data as { blocks?: unknown }).blocks,
  );
  if (blocksError) {
    res.status(400).json({ error: blocksError });
    return;
  }
  const updateData = {
    ...parsed.data,
    lastEditedAt: new Date(),
  } as Partial<InsertSpecialReport>;
  const [row] = await db
    .update(specialReportsTable)
    .set(updateData)
    .where(eq(specialReportsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/special-reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(specialReportsTable).where(eq(specialReportsTable.id, id));
  res.status(204).end();
});

// Append an export-history entry (one per PDF / Word / plain-text export).
router.post("/special-reports/:id/exports", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = AppendSpecialReportExportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(specialReportsTable)
    .where(eq(specialReportsTable.id, id));
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
    .update(specialReportsTable)
    .set({ exportHistory })
    .where(eq(specialReportsTable.id, id))
    .returning();
  res.json(row);
});

export default router;
