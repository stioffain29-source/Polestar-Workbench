import { Router, type IRouter } from "express";
import { db, reportsTable, reportIncidentSummariesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GenerateReportIncidentSummariesBody,
  EditReportIncidentSummariesBody,
} from "@workspace/api-zod";
import {
  generateIncidentSummaries,
  computeIncidentSummariesFingerprint,
  isLlmAvailable,
  MAX_PROSE_INCIDENTS_ACCEPTED,
  type ProseIncidentInput,
} from "../lib/countryProse";

const router: IRouter = Router();

function reportIdOf(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A 200 "unavailable" payload — same shape as a success, but available:false and
// empty summaries. NOTHING is persisted: a transient/never-configured LLM must
// not poison the cache with blank rows. The client falls back to its
// deterministic per-incident line.
function unavailableSummaries(fingerprint: string) {
  return {
    available: false as const,
    fingerprint,
    summaries: {} as Record<string, string>,
    edited: null,
    model: "unavailable",
    generatedAt: new Date().toISOString(),
  };
}

// POST /reports/:id/incident-summaries — return cached per-incident summaries for
// the current Related Incidents set, or generate them. The cache is keyed by a
// fingerprint of the supplied incidents (the same set the client renders), so a
// hit costs nothing and the summaries can never lag the data. `force: true`
// bypasses the cache (redraft).
router.post("/reports/:id/incident-summaries", async (req, res): Promise<void> => {
  const reportId = reportIdOf(req.params.id);
  if (reportId === null) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  const parsed = GenerateReportIncidentSummariesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, reportId));
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const incidents = (body.incidents ?? []) as ProseIncidentInput[];
  if (incidents.length > MAX_PROSE_INCIDENTS_ACCEPTED) {
    res.status(400).json({
      error: `too many incidents (max ${MAX_PROSE_INCIDENTS_ACCEPTED})`,
    });
    return;
  }

  const fingerprint = computeIncidentSummariesFingerprint({
    scope: `report:${reportId}`,
    incidents,
  });

  const [existing] = await db
    .select()
    .from(reportIncidentSummariesTable)
    .where(eq(reportIncidentSummariesTable.reportId, reportId));

  if (!body.force && existing && existing.fingerprint === fingerprint) {
    res.json({
      available: true,
      fingerprint,
      summaries: existing.summaries,
      edited: existing.edited ?? null,
      model: existing.model,
      generatedAt: existing.generatedAt,
    });
    return;
  }

  if (!isLlmAvailable()) {
    res.json(unavailableSummaries(fingerprint));
    return;
  }

  const outcome = await generateIncidentSummaries(incidents);

  if (!outcome.ok) {
    req.log.warn(
      { reportId, error: outcome.error },
      "report incident summaries generation failed",
    );
    res.json(unavailableSummaries(fingerprint));
    return;
  }

  const now = new Date();
  const [row] = await db
    .insert(reportIncidentSummariesTable)
    .values({
      reportId,
      fingerprint,
      summaries: outcome.summaries,
      edited: null,
      model: outcome.model,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: reportIncidentSummariesTable.reportId,
      set: {
        fingerprint,
        summaries: outcome.summaries,
        edited: null,
        model: outcome.model,
        generatedAt: now,
      },
    })
    .returning();

  res.json({
    available: true,
    fingerprint: row.fingerprint,
    summaries: row.summaries,
    edited: row.edited ?? null,
    model: row.model,
    generatedAt: row.generatedAt,
  });
});

// PUT /reports/:id/incident-summaries/edit — store analyst overrides for the
// per-incident summaries. The edit is bound to the fingerprint it was written
// against; if the data has moved on (fingerprint mismatch) the edit is rejected
// so it can never describe a stale snapshot — the client must regenerate first.
router.put("/reports/:id/incident-summaries/edit", async (req, res): Promise<void> => {
  const reportId = reportIdOf(req.params.id);
  if (reportId === null) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  const parsed = EditReportIncidentSummariesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [existing] = await db
    .select()
    .from(reportIncidentSummariesTable)
    .where(eq(reportIncidentSummariesTable.reportId, reportId));
  if (!existing) {
    res.status(404).json({ error: "No generated summaries to edit" });
    return;
  }
  if (existing.fingerprint !== body.fingerprint) {
    res.status(409).json({ error: "stale", fingerprint: existing.fingerprint });
    return;
  }

  const [row] = await db
    .update(reportIncidentSummariesTable)
    .set({ edited: body.summaries })
    .where(eq(reportIncidentSummariesTable.reportId, reportId))
    .returning();

  res.json({
    available: true,
    fingerprint: row.fingerprint,
    summaries: row.summaries,
    edited: row.edited ?? null,
    model: row.model,
    generatedAt: row.generatedAt,
  });
});

export default router;
