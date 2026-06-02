import { db, incidentsTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { geocode } from "./geocode";
import { classifySeverity } from "./severity";
import { canonScopeCountry } from "./cargoWatch";
import { isLlmAvailable, screenBatch } from "./translateScreen";

// One-time backfill: surface genuine local-language cargo_watch rows that never
// reach the in-scope count. Two failure modes are fixed together:
//   1. country='Unknown' rows sit in "Needs Review" (no country to place them).
//   2. local-language rows (Bahasa Indonesia, Arabic, Thai) carry a NON-English
//      title, so the frontend's English-only cargo-vocabulary gate dumps them in
//      "excluded_non_cargo" even when the country is known.
// Both are recovered by re-screening each candidate through the SAME LLM stage the
// live ingest uses (translateScreen.ts), which returns an English translation +
// in-scope verdict + country. A row is only kept when the model says it is a real
// in-scope cargo incident AND a country canonicalises into the APAC + Middle East
// scope set (canonScopeCountry) — either the model's country or the row's existing
// one. Anything flagged slop, or with no scope country, is left untouched, so
// US/UK trade-press trend pieces can never be dragged into the count.
//
// Bahasa Indonesia is ASCII, so "non-ASCII" is NOT a reliable local-language test;
// candidates are selected by non-ASCII chars OR distinctive Indonesian cargo-crime
// markers. For any local-language row the English translation replaces the stored
// title/summary and severity is re-rated on that translated text — matching how a
// freshly-ingested translated row looks (single severity authority on translated
// text). Rows already in English keep their title verbatim.

export type CargoCountryBackfillSummary = {
  mode: "dry-run" | "commit";
  llmReady: boolean;
  candidates: number;
  recovered: number;
  leftSlop: number;
  leftUnplaceable: number;
  llmErrors: number;
  maxIdProcessed: number | null;
  perCountry: [string, number][];
  recoveredSamples: { id: number; country: string; title: string; reason: string }[];
  leftSamples: { id: number; reason: string; title: string }[];
  logLines: string[];
};

// Real non-Latin scripts (Cyrillic, Hebrew, Arabic, Syriac, Devanagari, Thai,
// Hangul, CJK). Deliberately NOT "any non-ASCII char" — an English headline that
// merely contains an em-dash or curly quote must NOT be treated as local-language
// and must keep its title verbatim (never overwritten by a re-translation).
const NON_LATIN_SCRIPT =
  /[\u0400-\u052F\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u3000-\u30FF\u3130-\u318F\u3400-\u9FFF\uAC00-\uD7AF]/;
// Distinctive Bahasa Indonesia cargo-crime words (none are English homographs), so
// an ASCII Indonesian headline is still recognised as local-language and translated.
const INDO_MARKERS =
  /\b(pencurian|perampokan|perampok|dirampok|dirampas|dijarah|begal|gudang|truk|sopir|muatan|kerugian|tersangka|ditangkap|kasus|ungkap|polrestabes|polres|polsek|satreskrim)\b/i;
const looksLocalLanguage = (title: string) => NON_LATIN_SCRIPT.test(title) || INDO_MARKERS.test(title);

export async function runCargoCountryBackfill(
  opts: { commit?: boolean; limit?: number; afterId?: number } = {},
): Promise<CargoCountryBackfillSummary> {
  const commit = opts.commit ?? false;
  const limit = opts.limit ?? 1000;
  const afterId = opts.afterId ?? 0;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const perCountry = new Map<string, number>();
  const recoveredSamples: CargoCountryBackfillSummary["recoveredSamples"] = [];
  const leftSamples: CargoCountryBackfillSummary["leftSamples"] = [];

  const llmReady = isLlmAvailable();
  log(
    `Cargo country backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}, limit=${limit}, afterId=${afterId}`,
  );

  const empty = (): CargoCountryBackfillSummary => ({
    mode: commit ? "commit" : "dry-run",
    llmReady,
    candidates: 0,
    recovered: 0,
    leftSlop: 0,
    leftUnplaceable: 0,
    llmErrors: 0,
    maxIdProcessed: null,
    perCountry: [],
    recoveredSamples: [],
    leftSamples: [],
    logLines,
  });

  if (!llmReady) {
    log("OpenAI integration not configured (AI_INTEGRATIONS_OPENAI_*) — cannot screen. Aborting.");
    return empty();
  }

  // Still-relevant cargo rows whose title is local-language (non-ASCII chars OR a
  // distinctive Indonesian cargo-crime marker) — these are the rows the English
  // gate rejects, whether their country is 'Unknown' or already known. Walked
  // forward by id so repeated chunked runs always make progress (slop rows are
  // skipped via the afterId cursor rather than re-screened).
  const rows = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
      latitude: incidentsTable.latitude,
      longitude: incidentsTable.longitude,
    })
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.topic, "cargo_watch"),
        gt(incidentsTable.id, afterId),
        sql`${incidentsTable.relevanceStatus} IS DISTINCT FROM 'irrelevant'`,
        sql`(${incidentsTable.title} ~ '[^[:ascii:]]' OR ${incidentsTable.title} ~* '\\y(pencurian|perampokan|perampok|dirampok|dirampas|dijarah|begal|gudang|truk|sopir|muatan|kerugian|tersangka|ditangkap|kasus|ungkap|polrestabes|polres|polsek|satreskrim)\\y')`,
      ),
    )
    .orderBy(incidentsTable.id)
    .limit(limit);

  log(`Candidates (local-language title, relevant): ${rows.length}`);
  if (rows.length === 0) {
    log("Nothing to process.");
    return empty();
  }

  const verdicts = await screenBatch(
    rows.map((r) => ({ title: r.title, summary: r.summary ?? "" })),
    { concurrency: 4 },
  );

  let recovered = 0;
  let leftSlop = 0;
  let leftUnplaceable = 0;
  let llmErrors = 0;
  let maxIdProcessed = afterId;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const v = verdicts[i];
    maxIdProcessed = Math.max(maxIdProcessed, r.id);

    if (!v.ok) {
      llmErrors++;
      if (leftSamples.length < 20)
        leftSamples.push({ id: r.id, reason: `llm-error:${v.error}`, title: r.title.slice(0, 80) });
      continue;
    }
    const ver = v.verdict;
    if (!ver.inScope) {
      leftSlop++;
      if (leftSamples.length < 20)
        leftSamples.push({ id: r.id, reason: `slop:${ver.reason}`.slice(0, 120), title: r.title.slice(0, 80) });
      continue;
    }
    // Place the row by the model's country, falling back to the row's existing
    // in-scope country (so a known-country local-language row that the model can't
    // re-place is still kept and translated, not dropped).
    const existingScope = r.country === "Unknown" ? null : canonScopeCountry(r.country);
    const country = canonScopeCountry(ver.country) ?? existingScope;
    if (!country) {
      leftUnplaceable++;
      if (leftSamples.length < 20)
        leftSamples.push({
          id: r.id,
          reason: `in-scope-but-no-scope-country:${ver.country ?? "?"}`,
          title: r.title.slice(0, 80),
        });
      continue;
    }

    // Local-language rows get the English translation (the frontend's cargo gate is
    // English-only); rows already in English keep their title verbatim.
    const translate = looksLocalLanguage(r.title) && Boolean(ver.titleEn);
    const newTitle = translate ? ver.titleEn.slice(0, 500) : r.title;
    const newSummary = translate
      ? [ver.summaryEn || newTitle, ver.city ? `Location: ${ver.city}.` : ""].join(" ").trim().slice(0, 2000)
      : (r.summary ?? "");
    const geo = geocode(country, `${newTitle} ${newSummary} ${ver.city ?? ""}`);

    recovered++;
    perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
    if (recoveredSamples.length < 25)
      recoveredSamples.push({
        id: r.id,
        country,
        title: newTitle.slice(0, 80),
        reason: (ver.reason || "").slice(0, 80),
      });

    if (commit) {
      const set: Partial<typeof incidentsTable.$inferInsert> = {};
      if (country !== r.country) set.country = country;
      // Only fill coordinates when the row has none — never overwrite (and thereby
      // potentially downgrade) coordinates a known-country row may already carry.
      if (geo && r.latitude == null && r.longitude == null) {
        set.latitude = geo.latitude;
        set.longitude = geo.longitude;
        if (geo.location) set.location = geo.location;
      }
      if (translate) {
        set.title = newTitle;
        set.summary = newSummary || newTitle;
        set.severity = classifySeverity(newTitle, newSummary, "cargo_watch");
      }
      if (Object.keys(set).length > 0)
        await db.update(incidentsTable).set(set).where(eq(incidentsTable.id, r.id));
    }
  }

  const sortedCov = [...perCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("");
  log("=== Backfill totals ===");
  log(`  Candidates              : ${rows.length}`);
  log(`  Surfaced (translated)   : ${recovered}`);
  log(`  Left (slop)             : ${leftSlop}`);
  log(`  Left (no scope ctry)    : ${leftUnplaceable}`);
  log(`  LLM errors              : ${llmErrors}`);
  log(`  Max id processed        : ${maxIdProcessed}`);
  log("");
  log("=== Surfaced country coverage ===");
  for (const [c, n] of sortedCov) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedCov.length === 0) log("  (none)");
  if (!commit) log("\nDRY-RUN — no rows written. Re-run with --commit to update.");

  return {
    mode: commit ? "commit" : "dry-run",
    llmReady,
    candidates: rows.length,
    recovered,
    leftSlop,
    leftUnplaceable,
    llmErrors,
    maxIdProcessed,
    perCountry: sortedCov,
    recoveredSamples,
    leftSamples,
    logLines,
  };
}
