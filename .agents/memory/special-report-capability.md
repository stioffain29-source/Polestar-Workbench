---
name: Special Report capability
description: Lean one-off multi-domain report cloned from Spot Reports — chosen front cover, manual HTML/div charts, maps, photos.
---

Special Reports (`/special-reports`, `/special-reports/:id`) are a clean CLONE of Spot Reports: own `special_reports` table, own router mounted BELOW `requireOwner` with NO admin token, preview==PDF via `exportElementToPdf` DOM-rasterise. Editor drops Word/Text export (no docx/text builder for the Special shape) — PDF only.

**Chosen front cover** — the differentiator. Either a LIBRARY pick (persisted as a stable KEY) or a CUSTOM upload (persisted as a resized JPEG data URL, 5 MB ceiling via `validateCoverDataUrl`). Upload WINS over key — `resolveCoverUrl({coverImageKey,coverImageDataUrl})` in `coverImages.ts` returns trimmed dataUrl first, then a known library key, else null.

**Why the KEY (not the resolved URL) is stored:** `COVER_LIBRARY` images are Vite build-hashed assets; a rebuild rehashes the filename, so storing the resolved URL would break old reports. Store the key, resolve at render.

**⚠ coverImages.ts is a SHARED registry** — `TOPIC_COVER_URLS`/`COUNTRY_COVER_URLS`/`topicCoverUrl`/`countryCoverUrl` are imported by ~9 report surfaces (CountryReport, exportTopic/Country/Flashpoint/ConflictReportPdf, Cargo/ReportPreview). Do NOT rewrite the file wholesale to add the cover library — APPEND. (A wholesale rewrite silently dropped those exports once; recovered from git.)

**Manual charts** — analyst-typed only (no data source = no fabrication), rendered as HTML/div bars (NOT recharts SVG, which html2canvas mangles). Default bar colour Electric Blue #465bff. A chart is persisted only if it has ≥1 labelled point; unlabelled points are stripped at both buildData and render so preview==PDF==reloaded report.

**buildData create-vs-update:** create OMITS empty text/enum/date/coord/cover fields; update sends "" for text and explicit `null` for severity/confidence/cover/date/coords to CLEAR. mapPoints/photos/charts ALWAYS travel as (possibly empty) arrays.

**Draft isolation:** `DRAFT_PREFIX = "polestar:special-report-draft:"` (distinct from Spot's). Brand palette/severity/disclaimer re-exported from `spotReport.ts` via `specialReport.ts` so the two products can never drift.
