import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, or } from "drizzle-orm";
import {
  db,
  incidentsTable,
  dataCentreFacilitiesTable,
  type InsertIncident,
  type InsertDataCentreFacility,
} from "@workspace/db";
import { requireAdminToken } from "../lib/adminAuth";

// One-time, token-gated incident backfill.
//
// Why this exists: the production database is only writable from inside the
// deployment runtime, and the live Google News feeds are non-deterministic —
// a given ingest pass may not return a record that a previous (dev) pass did.
// When a genuine, already-verified incident exists in one database but is
// missing from production, the only reliable recovery is to copy the exact
// record across rather than re-pull the feed and hope. This route accepts
// fully-formed incident records and inserts the ones that are not already
// present (deduped by source_url, falling back to topic+title+occurred_at).
//
// It is NOT an ingest path and does not fetch anything external — it only
// persists records supplied in the request body. Gated by INGEST_ADMIN_TOKEN
// via requireAdminToken (503 if unconfigured, 401 if token missing/wrong).

const router: IRouter = Router();

type BackfillIncident = {
  topic: string;
  title: string;
  summary: string;
  country: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  occurredAt: string;
  severity: string;
  confidence: string;
  source?: string | null;
  sourceUrl?: string | null;
  relevanceStatus?: string | null;
};

const REQUIRED_STRINGS = [
  "topic",
  "title",
  "summary",
  "country",
  "occurredAt",
  "severity",
  "confidence",
] as const;

function validateIncidents(body: unknown): { ok: true; incidents: BackfillIncident[] } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { incidents?: unknown }).incidents)) {
    return { ok: false, message: "body must be { incidents: [...] }" };
  }
  const list = (body as { incidents: unknown[] }).incidents;
  if (list.length < 1 || list.length > 200) {
    return { ok: false, message: "incidents must contain between 1 and 200 records" };
  }
  const out: BackfillIncident[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (typeof r !== "object" || r === null) return { ok: false, message: `incidents[${i}] is not an object` };
    const rec = r as Record<string, unknown>;
    for (const key of REQUIRED_STRINGS) {
      if (typeof rec[key] !== "string" || (rec[key] as string).length === 0) {
        return { ok: false, message: `incidents[${i}].${key} must be a non-empty string` };
      }
    }
    for (const key of ["location", "source", "sourceUrl", "relevanceStatus"] as const) {
      if (rec[key] != null && typeof rec[key] !== "string") {
        return { ok: false, message: `incidents[${i}].${key} must be a string or null` };
      }
    }
    for (const key of ["latitude", "longitude"] as const) {
      if (rec[key] != null && typeof rec[key] !== "number") {
        return { ok: false, message: `incidents[${i}].${key} must be a number or null` };
      }
    }
    out.push(rec as unknown as BackfillIncident);
  }
  return { ok: true, incidents: out };
}

router.post(
  "/admin/incidents/backfill",
  requireAdminToken,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = validateIncidents(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_body", message: parsed.message });
      return;
    }

    const inserted: Array<{ id: number; title: string }> = [];
    const skipped: Array<{ title: string; reason: string }> = [];

    for (const rec of parsed.incidents) {
      const occurredAt = new Date(rec.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        skipped.push({ title: rec.title, reason: "bad_occurred_at" });
        continue;
      }

      // A record counts as already present if EITHER its source URL matches an
      // existing row, OR the (topic, title, occurred_at) natural key matches.
      // Checking both keys (not one or the other) keeps the backfill idempotent
      // even when prod stored the same incident without a source URL or with a
      // URL variation.
      const naturalKey = and(
        eq(incidentsTable.topic, rec.topic),
        eq(incidentsTable.title, rec.title),
        eq(incidentsTable.occurredAt, occurredAt),
      );
      const matchCondition = rec.sourceUrl
        ? or(eq(incidentsTable.sourceUrl, rec.sourceUrl), naturalKey)
        : naturalKey;
      const existing = await db
        .select({ id: incidentsTable.id })
        .from(incidentsTable)
        .where(matchCondition)
        .limit(1);

      if (existing.length > 0) {
        skipped.push({ title: rec.title, reason: "already_present" });
        continue;
      }

      const values: InsertIncident = {
        topic: rec.topic,
        title: rec.title,
        summary: rec.summary,
        country: rec.country,
        location: rec.location ?? null,
        latitude: rec.latitude ?? null,
        longitude: rec.longitude ?? null,
        occurredAt,
        severity: rec.severity,
        confidence: rec.confidence,
        source: rec.source ?? null,
        sourceUrl: rec.sourceUrl ?? null,
        relevanceStatus: rec.relevanceStatus ?? null,
      };

      const [row] = await db
        .insert(incidentsTable)
        .values(values)
        .returning({ id: incidentsTable.id });
      inserted.push({ id: row!.id, title: rec.title });
    }

    req.log.info(
      { insertedCount: inserted.length, skippedCount: skipped.length },
      "admin incident backfill finished",
    );
    res.json({ ok: true, insertedCount: inserted.length, inserted, skipped });
  },
);

