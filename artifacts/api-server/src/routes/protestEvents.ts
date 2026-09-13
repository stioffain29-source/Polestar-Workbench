import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  protestEventsTable,
  protestScheduleStateTable,
} from "@workspace/db";
import {
  CreateProtestEventBody,
  ListProtestEventsQueryParams,
  ListProtestEventsResponse,
  UpdateProtestEventBody,
} from "@workspace/api-zod";
import { runProtestScheduleOnce } from "../lib/ingestRunner";
import { createHash } from "node:crypto";

const router: IRouter = Router();
const PROTEST_SCHEDULE_STATE_KEY = "singleton";

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number.parseInt(value ?? "", 10);
  return Number.isInteger(id) ? id : -1;
}

function asDate(value: Date | string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function dedupKey(values: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      [
        values.eventDate,
        values.country,
        values.city,
        values.venue,
        values.organiser,
        values.issue,
        values.description,
        values.sourceUrl,
      ]
        .map((value) => String(value ?? "").trim().toLowerCase())
        .join("|"),
    )
    .digest("hex");
}

// Owner-private schedule read. Cancelled and postponed rows are deliberately
// not returned by the main forward-looking API.
router.get("/protest-events", async (req, res): Promise<void> => {
  const parsed = ListProtestEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
  const conditions = [
    gte(protestEventsTable.eventDate, start),
    lt(protestEventsTable.eventDate, end),
    eq(protestEventsTable.status, "Confirmed"),
  ];
  const possibleConditions = [
    gte(protestEventsTable.eventDate, start),
    lt(protestEventsTable.eventDate, end),
    eq(protestEventsTable.status, "Possible"),
  ];
  if (parsed.data.country) {
    conditions.push(eq(protestEventsTable.country, parsed.data.country));
    possibleConditions.push(eq(protestEventsTable.country, parsed.data.country));
  }
  if (parsed.data.city) {
    conditions.push(eq(protestEventsTable.city, parsed.data.city));
    possibleConditions.push(eq(protestEventsTable.city, parsed.data.city));
  }
  const limit = parsed.data.limit ?? 200;
  const [confirmed, planned, possible, state] = await Promise.all([
    db.select().from(protestEventsTable).where(and(...conditions)).orderBy(protestEventsTable.eventDate, desc(protestEventsTable.confidence)).limit(limit),
    db.select().from(protestEventsTable).where(and(
      gte(protestEventsTable.eventDate, start),
      lt(protestEventsTable.eventDate, end),
      eq(protestEventsTable.status, "Planned"),
      ...(parsed.data.country ? [eq(protestEventsTable.country, parsed.data.country)] : []),
      ...(parsed.data.city ? [eq(protestEventsTable.city, parsed.data.city)] : []),
    )).orderBy(protestEventsTable.eventDate, desc(protestEventsTable.confidence)).limit(limit),
    db.select().from(protestEventsTable).where(and(...possibleConditions)).orderBy(protestEventsTable.eventDate, desc(protestEventsTable.confidence)).limit(limit),
    db
      .select({ searchCompletedAt: protestScheduleStateTable.searchCompletedAt })
      .from(protestScheduleStateTable)
      .where(eq(protestScheduleStateTable.key, PROTEST_SCHEDULE_STATE_KEY))
      .limit(1),
  ]);
  const confirmedPlanned = [...confirmed, ...planned].sort(
    (a, b) => (a.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
  );
  res.json(
    ListProtestEventsResponse.parse({
      confirmedPlanned,
      possible,
      searchCompletedAt: state[0]?.searchCompletedAt ?? null,
    }),
  );
});

// This router is mounted below requireOwner in routes/index.ts. Schedule rows
// are context, but manual edits follow the same owner-only convention as
// report mutations and never touch the incident table.
router.post("/protest-events", async (req, res): Promise<void> => {
  const parsed = CreateProtestEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const values = {
    ...input,
    sourceName: input.sourceName ?? "analyst",
    sourcePublishedAt: asDate(input.sourcePublishedAt),
    eventDate: asDate(input.eventDate),
    dedupKey: dedupKey(input),
  };
  if (values.eventDate && Number.isNaN(values.eventDate.getTime())) {
    res.status(400).json({ error: "eventDate must be a valid date" });
    return;
  }
  const [row] = await db
    .insert(protestEventsTable)
    .values(values as never)
    .returning();
  res.status(201).json(row);
});

router.patch("/protest-events/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateProtestEventBody.safeParse(req.body);
  if (id < 1 || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const input = parsed.data;
  const values: Record<string, unknown> = {
    ...input,
    sourcePublishedAt: asDate(input.sourcePublishedAt),
    eventDate: asDate(input.eventDate),
  };
  if (values.eventDate instanceof Date && Number.isNaN(values.eventDate.getTime())) {
    res.status(400).json({ error: "eventDate must be a valid date" });
    return;
  }
  const [existing] = await db
    .select()
    .from(protestEventsTable)
    .where(eq(protestEventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const merged = { ...existing, ...values };
  values.dedupKey = dedupKey(merged);
  const [row] = await db
    .update(protestEventsTable)
    .set(values as never)
    .where(eq(protestEventsTable.id, id))
    .returning();
  res.json(row);
});

// Owner-triggered collection is useful from the workbench and shares the same
// advisory lock as the scheduled and admin-triggered paths.
router.post("/protest-events/collect", async (_req, res): Promise<void> => {
  const result = await runProtestScheduleOnce();
  if (!result.ran) {
    res.status(409).json({ error: "ingestion_in_progress" });
    return;
  }
  res.json(result.protestSchedule);
});

export default router;