import { Router, type IRouter } from "express";
import {
  db,
  countryReportsTable,
  countryReportProseTable,
  type CountryProseSections,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { GenerateCountryProseBody, EditCountryProseBody } from "@workspace/api-zod";
import {
  generateCountryProse,
  computeProseFingerprint,
  isLlmAvailable,
  MAX_PROSE_INCIDENTS_ACCEPTED,
  type ProseIncidentInput,
} from "../lib/countryProse";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

function slugOf(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

// Empty narrative used when the AI prose engine is unavailable. The client treats
// `available: false` exactly like a generation failure (renders its deterministic
// template + a visible "AI narrative unavailable" label), so an unconfigured /
// failing LLM degrades gracefully instead of hard-failing the country brief.
const EMPTY_PROSE_SECTIONS: CountryProseSections = {
  executiveSummary: "",
  situation: "",
  whatHappened: "",
  whatMatters: "",
  implications: [],
  watchNext: [],
  polestarView: "",
};

// A 200 "unavailable" payload — same shape as a success, but available:false and
// empty sections. NOTHING is persisted: a transient/never-configured LLM must not
// poison the prose cache with blank rows.
function unavailableProse(fingerprint: string) {
  return {
    available: false as const,
    fingerprint,
    sections: EMPTY_PROSE_SECTIONS,
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

// POST /countries/:slug/prose — return cached AI prose for the current incident
// set, or generate it. The cache is keyed by a fingerprint of the supplied
// window incidents (the same set the client renders), so a hit costs nothing and
// the prose can never lag the data. `force: true` bypasses the cache (redraft).
router.post("/countries/:slug/prose", requireAdminToken, async (req, res): Promise<void> => {
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
  const variant = body.variant ?? "country";
  const fingerprint = computeProseFingerprint({
    slug,
    countryName: country.name,
    basisDays: body.basisDays,
    incidents,
    variant,
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
      stale: isProseEditStale(fingerprint, existing.editedFingerprint, existing.edited),
      model: existing.model,
      generatedAt: existing.generatedAt,
    });
    return;
  }

  if (!isLlmAvailable()) {
    // Graceful degradation: never hard-503 the country brief. Return a 200
    // "unavailable" payload so the client falls back to its template narrative.
    res.json(unavailableProse(fingerprint));
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
    variant,
  });

  if (!outcome.ok) {
    req.log.warn({ slug, error: outcome.error }, "country prose generation failed");
    // Upstream LLM call failed — degrade to the template narrative rather than
    // hard-failing. Do not persist the empty result.
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
    .insert(countryReportProseTable)
    .values({
      slug,
      fingerprint,
      sections: outcome.sections,
      edited: keptEdited,
      editedFingerprint: keptEditedFingerprint,
      model: outcome.model,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: countryReportProseTable.slug,
      set: {
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

// PUT /countries/:slug/prose/edit — store analyst overrides for the sections.
// The edit is bound to the fingerprint it was written against; if the data has
// moved on (fingerprint mismatch) the edit is rejected so it can never describe
// a stale snapshot — the client must regenerate first.
router.put("/countries/:slug/prose/edit", requireAdminToken, async (req, res): Promise<void> => {
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
    // Bind the edit to the fingerprint it was written against so a later
    // data-basis change can flag it as stale (kept, not dropped).
    .set({ edited: body.sections, editedFingerprint: existing.fingerprint })
    .where(eq(countryReportProseTable.slug, slug))
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
