import { Router, type IRouter, type Response } from "express";
import {
  db,
  dbPortsSettingsTable,
} from "@workspace/db";
import {
  DEFAULT_DB_PORTS_PARAMETERS,
  DEFAULT_DB_PORTS_SETTINGS,
  assessDbPortsItem,
  editionWindow,
  importDbPortsDiscovery,
  normaliseParameters,
  normaliseStoredItems,
  type DbPortsItem,
  type DbPortsParameters,
} from "@workspace/db-ports";
import {
  AddDbPortsItemBody,
  CreateDbPortsEditionBody,
  DeleteDbPortsEditionBody,
  GenerateDbPortsDraftBody,
  ImportDbPortsCandidatesBody,
  MergeDbPortsItemsBody,
  PrepareDbPortsExportBody,
  RecordDbPortsCoverageBody,
  RegenerateDbPortsItemBody,
  RegenerateDbPortsOverviewBody,
  ReorderDbPortsItemsBody,
  DeleteDbPortsItemBody,
  UpdateDbPortsEditionBody,
  UpdateDbPortsItemBody,
  UpdateDbPortsSettingsBody,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import {
  DbPortsConflictError,
  DbPortsNotFoundError,
  DbPortsValidationError,
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
import {
  generateDbPortsDraft,
  generateDbPortsOverview,
  regenerateDbPortsItem,
} from "../lib/dbPortsGenerate";
import { readDbPortsDiscovery } from "../lib/dbPortsDiscovery";
import {
  isPositiveInteger,
  validateCalendarDate,
  validateItemContent,
  validateParameters,
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
  } else res.status(500).json({ error: "The ports report operation failed." });
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

async function readSettings(): Promise<{
  revision: number;
  sources: typeof DEFAULT_DB_PORTS_SETTINGS.sources;
  watchlist: typeof DEFAULT_DB_PORTS_SETTINGS.watchlist;
  notes: string;
  defaults: DbPortsParameters;
  updatedAt: string | null;
}> {
  const [row] = await db.select().from(dbPortsSettingsTable).where(eq(dbPortsSettingsTable.id, 1));
  if (!row) return DEFAULT_DB_PORTS_SETTINGS;
  return {
    revision: row.revision,
    sources: row.sources,
    watchlist: row.watchlist,
    notes: row.notes,
    defaults: normaliseParameters(row.defaults),
    updatedAt: row.updatedAt,
  };
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
    const settings = await readSettings();
    res.status(201).json(await createEdition(body.endDate, settings.defaults, body.title));
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
  if (body.endDate) {
    const dateError = validateCalendarDate(body.endDate);
    if (dateError) return bad(res, dateError);
  }
  if (body.parameters) {
    const parameterError = validateParameters(body.parameters);
    if (parameterError) return bad(res, parameterError);
  }
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      const period = body.endDate && body.endDate !== row.endDate ? editionWindow(body.endDate) : null;
      const changes = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.overview !== undefined ? { overview: body.overview } : {}),
        ...(body.parameters ? { parameters: normaliseParameters(body.parameters) } : {}),
        ...(period ?? {}),
      };
      const detail = [
        body.title !== undefined ? "title" : "",
        body.overview !== undefined ? "overview" : "",
        body.parameters ? "parameters" : "",
        period ? "reporting period" : "",
      ].filter(Boolean).join(", ") || "no fields";
      return contentEdit(row, changes, "edition_edited", `Edited ${detail}.`, now);
    }));
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

