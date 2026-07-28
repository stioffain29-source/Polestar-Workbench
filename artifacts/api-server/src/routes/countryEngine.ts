import { Router, type IRouter } from "express";
import {
  db,
  countryEngineEventsTable,
  countryEngineOverridesTable,
  countryEngineAuditTable,
  countryEngineRunsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminToken } from "../lib/adminAuth";
import { runCountryEngine, applyOverride } from "../lib/countryEngine";
import {
  SEVERITIES,
  ISSUE_CATEGORIES,
  LOCATION_PRECISIONS,
  EXCLUSION_REASONS,
} from "@workspace/country-engine/types";

const router: IRouter = Router();

function slugParam(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

// Analyst override body (owner brief §37). This is AnalystEventOverride MINUS
// eventId — the eventId comes from the path — so it is validated separately and
// merged with the path param before persisting.
const OverrideBody = z
  .object({
    physicalCountry: z.string().optional(),
    eventDate: z.string().nullable().optional(),
    // Constrained fields validate against the engine's own vocabularies so an
    // override can never persist a value the engine does not understand.
    issueCategory: z.enum(ISSUE_CATEGORIES).optional(),
    locationPrecision: z.enum(LOCATION_PRECISIONS).optional(),
    severity: z.enum(SEVERITIES).optional(),
    inclusionStatus: z.enum(["included", "excluded", "held"]).optional(),
    exclusionReason: z.enum(EXCLUSION_REASONS).nullable().optional(),
    mergeIntoEventId: z.string().optional(),
    splitSourceIds: z.array(z.string()).optional(),
  })
  .strict();

/**
 * GET /countries/:slug/engine — the full engine picture for the admin review
 * queue (owner brief §7/§37): every canonical event (from the persisted
 * payloads), the latest run's stats, and the persisted analyst overrides.
 */
router.get("/countries/:slug/engine", async (req, res): Promise<void> => {
  const slug = slugParam(req.params.slug);

  const eventRows = await db
    .select()
    .from(countryEngineEventsTable)
    .where(eq(countryEngineEventsTable.countrySlug, slug))
    .orderBy(desc(countryEngineEventsTable.updatedAt));

  const [latestRun] = await db
    .select()
    .from(countryEngineRunsTable)
    .where(eq(countryEngineRunsTable.countrySlug, slug))
    .orderBy(desc(countryEngineRunsTable.ranAt))
    .limit(1);

  const overrideRows = await db
    .select()
    .from(countryEngineOverridesTable)
    .where(eq(countryEngineOverridesTable.countrySlug, slug));

  res.json({
    events: eventRows.map((r) => r.payload),
    stats: latestRun?.stats ?? null,
    overrides: overrideRows.map((r) => r.override),
  });
});

/**
 * POST /countries/:slug/engine/reprocess — re-run the shared engine for a
 * country (owner brief §35 reprocess / §37 "re-run the report"). Admin-token
 * gated like other mutations. Returns the fresh run stats.
 */
router.post(
  "/countries/:slug/engine/reprocess",
  requireAdminToken,
  async (req, res): Promise<void> => {
    const slug = slugParam(req.params.slug);
    const result = await runCountryEngine(slug);
    res.json({
      stats: result.stats,
      eventsTotal: result.events.length,
      included: result.included.length,
      held: result.held.length,
      excluded: result.excluded.length,
    });
  },
);

/**
 * PATCH /countries/:slug/engine/events/:eventId — apply an analyst override to
 * one canonical event (owner brief §37: merge/split/change country/correct
 * date/category/precision/severity/exclude/approve). Admin-token gated,
 * audit-logged, re-runs the engine, and returns the updated event.
 */
router.patch(
  "/countries/:slug/engine/events/:eventId",
  requireAdminToken,
  async (req, res): Promise<void> => {
    const slug = slugParam(req.params.slug);
    const eventId = slugParam(req.params.eventId);
    const parsed = OverrideBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const actor =
      (req.isAuthenticated?.() ? req.user?.id : undefined) ?? "admin-token";
    await applyOverride(
      slug,
      // The zod schema above mirrors AnalystEventOverride's enums exactly, so
      // the merged object is a valid override without any type escape hatch.
      { eventId, ...parsed.data },
      actor,
    );
    const [row] = await db
      .select()
      .from(countryEngineEventsTable)
      .where(
        and(
          eq(countryEngineEventsTable.countrySlug, slug),
          eq(countryEngineEventsTable.eventId, eventId),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row.payload);
  },
);

/**
 * GET /countries/:slug/engine/audit — recent audit-log rows (owner brief §37:
 * all manual changes must be recorded in an audit log).
 */
router.get("/countries/:slug/engine/audit", async (req, res): Promise<void> => {
  const slug = slugParam(req.params.slug);
  const rows = await db
    .select()
    .from(countryEngineAuditTable)
    .where(eq(countryEngineAuditTable.countrySlug, slug))
    .orderBy(desc(countryEngineAuditTable.createdAt))
    .limit(100);
  res.json(rows);
});

export default router;
