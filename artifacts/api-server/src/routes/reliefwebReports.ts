import { Router, type IRouter } from "express";
import { db, reliefwebReportsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { ListReliefWebReportsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// UN OCHA ReliefWeb situational reports stored as supporting CONTEXT.
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents — they live in their own
// table and no incident-counting surface reads them. This endpoint exists so the
// Conflict Watch and country reports can surface official UN OCHA reporting
// alongside the incident feed WITHOUT ever inflating the incident count.
//
// Public (read-only), in line with the rest of the workbench. Returns the most
// recent reports first, optionally narrowed to a single primary country.
const DEFAULT_LIMIT = 50;

router.get("/reliefweb-reports", async (req, res): Promise<void> => {
  const parsed = ListReliefWebReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { country, limit } = parsed.data;
  const conditions = [eq(reliefwebReportsTable.sourceName, "reliefweb")];
  if (country) conditions.push(eq(reliefwebReportsTable.country, country));

  const rows = await db
    .select({
      id: reliefwebReportsTable.id,
      externalId: reliefwebReportsTable.externalId,
      title: reliefwebReportsTable.title,
      summary: reliefwebReportsTable.summary,
      url: reliefwebReportsTable.url,
      sourceOrg: reliefwebReportsTable.sourceOrg,
      country: reliefwebReportsTable.country,
      countries: reliefwebReportsTable.countries,
      publishedAt: reliefwebReportsTable.publishedAt,
      originalDate: reliefwebReportsTable.originalDate,
      categoryRaw: reliefwebReportsTable.categoryRaw,
      classification: reliefwebReportsTable.classification,
      confidence: reliefwebReportsTable.confidence,
      tags: reliefwebReportsTable.tags,
    })
    .from(reliefwebReportsTable)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(desc(reliefwebReportsTable.publishedAt), desc(reliefwebReportsTable.id))
    .limit(limit ?? DEFAULT_LIMIT);

  res.json(rows);
});

export default router;
