# Flashpoint Data Coverage Audit — Post-Fix

**Date:** 2026-05-26
**Status:** Pipeline rebuilt. Cleanup migration applied. Live scraper online.
**Compared against the prior audit attached to this file.**

## Summary

The data pipeline has been overhauled in five places:

1. **Topic pollution stopped.** A startup migration in `artifacts/api-server/src/lib/migrations.ts` reassigns every UAE air-defense / kinetic / cargo-theft record out of `flashpoint` and `protests`, deletes operational-risk-zone watchlist leaks, and de-duplicates by source URL.
2. **Legacy import hardened.** `scripts/src/import-legacy.ts` now applies the same kinetic / cargo / watchlist filters at import time, so re-running `pnpm --filter @workspace/scripts run import:legacy` will not re-pollute.
3. **Live Flashpoint ingest built.** `scripts/src/scrape-flashpoint.ts` queries the `sources` table for `topic='flashpoint'`, fetches each working RSS feed, applies the same allow/deny rules used by the on-screen report classifier, dedupes in-batch and against the DB, and inserts new rows. Each source's `last_success_at` / `last_failure_at` / `error_message` is tracked so Source Health reflects reality.
4. **Regional coverage seeded.** 14 new source rows (direct publisher RSS where reachable, Google News country-targeted RSS where not) added for MY / LK / TH / BD / ID-Jakarta / PH-Manila / JP-Tokyo / NP.
5. **Audit re-run.** Numbers below.

## Pollution: before → after

| Pollutant | Before (in `flashpoint` + `protests`) | After |
|---|---|---|
| UAE Air-Defense / Missile Activity (Google News) | 274 rows | **0** |
| Cargo-theft Google News (Trucking, Tobacco Cargo Theft, etc.) | 169 rows | **0** |
| Kinetic armed conflict without protest cue | 62 rows | **0** |
| Operational-risk-zone watchlist leaks | 5 rows | **0** (deleted) |
| Duplicate by `source_url` | 91 rows | **0** (deleted) |
| Null-source rows | 12 rows | 7 rows (legitimate legacy early-warning signals, not pollution) |

The reassigned rows are not lost — they live in the topic they belong in (`strikes` for kinetic / UAE air-defense, `cargo_watch` for cargo-theft).

## Topic totals (post-fix)

| Topic | Rows |
|---|---|
| fuel | 756 |
| flashpoint | **591** |
| shipping | 469 |
| protests | 427 |
| strikes | 336 |
| cargo_watch | 296 |
| energy | 108 |
| fertiliser | 79 |

## Flashpoint country coverage (post-fix)

Top 13, all APAC:

| Country | Rows |
|---|---|
| Japan | 80 |
| Bangladesh | 78 |
| Malaysia | 77 |
| Indonesia | 70 |
| Nepal | 61 |
| Sri Lanka | 54 |
| Philippines | 53 |
| Thailand | 50 |
| West Papua | 26 |
| China | 11 |
| Australia | 5 |
| India | 4 |
| Pakistan | 4 |

Trailing countries (Myanmar 1, Vietnam 1, Papua New Guinea 1) appear because of overlap with non-flashpoint feeds — these will fill in as more direct PNG / MM publishers come online.

## Source health (40 catalogued flashpoint sources)

**Operational and returning rows (16):**

ABC News Australia, Free Malaysia Today, GMA News Online, Khaosod English, Malaysiakini, Online Khabar English, Philippine Daily Inquirer, Post-Courier (PNG), Prothom Alo English, RNZ Pacific, Rappler, The Japan Times, and 8 Google News country queries (Malaysia, Sri Lanka, Thailand, Bangladesh, Indonesia, Philippines, Japan, Nepal).

**Catalogued but returning errors from the Replit container (15):**

| Source | Error class | Recommended action |
|---|---|---|
| Reuters Asia Pacific Wire | 401 Unauthorized | Gated wire — needs paid API key |
| AFP Asia-Pacific | malformed RSS | Switch to AFP partner feed or drop |
| Benar News | 404 | Feed URL changed — research current RSS path |
| Kyodo News (English) | 404 | Switch to Kyodo partner JP feed |
| NHK World Japan | 20s timeout | Network-blocked from container; Google News — Japan covers this gap |
| The Kathmandu Post | malformed XML entities | Wait for publisher fix or replace with Online Khabar (already working) |
| Nepal Republica | 404 | Replace with Online Khabar (already working) |
| Sunday Times Sri Lanka | 404 | Replaced operationally by Google News — Sri Lanka |
| Daily Mirror Sri Lanka | malformed RSS | Replaced operationally by Google News — Sri Lanka |
| New Age Bangladesh | 404 | Replaced operationally by Google News — Bangladesh |
| The Jakarta Post | 404 | Replaced operationally by Google News — Indonesia |
| Tempo English | 404 | Replaced operationally by Google News — Indonesia |
| Prachatai English | malformed RSS | Wait for publisher fix |
| Human Rights Watch Asia | malformed RSS | Switch to HRW search-API feed |
| ITUC Global Rights Index, IndustriALL, Education International APAC, University World News Asia, Jubi.id, CIVICUS Monitor | various (403/404/non-RSS) | Specialist civic-space sources — keep catalogued so analysts know about them; needs manual sourcing |

Each failing source has its error logged on the row in `sources.error_message` so the Source Health view surfaces it.

## How to operate

- **Add live records:** `pnpm --filter @workspace/scripts run scrape:flashpoint -- --commit`. Dry-run (no flag) prints per-feed counts and country coverage without writing.
- **Reset and re-import legacy:** `pnpm --filter @workspace/scripts run import:legacy`. Refined filters apply automatically.
- **Cleanup migration:** runs on every API-server startup. Idempotent. Will silently reassign / dedupe any new pollution.
- **Add a new source:** insert into `sources` table with `topic='flashpoint'`, `source_type='rss'`, working `url`. The scraper picks it up on next run.

## What this audit deliberately does **not** change

Report prose / topic-specific narrative generation is untouched. Per the standing instruction, those rewrites are queued as a separate follow-up task and will run only after the data layer is signed off.
