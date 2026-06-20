import { Router, type IRouter } from "express";
import { db, maritimeSecurityEventsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { ListMaritimeSecurityEventsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// ICC CCS / IMB Piracy Reporting Centre maritime piracy & armed-robbery events.
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents — they live in their own
// `maritime_security_events` table and no incident-counting surface reads them.
// This endpoint exists so Shipping Watch and country reports can surface a
// standalone maritime-security picture WITHOUT ever inflating the incident
// count.
//
// Public (read-only), in line with the rest of the workbench. Returns the most
// recent events first (by incident date), optionally narrowed to one country.
const DEFAULT_LIMIT = 200;
const SOURCE_NAME = "icc_imb";

router.get("/maritime-security-events", async (req, res): Promise<void> => {
  const parsed = ListMaritimeSecurityEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { country, limit } = parsed.data;
  const conditions = [eq(maritimeSecurityEventsTable.sourceName, SOURCE_NAME)];
  if (country) conditions.push(eq(maritimeSecurityEventsTable.country, country));

  const rows = await db
    .select({
      id: maritimeSecurityEventsTable.id,
      eventKey: maritimeSecurityEventsTable.eventKey,
      incidentNumber: maritimeSecurityEventsTable.incidentNumber,
      incidentType: maritimeSecurityEventsTable.incidentType,
      categoryRaw: maritimeSecurityEventsTable.categoryRaw,
      title: maritimeSecurityEventsTable.title,
      narrative: maritimeSecurityEventsTable.narrative,
      locationName: maritimeSecurityEventsTable.locationName,
      country: maritimeSecurityEventsTable.country,
      latitude: maritimeSecurityEventsTable.latitude,
      longitude: maritimeSecurityEventsTable.longitude,
      rawPositionText: maritimeSecurityEventsTable.rawPositionText,
      coordinateQuality: maritimeSecurityEventsTable.coordinateQuality,
      incidentDate: maritimeSecurityEventsTable.incidentDate,
      year: maritimeSecurityEventsTable.year,
      sourceUrl: maritimeSecurityEventsTable.sourceUrl,
      classification: maritimeSecurityEventsTable.classification,
    })
    .from(maritimeSecurityEventsTable)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(
      desc(maritimeSecurityEventsTable.incidentDate),
      desc(maritimeSecurityEventsTable.id),
    )
    .limit(limit ?? DEFAULT_LIMIT);

  res.json(rows);
});

export default router;
