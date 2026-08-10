---
name: Ingest run watchdog + why prod goes stale
description: Root cause of recurring "map empty past 24h" prod outages and the watchdog that fixes it; also the replshield block on external admin curls.
---

# Ingest watchdog (recurring prod staleness root cause)

**Root cause of the repeated "no incidents past 24h" outages:** the full ingest
chain (~30 sequential stages) had NO overall deadline. One stage hanging
forever on an external call left the advisory lock held; on the Reserved VM
that stuck promise lives until the next republish, and every 12h interval tick
logs `scheduled ingest skipped (already running)` while only the hourly price
top-up keeps working. Signature: incidents/sources frozen at one timestamp,
`price top-up finished` lines continuing hourly, and the skip line at ticks.
Eventually the lock connection dies (lock frees) but the awaited fn never
settles, so no "finished/failed" line is ever logged.

**Fix (in `ingestRunner.ts`):** `withIngestLock` races `fn()` against a hard
watchdog (`INGEST_WATCHDOG_MINUTES`, default 90). On timeout it throws with
the LAST STAGE REACHED (`markIngestStage(...)` markers before every awaited
stage in `runIngestOnce`, incident topics as `runIncidentIngest:<topic>`),
the finally releases the lock, and the next tick can run. The abandoned run
may keep writing in the background — idempotent, harmless.

**How to apply / diagnose next time:** read the watchdog error's stage name in
deployment logs; corroborate with `sources.last_success_at` ordering (the
stage after the last-touched source is the culprit).

**Why the lock diagnosis is subtle:** by the time you query `pg_locks` the
lock is often already free (the lock client died mid-hang) — absence of an
advisory lock does NOT mean no run is stuck in-process.

## Replshield blocks external admin curls on private deployments

With the app set to PRIVATE visibility, workspace curl to
`<prod>/api/admin/ingest` gets **307 → replit.com/__replshield** — the Bearer
token never reaches the app, so the token-gated trigger is unreachable from
outside. Recovery paths that still work: the in-app Source Health "Run ingest
now" button (owner's authenticated browser session passes the shield), the
scheduler's next interval tick, or a republish (boot catch-up sees stale data
and runs).
