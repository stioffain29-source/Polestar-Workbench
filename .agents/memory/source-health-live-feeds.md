---
name: Source Health live-feed telemetry
description: How the `sources` table gets real per-feed health (not placeholders), and the rule that any new ingest path must self-register or its topic shows empty/stale Source Health.
---

# Source Health is now self-registered by ingest, not seeded

Every topic ingest writes REAL per-feed success/failure into the `sources` table via the shared `recordSourceHealth(topic, feeds, opts)` helper (`lib/ingest/src/sourceHealth.ts`). Upsert key is `(name, topic)`; a successful fetch → `status='operational'` + `last_success_at`; a throw → `status='failing'` + `last_failure_at` + error. It is wrapped in a global try/catch and gated on `commit`, placed right before each runner's summary object so it runs even when `toInsert` is empty (health reflects the FETCH, not whether new rows existed).

**Why:** the old non-flashpoint Source Health rows were dead seed-only placeholders (BSI/TAPA/ACLED/GDELT/Lloyd's List/UKMTO/Reuters Energy Wire/S&P Platts/etc.) that never polled anything — they showed permanently green/red and misled the (distrust-prone) user. Flashpoint already had 43 genuinely-monitored rows; this brings every topic to that bar.

**How to apply:**
- Any NEW ingest runner/topic MUST call `recordSourceHealth` or its topic will have empty (or stale) Source Health. Wire it the same way the existing runners do (newsTopic/shipping/cargoWatch/strikes use `rss`; marketPrices uses `api`, `ok = series.points.length>0`).
- The 16 dead placeholders are removed ONE TIME by a marker-gated boot migration (`app_migration_markers` key `dead_placeholder_sources_removed_v2`) in `artifacts/api-server/src/lib/migrations.ts`, deleting BY NAME ONLY (`name IN (...)`). Do NOT scope this by `topic != 'flashpoint'` — at least one placeholder ("FAO Fertilizer Outlook") is MIS-FILED under topic `flashpoint` in prod, so a topic-scoped delete strands it (the original v1 bug the user caught). Safe because none of the 16 dead names collide with any real (live) feed name. Marker-gated so a legitimately re-added same-name source is never re-deleted.
- Race-safety: `recordSourceHealth` is select-then-upsert with no DB unique constraint, which is safe ONLY because `runIngestOnce` holds a cross-instance pg advisory lock (same-topic runs can't overlap) and feed names are unique within a run. If that lock is ever removed, add a unique index on `sources(topic, name)` + `ON CONFLICT DO UPDATE`.
- Country coverage gate (`artifacts/workbench/src/lib/countryReportLayers.ts`) filters relevant sources by BOTH name match AND `topic ∈ COUNTRY_TOPIC_FEEDS` (flashpoint/protests) — otherwise the new country-named specialist feeds (e.g. `Google News — Kuwait` under `energy`) would falsely trip a country's coverage warning.
- Prod only reflects this after a republish + boot force-run (the writable prod DB is reachable only from the deployment runtime). The workspace sees DEV; prod via `executeSql(environment:"production")` is a read-only replica — you can VERIFY prod state but cannot fix it from here. Dead rows persist in prod until the user republishes; that is not a code failure, it is the deployment boundary.
