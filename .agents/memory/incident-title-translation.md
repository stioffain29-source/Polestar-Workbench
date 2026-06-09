---
name: Incident title translation (display_title)
description: How non-English incident headlines become clean English advisory titles, and the convergence rule that keeps the backfill from starving.
---

Non-English incident headlines (Bahasa Indonesia from West Papua feeds, plus Arabic/Thai/CJK/Cyrillic) are translated to clean English at ingest and stored on a NULLABLE `incidents.display_title`; the original `title` is ALWAYS preserved. UI prefers `display_title` and falls back to `title` (then `cleanIncidentTitle`). English/unprocessed rows stay NULL.

Runs as one centralized pass (`runTitleTranslation` in `@workspace/ingest`) called from `runIngestOnce` after the scrapers (own try/catch, non-fatal) and from a CLI script (`scrape`/`translate-titles`) — NOT per-scraper. Uses the Replit OpenAI integration (gpt-4o-mini, json_object), mirroring `translateScreen.ts`'s fetch client.

**Convergence rule (the bug to never reintroduce):** detection must be the SAME predicate in JS (`needsTitleTranslation`) and in the candidate SQL `WHERE`, both built from the shared constants (`NON_LATIN_RANGES`, `INDONESIAN_MARKER_WORDS`). The query selects ONLY rows matching the predicate (`display_title IS NULL AND (title ~ <script> OR title ~* <markers>)`). 
**Why:** an earlier version scanned the newest-N NULL rows then JS-filtered. Permanently-English rows keep `display_title` NULL forever, so a wall of newer English rows starves the per-run limit and older non-English rows are never reached. Putting the predicate in SQL means every fetched row is a genuine candidate that drops out once written, so the backfill converges.
**How to apply:** pass the regex patterns as BOUND PARAMS (not interpolated SQL text) to dodge escaping. Postgres word boundary is `\y` (not `\m`/`\b`); script ranges use the ACTUAL boundary chars in the class, valid in both JS and PG regex.

**Bahasa detection:** Bahasa is Latin/ASCII, so a non-ASCII test misses it — match distinctive function words (`yang`, `dengan`, `untuk`, `tewas`, `ditangkap`, `warga`, …). Ambiguous short ones (para/dari/massa/saat/soal) are excluded to avoid rewriting English. `yang` is the strongest marker but collides with the Korean surname "Yang" — accept the rare 1-in-N cosmetic reword; dropping `yang` would miss most Bahasa.

**Prod backfill:** bump `INGEST_FORCE_VERSION` (in `ingestScheduler.ts`) so the next deploy forces a full ingest whose translation pass backfills existing prod rows; convergent ingest passes finish the rest. Dev backfill: run the CLI script with `--commit`.
