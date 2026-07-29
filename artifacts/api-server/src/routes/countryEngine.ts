import { Router, type IRouter } from "express";
import {
  db,
  countryEngineEventsTable,
  countryEngineOverridesTable,
  countryEngineAuditTable,
  countryEngineRunsTable,
} from "@workspace/db";
import { and, desc, eq, sql, count } from "drizzle-orm";
import { z } from "zod";
import { requireAdminToken } from "../lib/adminAuth";
import {
  runCountryEngine,
  applyOverride,
  applyBulkOverride,
} from "../lib/countryEngine";
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

// Optional query params for the engine view: status/category filters and
// paging so the review queue stays usable at 10k+ rows per country. With no
// params the response is unchanged (all events) for existing readers.
const EngineViewQuery = z.object({
  status: z.enum(["included", "excluded", "held"]).optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * GET /countries/:slug/engine — the full engine picture for the admin review
 * queue (owner brief §7/§37): canonical events (from the persisted payloads,
 * optionally filtered/paged), per-status counts, the latest run's stats, and
 * the persisted analyst overrides.
 */
router.get("/countries/:slug/engine", async (req, res): Promise<void> => {
  const slug = slugParam(req.params.slug);
  const parsedQuery = EngineViewQuery.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }
  const { status, category, limit, offset } = parsedQuery.data;

  const conditions = [eq(countryEngineEventsTable.countrySlug, slug)];
  if (status) {
    conditions.push(eq(countryEngineEventsTable.inclusionStatus, status));
  }
  if (category) {
    conditions.push(
      sql`${countryEngineEventsTable.payload}->>'issueCategory' = ${category}`,
    );
  }

  const eventsQuery = db
    .select()
    .from(countryEngineEventsTable)
    .where(and(...conditions))
    .orderBy(desc(countryEngineEventsTable.updatedAt));
  const eventRows =
    limit != null
      ? await eventsQuery.limit(limit).offset(offset ?? 0)
      : await eventsQuery;

  // Per-status counts for the WHOLE country (held backlog at a glance),
  // independent of the list filter.
  const countRows = await db
    .select({
      inclusionStatus: countryEngineEventsTable.inclusionStatus,
      n: count(),
    })
    .from(countryEngineEventsTable)
    .where(eq(countryEngineEventsTable.countrySlug, slug))
    .groupBy(countryEngineEventsTable.inclusionStatus);
  const statusCounts = { included: 0, excluded: 0, held: 0 };
  for (const r of countRows) {
    if (r.inclusionStatus in statusCounts) {
      statusCounts[r.inclusionStatus as keyof typeof statusCounts] = Number(r.n);
    }
  }

  // Total rows matching the list filter (for paging).
  const [matchedRow] = await db
    .select({ n: count() })
    .from(countryEngineEventsTable)
    .where(and(...conditions));

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
    statusCounts,
    totalMatched: Number(matchedRow?.n ?? eventRows.length),
  });
});

/**
 * GET /country-engine/held-summary — per-country inclusion-status counts so
 * the held backlog is visible at a glance across all engine countries.
 */
router.get("/country-engine/held-summary", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      countrySlug: countryEngineEventsTable.countrySlug,
      inclusionStatus: countryEngineEventsTable.inclusionStatus,
      n: count(),
    })
    .from(countryEngineEventsTable)
    .groupBy(
      countryEngineEventsTable.countrySlug,
      countryEngineEventsTable.inclusionStatus,
    );
  const bySlug = new Map<
    string,
    { countrySlug: string; included: number; excluded: number; held: number; total: number }
  >();
  for (const r of rows) {
    const entry =
      bySlug.get(r.countrySlug) ??
      { countrySlug: r.countrySlug, included: 0, excluded: 0, held: 0, total: 0 };
    const n = Number(r.n);
    if (r.inclusionStatus === "included") entry.included += n;
    else if (r.inclusionStatus === "excluded") entry.excluded += n;
    else if (r.inclusionStatus === "held") entry.held += n;
    entry.total += n;
    bySlug.set(r.countrySlug, entry);
  }
  res.json(
    [...bySlug.values()].sort((a, b) => b.held - a.held),
  );
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

// Bulk triage body (review-queue scale, §37). filter selects persisted engine
// events (defaults to the held queue); set applies to every match; dryRun
// previews the match count + sample without changing anything.
const BulkBody = z
  .object({
    filter: z
      .object({
        inclusionStatus: z.enum(["included", "excluded", "held"]).optional(),
        issueCategory: z.enum(ISSUE_CATEGORIES).optional(),
        exclusionReason: z.enum(EXCLUSION_REASONS).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        minConfidence: z.number().int().min(0).max(100).optional(),
        maxConfidence: z.number().int().min(0).max(100).optional(),
      })
      .strict()
      .optional(),
    set: z
      .object({
        inclusionStatus: z.enum(["included", "excluded"]),
        exclusionReason: z.enum(EXCLUSION_REASONS).nullable().optional(),
      })
      .strict(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.set.inclusionStatus !== "excluded" || b.set.exclusionReason != null,
    { message: "exclusionReason is required when bulk-excluding" },
  );

/**
 * POST /countries/:slug/engine/bulk — bulk approve/exclude matching engine
 * events. Admin-token gated, audit-logged as ONE row, re-runs the engine once.
 */
router.post(
  "/countries/:slug/engine/bulk",
  requireAdminToken,
  async (req, res): Promise<void> => {
    const slug = slugParam(req.params.slug);
    const parsed = BulkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const actor =
      (req.isAuthenticated?.() ? req.user?.id : undefined) ?? "admin-token";
    const result = await applyBulkOverride(
      slug,
      parsed.data.filter ?? {},
      parsed.data.set,
      actor,
      parsed.data.dryRun ?? false,
    );
    res.json(result);
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
