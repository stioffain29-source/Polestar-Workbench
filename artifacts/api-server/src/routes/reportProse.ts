import { Router, type IRouter } from "express";
import { db, reportsTable, reportProseTable, type TopicProseSections } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GenerateReportProseBody, EditReportProseBody } from "@workspace/api-zod";
import {
  generateReportProse,
  computeReportProseFingerprint,
  isLlmAvailable,
  MAX_PROSE_INCIDENTS_ACCEPTED,
  type ProseIncidentInput,
} from "../lib/reportProse";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

function reportIdOf(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A 200 "unavailable" payload — same shape as a success, but available:false and
// empty sections. NOTHING is persisted: a transient/never-configured LLM must
// not poison the cache with blank rows. The client falls back to its
// deterministic draftTopicReportProse template.
function unavailableProse(fingerprint: string) {
  return {
    available: false as const,
    fingerprint,
    sections: null,
    edited: null,
    model: "unavailable",
    generatedAt: new Date().toISOString(),
  };
}

// POST /reports/:id/prose — return cached AI narrative for the current rendered
// incident set, or generate it. The cache is keyed by a fingerprint of the
// supplied incidents + topic/title/issueDate/window (the same set the client
// renders), so a hit costs nothing and the prose can never lag the data.
// `force: true` bypasses the cache (redraft).
router.post("/reports/:id/prose", requireAdminToken, async (req, res): Promise<void> => {
  const reportId = reportIdOf(req.params.id);
  if (reportId === null) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  const parsed = GenerateReportProseBody.safeParse(req.body);
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

  const fingerprint = computeReportProseFingerprint({
    reportId,
    topic: body.topic,
    title: body.title ?? "",
    issueDate: body.issueDate,
    basisDays: body.basisDays,
    incidents,
  });

  const [existing] = await db
    .select()
    .from(reportProseTable)
    .where(eq(reportProseTable.reportId, reportId));

  if (!body.force && existing && existing.fingerprint === fingerprint) {
    res.json({
      available: true,
      fingerprint,
      sections: existing.sections,
      edited: existing.edited ?? null,
      model: existing.model,
      generatedAt: existing.generatedAt,
    });
    return;
  }

  if (!isLlmAvailable()) {
    res.json(unavailableProse(fingerprint));
    return;
  }

  const outcome = await generateReportProse({
    topic: body.topic,
    title: body.title ?? "",
    periodWord: body.periodWord,
    basisDays: body.basisDays,
    issueDate: body.issueDate,
    incidents,
  });

  if (!outcome.ok) {
    req.log.warn({ reportId, error: outcome.error }, "report prose generation failed");
    res.json(unavailableProse(fingerprint));
    return;
  }

  const now = new Date();
  const [row] = await db
    .insert(reportProseTable)
    .values({
      reportId,
      topic: body.topic,
      fingerprint,
      sections: outcome.sections,
      edited: null,
      model: outcome.model,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: reportProseTable.reportId,
      set: {
        topic: body.topic,
        fingerprint,
        sections: outcome.sections,
        edited: null,
        model: outcome.model,
        generatedAt: now,
      },
    })
    .returning();

  res.json({
    available: true,
    fingerprint: row.fingerprint,
    sections: row.sections,
    edited: row.edited ?? null,
    model: row.model,
    generatedAt: row.generatedAt,
  });
});

// PUT /reports/:id/prose/edit — store analyst overrides for the narrative
// sections. The edit is bound to the fingerprint it was written against; if the
// data has moved on (fingerprint mismatch) the edit is rejected so it can never
// describe a stale snapshot — the client must regenerate first.
router.put("/reports/:id/prose/edit", requireAdminToken, async (req, res): Promise<void> => {
  const reportId = reportIdOf(req.params.id);
  if (reportId === null) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  const parsed = EditReportProseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [existing] = await db
    .select()
    .from(reportProseTable)
    .where(eq(reportProseTable.reportId, reportId));
  if (!existing) {
    res.status(404).json({ error: "No generated prose to edit" });
    return;
  }
  if (existing.fingerprint !== body.fingerprint) {
    res.status(409).json({ error: "stale", fingerprint: existing.fingerprint });
    return;
  }

  const [row] = await db
    .update(reportProseTable)
    .set({ edited: body.sections as TopicProseSections })
    .where(eq(reportProseTable.reportId, reportId))
    .returning();

  res.json({
    available: true,
    fingerprint: row.fingerprint,
    sections: row.sections,
    edited: row.edited ?? null,
    model: row.model,
    generatedAt: row.generatedAt,
  });
});

export default router;
