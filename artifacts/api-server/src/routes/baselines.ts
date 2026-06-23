import { Router, type IRouter } from "express";
import { db, countryBaselinesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { UpsertCountryBaselineBody } from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

function slugFrom(req: { params: { slug?: string | string[] } }): string {
  const s = req.params.slug;
  return (Array.isArray(s) ? s[0] : s) ?? "";
}

function serialise(row: typeof countryBaselinesTable.$inferSelect) {
  return {
    slug: row.slug,
    operatingEnvironment: row.operatingEnvironment,
    securityContext: row.securityContext,
    knownRiskAreas: row.knownRiskAreas ?? [],
    keyCitiesProvinces: row.keyCitiesProvinces ?? [],
    movementConstraints: row.movementConstraints,
    infrastructureLimits: row.infrastructureLimits,
    medicalEvac: row.medicalEvac,
    resourceSectorExposure: row.resourceSectorExposure,
    locationWatchlist: row.locationWatchlist ?? [],
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/countries/:slug/baseline", async (req, res): Promise<void> => {
  const slug = slugFrom(req);
  const [row] = await db
    .select()
    .from(countryBaselinesTable)
    .where(eq(countryBaselinesTable.slug, slug));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialise(row));
});

router.put("/countries/:slug/baseline", requireAdminToken, async (req, res): Promise<void> => {
  const slug = slugFrom(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const parsed = UpsertCountryBaselineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const v = parsed.data;
  const values = {
    slug,
    operatingEnvironment: v.operatingEnvironment ?? "",
    securityContext: v.securityContext ?? "",
    knownRiskAreas: v.knownRiskAreas ?? [],
    keyCitiesProvinces: v.keyCitiesProvinces ?? [],
    movementConstraints: v.movementConstraints ?? "",
    infrastructureLimits: v.infrastructureLimits ?? "",
    medicalEvac: v.medicalEvac ?? "",
    resourceSectorExposure: v.resourceSectorExposure ?? "",
    locationWatchlist: v.locationWatchlist ?? [],
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(countryBaselinesTable)
    .values(values)
    .onConflictDoUpdate({
      target: countryBaselinesTable.slug,
      set: {
        operatingEnvironment: values.operatingEnvironment,
        securityContext: values.securityContext,
        knownRiskAreas: values.knownRiskAreas,
        keyCitiesProvinces: values.keyCitiesProvinces,
        movementConstraints: values.movementConstraints,
        infrastructureLimits: values.infrastructureLimits,
        medicalEvac: values.medicalEvac,
        resourceSectorExposure: values.resourceSectorExposure,
        locationWatchlist: values.locationWatchlist,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  res.json(serialise(row));
});

router.delete("/countries/:slug/baseline", requireAdminToken, async (req, res): Promise<void> => {
  const slug = slugFrom(req);
  await db.delete(countryBaselinesTable).where(eq(countryBaselinesTable.slug, slug));
  res.status(204).end();
});

export default router;
