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

// Photo ceilings. Photos are base64 image data URLs stored in jsonb and
// rasterised into the DOM/PDF, so cap count and bytes to keep rows, requests
// and PDF rendering bounded. Mirrored by the editor's client-side guard.
const MAX_PHOTOS = 24;
const MAX_PHOTO_DATAURL_BYTES = 4 * 1024 * 1024;
const MAX_PHOTOS_TOTAL_BYTES = 28 * 1024 * 1024;
const PHOTO_DATAURL_RE = /^data:image\/(jpeg|png|webp|gif);base64,/;

type PhotoLike = { dataUrl?: unknown };

/**
 * Validate a photos payload. Returns an error message, or null when valid or
 * absent (PATCH may omit photos). Keeps oversized/non-image data URLs out of
 * the jsonb column even though express.json now accepts large bodies.
 */
function validatePhotos(photos: unknown): string | null {
  if (photos === undefined) return null;
  if (!Array.isArray(photos)) return "photos must be an array";
  if (photos.length > MAX_PHOTOS) {
    return `Too many photos (max ${MAX_PHOTOS}).`;
  }
  let total = 0;
  for (const p of photos as PhotoLike[]) {
    const dataUrl = p?.dataUrl;
    if (typeof dataUrl !== "string" || !PHOTO_DATAURL_RE.test(dataUrl)) {
      return "Each photo must be an image data URL (jpeg, png, webp or gif).";
    }
    const bytes = Buffer.byteLength(dataUrl, "utf8");
    if (bytes > MAX_PHOTO_DATAURL_BYTES) {
      return "A photo is too large; please use a smaller image.";
    }
    total += bytes;
  }
  if (total > MAX_PHOTOS_TOTAL_BYTES) {
    return "Photos exceed the total size limit; please remove or shrink some.";
  }
  return null;
}

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
  const photoError = validatePhotos((parsed.data as { photos?: unknown }).photos);
  if (photoError) {
    res.status(400).json({ error: photoError });
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
  const photoError = validatePhotos((parsed.data as { photos?: unknown }).photos);
  if (photoError) {
    res.status(400).json({ error: photoError });
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
