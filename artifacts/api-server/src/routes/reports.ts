import { Router, type IRouter } from "express";
import { db, reportsTable } from "@workspace/db";
import type { FuelHardNumbers, InsertReport } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateReportBody,
  UpdateReportBody,
  ListReportsQueryParams,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

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
    .orderBy(desc(reportsTable.issueDate));
  res.json(rows);
});

router.get("/reports/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/reports", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { issueDate, hardNumbers, ...rest } = parsed.data;
  const normalizedIssueDate = dateToYmd(issueDate);
  // Reliability guard: "New Report" is a single client button that can fire
  // twice (slow network, an impatient re-click before the dialog closes), and
  // any other caller retrying a timed-out POST hits the same risk. Without a
  // check here every retry inserts ANOTHER identical draft, and drafts have
  // accumulated in exactly this way. Only status: "draft" is deduped —
  // review/published are deliberate state transitions the analyst chose, not
  // creation retries, so they always insert. Match on topic + issueDate +
  // title so a genuinely distinct draft for the same topic/day (different
  // title) is never blocked.
  if (rest.status === "draft") {
    const [existing] = await db
      .select()
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.topic, rest.topic),
          eq(reportsTable.issueDate, normalizedIssueDate),
          eq(reportsTable.title, rest.title),
          eq(reportsTable.status, "draft"),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(200).json(existing);
      return;
    }
  }
  const insertValues: InsertReport = {
    ...rest,
    issueDate: normalizedIssueDate,
    hardNumbers: normalizeHardNumbers(hardNumbers),
  };
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
  const { issueDate, hardNumbers, ...rest } = parsed.data;
  const updateData: Partial<InsertReport> = { ...rest };
  if (issueDate !== undefined) {
    updateData.issueDate = dateToYmd(issueDate);
  }
  if (hardNumbers !== undefined) {
    updateData.hardNumbers = normalizeHardNumbers(hardNumbers);
  }
  const [row] = await db
    .update(reportsTable)
    .set(updateData)
    .where(eq(reportsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/reports/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(reportsTable).where(eq(reportsTable.id, id));
  res.status(204).end();
});

export default router;
