---
name: Flashpoint topic alias (flashpoint ↔ protests)
description: Why Flashpoint report code must treat `topic='flashpoint'` and `topic='protests'` as the same operational bucket, and where every alias point lives.
---

The Flashpoint report row in the `reports` table has `topic='protests'` (legacy seed). The live regional scraper (`scripts/src/scrape-flashpoint.ts`) writes new rows with `topic='flashpoint'`. The legacy importer (`scripts/src/import-legacy.ts` → `categoryToTopic`) splits incoming records: "Civil Unrest" → `protests`, "Other" → `flashpoint`. Both buckets are operationally the same thing (activism, protest, strike, civil unrest) and must be rendered together.

**Why:** A previous audit ran the scraper, inserted 537 rows across 13 APAC countries into `flashpoint`, then exported a PDF that still showed only 18 records / 4 countries — because the dataset filter dropped everything where `i.topic !== topic`. The fix is a topic alias at every place that does `byTopic` filtering.

**How to apply — every place that filters incidents to the report bucket must alias both topics together:**
- `artifacts/workbench/src/lib/flashpointReportDataset.ts` — `buildFlashpointReportDataset()`: drop `{ byTopic: true }`, then `.filter(i => i.topic==='flashpoint' || i.topic==='protests')`.
- `artifacts/workbench/src/lib/topicFastFacts.ts` — `filterTopicReportIncidents()`: branch on `topic === 'flashpoint' || topic === 'protests'` and apply the same dual-topic filter so editor KPI cards match the PDF.
- DB-level cleanup migrations and `refineTopic()` in `import-legacy.ts` must run their pollution rules against BOTH topics in the `WHERE topic IN ('flashpoint','protests')` clause, otherwise the alias re-exposes legacy pollution.

If you add a new report-rendering surface (chart, fast-fact, related-incident table) for the flashpoint topic and forget the alias, the new surface will under-count and silently diverge from the PDF — which violates the user's strict "preview and PDF must never disagree" rule in replit.md.

Note: `shippingReportDataset.ts`, `fuelReportDataset.ts`, `cargoWatchReportDataset.ts` use `i.topic !== topic` directly and must NOT be touched — they are single-bucket topics. The alias is flashpoint-specific.
