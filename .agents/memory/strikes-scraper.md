---
name: Missile Strike Tracker live scraper
description: How the strikes ingest works and why its dedupe/casualty rules are deliberately conservative.
---

# Missile Strike Tracker live ingest (`lib/ingest/src/strikes.ts`)

The Missile Strike Tracker (`strikesTable`, theatres `land_gcc` + `maritime_hormuz`, viewed at `/strikes/:theatre`) is fed by a live Google-News RSS ingest, wired exactly like the other topics: `runStrikesIngest` runs inside `runIngestOnce`, the scheduler boot-gate checks strike staleness, the admin route reports it, and `scrape:strikes` / `scrape:prod` cover the CLI. It had no scraper before and was frozen.

## Conservative dedupe — deliberate, do NOT "fix" into inflation
Dedupe collapses to ONE row per `{theatre, country, munition, day}` (the `clusterKey`), keeping the highest-confidence/longest candidate. Both the in-batch stage and the DB stage use the SAME `clusterKey` + `sourceUrl` so they agree.

**Why:** A title-Jaccard "keep distinct same-day events" attempt was tried and rejected — it pushed unique counts 104→225 because syndicated copies of ONE event have reworded headlines scoring <0.5 token overlap, so it inserted near-duplicate rows and inflated the strike count. For this distrustful, precision-first user, inflating counts is the worse failure than occasionally merging two genuinely distinct same-day same-munition strikes. The headline/title is NOT persisted (no `title` column; DB stores `summary`), so there is no reliable cross-run title signal anyway.

**How to apply:** Keep the single-best-per-cluster collapse. If asked to capture more distinct same-day events, push back or require a persisted title + a high merge threshold — never lower the bar in a way that re-admits syndication.

## Casualty parsing — explicit deaths only, never fabricate
`parseCasualties` counts a number ONLY when directly governed by a death term (`killed/kills/killing/dead/deaths/fatalities`). The earlier `leaving (\d+)` branch was removed because "leaving 12 injured" was being counted as 12 deaths. Injuries are never counted; missing count → null.

## Autoscale: the backfill must run FIRST, not last
`runIngestOnce` is launched as an UNOWNED background task ~60s after boot by the scheduler. On an AUTOSCALE deployment the instance is torn down once traffic stops, so a multi-minute chain (flashpoint+cargo+shipping+energy+fertiliser+fuel+FRED+strikes) frequently dies before the LAST step runs. The first prod republish proved this: logs showed "boot ingest: forced run ... forceVersion=4" but NO "scheduled ingest finished", and prod strikes stayed at 48 land / 0 maritime — strikes (then last) was never reached.

**Fix/rule:** the strikes ingest now runs FIRST in `runIngestOnce` (it writes its own table, shares nothing with the incidents dedupe, so reordering is safe). Any one-time backfill that depends on the boot scheduler must be ordered to run before the long incident chain, or it may never land on autoscale. Bump `INGEST_FORCE_VERSION` whenever the forced-run behaviour changes so the next boot re-forces. The truly guaranteed path for a one-time backfill is request-scoped (the token-gated `POST /api/admin/ingest`, which keeps the instance alive for the request) or a reserved-VM/scheduled deployment — NOT an unowned boot timer.

**Watch out:** the in-app "Run Backfill" button (`StrikesBackfill.tsx`) is a MANUAL single-event entry form (public `POST /api/strikes`), NOT a scraper trigger. It does not run the live ingest.

## Precision: deny-list trailing-`\b` plural trap
The STRIKE_DENY verb/place groups intentionally OMIT the trailing `\b` (leading `\b` only) so inflections/plurals are caught: `\bukrain` matches "Ukraine"/"Ukrainian", `cope cage` matches "cope cages", `narcotic`/`drug` match plurals. A trailing `\b` on the group silently failed on every plural (the most common false-accept class). Country detection is TITLE-FIRST (strip Google's trailing " - Source", detect on headline only); land events must name a GCC state in the headline, maritime events need a maritime cue or they're rejected.
