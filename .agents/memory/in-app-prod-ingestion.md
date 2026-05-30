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
