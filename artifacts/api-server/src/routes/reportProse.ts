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
    stale: false,
    model: "unavailable",
    generatedAt: new Date().toISOString(),
  };
}

// An analyst edit is STALE when it is retained but was written against a data
// basis that has since moved on (its recorded fingerprint differs from the live
// one). The edit is kept, never discarded — the client surfaces a warning.
function isProseEditStale(
  liveFingerprint: string,
  editedFingerprint: string | null | undefined,
  edited: unknown,
): boolean {
  return (
    edited != null &&
    editedFingerprint != null &&
    editedFingerprint !== liveFingerprint
  );
}

// POST /reports/:id/prose — return cached AI narrative for the current rendered
// incident set, or generate it. The cache is keyed by a fingerprint of the
// supplied incidents + topic/title/issueDate/window (the same set the client
// renders), so a hit costs nothing and the prose can never lag the data.
// `force: true` bypasses the cache (redraft).
router.post("/reports/:id/prose", async (req, res): Promise<void> => {
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
    facts: body.facts ?? null,
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
      stale: isProseEditStale(fingerprint, existing.editedFingerprint, existing.edited),
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
    facts: body.facts ?? null,
  });

  if (!outcome.ok) {
    req.log.warn({ reportId, error: outcome.error }, "report prose generation failed");
    res.json(unavailableProse(fingerprint));
    return;
  }

  // KEEP any existing analyst edit across the regenerate (the fresh AI prose
  // lands in `sections`, but the override in `edited` is retained rather than
  // dropped). Its `editedFingerprint` is preserved so the response can flag it
  // as stale — the edit describes the previous data basis until the analyst
  // re-saves it against the new one.
  const keptEdited = existing?.edited ?? null;
  const keptEditedFingerprint = existing?.editedFingerprint ?? null;
  const now = new Date();
  const [row] = await db
    .insert(reportProseTable)
    .values({
      reportId,
      topic: body.topic,
      fingerprint,
      sections: outcome.sections,
      edited: keptEdited,
      editedFingerprint: keptEditedFingerprint,
      model: outcome.model,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: reportProseTable.reportId,
      set: {
        topic: body.topic,
        fingerprint,
        sections: outcome.sections,
        edited: keptEdited,
        editedFingerprint: keptEditedFingerprint,
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
    stale: isProseEditStale(row.fingerprint, row.editedFingerprint, row.edited),
    model: row.model,
    generatedAt: row.generatedAt,
  });
});

// PUT /reports/:id/prose/edit — store analyst overrides for the narrative
// sections. The edit is bound to the fingerprint it was written against; if the
// data has moved on (fingerprint mismatch) the edit is rejected so it can never
// describe a stale snapshot — the client must regenerate first.
router.put("/reports/:id/prose/edit", async (req, res): Promise<void> => {
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
    // Bind the edit to the fingerprint it was written against so a later
    // data-basis change can flag it as stale (kept, not dropped).
    .set({
      edited: body.sections as TopicProseSections,
      editedFingerprint: existing.fingerprint,
    })
    .where(eq(reportProseTable.reportId, reportId))
    .returning();

  res.json({
    available: true,
    fingerprint: row.fingerprint,
    sections: row.sections,
    edited: row.edited ?? null,
    stale: isProseEditStale(row.fingerprint, row.editedFingerprint, row.edited),
    model: row.model,
    generatedAt: row.generatedAt,
  });
});

export default router;
