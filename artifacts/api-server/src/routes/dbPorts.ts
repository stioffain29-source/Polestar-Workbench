import { Router, type IRouter, type Response } from "express";
import {
  db,
  dbPortsSettingsTable,
} from "@workspace/db";
import {
  DEFAULT_DB_PORTS_SETTINGS,
  assessDbPortsItem,
  buildDbPortsQuality,
  importDbPortsDiscovery,
  type DbPortsItem,
} from "@workspace/db-ports";
import {
  AddDbPortsItemBody,
  AddDbPortsWorklogBody,
  CreateDbPortsEditionBody,
  DeleteDbPortsEditionBody,
  DeleteDbPortsWorklogBody,
  ImportDbPortsCandidatesBody,
  MergeDbPortsItemsBody,
  PrepareDbPortsExportBody,
  RecordDbPortsCoverageBody,
  UpdateDbPortsEditionBody,
  UpdateDbPortsItemBody,
  UpdateDbPortsSettingsBody,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import {
  DbPortsConflictError,
  DbPortsNotFoundError,
  DbPortsValidationError,
  appendHistory,
  assertDispositionCaps,
  audit,
  contentEdit,
  createEdition,
  deleteEdition,
  getEditionRow,
  listEditions,
  makeItem,
  mutateEdition,
  toEdition,
  updateItemPreservingEvidence,
} from "../lib/dbPortsEditions";
import { readDbPortsDiscovery } from "../lib/dbPortsDiscovery";
import {
  isPositiveInteger,
  validateCalendarDate,
  validateItemContent,
  validateSettings,
} from "../lib/dbPortsValidation";

const router: IRouter = Router();

function idParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const number = Number(value);
  return isPositiveInteger(number) && String(number) === value ? number : null;
}

function bad(res: Response, error: string): void {
  res.status(400).json({ error });
}

function fail(res: Response, error: unknown): void {
  if (error instanceof DbPortsNotFoundError) res.status(404).json({ error: error.message });
  else if (error instanceof DbPortsConflictError) res.status(409).json({ error: error.message });
  else if (error instanceof DbPortsValidationError || error instanceof Error) {
    res.status(error instanceof DbPortsValidationError ? 400 : 500).json({ error: error.message });
  } else res.status(500).json({ error: "DB Ports operation failed." });
}

function parseBody<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: Error } },
  value: unknown,
  res: Response,
): T | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    bad(res, parsed.error.message);
    return null;
  }
  return parsed.data;
}

