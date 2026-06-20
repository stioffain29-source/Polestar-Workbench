---
name: maritime-movement scrape operations
description: AIS collection providers (aisstream vs Datalastic satellite), why the commit run looks hung, provider-switch boot gate, and the NULL-not-zero cargo-split honesty rule.
---

# AIS maritime-movement ingest

`runMaritimeMovementIngest` collects live vessel positions per chokepoint and writes
UNIQUE-vessel snapshots into `maritime_movement` (+ `maritime_vessel_sighting`, SINGULAR).
It NEVER touches the incidents table. CLI: `pnpm --filter @workspace/scripts run
scrape:maritime-movement -- --commit`.

## Two collection providers — pick the satellite one for the Middle East

- **aisstream.io** (free, terrestrial WebSocket sample): near-ZERO Middle-East coverage.
  Short samples from the workspace egress consistently only capture **Singapore Strait**;
  Hormuz / Bab el-Mandeb / Red Sea / Gulf of Aden read empty. This is the coverage gap, NOT
  a no-traffic situation — do not mistake it for the honest no-row rule.
- **Datalastic satellite** (`collectViaDatalastic`): the coverage-complete path. Used when the
  PAID `VESSEL_REGISTRY_API_KEY` (datalastic) is configured+enabled — that key DOUBLES as the
  collection source. One `vessel_inradius` GET per theatre centre+radius; classes resolved
  INLINE from each vessel's `type_specific` (no slow per-vessel registry lookups). Verified:
  all 6 chokepoints populate incl. **Strait of Hormuz** (~157 vessels). source_name =
  `"AIS (Datalastic satellite)"` (contains "ais" for the boot-gate ILIKE, and "datalastic"
  for the provider check).
- **Why:** the user demanded real Hormuz vessel data; free aisstream cannot deliver it.
- **How to apply:** if Hormuz/ME straits are empty in prod, confirm the Datalastic key is set
  and the deployment shipped the satellite path — then a refresh repopulates every theatre.

## Provider-switch boot gate (prod self-heal)

The scheduler's boot freshness gate only checked the newest AIS row's TIME age. A switch from
aisstream → Datalastic leaves the old rows TIME-fresh but COVERAGE-wrong, so the gate would
skip the catch-up and Hormuz stays empty after republish. Fix: `movementProviderMismatch()`
forces a boot catch-up when the newest row's provider ≠ the now-active provider. Also
`movementFeedActive() = aisMovementActive() (AIS_API_KEY) || activeMovementProviderIsDatalastic()`
— gate logic must use the OR or a Datalastic-only deployment skips movement refresh.
- **Why:** time-based freshness alone masks a coverage regression on provider change.
- **How to apply:** any new movement provider must (a) write a distinguishable source_name and
  (b) be recognised by both helpers, or the switch won't trigger a refresh.

## NULL-not-zero cargo-split honesty (NO-FABRICATION)

`datalasticCargoClass(typeSpecific)` resolves bulk/container/lng-lpg ONLY from a SPECIFIC
`type_specific` ("Bulk Carrier", "LNG Tanker", "General Cargo"…). A bare generic "Cargo"/
"Tanker" (or absent) stays UNRESOLVED (null) — it must NOT be bucketed as "other", because
"other" marks the vessel `registryResolved`, which flips the split columns from honest NULL to
a fabricated `0 bulk / 0 container / 0 LNG`. A specific-but-untracked type ("Crude Oil Tanker")
legitimately resolves to "other" (a confirmed non-split).
- **Why:** a displayed "0 bulk" must mean "checked, none", never "couldn't tell".
- **How to apply:** keep split counts gated on a definitive match; total still counts the hull.

## Operational traps

- **The "it's hung" trap (aisstream path):** the inline Datalastic registry pass resolves up to
  `VESSEL_REGISTRY_MAX_LOOKUPS` (default 150) at concurrency 5 with an 8s per-lookup timeout —
  minutes after the sample ends; non-TTY stdout buffers so the log shows only the banner. Slow,
  not broken. For a fast movement-only run set `VESSEL_REGISTRY_ENABLED=false` (splits stay NULL).
  NOTE: with the Datalastic COLLECTION path, splits come free from `type_specific` (no slow pass).
- **Don't chase your own shell:** `pgrep/pkill -f maritime-movement` self-match the checker. Use
  the bracket trick — `ps -eo pid,args | grep '[s]crape-maritime-movement'`.
- **tsx invocation:** run from `scripts/` (`cd scripts && npx tsx src/...`); bare `tsx` not on PATH.
  Node/tsx scripts see `process.env`; the code_execution sandbox does NOT.
- Prod DB is read-only from the workspace; movement refresh runs INSIDE the deployment runtime
  (boot freshness gate after republish, or token-gated `POST /api/admin/ingest`).

## "No inbound/outbound or cargo" complaints are usually a STALE view, not a missing feature

The Datalastic COLLECTION path DOES populate `inbound_count`/`outbound_count` AND the
cargo split (`tankers/bulk/container/lng_lpg`) — replit.md's older "inbound/outbound stay NULL"
wording predates that path and is now stale for a Datalastic-keyed deployment. These columns
only (re)fill when the live AIS+registry ingest runs on a deployment cold start, so a board
viewed BEFORE the latest republish's boot ingest shows them blank — same stale-view class as
every other boot-ingest-fed surface. Confirm the prod row actually has the values before
treating "the board has no inbound/outbound/cargo" as a code bug.
- **Why:** the data, mapping, and rendering were all already correct; the user's screenshot
  pre-dated the boot ingest that filled the columns.
- **How to apply:** query `maritime_movement` in prod first; if populated, it's a refresh/cache
  issue (republish + hard refresh), not a missing feature.

## Board card vs report/PDF movement rendering split

The Shipping monitor chokepoint card surfaces movement as labelled MOVEMENT / DIRECTION /
CARGO MIX rows via the dedicated `formatMovementTotals` / `formatMovementDirection` /
`formatMovementCargo` helpers (in `maritimeIntelligence.ts`). The Shipping Watch report
preview AND its PDF still use the compact one-line `formatMovementSummary` (their parity is
preserved). All four read the SAME `MovementTheatre` data; only presentation differs. Every
helper returns null / omits a fragment when the provider didn't report it (no fabricated zeros).
- **How to apply:** add a new movement dimension to the helper(s) for the card, and to
  `formatMovementSummary` for the report/PDF, or the surfaces drift.
