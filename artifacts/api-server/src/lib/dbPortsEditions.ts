import {
  db,
  dbPortsEditionsTable,
  type DbPortsEditionRow,
} from "@workspace/db";
import {
  DB_PORTS_MAX_SELECTED,
  DB_PORTS_MAX_WATCH,
  assessDbPortsItem,
  buildDbPortsQuality,
  editionWindow,
  flagDuplicates,
  normaliseParameters,
  normaliseStoredItems,
  type DbPortsEdition,
  type DbPortsEditionSummary,
  type DbPortsEvidence,
  type DbPortsHistory,
  type DbPortsItem,
  type DbPortsItemContent,
  type DbPortsParameters,
} from "@workspace/db-ports";
import { and, desc, eq } from "drizzle-orm";

export class DbPortsConflictError extends Error {}
export class DbPortsNotFoundError extends Error {}
export class DbPortsValidationError extends Error {}

const MAX_HISTORY = 500;

export function audit(action: string, detail: string, at = new Date().toISOString()): DbPortsHistory {
  return { at, action, detail };
}

function boundedHistory(history: DbPortsHistory[], entry: DbPortsHistory): DbPortsHistory[] {
  return [...history, entry].slice(-MAX_HISTORY);
}

/** Warnings are always recomputed from the current text and parameters, so an
 * edit can clear one and stored rows never carry a stale judgment forward. */
