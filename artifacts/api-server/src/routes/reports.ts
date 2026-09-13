import { Router, type IRouter } from "express";
import { db, reportProseTable, reportsTable } from "@workspace/db";
import type {
  FuelHardNumbers,
  InsertReport,
  Report,
  ReportProse,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateReportBody,
  UpdateReportBody,
  ListReportsQueryParams,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";
import {
  mergeReportProvenance,
  REPORT_PROSE_KEYS,
} from "../lib/reportProvenance";

async function hydrateLegacyProvenance(
  report: Report,
  suppliedCache?: ReportProse,
): Promise<Report> {
  if (report.proseProvenance != null) return report;
  const cache =
    suppliedCache ??
    (
      await db
        .select()
        .from(reportProseTable)
        .where(eq(reportProseTable.reportId, report.id))
    )[0];
  const reportSnapshot = { ...report } as Record<string, unknown>;
  // Do not treat the legacy row's old basis column as an explicit generated
  // save. Hydration is read-only and must remain GENERATED_UNKNOWN unless the
  // cache proves an exact edited value.
  delete reportSnapshot.proseBasisFingerprint;
  const proseProvenance = mergeReportProvenance(
    report,
    reportSnapshot,
    cache,
  );
  return { ...report, proseProvenance };
}

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

/**
 * The orval-generated types use `Date` for `format: date` / `date-time`
 * fields (because `useDates: true` in orval.config.ts). The DB stores
 * those as strings (postgres `date` column for `issueDate`; ISO strings
 * inside the `hardNumbers` jsonb column for `JetFuelPricePoint.date`).
 * These helpers normalize at the API boundary so the insert/update
 * shape matches the Drizzle column types.
 */
function dateToYmd(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

/**
 * JSON-roundtrip the hardNumbers payload so any nested `Date` instances
 * (e.g. `JetFuelPricePoint.date`) become ISO strings — Date.toJSON()
 * returns the ISO-8601 string, which matches the DB-side
 * FuelHardNumbers shape (date: string). Safe for KpiCard[] and
 * FuelHardNumbers alike since both are pure-data structures.
 */
function normalizeHardNumbers(value: unknown): FuelHardNumbers | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as FuelHardNumbers;
}

router.get("/reports", async (req, res): Promise<void> => {
  const parsed = ListReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { topic, status } = parsed.data;
  const conds = [];
  if (topic) conds.push(eq(reportsTable.topic, topic));
  if (status) conds.push(eq(reportsTable.status, status));
  const rows = await db
    .select()
    .from(reportsTable)
    .where(conds.length ? and(...conds) : undefined)
    // Legacy rows have no activity timestamp; coalesce to createdAt.
    .orderBy(
      desc(sql`coalesce(${reportsTable.updatedAt}, ${reportsTable.createdAt})`),
      desc(reportsTable.issueDate),
      desc(reportsTable.id),
    );
  if (rows.some((row) => row.proseProvenance == null)) {
    const caches =
      rows.length > 0
        ? await db
            .select()
            .from(reportProseTable)
            .where(inArray(reportProseTable.reportId, rows.map((row) => row.id)))
        : [];
    const byReportId = new Map(caches.map((cache) => [cache.reportId, cache]));
    res.json(
      await Promise.all(
        rows.map((row) =>
          hydrateLegacyProvenance(row, byReportId.get(row.id)),
        ),
      ),
    );
    return;
  }
  res.json(rows);
});

router.get("/reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(await hydrateLegacyProvenance(row));
});

router.post("/reports", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { issueDate, hardNumbers, ...rest } = parsed.data;
  const normalizedIssueDate = dateToYmd(issueDate);
  const insertValues: InsertReport = {
    ...rest,
    issueDate: normalizedIssueDate,
    updatedAt: new Date(),
  };
  if (hardNumbers !== undefined) {
    insertValues.hardNumbers = normalizeHardNumbers(hardNumbers);
  }
  // A POST explicitly means "new report". Double-submit prevention belongs
  // to the client button; same-day topic/title matching must never reuse an
  // existing analyst workspace or identity.
  const [row] = await db.insert(reportsTable).values(insertValues).returning();
  res.status(201).json(row);
});

router.patch("/reports/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { issueDate, hardNumbers, proseDirtySections, ...rest } = parsed.data;
  const [existing] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [proseCache] = await db
    .select()
    .from(reportProseTable)
    .where(eq(reportProseTable.reportId, id));
  const legacySnapshot = { ...existing } as Record<string, unknown>;
  delete legacySnapshot.proseBasisFingerprint;
  const knownProvenance =
    existing.proseProvenance ??
    mergeReportProvenance(existing, legacySnapshot, proseCache);
  const dirty = new Set(proseDirtySections ?? []);
  const patchForProvenance = { ...parsed.data } as Record<string, unknown>;
  // A stale analyst section is intentionally absent from the reseeded form.
  // Do not interpret that UI blank as a user clear when the user has not
  // explicitly dirtied the section; retain the old text for the recovery panel.
  for (const key of REPORT_PROSE_KEYS) {
    const provenance = knownProvenance[key];
    if (
      provenance?.kind === "ANALYST_EDITED" &&
      !dirty.has(key) &&
      key in rest &&
      JSON.stringify((existing as Record<string, unknown>)[key]) !==
        JSON.stringify((rest as Record<string, unknown>)[key])
    ) {
      delete (rest as Record<string, unknown>)[key];
      delete patchForProvenance[key];
    }
  }
  const updateData: Partial<InsertReport> = { ...rest };
  // Every successful edit is activity, including edits that only change
  // metadata. Legacy rows remain nullable and fall back to createdAt.
  updateData.updatedAt = new Date();
  if (issueDate !== undefined) {
    updateData.issueDate = dateToYmd(issueDate);
  }
  if (hardNumbers !== undefined) {
    updateData.hardNumbers = normalizeHardNumbers(hardNumbers);
  }
  const proseProvenance = mergeReportProvenance(
    { ...existing, proseProvenance: knownProvenance },
    patchForProvenance,
    proseCache,
    proseDirtySections ?? [],
  );
  if (Object.keys(proseProvenance).length > 0) {
    updateData.proseProvenance = proseProvenance;
  }
  const [row] = await db
    .update(reportsTable)
    .set(updateData)
    .where(eq(reportsTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/reports/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(reportsTable).where(eq(reportsTable.id, id));
  res.status(204).end();
});

export default router;
