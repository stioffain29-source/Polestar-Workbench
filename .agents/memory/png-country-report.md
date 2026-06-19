---
name: PNG structured country report
description: How the Papua New Guinea country brief is built — client-side extraction mirror, 9-section layout, why headless jsPDF/AI prose were skipped.
---

# PNG (Papua New Guinea) structured country report

The PNG country report (slug `papua-new-guinea`) is a bespoke 9-section security brief, separate from the generic country-report template. It renders only for PNG; all other country slugs keep the generic layout.

## Client-side extraction via the SHARED rulebook (the key architectural decision)
Per-item attributes (province / category / business-impact / occurred-vs-reported date) are derived **client-side** in the workbench. The duplicated copy was retired: `pngReportDataset.ts` now IMPORTS the one canonical rulebook from `@workspace/ingest/pngExtract` (subpath export; pure module — its only import is `./text` hasWord, no server deps), so there is a single source of truth shared by ingest + the report. Reason the derive still runs at all: the nullable DB columns (province/category/businessImpact/incidentDate) are NOT plumbed through the incidents API/OpenAPI/generated types, and prod is read-only from the workspace — columns stay null until republish + a fresh ingest WITH a backfill that does not yet exist (migrations only ADD columns; re-ingest only INSERTs new rows). Empirically EVERY PNG incidents-API row reads these four fields null in dev too, so the report is rendered entirely by the derive path today.
**How to apply:** the dataset keeps a prefer-API-else-derive fallback (`i.province ?? derived.province`, category+businessImpact as a pair, `i.incidentDate ?? derivePngIncidentDate`). Do NOT make it API-exclusive until a real backfill lands AND the columns are confirmed populated, or the whole report blanks. Any change to province keys or category rules now lands ONLY in `lib/ingest/src/pngExtract.ts` — no second copy to keep in sync. Workbench imports it as a pure lib (same pattern as @workspace/relevance / @workspace/strike-targets); do not add it to the workbench tsconfig references.

## Why parity was free (no headless jsPDF branch)
The in-app "Download PDF" rasterises the on-screen DOM (the project-wide pattern), so screen == in-app PDF automatically — the PNG body needs no separate PDF builder. The country-report jsPDF export path has **no caller anywhere** (dead code), so its PNG branch was deliberately skipped, not built. The PNG body is pure text/tables with NO map, which keeps DOM-rasterise parity clean.

## Prose: Executive Summary + Outlook are AI; the other 7 sections stay deterministic
The PNG Executive Summary and Outlook are now LLM-generated, fingerprint-cached, and editable — reusing the SHARED country-prose table/route/hooks via a `variant` field (`"png"`), NOT a parallel table/route/migration. The server prompt+parser branch on `variant`; the `png` parser fills only executiveSummary+outlook and leaves the other 5 generic keys empty. `variant` is part of the fingerprint, so adding it invalidates every existing country cache once (self-healing regen). The other 7 PNG sections (Top 3, location buckets, Business Impact, Source Confidence) remain the deterministic builder, which is also the LABELLED fallback when AI is unavailable (the page-level "AI narrative unavailable" banner already shows screen-only). The AI prose is grounded on `pngDataset.windowItems` (the same deduped/attributed set the brief renders), mapped to the prose-incident shape — so the fingerprint hashes the rendered items. The template never emits parenthetical record counts (a hard user rule across all reports); a parenthetical LIST of watchlist locations is fine (it is not a count).
**Why:** lean reuse avoids a new DB table + boot migration + codegen; PNG slug is unique so no collision.
**How to apply:** the prose effect waits for `pngDataset` to build before firing (so the fingerprint is stable); editing PNG shows only 2 fields (Executive Summary + Outlook).

## Syndication dedup
The page feeds the PNG builder the RAW window incidents (buildCountryLayers does not dedupe; only the lookback-prose set runs dropSyndicatedRehashes). So the builder must dedupe itself. Feeds carry the same story under headlines that differ only by a trailing " - Publisher" tail that cleanTitle leaves on when the tail doesn't match the row's own source (e.g. a Jubi.id story syndicated via a Google News feed). Dedup key therefore strips a trailing dash/pipe segment when the surviving prefix is still a substantial headline (≥5 words), then collapses to one representative (best by severity then recency).

## Empty-location fallback (exact string, do not paraphrase)
"No fresh publicly reported protest, theft, robbery or major crime incident identified in open sources for this location during the reporting period."
