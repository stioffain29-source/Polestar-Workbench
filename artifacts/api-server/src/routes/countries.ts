import { Router, type IRouter } from "express";
import { db, countryReportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateCountryReportBody,
  UpdateCountryReportBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/countries", async (_req, res): Promise<void> => {
  const rows = await db.select().from(countryReportsTable);
  res.json(rows);
});

router.get("/countries/:slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const [row] = await db
    .select()
    .from(countryReportsTable)
    .where(eq(countryReportsTable.slug, slug ?? ""));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/countries", async (req, res): Promise<void> => {
  const parsed = CreateCountryReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(countryReportsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/countries/:slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const parsed = UpdateCountryReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // The narrative columns overview/trend_summary/implications are no longer
  // read anywhere — the report sections are generated from the live 7-day
  // window at render time. Strip any incoming writes to these fields so the
  // legacy stale prose can never be reintroduced into the database.
  const { overview: _o, trendSummary: _t, implications: _i, ...updates } =
    parsed.data as Record<string, unknown>;
  void _o;
  void _t;
  void _i;
  if (Object.keys(updates).length === 0) {
    const [existing] = await db
      .select()
      .from(countryReportsTable)
      .where(eq(countryReportsTable.slug, slug ?? ""));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(existing);
    return;
  }
  const [row] = await db
    .update(countryReportsTable)
    .set(updates)
    .where(eq(countryReportsTable.slug, slug ?? ""))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

export default router;
