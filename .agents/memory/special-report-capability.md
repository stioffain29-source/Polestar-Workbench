---
name: Special Report capability
description: Lean one-off multi-domain report cloned from Spot Reports — chosen front cover, manual HTML/div charts, maps, photos.
---

Special Reports (`/special-reports`, `/special-reports/:id`) are a clean CLONE of Spot Reports: own `special_reports` table, own router mounted BELOW `requireOwner` with NO admin token, preview==PDF via `exportElementToPdf` DOM-rasterise. Editor drops Word/Text export (no docx/text builder for the Special shape) — PDF only.

**Chosen front cover** — the differentiator. Either a LIBRARY pick (persisted as a stable KEY) or a CUSTOM upload (persisted as a resized JPEG data URL, 5 MB ceiling via `validateCoverDataUrl`). Upload WINS over key — `resolveCoverUrl({coverImageKey,coverImageDataUrl})` in `coverImages.ts` returns trimmed dataUrl first, then a known library key, else null.

**Why the KEY (not the resolved URL) is stored:** `COVER_LIBRARY` images are Vite build-hashed assets; a rebuild rehashes the filename, so storing the resolved URL would break old reports. Store the key, resolve at render.

**⚠ coverImages.ts is a SHARED registry** — `TOPIC_COVER_URLS`/`COUNTRY_COVER_URLS`/`topicCoverUrl`/`countryCoverUrl` are imported by ~9 report surfaces (CountryReport, exportTopic/Country/Flashpoint/ConflictReportPdf, Cargo/ReportPreview). Do NOT rewrite the file wholesale to add the cover library — APPEND. (A wholesale rewrite silently dropped those exports once; recovered from git.)

**FREE-FORM body (the current model, replaced the fixed spot-clone prose):** the body is an ordered `blocks` jsonb array — types `heading|text|bullets|chart|image|map|incidents`, reorder/add/remove/hide, NO forced fields. `resolveSpecialReportBlocks` (specialReport.ts) is the SINGLE renderer authority for BOTH `SpecialReportPreview` and the DOM-rasterised PDF; empty/unlabelled blocks are skipped identically so preview==PDF. `checkSpecialReportQuality` no longer forces any field. Legacy rows (7 fixed prose cols + top-level photos[]/charts[]) are synthesised into blocks in the old order so nothing is lost. `map`/`incidents` are SINGLETONS (editor disables adding a second); server does NOT enforce this (owner-only surface).

**Manual charts** — inline on `chart` blocks now (not a top-level array): analyst-typed only (no data source = no fabrication), HTML/div bars (NOT recharts SVG, html2canvas mangles it), default bar Electric Blue #465bff; unlabelled points stripped at buildData + render.

**buildData:** body ALWAYS travels as `blocks` (possibly empty). `mapEnabled` is DERIVED (true iff a `map` block exists) — no checkbox. On UPDATE the 7 legacy prose cols are set to `null` and `photos`/`charts` to `[]` so a migrated report never carries stale duplicate body. Images live inline on `image` blocks (dataUrl, reuse photo size ceilings via `validateSpecialReportBlocks`).

**⚠ GOTCHA — nullable-to-clear:** any field the editor sends `null` to CLEAR must be `type: ["string","null"]` in the OpenAPI **Update** schema, else generated zod is `.string().optional()` and REJECTS null → route safeParse 400 on EVERY authenticated save. This is invisible to `curl` (unauthenticated only ever returns 401 before the body parse) — the authenticated save path is the ONLY one that exercises the body. Verify a save via the generated `UpdateSpecialReportBody.safeParse`, not just a 401 curl.

**⚠ Map export id:** the singleton map block renders stable `domId="special-report-map"`; `applyMapExportLayout(root,"special-report-map",…)` in exportPdf.ts must use that EXACT id or the PDF map loses zoom-control restyle + shadow removal (brand forbids shadows). Do NOT use a dynamic `special-map-<id>`.

**Draft isolation:** `DRAFT_PREFIX = "polestar:special-report-draft:"` (distinct from Spot's). Quota fallback DROPS image blocks entirely (not empties their dataUrl) — a dataUrl-less image block would fail `validateSpecialReportBlocks` on restore. Brand palette/severity/disclaimer re-exported from `spotReport.ts` via `specialReport.ts` so the two products can never drift.
