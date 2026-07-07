import { Router, type IRouter } from "express";
import { db, dataCentreCountryRiskTable } from "@workspace/db";
import type { InsertDataCentreCountryRisk } from "@workspace/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  CreateDataCentreCountryRiskBody,
  UpdateDataCentreCountryRiskBody,
  ListDataCentreCountryRiskQueryParams,
} from "@workspace/api-zod";

// Owner-gated CRUD for the per-country DATA-CENTRE RISK FRAMEWORK.
//
// CRITICAL PRODUCT RULE: this router only touches the isolated
// `data_centre_country_risk` table. It is CONTEXT — it never reads, writes,
// creates, or removes an incident and can never inflate any incident count.
//
// STRICT no-fabrication: a dimension with no rating stays "not reported"; this
// router never invents a rating. Auto-seeding is done OUT-OF-BAND by the CPI
// import CLI, never here.
//
// Country is normalised (trimmed) on write and is UNIQUE case-insensitively
// (lower(country) unique index), so the same country cannot be assessed twice.
//
// Mounted AFTER `requireOwner` in routes/index.ts, so every method is owner-only
// (401 anonymous / 403 non-owner).

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

router.get("/data-centre-country-risk", async (req, res): Promise<void> => {
  const parsed = ListDataCentreCountryRiskQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { country } = parsed.data;
  const conds = [];
  if (country) {
    conds.push(
      eq(
        sql`lower(${dataCentreCountryRiskTable.country})`,
        country.trim().toLowerCase(),
      ),
    );
  }
  const rows = await db
    .select()
    .from(dataCentreCountryRiskTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(dataCentreCountryRiskTable.country));
  res.json(rows);
});

router.get("/data-centre-country-risk/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db
    .select()
    .from(dataCentreCountryRiskTable)
    .where(eq(dataCentreCountryRiskTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/data-centre-country-risk", async (req, res): Promise<void> => {
  const parsed = CreateDataCentreCountryRiskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const country = parsed.data.country.trim();
  if (!country) {
    res.status(400).json({ error: "country must not be blank" });
    return;
  }
  // Case-insensitive uniqueness: reject a country already on file.
  const [dupe] = await db
    .select({ id: dataCentreCountryRiskTable.id })
    .from(dataCentreCountryRiskTable)
    .where(
      eq(
        sql`lower(${dataCentreCountryRiskTable.country})`,
        country.toLowerCase(),
      ),
    );
  if (dupe) {
    res
      .status(409)
      .json({ error: `A risk assessment for "${country}" already exists.` });
    return;
  }
  const insertValues = {
    ...parsed.data,
    country,
  } as InsertDataCentreCountryRisk;
  const [row] = await db
    .insert(dataCentreCountryRiskTable)
    .values(insertValues)
    .returning();
  res.status(201).json(row);
});

router.patch("/data-centre-country-risk/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateDataCentreCountryRiskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(dataCentreCountryRiskTable)
    .where(eq(dataCentreCountryRiskTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Full-object replace: whatever fields are supplied overwrite wholesale (the
  // `dimensions` map is replaced in full, never per-key merged).
  const updateData: Partial<InsertDataCentreCountryRisk> = {
    ...parsed.data,
    updatedAt: new Date(),
  };
  if (parsed.data.country !== undefined) {
    const country = parsed.data.country.trim();
    if (!country) {
      res.status(400).json({ error: "country must not be blank" });
      return;
    }
    // If the (case-insensitive) country changed, guard the uniqueness index.
    if (country.toLowerCase() !== existing.country.toLowerCase()) {
      const [dupe] = await db
        .select({ id: dataCentreCountryRiskTable.id })
        .from(dataCentreCountryRiskTable)
        .where(
          and(
            eq(
              sql`lower(${dataCentreCountryRiskTable.country})`,
              country.toLowerCase(),
            ),
            ne(dataCentreCountryRiskTable.id, id),
          ),
        );
      if (dupe) {
        res
          .status(409)
          .json({ error: `A risk assessment for "${country}" already exists.` });
        return;
      }
    }
    updateData.country = country;
  }
  const [row] = await db
    .update(dataCentreCountryRiskTable)
    .set(updateData)
    .where(eq(dataCentreCountryRiskTable.id, id))
    .returning();
  res.json(row);
});

router.delete(
  "/data-centre-country-risk/:id",
  async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    await db
      .delete(dataCentreCountryRiskTable)
      .where(eq(dataCentreCountryRiskTable.id, id));
    res.status(204).end();
  },
);

export default router;
