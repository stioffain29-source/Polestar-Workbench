import { Router, type IRouter } from "express";
import { db, dataCentreFacilitiesTable } from "@workspace/db";
import type { InsertDataCentreFacility } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import {
  CreateDataCentreFacilityBody,
  UpdateDataCentreFacilityBody,
  ListDataCentreFacilitiesQueryParams,
} from "@workspace/api-zod";

// Owner-gated CRUD for the analyst-maintained Data Centre facility REGISTRY.
//
// CRITICAL PRODUCT RULE: a registry facility is NEVER an incident and can never
// inflate any incident count. This router only ever touches the isolated
// `data_centre_facilities` table; `linkedIncidentId` is an OPTIONAL analyst
// association that never creates or removes an incident.
//
// Mounted AFTER `requireOwner` in routes/index.ts, so every method here is
// owner-only (401 anonymous / 403 non-owner) exactly like spot reports.

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/data-centre-facilities", async (req, res): Promise<void> => {
  const parsed = ListDataCentreFacilitiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { country, status } = parsed.data;
  const conds = [];
  if (country) conds.push(eq(dataCentreFacilitiesTable.country, country));
  if (status) conds.push(eq(dataCentreFacilitiesTable.status, status));
  const rows = await db
    .select()
    .from(dataCentreFacilitiesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(dataCentreFacilitiesTable.country), asc(dataCentreFacilitiesTable.name));
  res.json(rows);
});

router.get("/data-centre-facilities/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db
    .select()
    .from(dataCentreFacilitiesTable)
    .where(eq(dataCentreFacilitiesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/data-centre-facilities", async (req, res): Promise<void> => {
  const parsed = CreateDataCentreFacilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Date fields arrive as Date instances (orval `useDates`); Drizzle timestamp
  // columns accept Date directly and skip undefined fields so column defaults
  // (status/planningRisk 'Unknown', statusChanged false) apply for blanks.
  const insertValues = parsed.data as InsertDataCentreFacility;
  const [row] = await db
    .insert(dataCentreFacilitiesTable)
    .values(insertValues)
    .returning();
  res.status(201).json(row);
});

router.patch("/data-centre-facilities/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateDataCentreFacilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(dataCentreFacilitiesTable)
    .where(eq(dataCentreFacilitiesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const updateData = {
    ...parsed.data,
    updatedAt: new Date(),
  } as Partial<InsertDataCentreFacility>;
  // Status-transition tracking: when the status is updated to a DIFFERENT value,
  // stamp the recent-mover fields so the monitor can highlight it. When status
  // is unchanged (or absent from the patch) these fields are left as-is.
  if (
    parsed.data.status !== undefined &&
    parsed.data.status !== existing.status
  ) {
    updateData.statusChanged = true;
    updateData.previousStatus = existing.status;
    updateData.statusChangedAt = new Date();
  }
  const [row] = await db
    .update(dataCentreFacilitiesTable)
    .set(updateData)
    .where(eq(dataCentreFacilitiesTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/data-centre-facilities/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(dataCentreFacilitiesTable).where(eq(dataCentreFacilitiesTable.id, id));
  res.status(204).end();
});

export default router;
