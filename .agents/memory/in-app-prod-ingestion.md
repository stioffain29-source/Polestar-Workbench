---
name: In-app production ingestion trigger
description: Why/how the prod data refresh runs as a token-gated server route instead of a scheduled deployment, and the two traps that pattern hit.
---

# In-app production ingestion trigger

When a Scheduled Deployment is the "correct" mechanism but the user cannot find/create it
in the Publishing UI, an in-app authenticated route is a valid alternative: the deployment
RUNTIME (the long-lived server process) is the one place `DATABASE_URL` points at the
writable production primary. A `POST /api/admin/ingest` route that calls the ingest code
directly therefore refreshes prod with a single authenticated request after a normal
republish — no scheduled deployment needed. The route only reaches prod once the autoscale
app is republished (the new code must ship first).

**Why a shared lib (`@workspace/ingest`):** leaf packages (`scripts`, `api-server`) must not
import each other. Extract the scraper core into a lib both import, so the CLI and the route
run identical code. esbuild bundles the lib + `rss-parser` into the server bundle, so no
`tsx`/`pnpm` is needed in the prod runtime.

## Trap 1 — never close the shared DB pool inside reusable lib code
`@workspace/db` exports a singleton `pool`. The old scrapers called `pool.end()` at the end.
If library functions do that, the long-lived server's pool dies after the first run.
**Rule:** lib ingest functions must NOT call `pool.end()`. Only CLI entrypoints (the thin
`scripts/src/scrape-*.ts` wrappers) close the pool; the server keeps it open.

## Trap 2 — serialize high-cost admin endpoints with a Postgres advisory lock, not a flag
An in-memory `inFlight` boolean only blocks overlap within one Node process; autoscale runs
multiple instances, so two concurrent triggers on different instances both proceed and the
read-then-insert dedupe races into duplicate rows.
**Fix:** take a session-level `pg_try_advisory_lock($key)` on a DEDICATED pooled connection
(`pool.connect()`), held for the whole run and released (`pg_advisory_unlock`) + `client.release()`
in `finally`. A second caller (any instance) gets 409. Because only one ingest runs globally
at a time, the in-app dedupe is safe again without needing a new DB unique index.
**How to apply:** any manually-triggered, expensive, non-idempotent server route in this
autoscale app should use the advisory-lock pattern, not a module-level flag.

## Root cause of "data is stale everywhere": nothing TRIGGERED ingestion
The pipeline was never broken — the live RSS feeds return current items (a dry-run
`scrape:flashpoint` with no `--commit` shows dozens of "New to insert"). Data froze because
nothing ever RAN the scrapers; the DB just sat at the last manual run.
**Rule:** when every topic looks frozen ~1–2 weeks back, suspect the TRIGGER, not the feeds.
Confirm by running the scraper in DRY-RUN and reading "New to insert" / per-feed dates.
**Fix shipped:** an automatic scheduler in the api-server (`lib/ingestScheduler.ts`, started
from `index.ts` after `listen`) runs ingestion on boot IF data is stale beyond the interval,
plus a recurring timer every `INGEST_INTERVAL_HOURS` (default 6). Both the scheduler and the
admin route go through one shared `lib/ingestRunner.ts` (`runIngestOnce`) that holds the same
advisory lock. On autoscale the boot catch-up is what matters (timers don't fire while scaled
to zero): every cold start that finds stale data self-refreshes. The scheduler only reaches
prod after a republish, and writes prod only inside the deployment (writable primary there).
Disable with `INGEST_SCHEDULE_ENABLED=false`.

## Only flashpoint + cargo_watch have scrapers; the rest are import-only
fuel / energy / fertiliser / shipping / strikes have NO live feed — they are STATIC / IMPORT
ONLY (the Fuel Watch report literally prints that). "Fix ingestion for every topic" is not
possible as stated; there is nothing to pull for those. cargo_watch has a scraper but the
APAC cargo-theft feeds are genuinely thin (few accepted items), so it moves slowly even when
running. Cargo Map "0 geocoded" is a SEPARATE gap: the ingest inserts incidents with
latitude/longitude = null (no geocoding step), so the map has nothing to plot.