export function toEdition(row: DbPortsEditionRow): DbPortsEdition {
  const parameters = normaliseParameters(row.parameters);
  const window = { startDate: row.startDate, endDate: row.endDate };
  const items = flagDuplicates(
    normaliseStoredItems(row.items).map((item) => ({
      ...item,
      warnings: assessDbPortsItem(item, window, parameters),
    })),
  );
  const base = {
    id: row.id,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    overview: row.overview,
    revision: row.revision,
    parameters,
    items,
    coverage: row.coverage,
    history: row.history,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return { ...base, quality: buildDbPortsQuality(base) };
}

export function toEditionSummary(row: DbPortsEditionRow): DbPortsEditionSummary {
  const { items: _items, coverage: _coverage, history: _history, ...summary } = toEdition(row);
  return summary;
}

export async function listEditions(): Promise<DbPortsEditionSummary[]> {
  const rows = await db.select().from(dbPortsEditionsTable).orderBy(desc(dbPortsEditionsTable.endDate));
  return rows.map(toEditionSummary);
}

export async function getEditionRow(id: number): Promise<DbPortsEditionRow> {
  const [row] = await db.select().from(dbPortsEditionsTable).where(eq(dbPortsEditionsTable.id, id));
  if (!row) throw new DbPortsNotFoundError("Edition not found.");
  return row;
}

export async function createEdition(
  endDate: string,
  parameters: DbPortsParameters,
  title?: string,
): Promise<DbPortsEdition> {
  const window = editionWindow(endDate);
  const now = new Date().toISOString();
  const [created] = await db
    .insert(dbPortsEditionsTable)
    .values({
      ...window,
      title: title?.trim() || `${parameters.reportTitle} — fortnight ending ${endDate}`,
      parameters,
      history: [audit("edition_created", "Created report edition from the saved parameter preset.", now)],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: dbPortsEditionsTable.endDate })
    .returning();
  if (created) return toEdition(created);
  const [existing] = await db
    .select()
    .from(dbPortsEditionsTable)
    .where(eq(dbPortsEditionsTable.endDate, endDate));
  if (!existing) throw new DbPortsConflictError("Edition could not be created.");
  return toEdition(existing);
}

type EditionChanges = Partial<
  Pick<
    DbPortsEditionRow,
    "title" | "overview" | "items" | "coverage" | "history" | "parameters" | "startDate" | "endDate"
  >
>;

export async function mutateEdition(
  id: number,
  revision: number,
  transform: (row: DbPortsEditionRow, now: string) => EditionChanges | Promise<EditionChanges>,
): Promise<DbPortsEdition> {
  const current = await getEditionRow(id);
  if (current.revision !== revision) throw new DbPortsConflictError("Edition revision has changed.");
  const now = new Date().toISOString();
  const changes = await transform(current, now);
  const [updated] = await db
    .update(dbPortsEditionsTable)
    .set({ ...changes, revision: revision + 1, updatedAt: now })
    .where(and(eq(dbPortsEditionsTable.id, id), eq(dbPortsEditionsTable.revision, revision)))
    .returning();
  if (!updated) throw new DbPortsConflictError("Edition revision has changed.");
  return toEdition(updated);
}

export async function deleteEdition(id: number, revision: number): Promise<void> {
  const [deleted] = await db
    .delete(dbPortsEditionsTable)
    .where(and(eq(dbPortsEditionsTable.id, id), eq(dbPortsEditionsTable.revision, revision)))
    .returning({ id: dbPortsEditionsTable.id });
  if (!deleted) throw new DbPortsConflictError("Edition revision has changed or edition was not found.");
}

export function contentEdit(
  row: DbPortsEditionRow,
  changes: EditionChanges,
  action: string,
  detail: string,
  now: string,
): EditionChanges {
  return { ...changes, history: boundedHistory(row.history, audit(action, detail, now)) };
}

export function makeItem(content: DbPortsItemContent, row: DbPortsEditionRow, now: string): DbPortsItem {
  return {
    ...content,
    id: crypto.randomUUID(),
    mergedInto: null,
    updatedAt: now,
    drafted: false,
    warnings: assessDbPortsItem(content, row, normaliseParameters(row.parameters)),
  };
}

export function assertDispositionCaps(items: DbPortsItem[]): void {
  const active = items.filter((item) => !item.mergedInto);
  if (active.filter((item) => item.disposition === "selected").length > DB_PORTS_MAX_SELECTED) {
    throw new DbPortsValidationError(`A report carries at most ${DB_PORTS_MAX_SELECTED} priority items.`);
  }
  if (active.filter((item) => item.disposition === "watch").length > DB_PORTS_MAX_WATCH) {
    throw new DbPortsValidationError(`The Watchlist carries at most ${DB_PORTS_MAX_WATCH} entries.`);
  }
}

const IMPORTED_IMMUTABLE: (keyof DbPortsEvidence)[] = ["originalTitle", "sourceRecord", "sourceDate"];

/** Sources may be replaced or added. What cannot happen is quietly rewriting an
 * imported record's provenance while keeping its identity: remove it instead. */
export function updateItemPreservingEvidence(
  previous: DbPortsItem,
  content: DbPortsItemContent,
  row: DbPortsEditionRow,
  now: string,
): DbPortsItem {
  const byId = new Map(previous.evidence.map((entry) => [entry.id, entry]));
  for (const next of content.evidence) {
    const old = byId.get(next.id);
    if (!old?.sourceRecord) continue;
    if (next.sourceUrl !== old.sourceUrl) {
      throw new DbPortsValidationError(
        "An imported source URL cannot be substituted under the same record; remove it and add the replacement source.",
      );
    }
    for (const key of IMPORTED_IMMUTABLE) {
      if (next[key] !== old[key]) {
        throw new DbPortsValidationError(`Imported source ${key} cannot be changed.`);
      }
    }
  }
  return {
    ...content,
    id: previous.id,
    mergedInto: previous.mergedInto,
    // Once an analyst has saved an item it belongs to them: a later Generate
    // Draft replaces generator drafts only, so the edit cannot be overwritten.
    drafted: false,
    updatedAt: now,
    warnings: assessDbPortsItem(content, row, normaliseParameters(row.parameters)),
  };
}

export function appendHistory(row: DbPortsEditionRow, entry: DbPortsHistory): DbPortsHistory[] {
  return boundedHistory(row.history, entry);
}
