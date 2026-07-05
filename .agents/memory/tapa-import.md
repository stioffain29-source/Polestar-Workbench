---
name: TAPA incident import
description: How the TAPA (TIS) incident data enters the workbench — offline, upload-only; scraping/cookies are forbidden by the owner.
---

# TAPA incident import

The owner explicitly REVERSED an initial "scrape the TAPA session" request and
mandated an OFFLINE, upload-only importer. Do NOT re-introduce live scraping,
login cookies, stored credentials, or browser automation for TAPA.

**Rule:** TAPA data comes only from SAVED TAPA Data Explorer HTML files the owner
uploads (into `attached_assets/`). The importer parses the incident GridView
table from each file, combines rows, deduplicates byte-identical rows, and writes
`tapa_apac_incidents_clean.csv` (9 columns: Date of incident, Incident Category,
Modus Operandi, Product Category, Location Type, High Value, Value EUR, City,
Country). Script: `scripts/src/import-tapa-explorer.ts`
(`pnpm --filter @workspace/scripts run import:tapa-explorer`).

**Why:** the public/anonymous TIS grid hard-caps at ~10 rows/page (ignores
`per-page=100`) and returns unfiltered EMEA incidents (Bulgaria/Jordan/Hungary…),
NOT APAC — so a scrape would be both wrong data and against the owner's explicit
"do not scrape / no cookies / no credentials" instruction. The full member view
(APAC scope, 100/page) only exists behind a logged-in session the workbench does
not hold.

**How to apply:**
- Parser selects the table whose header set best matches the 9 required columns
  (threshold ≥5) and maps by normalised header NAME, so Data Explorer column
  reordering/extras are tolerated. First run against a REAL saved Data Explorer
  page is the true acceptance test (multi-row/colspan headers would break
  positional th→td alignment).
- It is deliberately standalone: NO database, NO `@workspace/ingest`, NOT wired to
  Cargo Watch. Connecting it to Cargo Watch is a future task the owner deferred
  ("not yet") — keep it isolated until asked.
