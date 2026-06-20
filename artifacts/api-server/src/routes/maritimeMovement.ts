import { Router, type IRouter } from "express";
import { db, maritimeMovementTable, maritimeVesselSightingTable } from "@workspace/db";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import {
  CreateMaritimeMovementBody,
  ListMaritimeMovementQueryParams,
  ListMaritimeVesselsQueryParams,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth.js";

// Derive the map's coarse vessel class from the AIS ship-type code. AIS encodes
// 80-89 = tanker and 70-79 = cargo; everything else (passenger, fishing, tug,
// service, unknown) is "other". This is the SAME split the colour legend uses.
function vesselClassFor(shipType: number | null): "tanker" | "cargo" | "other" {
  if (shipType !== null && shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType !== null && shipType >= 70 && shipType <= 79) return "cargo";
  return "other";
}

// Maritime vessel-MOVEMENT context (AIS-derived traffic snapshots).
//
//   * Reads are PUBLIC (the workbench is public by product decision).
//   * The write is admin-token-gated — there is no AIS API, so rows are a manual
//     upload from a licensed provider.
//
// Movement is CONTEXT only. These rows are never incidents and never feed any
// incident count; when the table is empty the consuming surfaces degrade to
// "movement data unavailable".

// Every count is a whole vessel tally. The generated Zod (from the OpenAPI
// `integer` type) only enforces `>= 0`, not integer-ness, so a decimal sent
// straight to the API would otherwise reach the integer DB columns and surface
// as a 500. Enforce integer here so a bad direct call gets a clean 400.
const MOVEMENT_COUNT_KEYS = [
  "totalVessels",
  "inboundCount",
  "outboundCount",
  "tankersCount",
  "bulkCarriersCount",
  "containerCount",
  "lngLpgCount",
  "anchoredOrWaitingCount",
  "aisVisibleCount",
  "aisDarkOrGapCount",
] as const;

const CreateMaritimeMovementBodyStrict = CreateMaritimeMovementBody.refine(
  (d) =>
    MOVEMENT_COUNT_KEYS.every((k) => {
      const v = (d as Record<string, unknown>)[k];
      return v == null || (typeof v === "number" && Number.isInteger(v));
    }),
  { message: "Vessel count fields must be whole numbers." },
);

const router: IRouter = Router();

router.get("/maritime-movement", async (req, res): Promise<void> => {
  const parsed = ListMaritimeMovementQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { theatre, limit } = parsed.data;
  const rows = await db
    .select()
    .from(maritimeMovementTable)
    .where(theatre ? eq(maritimeMovementTable.theatre, theatre) : undefined)
    .orderBy(desc(maritimeMovementTable.dataAsOf))
    .limit(limit ?? 100);
  res.json(rows);
});

// Latest snapshot per theatre (one row each). DISTINCT ON keeps the newest by
// data_as_of within each theatre; Drizzle maps the columns back to camelCase so
// the response matches the generated MaritimeMovement type.
router.get("/maritime-movement/latest", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinctOn([maritimeMovementTable.theatre])
    .from(maritimeMovementTable)
    .orderBy(maritimeMovementTable.theatre, desc(maritimeMovementTable.dataAsOf));
  res.json(rows);
});

// Individual live vessel POSITIONS for the interactive map: the most recent AIS
// sighting per MMSI, filtered to rows that carry a real lat/lon and are recent
// enough to plot. CONTEXT only — a position is never an incident.
router.get("/maritime-movement/vessels", async (req, res): Promise<void> => {
  const parsed = ListMaritimeVesselsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { theatre, maxAgeHours, limit } = parsed.data;
  const cutoff = new Date(Date.now() - (maxAgeHours ?? 24) * 3_600_000);
  const rows = await db
    .select({
      mmsi: maritimeVesselSightingTable.mmsi,
      name: maritimeVesselSightingTable.name,
      theatre: maritimeVesselSightingTable.theatre,
      latitude: maritimeVesselSightingTable.latitude,
      longitude: maritimeVesselSightingTable.longitude,
      courseOverGround: maritimeVesselSightingTable.lastCog,
      speedOverGround: maritimeVesselSightingTable.lastSog,
      navStatus: maritimeVesselSightingTable.lastNavStatus,
      shipType: maritimeVesselSightingTable.shipType,
      lastSeenAt: maritimeVesselSightingTable.lastSeenAt,
    })
    .from(maritimeVesselSightingTable)
    .where(
      and(
        isNotNull(maritimeVesselSightingTable.latitude),
        isNotNull(maritimeVesselSightingTable.longitude),
        gte(maritimeVesselSightingTable.lastSeenAt, cutoff),
        theatre ? eq(maritimeVesselSightingTable.theatre, theatre) : undefined,
      ),
    )
    .orderBy(desc(maritimeVesselSightingTable.lastSeenAt))
    .limit(limit ?? 1000);
  res.json(
    rows.map((r) => ({ ...r, vesselClass: vesselClassFor(r.shipType) })),
  );
});

router.post(
  "/maritime-movement",
  requireAdminToken,
  async (req, res): Promise<void> => {
    const parsed = CreateMaritimeMovementBodyStrict.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const [row] = await db
      .insert(maritimeMovementTable)
      .values({
        theatre: d.theatre,
        chokepoint: d.chokepoint ?? null,
        dataAsOf: new Date(d.dataAsOf),
        totalVessels: d.totalVessels ?? null,
        inboundCount: d.inboundCount ?? null,
        outboundCount: d.outboundCount ?? null,
        tankersCount: d.tankersCount ?? null,
        bulkCarriersCount: d.bulkCarriersCount ?? null,
        containerCount: d.containerCount ?? null,
        lngLpgCount: d.lngLpgCount ?? null,
        anchoredOrWaitingCount: d.anchoredOrWaitingCount ?? null,
        aisVisibleCount: d.aisVisibleCount ?? null,
        aisDarkOrGapCount: d.aisDarkOrGapCount ?? null,
        changeVs7DayBaseline: d.changeVs7DayBaseline ?? null,
        notes: d.notes ?? null,
        confidence: d.confidence ?? "medium",
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl ?? null,
        // Keep the upload verbatim for provenance / audit.
        rawPayload: d.rawPayload ?? req.body,
      })
      .returning();
    res.status(201).json(row);
  },
);

export default router;
