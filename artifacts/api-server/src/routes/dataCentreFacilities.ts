import { Router, type IRouter } from "express";
import {
  db,
  dataCentreFacilitiesTable,
  ENRICHABLE_FACILITY_FIELDS,
} from "@workspace/db";
import type { InsertDataCentreFacility, EnrichmentLocks } from "@workspace/db";
import {
  runDataCentreEnrichment,
  getProviderProfile,
  PROVIDER_PROFILES,
} from "@workspace/ingest";
import { and, asc, eq } from "drizzle-orm";
import {
  CreateDataCentreFacilityBody,
  UpdateDataCentreFacilityBody,
  ListDataCentreFacilitiesQueryParams,
  PreviewDataCentreEnrichmentBody,
  CommitDataCentreEnrichmentBody,
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
  const now = new Date();
  // Pull `enrichmentLocks` OUT of the raw patch — it is not a plain column write;
  // the lock map is rebuilt below from the explicit request plus auto-locking.
  const { enrichmentLocks: lockPatch, ...rest } = parsed.data;
  const updateData = {
    ...rest,
    updatedAt: now,
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
    updateData.statusChangedAt = now;
  }
  // Per-field analyst LOCK maintenance (a locked field is never overwritten by an
  // import):
  //  - an explicit `enrichmentLocks` in the body REPLACES the map (so the UI can
  //    unlock a field by omitting it, or clear all with null);
  //  - editing an enrichable field to a NEW value AUTO-locks that field so a later
  //    import can never silently revert the manual correction.
  const baseLocks: EnrichmentLocks =
    lockPatch !== undefined
      ? (lockPatch ?? {})
      : (existing.enrichmentLocks ?? {});
  const nextLocks: EnrichmentLocks = {};
  for (const field of ENRICHABLE_FACILITY_FIELDS) {
    const held = baseLocks[field];
    if (held) nextLocks[field] = held;
  }
  for (const field of ENRICHABLE_FACILITY_FIELDS) {
    const incoming = (parsed.data as Record<string, unknown>)[field];
    if (incoming !== undefined && incoming !== existing[field]) {
      nextLocks[field] = { lockedAt: now.toISOString() };
    }
  }
  if (lockPatch !== undefined || Object.keys(nextLocks).length > 0) {
    updateData.enrichmentLocks =
      Object.keys(nextLocks).length > 0 ? nextLocks : null;
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

// ---------------------------------------------------------------------------
// Provider-agnostic facility ENRICHMENT (owner-gated). A SUPERVISED import that
// proposes per-field changes to EXISTING registry rows from an external provider
// sample and (separately) commits them. It NEVER creates or deletes a facility,
// never touches incidents, and never overwrites an analyst-LOCKED field. Preview
// is a pure dry-run (no writes); commit re-plans against the live DB and returns
// the changes APPLIED (so its diffs reflect reality at write time, not a stale
// preview). Distinct `/data-centre-enrichment/...` prefix, so no collision with
// the `/data-centre-facilities/:id` param route above.
// ---------------------------------------------------------------------------

router.get(
  "/data-centre-enrichment/providers",
  async (_req, res): Promise<void> => {
    const providers = Object.entries(PROVIDER_PROFILES).map(
      ([token, profile]) => ({
        token,
        name: profile.name,
        format: profile.format,
        columns: Object.values(profile.columnMap),
      }),
    );
    res.json(providers);
  },
);

// Downloadable CSV template (canonical provider columns). Plain CSV — NOT part of
// the JSON API — so the UI can link to it with an ordinary anchor and the browser
// never imports the server-only enrichment engine (which bundles pg → crashes).
router.get(
  "/data-centre-enrichment/template.csv",
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.query.provider)
      ? req.query.provider[0]
      : req.query.provider;
    const token = typeof raw === "string" && raw.trim() ? raw : "generic";
    const profile = getProviderProfile(token);
    if (!profile) {
      res.status(400).json({ error: `Unknown provider: ${String(token)}` });
      return;
    }
    const header = Object.values(profile.columnMap).join(",");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="data-centre-enrichment-template-${profile.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}.csv"`,
    );
    res.send(`${header}\n`);
  },
);

router.post(
  "/data-centre-enrichment/preview",
  async (req, res): Promise<void> => {
    const parsed = PreviewDataCentreEnrichmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const profile = getProviderProfile(parsed.data.provider);
    if (!profile) {
      res
        .status(400)
        .json({ error: `Unknown provider: ${parsed.data.provider}` });
      return;
    }
    const summary = await runDataCentreEnrichment({
      profile,
      fileContent: parsed.data.fileContent,
      commit: false,
      countries: parsed.data.countries ?? undefined,
    });
    res.json(summary);
  },
);

router.post(
  "/data-centre-enrichment/commit",
  async (req, res): Promise<void> => {
    const parsed = CommitDataCentreEnrichmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const profile = getProviderProfile(parsed.data.provider);
    if (!profile) {
      res
        .status(400)
        .json({ error: `Unknown provider: ${parsed.data.provider}` });
      return;
    }
    const summary = await runDataCentreEnrichment({
      profile,
      fileContent: parsed.data.fileContent,
      commit: true,
      countries: parsed.data.countries ?? undefined,
    });
    res.json(summary);
  },
);

export default router;
