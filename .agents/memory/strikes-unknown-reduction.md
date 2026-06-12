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

**Backfill scope now covers ALL rows** — auto-scraped AND hand-entered/seed
rows. (It was auto-scraped-only via `analyst_notes LIKE 'auto-scraped:%'`; an
explicit decision broadened it so the refinery / petrochemical / aluminium-smelter
SEED rows that sat unknown/unknown also get filled.) The protection that replaces
the scope filter is the **fill-only-when-blank** rule: overwrite target/infra
ONLY when currently unknown, fill casualties ONLY when NULL — a deliberately
chosen analyst value is never blank, so it is never touched. Runs once in the
deployment via a marker-gated boot block (prod DB writable only there; workspace
sees a read-only replica). **Bump the boot marker** (`strikes_reclassify_columns_vN`
in `artifacts/api-server/src/lib/migrations.ts`) whenever the classifier or the
backfill scope changes and rows must be re-swept — the CLI ignores the marker but
prod only re-runs on a marker change + republish.

**Known residual (display layer):** some rows still SHOW Unknown on the dashboard
because `Strikes.tsx`'s OWN display-layer `TARGET_TEXT` regex misses them (it had
a trailing-`\b` trap the ingest side fixed). That is a display-layer change,
distinct from the stored-column backfill.

**Real bug fixed:** `mapDbTarget` was missing `case "government_facility"`, so
any government-classified column displayed as Unknown.

**How to verify:** a tsx probe that imports `classifyStrikeFields` and re-derives
target over auto-scraped rows tells you how many Unknowns are still recoverable
(0 == fully maximized). Run bare `tsx` via `pnpm --filter @workspace/scripts
exec tsx ...` — `npx tsx` is not on PATH.
