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

**Current watchdog tradeoff:** `withIngestLock` races the full run against a
hard deadline and releases the advisory lock when the timer wins, but it does
not cancel the abandoned promise. The old run can continue fetching and
writing while a later run acquires the lock. Treat this as a real
serialization/data-integrity risk, not as harmless idempotence: several stages
use read-then-insert dedupe and source-health read-modify-write. **Why:** a
watchdog timeout has been observed in production, and JavaScript promise
rejection does not stop the underlying work. **How to apply:** cancellation or
worker termination must complete before unlock, or every write must be fenced
by a run owner/token; add a regression test proving a timed-out run cannot
overlap its successor.

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
