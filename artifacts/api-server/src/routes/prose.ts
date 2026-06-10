import { Router, type IRouter } from "express";
import { db, countryReportsTable, countryReportProseTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GenerateCountryProseBody, EditCountryProseBody } from "@workspace/api-zod";
import {
  generateCountryProse,
  computeProseFingerprint,
  isLlmAvailable,
  MAX_PROSE_INCIDENTS_ACCEPTED,
  type ProseIncidentInput,
} from "../lib/countryProse";

const router: IRouter = Router();

function slugOf(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

// POST /countries/:slug/prose — return cached AI prose for the current incident
// set, or generate it. The cache is keyed by a fingerprint of the supplied
// window incidents (the same set the client renders), so a hit costs nothing and
// the prose can never lag the data. `force: true` bypasses the cache (redraft).
router.post("/countries/:slug/prose", async (req, res): Promise<void> => {
  const slug = slugOf(req.params.slug);
  const parsed = GenerateCountryProseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [country] = await db
    .select()
    .from(countryReportsTable)
    .where(eq(countryReportsTable.slug, slug));
  if (!country) {
    res.status(404).json({ error: "Country not found" });
    return;
  }

  const incidents = (body.incidents ?? []) as ProseIncidentInput[];
  if (incidents.length > MAX_PROSE_INCIDENTS_ACCEPTED) {
    res.status(400).json({
      error: `too many incidents (max ${MAX_PROSE_INCIDENTS_ACCEPTED})`,
    });
    return;
  }
  const fingerprint = computeProseFingerprint({
    slug,
    countryName: country.name,
    basisDays: body.basisDays,
    incidents,
  });

  const [existing] = await db
    .select()
    .from(countryReportProseTable)
    .where(eq(countryReportProseTable.slug, slug));

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
    res.status(503).json({ error: "llm-unavailable" });
    return;
  }

  const outcome = await generateCountryProse({
    countryName: country.name,
    region: body.region,
    basisDays: body.basisDays,
    periodWord: body.periodWord,
    issueDate: body.issueDate,
    incidents,
    baseline: body.baseline ?? null,
  });

  if (!outcome.ok) {
    req.log.warn({ slug, error: outcome.error }, "country prose generation failed");
    res.status(503).json({ error: outcome.error });
    return;
  }

  const now = new Date();
  const [row] = await db
    .insert(countryReportProseTable)
    .values({
      slug,
      fingerprint,
      sections: outcome.sections,
      edited: null,
      model: outcome.model,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: countryReportProseTable.slug,
      set: {
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

// PUT /countries/:slug/prose/edit — store analyst overrides for the sections.
// The edit is bound to the fingerprint it was written against; if the data has
// moved on (fingerprint mismatch) the edit is rejected so it can never describe
// a stale snapshot — the client must regenerate first.
router.put("/countries/:slug/prose/edit", async (req, res): Promise<void> => {
  const slug = slugOf(req.params.slug);
  const parsed = EditCountryProseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [existing] = await db
    .select()
    .from(countryReportProseTable)
    .where(eq(countryReportProseTable.slug, slug));
  if (!existing) {
    res.status(404).json({ error: "No generated prose to edit" });
    return;
  }
  if (existing.fingerprint !== body.fingerprint) {
    res.status(409).json({ error: "stale", fingerprint: existing.fingerprint });
    return;
  }

  const [row] = await db
    .update(countryReportProseTable)
    .set({ edited: body.sections })
    .where(eq(countryReportProseTable.slug, slug))
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
