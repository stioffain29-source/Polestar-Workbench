---
name: Generic live news-topic scrapers (energy/fertiliser/fuel)
description: How the config-driven news scraper generalises shipping to add live energy/fertiliser/fuel incident feeds, and why strikes is excluded.
---

# Generic live news-topic scrapers

`lib/ingest/src/newsTopic.ts` (`runNewsTopicIngest(cfg, opts)`) is a config-driven
generalisation of the proven `shipping.ts` ingest: Google-News RSS fetch → allow/deny
gating → in-batch + DB dedupe → geocode → persisted relevance verdict → content-derived
severity → insert. Per-topic configs (feeds, allow/deny, severity topic) live in
`lib/ingest/src/topicConfigs.ts`, which exports `runEnergyIngest` / `runFertiliserIngest`
/ `runFuelIngest`.

**What is live now:** flashpoint, cargo_watch, shipping, energy, fertiliser, fuel
(incidents) all have live news scrapers. fuel ALSO has the FRED price feed (separate,
for `hardNumbers` tiles).

**Why strikes is excluded:** `strikes` is a separate missile/drone theatre tracker
(`Strikes.tsx`, own table/schema, `useListStrikes`), NOT a news-incident topic. It must
NOT get a news scraper.

**Wiring rule:** a new ingest topic must be threaded through ALL of: `severity.ts`
(`SeverityTopic` union + a topic branch), `types.ts` (`IngestTopic`), `index.ts`
(exports), `ingestRunner.ts` (`runIngestOnce` runs it + `IngestRunResult` fields),
`routes/admin.ts` (response payload), `ingestScheduler.ts` (boot stale-gate +
tick logging), and `scripts/` (CLI wrapper + `scrape:prod` chain). Miss one and the
scheduler/admin/prod paths silently diverge.

**Boot stale-gate:** `SCRAPED_LAND_TOPICS` (shipping/energy/fertiliser/fuel) have no
`sources.last_success_at` heartbeat, so the boot catch-up checks max(`created_at`) per
topic; ANY stale land topic forces a full run even when flashpoint's heartbeat reads
fresh. **Why:** the first boot after deploying a NEW scraper has a fresh flashpoint
heartbeat but weeks-stale land data — without the per-topic check the catch-up wrongly
skips.

**Known follow-ups (not blockers):** no per-topic ingest heartbeat row yet (quiet
periods with zero inserts re-scrape every cold start); no scheduler boot-gate regression
test.