router.post("/db-ports/editions/:id/generate", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(GenerateDbPortsDraftBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    const settings = await readSettings();
    res.json(await mutateEdition(id, body.revision, async (row, now) => {
      const parameters = normaliseParameters(row.parameters, settings.defaults);
      const generation = await generateDbPortsDraft(
        { startDate: row.startDate, endDate: row.endDate, items: normaliseStoredItems(row.items) },
        parameters,
        settings.watchlist,
        now,
      );
      assertDispositionCaps(generation.items);
      return contentEdit(
        row,
        {
          items: generation.items,
          // Written unconditionally: an overview kept from an earlier run would
          // describe items this run has removed.
          overview: generation.overview,
        },
        "draft_generated",
        generation.detail,
        now,
      );
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/overview", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(RegenerateDbPortsOverviewBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, async (row, now) => {
      const parameters = normaliseParameters(row.parameters);
      const overview = await generateDbPortsOverview(normaliseStoredItems(row.items), parameters, row);
      return contentEdit(row, { overview }, "overview_generated", "Regenerated the Regional Overview from the current items.", now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/items/:itemId/regenerate", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(RegenerateDbPortsItemBody, req.body, res);
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  if (!id || !body || !itemId) {
    if ((!id || !itemId) && body) bad(res, "Edition and item ids are required.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, async (row, now) => {
      const items = normaliseStoredItems(row.items);
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) throw new DbPortsNotFoundError("Item not found.");
      const parameters = normaliseParameters(row.parameters);
      const regenerated = await regenerateDbPortsItem(items[index]!, parameters, row, now);
      const next = items.map((item, position) => position === index ? regenerated : item);
      return contentEdit(row, { items: next }, "item_regenerated", `Regenerated item ${itemId} from its retained sources.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/db-ports/editions/:id/reorder", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(ReorderDbPortsItemsBody, req.body, res);
  if (!id || !body) {
    if (!id && body) bad(res, "Edition id must be a positive integer.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      const items = normaliseStoredItems(row.items);
      if (body.itemIds.some((itemId) => !items.some((item) => item.id === itemId))) {
        throw new DbPortsNotFoundError("Reorder referenced an item that is not in this report.");
      }
      const order = new Map(body.itemIds.map((itemId, index) => [itemId, index]));
      // Stable sort: anything the caller did not list keeps its relative place.
      const next = [...items].sort((a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      return contentEdit(row, { items: next }, "items_reordered", `Reordered ${body.itemIds.length} items.`, now);
    }));
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
      const items = [...normaliseStoredItems(row.items), item];
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
      const items = normaliseStoredItems(row.items);
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) throw new DbPortsNotFoundError("Item not found.");
      const item = updateItemPreservingEvidence(items[index]!, body.item, row, now);
      const next = items.map((existing, position) => position === index ? item : existing);
      assertDispositionCaps(next);
      return contentEdit(row, { items: next }, "item_updated", `Updated item ${itemId}.`, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/db-ports/editions/:id/items/:itemId", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  const body = parseBody(DeleteDbPortsItemBody, req.body, res);
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  if (!id || !body || !itemId) {
    if ((!id || !itemId) && body) bad(res, "Edition and item ids are required.");
    return;
  }
  if (!isPositiveInteger(body.revision)) return bad(res, "Revision must be a positive integer.");
  try {
    res.json(await mutateEdition(id, body.revision, (row, now) => {
      const items = normaliseStoredItems(row.items);
      if (!items.some((item) => item.id === itemId)) throw new DbPortsNotFoundError("Item not found.");
      // Anything folded into this item is restored rather than deleted with it:
      // corroborating material must never disappear as a side effect.
      const restored = items.filter((item) => item.mergedInto === itemId).length;
      const next = items
        .filter((item) => item.id !== itemId)
        .map((item) => item.mergedInto === itemId
          ? {
              ...item,
              mergedInto: null,
              disposition: "hold" as const,
              updatedAt: now,
              missingInfo: [item.missingInfo, "Restored when the item it had been merged into was deleted."]
                .filter(Boolean).join(" ").slice(0, 4000),
            }
          : item);
      assertDispositionCaps(next);
      const detail = restored
        ? `Deleted item ${itemId} and restored ${restored} merged item(s) to held.`
        : `Deleted item ${itemId}.`;
      return contentEdit(row, { items: next }, "item_deleted", detail, now);
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
      const items = normaliseStoredItems(row.items);
      const sourceIndex = items.findIndex((item) => item.id === body.sourceItemId);
      const targetIndex = items.findIndex((item) => item.id === body.targetItemId);
      if (sourceIndex < 0 || targetIndex < 0) throw new DbPortsNotFoundError("Merge item not found.");
      const source = items[sourceIndex]!;
      const target = items[targetIndex]!;
      let cursor: DbPortsItem | undefined = target;
      const seen = new Set<string>();
      while (cursor?.mergedInto) {
        if (cursor.mergedInto === source.id || seen.has(cursor.mergedInto)) {
          throw new DbPortsValidationError("Merge would create a cycle.");
        }
        seen.add(cursor.mergedInto);
        cursor = items.find((item) => item.id === cursor!.mergedInto);
      }
      if (target.mergedInto) throw new DbPortsValidationError("Merge into the active target item instead.");
      const evidence = [...target.evidence];
      for (const entry of source.evidence) {
        if (!evidence.some((existing) => existing.id === entry.id)) evidence.push(entry);
      }
      if (evidence.length > 12) throw new DbPortsValidationError("Merged sources would exceed the 12-source limit.");
      const parameters = normaliseParameters(row.parameters);
      const targetContent = { ...target, evidence };
      const mergedTarget = {
        ...targetContent,
        updatedAt: now,
        warnings: assessDbPortsItem(targetContent, row, parameters),
      };
      const sourceContent = { ...source, disposition: "rejected" as const };
      const mergedSource = {
        ...sourceContent,
        mergedInto: target.id,
        updatedAt: now,
        warnings: assessDbPortsItem(sourceContent, row, parameters),
      };
      const next = items.map((item, index) =>
        index === targetIndex ? mergedTarget : index === sourceIndex ? mergedSource : item);
      return contentEdit(row, { items: next }, "items_merged", `Merged ${source.id} into ${target.id}; all sources retained.`, now);
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
    const settings = await readSettings();
    res.json(await mutateEdition(id, body.revision, (current, now) => {
      const result = importDbPortsDiscovery(
        discovery.rows,
        normaliseStoredItems(current.items),
        current,
        settings.watchlist,
        now,
      );
      const truncated = discovery.truncated || result.truncated;
      const detail = `Scanned ${result.scanned}; added ${result.added}; duplicates ${result.duplicates}; capped ${truncated ? "yes" : "no"}.`;
      return contentEdit(current, { items: result.items }, "collection_imported", detail, now);
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/db-ports/settings", async (_req, res): Promise<void> => {
  try {
    res.json(await readSettings());
  } catch (error) {
    fail(res, error);
  }
});

router.put("/db-ports/settings", async (req, res): Promise<void> => {
  const body = parseBody(UpdateDbPortsSettingsBody, req.body, res);
  if (!body) return;
  if (!Number.isInteger(body.revision) || body.revision < 0) return bad(res, "Revision must be a non-negative integer.");
  const validationError = validateSettings(body) ?? validateParameters(body.defaults);
  if (validationError) return bad(res, validationError);
  const now = new Date().toISOString();
  const defaults = normaliseParameters(body.defaults, DEFAULT_DB_PORTS_PARAMETERS);
  try {
    if (body.revision === 0) {
      const [created] = await db.insert(dbPortsSettingsTable).values({
        id: 1,
        revision: 1,
        sources: body.sources,
        watchlist: body.watchlist,
        notes: body.notes,
        defaults,
        updatedAt: now,
      }).onConflictDoNothing({ target: dbPortsSettingsTable.id }).returning();
      if (!created) throw new DbPortsConflictError("Settings were already created; reload before saving.");
      res.json({
        revision: created.revision,
        sources: created.sources,
        watchlist: created.watchlist,
        notes: created.notes,
        defaults: normaliseParameters(created.defaults),
        updatedAt: created.updatedAt,
      });
      return;
    }
    const [updated] = await db.update(dbPortsSettingsTable).set({
      revision: body.revision + 1,
      sources: body.sources,
      watchlist: body.watchlist,
      notes: body.notes,
      defaults,
      updatedAt: now,
    }).where(and(eq(dbPortsSettingsTable.id, 1), eq(dbPortsSettingsTable.revision, body.revision))).returning();
    if (!updated) throw new DbPortsConflictError("Settings revision has changed.");
    res.json({
      revision: updated.revision,
      sources: updated.sources,
      watchlist: updated.watchlist,
      notes: updated.notes,
      defaults: normaliseParameters(updated.defaults),
      updatedAt: updated.updatedAt,
    });
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
    res.json({ edition: toEdition(row), generatedAt: new Date().toISOString() });
  } catch (error) {
    fail(res, error);
  }
});

export default router;
