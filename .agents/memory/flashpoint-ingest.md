---
name: Flashpoint ingest pipeline
description: How Flashpoint (and other topic) data actually lands in the incidents table — what runs automatically vs manually, and where the seed/cleanup boundary sits.
---

The Polestar Advisory Workbench has **no scheduler**. Topic ingest happens in exactly two places:

1. **Manual scraper runs** — `pnpm --filter @workspace/scripts run scrape:flashpoint -- --commit` (and the analogous `scrape:cargo-watch`). These read catalogued sources from the `sources` table, fetch RSS, classify, dedupe, insert. Source `last_success_at` / `last_failure_at` / `error_message` are updated per run.
2. **Startup data migrations** — `runDataMigrations()` in `artifacts/api-server/src/lib/migrations.ts` runs once per API-server boot. It seeds reports + country baselines, applies idempotent topic-pollution cleanup (UAE air-defense → strikes, cargo theft → cargo_watch, kinetic-without-protest-cue → strikes, operational-risk-zone watchlist → delete, dedupe by source_url), seeds regional flashpoint source rows, and self-heals their URLs.

**Why:** A previous audit found 252/687 records in `flashpoint`+`protests` were mis-classified Strike/Cargo content from the legacy seed (`attached_assets/legacy-dashboard-data.json`). The cleanup migration prevents that pollution from coming back; the import-time filter in `scripts/src/import-legacy.ts` (`refineTopic()`) prevents re-import from re-introducing it.

**How to apply:**
- Adding a new topic source: insert a row into `sources` with the right `topic` and `source_type='rss'`, then re-run the matching scrape script. No code change needed.
- Adding a new pollution rule: add it to BOTH the startup migration (cleans existing rows) AND `refineTopic()` in `import-legacy.ts` (prevents re-import). Keep the two in sync.
- Regional source URLs from Replit's container: many publisher RSS feeds are 404/403/timeout from this network. Google News country-targeted RSS (`news.google.com/rss/search?q=...&hl=en-XX&gl=XX&ceid=XX:en`) is the reliable fallback.
- The scraper's DB-dedupe lookup is scoped to (last 365 days OR source_url IS NOT NULL) to avoid OOM as the table grows. Do not remove that predicate.
