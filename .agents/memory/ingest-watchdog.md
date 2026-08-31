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

**Current watchdog design:** full scheduled, boot and manual ingestion runs in
a supervised child process. On timeout/cancellation, the parent sends SIGTERM,
escalates to SIGKILL, and retains local ownership until the child emits `exit`.
The worker owns the PostgreSQL advisory lock, and loss of that dedicated lock
session is process-fatal.

Database writes are also protected by an epoch fence. Each worker connection is
labelled with its run ID; guarded mutations lock the singleton fence row and
must match the active run. A successor advances the epoch only after
already-started old writes finish, drains prior labelled sessions, and rejects
later stale writes with SQLSTATE 55000. Legacy/unlabelled writers fail closed.
**Why:** killing sessions alone cannot prevent an abandoned worker from
reconnecting, and rejecting a JavaScript promise never cancels its underlying
work.
**How to apply:** every full-ingest entry point must use the supervised worker;
every mutable public table must retain fence-trigger coverage; maintenance
writers must use the explicit protocol label. Never restore a Promise.race
watchdog around in-process ingestion.

**True root cause (found Aug 2026, after the watchdog):** the shared pg Pool
had NO keepAlive/query_timeout. Neon kills backends mid-run ("terminating
connection due to administrator command", ~3 min in on a bad morning); a query
issued on that half-dead socket never settles → the awaiting stage (a plain
`db.select` dedupe, NOT an external call) hangs forever. Fix in
`lib/db/src/index.ts`: `keepAlive:true`, `connectionTimeoutMillis:30s`,
`query_timeout:300s` (client-side; deliberately no server statement_timeout so
long boot migrations survive). Watchdog stays as the backstop.

**Backfill reality after an outage:** Google News feeds are rank-capped, so
most of a >24h gap never comes back from feeds; GDELT structured (date-ranged)
recovers some flashpoint-family events once its stage completes.

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
