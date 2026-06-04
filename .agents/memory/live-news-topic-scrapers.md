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

**Strikes is now LIVE via its OWN module (NOT runNewsTopicIngest).** `strikes` is a
separate missile/drone theatre tracker (`Strikes.tsx`, own `strikes` table/schema,
`useListStrikes`), so it deliberately does NOT use the generic news-topic runner. It has
its own `lib/ingest/src/strikes.ts` (`runStrikesIngest`): per-theatre feeds (land_gcc /
maritime_hormuz), allow/deny gate, conservative munition/target/infra classifier
(unknown by default, NEVER fabricates casualties), coarse dedupe {theatre,country,
munition,date}+sourceUrl. **Why a dedicated EARLY boot-only run** (`ingestScheduler.ts`,
gated on `MAX(strikes.created_at)` staleness, separate from the full ingest): the tracker
had frozen at 2026-05-22 because the full ingest sometimes timed out before reaching
strikes, so strikes gets its own fast, early, strikes-only boot run. `INGEST_FORCE_VERSION`
(currently 5) force-runs once on the next prod boot so strikes populates prod after a
single republish.

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
