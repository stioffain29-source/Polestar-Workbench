---
name: PNG/West Papua structured country report
description: How the config-driven structured country brief is built (serves Papua New Guinea AND Indonesian West Papua) — client-side extraction mirror, 9-section layout, why headless jsPDF/AI prose were skipped, cross-border-safe enrichment.
---

# Structured country report (Papua New Guinea + West Papua)

The structured 9-section security brief (location buckets + incident cards) is now CONFIG-DRIVEN and serves TWO theatres: Papua New Guinea (slug `papua-new-guinea`) and the Indonesian West Papua report (slug `papua`). All other country slugs keep the generic country-report template.

## Adding/maintaining a structured theatre (the generalization)
`pngReportDataset.ts` holds a `StructuredTheatreConfig` (name, buckets→provinces, empty-location fallback, anchors); `PNG_REPORT_CONFIG` + `WEST_PAPUA_REPORT_CONFIG` drive a generic `buildStructuredReportDataset`. Public wrappers stay: `buildPngReportDataset` / `buildWestPapuaReportDataset`. `PngCountryReportBody` renders `dataset.buckets[]` generically (no hardcoded bucket keys) + an "Other …" catch-all. `CountryReport.tsx` routes via a `structuredTheatre` memo (`"png"|"westPapua"|null` from `acceptedCountryTokens`; `papua-new-guinea`→png, `papua`→westPapua); everything keys off `isStructured` NOT `isPng`. **Do NOT touch the local cross-border incident-filter memo** (its own isPng/isPapua at ~L198-219) — it stays separate from the structured gate.
**How to apply (a miss silently degrades that theatre):** new structured theatre = gazetteer + extract wrapper (`lib/ingest`) + backfill wrapper + dataset config + `structuredTheatre` gate + country-aware prose + SEED_SOURCES feeds + marker-gated boot backfill.

## Cross-border-safe enrichment (PNG vs West Papua must never overwrite each other)
One incident gets ONE theatre's province/category/business_impact/incident_date. PNG matches `country ILIKE '%papua new guinea%'`; West Papua matches `ILIKE '%papua%' AND NOT ILIKE '%papua new guinea%'`. The inline flashpoint ingest mirrors this; the WP backfill (`runWestPapuaExtractBackfill`) and the marker-gated boot block (`west_papua_structured_extract_backfill_v1`) use the exclusion, so a cross-border row keeps its single PNG enrichment rather than being clobbered by WP.
**Why:** without the `NOT ILIKE papua new guinea` guard the two passes fight over shared rows.

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
