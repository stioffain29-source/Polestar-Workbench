---
name: Strikes Unknown-bar reduction
description: How the Missile Strike Tracker's Unknown bars / >50% caveat are actually driven, and the levers that move them.
---

# Reducing "Unknown" on the Missile Strike Tracker

The Strikes dashboard (`Strikes.tsx`) derives Target/Weapon/Casualties/Impact
with this precedence: a strong MILITARY text regex first, then the DB column via
`mapDbTarget` / munition enum, then a text fallback, else Unknown. So the lever
that shrinks Unknown bars is **populating the DB columns**, because the column is
trusted before the generic text fallback.

**Why the caveat can read differently than a full-table count:** the >50%
"mostly unattributed" caveat is computed over the CURRENT FILTERED WINDOW (e.g.
60d), not the whole table. A change can flip the caveat off in the default view
while the all-rows ratio is still ~50%.

**The classifier improvement** lives in `lib/ingest/src/strikes.ts`
(`classifyStrikeFields`, shared by live ingest + backfill). Stems must carry a
LEADING `\b` only — a trailing `\b` is the classic trap that drops
refiner→refinery, petrochem→petrochemical, energy-facilit→facility. The casualty
rule treats a clean interception as 0 only when INTERCEPT_SIG && !HARM_SIG &&
!LANDED_SIG (so "one impacted in the east" stays Unknown, not 0).

**Backfill scope is auto-scraped rows only** (`analyst_notes LIKE
'auto-scraped:%'`) — never overwrite analyst/manual data. Runs once in the
deployment via a marker-gated boot block (prod DB is writable only there; the
workspace sees a read-only replica). Idempotent: overwrite target/infra only
when currently unknown, fill casualties only when NULL.

**Known residual:** the catchable rows that remain Unknown are MANUAL SEED rows
(refinery / petrochemical / oil-storage targets) that the dashboard's OWN
display-layer `TARGET_TEXT` regex misses — it still has the trailing-`\b` trap
the ingest side fixed. Fixing that is a display-layer change (`Strikes.tsx`),
distinct from "improve the ingest classifier", so it was left as a follow-up.

**Real bug fixed:** `mapDbTarget` was missing `case "government_facility"`, so
any government-classified column displayed as Unknown.

**How to verify:** a tsx probe that imports `classifyStrikeFields` and re-derives
target over auto-scraped rows tells you how many Unknowns are still recoverable
(0 == fully maximized). Run bare `tsx` via `pnpm --filter @workspace/scripts
exec tsx ...` — `npx tsx` is not on PATH.
