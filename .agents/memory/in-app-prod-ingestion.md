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

## Freshness guard SKIPS the boot catch-up after a republish that changes classifier rules
The boot catch-up only runs when data is stale beyond `INGEST_INTERVAL_HOURS`. So a republish
carrying NEW scraper/classifier logic does NOT refresh prod when the existing rows are still
"fresh" (e.g. scraped <12h ago) — the new accept/reject rules never reach prod until the data
happens to age out. Symptom: code that surfaces a genuine new incident works in dev (which got
re-scraped) but prod stays empty/stale right after publishing.
**Fix:** a version-gated forced boot ingest — a code constant `INGEST_FORCE_VERSION` + an
`app_migration_markers` key `ingest_force_v<N>`. On boot, if the marker for the current version
is absent, force ONE full ingest regardless of freshness, then insert the marker. Bumping the
constant in code guarantees the next deploy re-scrapes prod once.
**Why mark only on success:** the forced path must record the marker ONLY when a full run
actually completed. `tick()` swallows errors and also returns when the advisory lock is already
held (ran=false) — so it returns a boolean and the forced path gates `markForcedIngestDone()`
on `ran===true`. A skipped/failed forced run must NOT consume the one guaranteed refresh; a
later boot retries.

## (SUPERSEDED) "Only flashpoint + cargo_watch have scrapers"
This was true historically but is NO LONGER — energy / fertiliser / fuel / shipping / strikes
are now LIVE Google-News-RSS scrapers too (see `live-news-topic-scrapers.md`). Do not repeat
the old "nothing to pull for those topics" claim.

## Autoscale FREEZES the long boot ingest mid-run → "no change after republish"
The version-gated forced boot ingest fires correctly in prod (deployment log shows
`boot ingest: forced run ... forceVersion=N`) but on an AUTOSCALE deployment the instance is
frozen/scaled down once the triggering page-load requests finish. The multi-minute serial
`runIngestOnce` chain (strikes+flashpoint+cargo+shipping+energy+fertiliser+fuel+prices, one
lock, no checkpoint/resume) then STOPS dead mid-run: no further per-feed logs, prod DB writes
halt, and the `ingest_force_v<N>` completion marker is NEVER written (it's gated on a completed
run). Symptom the user sees: republish → Source Health still shows the same failing feeds →
"no change / you're lying". A republish can NEVER fix this; it's the deployment model.
**Reliable fix (user decision, cost-bearing):** run ingestion in a process that stays alive to
completion — a Scheduled Deployment running `scrape:prod`, or a Reserved-VM/always-on deployment.
NOT another autoscale republish.
**How to PROVE which problem you're hitting:** read prod via `executeSql({environment:"production"})`
for `app_migration_markers` (is `ingest_force_v<N>` present? if absent the run never finished) and
`sources.last_success_at/last_failure_at` (do writes stop dead mid-run?); read the deployment
runtime via `fetch_deployment_logs` (does anything follow the "forced run" line, or silence?).

## WHY the boot work freezes: cloudrun throttles POST-LISTEN background CPU
The freeze above is not random — on cloudrun autoscale, CPU is allocated essentially
only DURING request handling. `index.ts` fires `runDataMigrations()` + `startIngestScheduler()`
in an un-awaited `void (async()=>{})()` AFTER `app.listen`, so all of it is post-listen
background work that gets throttled to ~0 between requests and is torn down before finishing.
That is why a ~10k-row sequential relevance backfill stalled partway in prod (most rows left
on the OLD `relevance_version`) and the boot movement run never committed.
**Reliable in-app fix WITHOUT a Scheduled/always-on deployment:** do the heavy work INSIDE an
HTTP request — a token-gated `POST /api/admin/<job>` runs in the request handler, where cloudrun
gives full CPU, so it completes to the end and returns a verifiable JSON result. This is a real
alternative to a Scheduled Deployment for one-shot/triggered jobs (not for guaranteed cadence).
**Also make boot work cheap regardless:** any post-listen pass must be bounded — batch DB writes
in POOL-bounded chunks (shared `pg` Pool defaults to max:10; cap chunk ≤8 to leave headroom for
request handlers) instead of one awaited UPDATE per row. Fast boot work + an in-request trigger
together cover the trafficked-autoscale case; only a guaranteed cadence still needs always-on.
**Verify, don't trust boot:** after republish, curl the admin trigger then read
`executeSql({environment:"production"})` to PROVE the row counts changed — never assume the cold
start finished the job.

## Google News rate-limits the PROD egress IP (not a code bug)
Dev (workspace IP) scrapes every feed operational; prod consistently times out ~20+ Google-News
feeds (`Request timed out after 20000ms`) on the same energy/shipping/strikes/fertiliser set.
That gap = per-IP throttling of the prod egress IP, not broken fetch code. Mitigation that
helps but may not fully clear it: gentler fetch (browser UA already; attempts 3, backoff 2.5s
exp, burst CONCURRENCY 2 on the Google-News topics) to avoid bursts. **Trade-off:** gentler =
slower = MORE exposure to the autoscale freeze above, so it only pays off on a Scheduled
Deployment / always-on runner where slow-but-thorough is fine. If still throttled there,
consider env-specific tuning or splitting ingest into short per-stage-marked jobs.
