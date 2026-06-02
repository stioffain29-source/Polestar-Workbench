---
name: Cargo local-language translation gate
description: cargo_watch rows must be translated to English by non-Latin-script + Indonesian-marker detection, NOT "non-ASCII", or they silently fall out of the in-scope count
---

Rule: a `cargo_watch` row only reaches the in-scope count if its title is ENGLISH —
the workbench frontend's cargo-vocabulary gate (`classifyScope` in
`artifacts/workbench/src/lib/cargoAnalysis.ts`) is English-only. Local-language rows
(Bahasa Indonesia, Arabic, Thai) MUST be translated — at ingest (`cargoWatch.ts`
uses `screenBatch`/`titleEn`) and in any backfill (`backfillCargoCountry.ts`).

Detect local-language by NON-LATIN SCRIPT (CJK/Arabic/Thai/Cyrillic/Devanagari/
Hangul ranges) OR distinctive Indonesian cargo-crime markers (pencurian, perampokan,
dirampok, gudang, truk, sopir, muatan, polres…). NEVER use "non-ASCII" as the test:
Bahasa Indonesia is ASCII Latin, so a non-ASCII gate silently skips it; and an
English headline with a stray em-dash/curly-quote would be wrongly re-translated.

**Why:** the first backfill gated translation on non-ASCII. ~32 genuine Indonesian
truck/warehouse thefts got a country but kept their Bahasa titles, so the English
cargo gate dumped them into `excluded_non_cargo` — recovery *looked* done but the
page count barely moved (+3, not +30). Fixing the gate to non-Latin-script +
Indonesian markers moved in_scope 103→133 and excluded_non_cargo 46→16, slop-free.

**How to apply:** `translateScreen.screenItem` returns `inScope` + English
`titleEn`/`summaryEn` + country for EVERY row. For any local-language row, overwrite
title/summary with the English version and re-rate severity via `classifySeverity`
on the translated text (single severity authority). `canonScopeCountry` gates scope
(model country OR the row's existing in-scope country); slop / no-scope-country rows
are left untouched so US/UK trend pieces never enter the count. Borderline
arrest/court-process warehouse pieces the LLM rejects stay out — that conservative
call is correct (precision-first). In Drizzle `sql\`\`` templates JS processes
escapes first: use POSIX `[^[:ascii:]]` and doubled-backslash `\\y` word boundaries
— a literal `\x00` (JS null byte) or stripped `\m`/`\M` corrupts the Postgres
protocol ("insufficient data left in message"). Backfill is idempotent (translated
rows drop out of the candidate filter) and chunked by forward `--after-id` cursor.
