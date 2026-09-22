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
  type DbPortsEdition,
  type DbPortsEditionSummary,
  type DbPortsEvidence,
  type DbPortsHistory,
  type DbPortsItem,
  type DbPortsItemContent,
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

function deriveItem(item: DbPortsItem, row: Pick<DbPortsEditionRow, "startDate" | "endDate">): DbPortsItem {
  return { ...item, ...assessDbPortsItem(item, row) };
}

export function toEdition(row: DbPortsEditionRow): DbPortsEdition {
  const items = row.items.map((item) => deriveItem(item, row));
  const base = {
    id: row.id,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    overview: row.overview,
    status: row.status,
    revision: row.revision,
    items,
    worklog: row.worklog,
    coverage: row.coverage,
    history: row.history,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt,
  };
  return { ...base, quality: buildDbPortsQuality(base) };
}

export function toEditionSummary(row: DbPortsEditionRow): DbPortsEditionSummary {
  const { items: _items, worklog: _worklog, coverage: _coverage, history: _history, ...summary } =
    toEdition(row);
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

export async function createEdition(endDate: string, title?: string): Promise<DbPortsEdition> {
  const window = editionWindow(endDate);
  const now = new Date().toISOString();
  const [created] = await db
    .insert(dbPortsEditionsTable)
    .values({
      ...window,
      title: title?.trim() || `DB Ports — fortnight ending ${endDate}`,
      history: [audit("edition_created", "Created internal unpublished pilot edition.", now)],
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
  Pick<DbPortsEditionRow, "title" | "overview" | "status" | "items" | "worklog" | "coverage" | "history" | "approvedAt">
>;

export async function mutateEdition(
  id: number,
  revision: number,
  transform: (row: DbPortsEditionRow, now: string) => EditionChanges,
): Promise<DbPortsEdition> {
  const current = await getEditionRow(id);
  if (current.revision !== revision) throw new DbPortsConflictError("Edition revision has changed.");
  const now = new Date().toISOString();
  const changes = transform(current, now);
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
  return {
    ...changes,
    status: "draft",
    approvedAt: null,
    history: boundedHistory(row.history, audit(action, detail, now)),
  };
}

export function makeItem(content: DbPortsItemContent, row: DbPortsEditionRow, now: string): DbPortsItem {
  const assessment = assessDbPortsItem(content, row);
  if ((content.disposition === "selected" || content.disposition === "watch") && assessment.blockers.length) {
    throw new DbPortsValidationError(assessment.blockers.join(" "));
  }
  return {
    ...content,
    id: crypto.randomUUID(),
    mergedInto: null,
    updatedAt: now,
    ...assessment,
  };
}

export function assertDispositionCaps(items: DbPortsItem[]): void {
  const active = items.filter((item) => !item.mergedInto);
  if (active.filter((item) => item.disposition === "selected").length > DB_PORTS_MAX_SELECTED) {
    throw new DbPortsValidationError("The pilot permits at most six selected developments.");
  }
  if (active.filter((item) => item.disposition === "watch").length > DB_PORTS_MAX_WATCH) {
    throw new DbPortsValidationError("The pilot permits at most five watch items.");
  }
}

const IMPORTED_IMMUTABLE: (keyof DbPortsEvidence)[] = [
  "originalTitle",
  "sourceRecord",
  "retrievedAt",
  "sourceDate",
];
const CORRECTABLE: (keyof DbPortsEvidence)[] = [
  "sourceName",
  "sourceType",
  "publishedDate",
  "excerpt",
  "verified",
];

export function updateItemPreservingEvidence(
  previous: DbPortsItem,
  content: DbPortsItemContent,
  row: DbPortsEditionRow,
  now: string,
): { item: DbPortsItem; correctionSummary: string | null } {
  const byId = new Map(content.evidence.map((entry) => [entry.id, entry]));
  const corrections: string[] = [];
  for (const oldEvidence of previous.evidence) {
    const next = byId.get(oldEvidence.id);
    if (!next) throw new DbPortsValidationError("Evidence cannot be removed; reject the item or add a correcting source.");
    if (oldEvidence.sourceRecord) {
      if (next.sourceUrl !== oldEvidence.sourceUrl) {
        throw new DbPortsValidationError("An imported evidence URL cannot be substituted; add a new evidence record.");
      }
      for (const key of IMPORTED_IMMUTABLE) {
        if (next[key] !== oldEvidence[key]) {
          throw new DbPortsValidationError(`Imported evidence ${key} cannot be changed.`);
        }
      }
    }
    const changed = CORRECTABLE.filter((key) => next[key] !== oldEvidence[key]);
    if (changed.length) corrections.push(`${oldEvidence.id}: ${changed.join(", ")}`);
  }
  const assessment = assessDbPortsItem(content, row);
  if ((content.disposition === "selected" || content.disposition === "watch") && assessment.blockers.length) {
    throw new DbPortsValidationError(assessment.blockers.join(" "));
  }
  return {
    item: { ...content, id: previous.id, mergedInto: previous.mergedInto, updatedAt: now, ...assessment },
    correctionSummary: corrections.length ? corrections.join("; ") : null,
  };
}

export function appendHistory(
  row: DbPortsEditionRow,
  entry: DbPortsHistory,
): DbPortsHistory[] {
  return boundedHistory(row.history, entry);
}