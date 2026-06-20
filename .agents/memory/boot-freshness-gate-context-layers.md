---
name: Boot freshness gate must cover full-ingest-only context layers
description: Why the scheduler's boot catch-up gate has to include AIS movement / strikes / land topics, and how to gate them
---

# Boot freshness gate must cover every full-ingest-only data layer

The autoscale boot catch-up (`startIngestScheduler`) only fires a full ingest
when its freshness gate says SOMETHING is stale. Anything that refreshes ONLY
inside `runIngestOnce` (it has no independent timer/cron) must be a member of
that gate, or it silently drifts stale while the gated topics stay fresh.

Concretely: the flashpoint/cargo_watch heartbeat is the original gate, but
strikes, the scraped land topics (shipping/energy/fertiliser/fuel/conflict),
and the live AIS `maritime_movement` snapshot each had to be added — because
when incidents are fresh the boot path skips the full ingest and only does the
cheap fuel-price top-up, so those layers would never refresh on a cold start.

**Why:** the ship-movement board flips "stale" past a 14-day window
(`FRESH_DAYS` in `lib/maritimeSources.ts`), and an intermittently-failing AIS
pass (it writes a row only when vessels are seen) would let it age out unnoticed.

**How to apply:**
- Add the layer's "hours since newest row" check to the boot gate's OR.
- Gate it on the provider being ACTIVE (e.g. AIS: `AIS_API_KEY` set AND
  `AIS_ENABLED`≠false). If you gate on a layer that is empty by design when
  unconfigured, the gate forces a useless full scrape on EVERY cold start.
- Scope the freshness query to the live feed (AIS rows = `source_name ILIKE
  '%ais%'`) so a one-off manual upload can't suppress the live-feed catch-up.
- For a GUARANTEED cadence regardless of traffic, a Scheduled Deployment running
  `scrape:prod` (which already chains maritime movement) is the real fix; the
  boot gate only helps a trafficked autoscale app that cold-starts often.
- A task agent CANNOT create a Scheduled Deployment / change the deployment type
  — that is a user Publishing-UI action, and `suggestDeploy()` is a no-op in a
  task agent. The api-server artifact must stay `autoscale` to serve the API, so
  don't repurpose its `artifact.toml` into a cron job. The in-repo deliverable is
  the boot/interval catch-up PLUS an SLA monitor (`monitorMovementFreshness`)
  that WARNs when AIS is active and the board breaches the 14-day window — that
  is what makes the SLA verifiable from logs; the guaranteed-cadence deployment
  is handed off to the user as a follow-up.

**Why:** a code reviewer rejected "make the cold-start gate cover movement" as
not satisfying "guaranteed cadence independent of traffic" — because zero-traffic
autoscale never cold-starts. The honest split: code can make warm/always-on and
trafficked-autoscale reliable AND make staleness observable; only a deployment
topology (VM/scheduled) can guarantee cadence at zero traffic, and that is a
user action.