// One-time, token-gated Data Centre facility REGISTRY backfill.
//
// Same rationale as the incident backfill above: the facility registry is
// populated only by the CLI OSM importer, which can never reach the production
// database (prod is read-only from the workspace). When dev holds verified
// registry rows that prod is missing, this route copies the exact records into
// the deployment runtime. It is NOT an ingest path and fetches nothing external.
//
// A registry row is NEVER an incident and cannot inflate any incident count —
// this only ever touches `data_centre_facilities`. `linkedIncidentId` is
// deliberately dropped (set null): incident ids differ across databases, so a
// copied id would point at the wrong (or a non-existent) incident.
//
// Idempotent: a row already present (matched by source_url, falling back to the
// name+country natural key) is skipped, so re-running inserts nothing new.

type BackfillFacility = {
  name: string;
  country: string;
  operator?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: string | null;
  planningRisk?: string | null;
  capacityMw?: number | null;
  itLoadMw?: number | null;
  announcedDate?: string | null;
  expectedOnlineDate?: string | null;
  commissionedDate?: string | null;
  facilityType?: string | null;
  notes?: string | null;
  sourceUrl?: string | null;
  createdBy?: string | null;
};

const FACILITY_NULLABLE_STRINGS = [
  "operator",
  "region",
  "city",
  "status",
  "planningRisk",
  "announcedDate",
  "expectedOnlineDate",
  "commissionedDate",
  "facilityType",
  "notes",
  "sourceUrl",
  "createdBy",
] as const;

const FACILITY_NULLABLE_NUMBERS = [
  "latitude",
  "longitude",
  "capacityMw",
  "itLoadMw",
] as const;

function validateFacilities(
  body: unknown,
): { ok: true; facilities: BackfillFacility[] } | { ok: false; message: string } {
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as { facilities?: unknown }).facilities)
  ) {
    return { ok: false, message: "body must be { facilities: [...] }" };
  }
  const list = (body as { facilities: unknown[] }).facilities;
  if (list.length < 1 || list.length > 500) {
    return { ok: false, message: "facilities must contain between 1 and 500 records" };
  }
  const out: BackfillFacility[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (typeof r !== "object" || r === null) {
      return { ok: false, message: `facilities[${i}] is not an object` };
    }
    const rec = r as Record<string, unknown>;
    for (const key of ["name", "country"] as const) {
      if (typeof rec[key] !== "string" || (rec[key] as string).length === 0) {
        return { ok: false, message: `facilities[${i}].${key} must be a non-empty string` };
      }
    }
    for (const key of FACILITY_NULLABLE_STRINGS) {
      if (rec[key] != null && typeof rec[key] !== "string") {
        return { ok: false, message: `facilities[${i}].${key} must be a string or null` };
      }
    }
    for (const key of FACILITY_NULLABLE_NUMBERS) {
      if (rec[key] != null && typeof rec[key] !== "number") {
        return { ok: false, message: `facilities[${i}].${key} must be a number or null` };
      }
    }
    out.push(rec as unknown as BackfillFacility);
  }
  return { ok: true, facilities: out };
}

function toDateOrNull(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.post(
  "/admin/data-centre-facilities/backfill",
  requireAdminToken,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = validateFacilities(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_body", message: parsed.message });
      return;
    }

    const inserted: Array<{ id: number; name: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const rec of parsed.facilities) {
      // Idempotency key: source_url is the stable, distinct identity when it
      // exists, so match on it ALONE. Fall back to the (name, country) natural
      // key ONLY for rows without a source_url. Do NOT OR them together —
      // (name, country) is not discriminating (e.g. many "NTT | Japan"
      // facilities share it), so an OR would skip legitimately distinct rows.
      const matchCondition = rec.sourceUrl
        ? eq(dataCentreFacilitiesTable.sourceUrl, rec.sourceUrl)
        : and(
            eq(dataCentreFacilitiesTable.name, rec.name),
            eq(dataCentreFacilitiesTable.country, rec.country),
          );
      const existing = await db
        .select({ id: dataCentreFacilitiesTable.id })
        .from(dataCentreFacilitiesTable)
        .where(matchCondition)
        .limit(1);

      if (existing.length > 0) {
        skipped.push({ name: rec.name, reason: "already_present" });
        continue;
      }

      const values: InsertDataCentreFacility = {
        name: rec.name,
        country: rec.country,
        operator: rec.operator ?? null,
        region: rec.region ?? null,
        city: rec.city ?? null,
        latitude: rec.latitude ?? null,
        longitude: rec.longitude ?? null,
        status: rec.status ?? "Unknown",
        planningRisk: rec.planningRisk ?? "Unknown",
        capacityMw: rec.capacityMw ?? null,
        itLoadMw: rec.itLoadMw ?? null,
        announcedDate: toDateOrNull(rec.announcedDate),
        expectedOnlineDate: toDateOrNull(rec.expectedOnlineDate),
        commissionedDate: toDateOrNull(rec.commissionedDate),
        facilityType: rec.facilityType ?? "Unknown / not reported",
        notes: rec.notes ?? null,
        sourceUrl: rec.sourceUrl ?? null,
        // Never carry a cross-database incident id.
        linkedIncidentId: null,
        createdBy: rec.createdBy ?? null,
      };

      const [row] = await db
        .insert(dataCentreFacilitiesTable)
        .values(values)
        .returning({ id: dataCentreFacilitiesTable.id });
      inserted.push({ id: row!.id, name: rec.name });
    }

    req.log.info(
      { insertedCount: inserted.length, skippedCount: skipped.length },
      "admin data-centre facility backfill finished",
    );
    res.json({ ok: true, insertedCount: inserted.length, inserted, skipped });
  },
);

export default router;
