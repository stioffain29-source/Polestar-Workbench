---
name: TAPA offline cargo-crime layer
description: How the saved TAPA "Data Explorer" HTML is wired into Cargo Watch (offline promote pass), and the invariants that keep it no-fabrication + idempotent.
---

# TAPA offline cargo-crime layer

TAPA cargo-crime data enters Cargo Watch (`topic='cargo_watch'`) from SAVED
logged-in "Data Explorer" HTML files in `attached_assets/`. It is **offline
only**: the parser takes an HTML string, nothing scrapes TAPA, uses a session
cookie, stores credentials, or drives a browser.

**Why offline:** the owner supplied saved pages and asked to wire them in as-is.
`TAPA_SESSION_COOKIE` sits in missing_secrets for a hypothetical future online
path that does NOT exist — do not build a scraper around it without the owner
explicitly asking.

## Shape

- ONE shared parser `lib/ingest/src/tapaParser.ts` (`parseTapaHtml` → `{rows,
  missingColumns}`, `TAPA_COLUMNS` = 9 cols) feeds BOTH the CSV export CLI
  (`scripts/src/import-tapa-explorer.ts`) and the promote pass. Never re-duplicate
  the parser — the CSV and the incidents must read a page identically.
- `lib/ingest/src/tapaPromote.ts` mirrors `gdeltPromote.ts`: pure
  `decideTapaPromotion` + a `runTapaPromote` commit runner; `runTapaPromoteOnce`
  (ingestRunner.ts) wraps it in the shared advisory lock. Token-gated
  `POST /api/admin/tapa-promote` (`?mode=dry-run`) is the ONLY trigger — it is
  deliberately NOT in the scheduler (offline, one-shot re-import).

## Invariants (do not break)

- **No fabrication:** title/summary only restate TAPA's 9 structured fields.
  The sole derived value is EUR→USD (`TAPA_EUR_USD_RATE`, default 1.09), and it
  carries an explicit provenance sentence. Blank/N-A fields render
  "Unknown"/"Unspecified", never guessed.
- **USD bridge:** the summary embeds `US$<int>` next to the word "value" so the
  frontend `cargoAnalysis.parseUsdLoss` (first-match regex + ±45-char context
  gate) reads it. Max source value €15.56M → ~$17M stays under parseUsdLoss's
  $100M sanity ceiling. If you reword the summary, keep "US$<digits>" adjacent
  to value/goods language or losses silently stop parsing.
- **In-scope gate:** `TAPA_SCOPE_COUNTRIES` in tapaPromote MUST mirror
  `cargoAnalysis` APAC+Middle-East sets exactly (lib cannot import workbench, so
  it is duplicated). It sets `analystInScope`, which `classifyScope`
  short-circuits to `in_scope` for APAC/ME BEFORE its noise gates. A country
  added to one set but not the other silently drops from the monitor.
- **Country canon:** `normaliseTapaCountry` files Hong Kong → China (+geoHint),
  and canonicalises Viet Nam→Vietnam, Korea, Republic of→South Korea,
  Taiwan, Province of China→Taiwan — must match cargoAnalysis aliases.
- **Idempotency:** marker `analyst_notes=tapa_offline:<sha256(9 fields)>:<occurrence>`.
  Dedupe is marker-only (TAPA rows have no URL, so gdelt's fuzzy news/URL dedupe
  does not apply). Byte-identical rows across pages promote as DISTINCT incidents
  via the occurrence index — expected, so an analyst may see near-identical
  Cargo Watch rows. Re-running the route inserts 0.
- **backfillRelevance (migrations.ts):** MUST keep excluding BOTH
  `'gdelt_cloud:%'` AND `'tapa_offline:%'` so a `RELEVANCE_RULE_VERSION` bump
  cannot re-score these structured rows by text.

## Verified facts (this dataset, 5 saved pages)

- 489 rows total; parser stable at 489 after the CLI refactor.
- Severity split low 226 / moderate 198 / high 65 — high=65 exactly equals the
  source's "High Value = Yes" count (a good sanity check for the classifier).
- Country spread (post-normalisation): India 267, Philippines 61, Vietnam 45,
  China 29 (incl. 24 Hong Kong), Indonesia 20, Malaysia 16, Thailand 16,
  Pakistan 9, Australia 9, South Korea 6, Japan 4, Taiwan 3, Singapore 2,
  New Zealand 1, Bangladesh 1 — all APAC, so all promote in-scope.
- Rollback: `DELETE FROM incidents WHERE analyst_notes LIKE 'tapa_offline:%'`.

## Verification path

Owner-gated UI (Replit Auth) can't be screenshotted headlessly — verify via the
unit suite (`__tests__/ingest/tapaPromote.test.ts`), the dry-run counts, and a
direct SQL spot-check, not live app screenshots.
