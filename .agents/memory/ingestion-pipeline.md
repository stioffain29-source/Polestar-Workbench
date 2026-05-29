---
name: Incident ingestion pipeline
description: How incidents get into the DB, why data goes stale, and the manual-only nature of scraping
---

# Incident ingestion

**There is NO scheduler/cron anywhere.** `.replit` has no scheduled deployment/jobs. Incidents only enter the DB when someone manually runs a scrape script. This is the root cause of "stale data" / "no records for recent days" complaints.

**Scrapers (only two exist):**
- `scripts/src/scrape-flashpoint.ts` → `pnpm --filter @workspace/scripts run scrape:flashpoint --commit`
- `scripts/src/scrape-cargo-watch.ts` → `pnpm --filter @workspace/scripts run scrape:cargo-watch --commit`
- Without `--commit` they dry-run (print report, write nothing).

**The other 6 topics (fuel, shipping, protests, strikes, energy, fertiliser) have NO scraper at all** — they only ever got a one-time legacy/seed import (`scripts/src/import-legacy.ts`). They will never update on their own.

**Source health reality (flashpoint):** Google News aggregator feeds are the workhorse (50-80 accepted each). Many individual publisher RSS feeds are chronically broken (401/403/404/timeout/malformed XML): Reuters, Benar News, ITUC, IndustriALL, Jakarta Post, Tempo, Kyodo, AFP, etc. The pipeline survives because Google News carries the volume. `occurredAt` comes from RSS isoDate/pubDate, fallback `now()` — dates are fine.

**Why:** the design assumes an external trigger (manual shell run or a Replit Scheduled Deployment) that was never wired up.

**How to apply:** When the user reports stale/missing recent incidents: (1) it's almost never a code bug — check `max(created_at)` per topic to see when ingestion last ran; (2) the fix is to run the scrape with `--commit`, and for a lasting fix set up a Scheduled Deployment running both scrape commands daily; (3) the scrapers DO work — a dry-run reliably finds hundreds of new items.

**Prod vs dev diverge independently.** Each environment has its own DB. Running a scrape in dev does NOT touch prod. Production only gets schema changes on Publish, and only gets incident rows if a scrape runs against the prod DATABASE_URL (e.g. via a Scheduled Deployment in the deployment, not the dev workspace). This is why the live site can be far staler than dev even after a successful dev scrape.