router.get("/db-ports/editions", async (_req, res): Promise<void> => {
  try {
    res.json(await listEditions());
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions", async (req, res): Promise<void> => {
  const body = parseBody(CreateDbPortsEditionBody, req.body, res);
  if (!body) return;
  const dateError = validateCalendarDate(body.endDate);
  if (dateError) return bad(res, dateError);
  try {
    res.status(201).json(await createEdition(body.endDate, body.title));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/db-ports/editions/:id", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) return bad(res, "Edition id must be a positive integer.");
  try {
    res.json(toEdition(await getEditionRow(id)));
  } catch (error) {
    fail(res, error);
  }
});

router.patch("/db-ports/editions/:id", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(UpdateDbPortsEditionBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    const edition = await mutateEdition(id, body.revision, (row, now) => {
      const changes = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.overview !== undefined ? { overview: body.overview } : {}),
      };
      const contentChanged = body.title !== undefined || body.overview !== undefined;
      if (contentChanged) {
        return contentEdit(row, changes, "edition_edited", "Title or overview edited; approval reset.", now);
      }
      if (body.status === "approved") {
        if (row.status !== "in_review") {
          throw new DbPortsValidationError("Approval requires a prior in-review revision.");
        }
        const candidate = toEdition({ ...row, ...changes });
        if (!candidate.quality.readyForReview) {
          throw new DbPortsValidationError(candidate.quality.blockers.join(" "));
        }
        return {
          ...changes,
          status: "approved",
          approvedAt: now,
          history: appendHistory(row, audit("edition_approved", "Approved after quality and prior review checks.", now)),
        };
      }
      if (body.status) {
        return {
          ...changes,
          status: body.status,
          approvedAt: null,
          history: appendHistory(row, audit("status_changed", `Status changed to ${body.status}.`, now)),
        };
      }
      return { history: appendHistory(row, audit("edition_touched", "Edition revision updated.", now)) };
    });
    res.json(edition);
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/db-ports/editions/:id", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(DeleteDbPortsEditionBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    await deleteEdition(id, body.revision);
    res.status(204).end();
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/items", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(AddDbPortsItemBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  const itemError = validateItemContent(body.item);
  if (itemError) return bad(res, itemError);
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      if (row.items.length >= 200) throw new DbPortsValidationError("An edition is limited to 200 items.");
      const item = makeItem(body.item, row, now);
      const items = [...row.items, item];
      assertDispositionCaps(items);
      return contentEdit(row, { items }, "item_added", `Added item ${item.id}.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.patch("/db-ports/editions/:id/items/:itemId", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(UpdateDbPortsItemBody, req.body, res);
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  if (!id || !body || !itemId) {
    if ((!id || !itemId) && body) bad(res, "Edition and item ids are required.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  const itemError = validateItemContent(body.item);
  if (itemError) return bad(res, itemError);
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      const index = row.items.findIndex((item) => item.id === itemId);
      if (index < 0) throw new DbPortsNotFoundError("Item not found.");
      const { item, correctionSummary } = updateItemPreservingEvidence(row.items[index]!, body.item, row, now);
      const items = row.items.map((existing, position) => position === index ? item : existing);
      assertDispositionCaps(items);
      const detail = correctionSummary
        ? `Updated item ${itemId}; evidence metadata corrected (${correctionSummary}).`
        : `Updated item ${itemId}.`;
      return contentEdit(row, { items }, correctionSummary ? "evidence_corrected" : "item_updated", detail, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/merge", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(MergeDbPortsItemsBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      if (body.sourceItemId === body.targetItemId) throw new DbPortsValidationError("An item cannot be merged into itself.");
      const sourceIndex = row.items.findIndex((item) => item.id === body.sourceItemId);
      const targetIndex = row.items.findIndex((item) => item.id === body.targetItemId);
      if (sourceIndex < 0 || targetIndex < 0) throw new DbPortsNotFoundError("Merge item not found.");
      const source = row.items[sourceIndex]!;
      const target = row.items[targetIndex]!;
      let cursor: DbPortsItem | undefined = target;
      const seen = new Set<string>();
      while (cursor?.mergedInto) {
        if (cursor.mergedInto === source.id || seen.has(cursor.mergedInto)) {
          throw new DbPortsValidationError("Merge would create a cycle.");
        }
        seen.add(cursor.mergedInto);
        cursor = row.items.find((item) => item.id === cursor!.mergedInto);
      }
      if (target.mergedInto) throw new DbPortsValidationError("Merge into the active target item instead.");
      const evidence = [...target.evidence];
      for (const entry of source.evidence) {
        if (!evidence.some((existing) => existing.id === entry.id)) evidence.push(entry);
      }
      if (evidence.length > 12) throw new DbPortsValidationError("Merged evidence would exceed the 12-source limit.");
      const targetContent = {
        ...target,
        evidence,
        disposition: target.disposition === "selected" ? "hold" as const : target.disposition,
        reviewed: false,
        confidence: "unverified" as const,
      };
      const mergedTarget = {
        ...targetContent,
        updatedAt: now,
        ...assessDbPortsItem(targetContent, row),
      };
      const mergedSource = {
        ...source,
        disposition: "rejected" as const,
        mergedInto: target.id,
        reviewed: false,
        updatedAt: now,
        ...assessDbPortsItem({ ...source, disposition: "rejected", reviewed: false }, row),
      };
      const items = row.items.map((item, index) =>
        index === targetIndex ? mergedTarget : index === sourceIndex ? mergedSource : item);
      return contentEdit(row, { items }, "items_merged", `Merged ${source.id} into ${target.id}; all evidence retained.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/worklog", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(AddDbPortsWorklogBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision) || !Number.isInteger(body.minutes)) {
    return bad(res, "Revision and minutes must be integers.");
  }
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      if (row.worklog.length >= 500) throw new DbPortsValidationError("An edition is limited to 500 worklog entries.");
      const entry = { id: crypto.randomUUID(), activity: body.activity, minutes: body.minutes, notes: body.notes, createdAt: now };
      return contentEdit(row, { worklog: [...row.worklog, entry] }, "worklog_added", `Logged ${body.minutes} minutes for ${body.activity}.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/db-ports/editions/:id/worklog/:entryId", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(DeleteDbPortsWorklogBody, req.body, res);
  const entryId = Array.isArray(req.params.entryId) ? req.params.entryId[0] : req.params.entryId;
  if (!id || !body || !entryId) {
    if ((!id || !entryId) && body) bad(res, "Edition and worklog ids are required.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      const worklog = row.worklog.filter((entry) => entry.id !== entryId);
      if (worklog.length === row.worklog.length) throw new DbPortsNotFoundError("Worklog entry not found.");
      return contentEdit(row, { worklog }, "worklog_deleted", `Deleted worklog entry ${entryId}.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/coverage", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(RecordDbPortsCoverageBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      const check = { sourceId: body.sourceId, status: body.status, notes: body.notes, checkedAt: now };
      const coverage = [...row.coverage.filter((entry) => entry.sourceId !== body.sourceId), check];
      return contentEdit(row, { coverage }, "coverage_recorded", `Recorded ${body.status} for source ${body.sourceId}.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/import", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(ImportDbPortsCandidatesBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    const row = await getEditionRow(id);
    if (row.revision !== body.revision) throw new DbPortsConflictError("Edition revision has changed.");
    const discovery = await readDbPortsDiscovery(row);
    const [savedSettings] = await db.select().from(dbPortsSettingsTable).where(eq(dbPortsSettingsTable.id, 1));
    const watchlist = savedSettings?.watchlist ?? DEFAULT_DB_PORTS_SETTINGS.watchlist;
    res.json(await mutateEdition(id, body.revision, (current, now) => {
      const result = importDbPortsDiscovery(discovery.rows, current.items, current, watchlist, now);
      const truncated = discovery.truncated || result.truncated;
      const detail = `Scanned ${result.scanned}; added ${result.added}; duplicates ${result.duplicates}; capped ${truncated ? "yes" : "no"}. No coverage checks were inferred.`;
      return contentEdit(current, { items: result.items }, "discovery_imported", detail, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/db-ports/settings", async (_req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(dbPortsSettingsTable).where(eq(dbPortsSettingsTable.id, 1));
    res.json(row ? {
      revision: row.revision,
      sources: row.sources,
      watchlist: row.watchlist,
      notes: row.notes,
      updatedAt: row.updatedAt,
    } : DEFAULT_DB_PORTS_SETTINGS);
  } catch (error) {
    fail(res, error);
  }
});

router.put("/db-ports/settings", async (req, res): Promise<void> => {
  const body = parseBody(UpdateDbPortsSettingsBody, req.body, res);
  if (!body) return;
  if (!Number.isInteger(body.revision) || body.revision < 0) return bad(res, "Revision must be a non-negative integer.");
  const validationError = validateSettings(body);
  if (validationError) return bad(res, validationError);
  const now = new Date().toISOString();
  try {
    if (body.revision === 0) {
      const [created] = await db.insert(dbPortsSettingsTable).values({
        id: 1,
        revision: 1,
        sources: body.sources,
        watchlist: body.watchlist,
        notes: body.notes,
        updatedAt: now,
      }).onConflictDoNothing({ target: dbPortsSettingsTable.id }).returning();
      if (!created) throw new DbPortsConflictError("Settings were already created; reload before saving.");
      res.json({ revision: created.revision, sources: created.sources, watchlist: created.watchlist, notes: created.notes, updatedAt: created.updatedAt });
      return;
    }
    const [updated] = await db.update(dbPortsSettingsTable).set({
      revision: body.revision + 1,
      sources: body.sources,
      watchlist: body.watchlist,
      notes: body.notes,
      updatedAt: now,
    }).where(and(eq(dbPortsSettingsTable.id, 1), eq(dbPortsSettingsTable.revision, body.revision))).returning();
    if (!updated) throw new DbPortsConflictError("Settings revision has changed.");
    res.json({ revision: updated.revision, sources: updated.sources, watchlist: updated.watchlist, notes: updated.notes, updatedAt: updated.updatedAt });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/export", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(PrepareDbPortsExportBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    const row = await getEditionRow(id);
    if (row.revision !== body.revision) throw new DbPortsConflictError("Edition revision has changed.");
    let edition = toEdition(row);
    if (body.mode === "reviewed") {
      const quality = buildDbPortsQuality(edition);
      if (edition.status !== "approved" || !quality.readyForReview) {
        throw new DbPortsValidationError("Reviewed export requires an approved edition that still passes quality checks.");
      }
    } else {
      edition = {
        ...edition,
        items: edition.items.map((item) =>
          item.disposition === "inbox" || item.disposition === "hold"
            ? { ...item, blockers: ["UNVERIFIED WORKING APPENDIX — not approved for distribution.", ...item.blockers] }
            : item),
      };
    }
    res.json({ edition, mode: body.mode, generatedAt: new Date().toISOString() });
  } catch (error) {
    fail(res, error);
  }
});

export default router;