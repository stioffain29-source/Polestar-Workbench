---
name: GDELT Cloud structured event layer
description: GDELT daily Events + Stories in own table; EVENTS now promote into real incidents (owner revoked the old "never an incident" isolation); lane/sub-bucket rules, promote semantics, and QU-cost mitigations.
---

# GDELT Cloud structured event layer

A daily STRUCTURED source. Rows land in their OWN `gdelt_structured_items` table
first, then lane-bearing EVENTS are PROMOTED into real incidents (see the promote
section). Stories remain context-only.

- **Isolation invariant REVOKED (owner request).** The layer USED to be hard-
  isolated — its rows could NEVER become incidents. The owner reversed that:
  GDELT-coded events must feed the real flashpoint/conflict monitors and the
  country geography reports. Do NOT re-isolate it or treat a promoted incident as
  a bug. Stories (lane=null) still never promote.
- **Shape.** One table with a `kind` discriminator (`'event'` | `'story'`).
  Dedup key = unique `(source_name, kind, external_id)` via `onConflictDoNothing`.
  `source_name = "gdelt_cloud"`.
- **Lanes (EVENTS only).** 5 fixed lanes: Protests; Civil unrest and riots;
  Security incidents; Crime; Transport disruption. Mapping is from GDELT's
  verbatim category/subcategory/event_code (Protests→Protests; Riots→Civil unrest
  and riots; Battles/Explosions-Remote violence/Violence against civilians/
  Strategic developments→Security incidents; CRIME→Crime; INFRASTRUCTURE +
  IN02* code→Transport disruption). Anything else is DROPPED — no catch-all lane.
  STORIES carry `lane = null` (no fabrication of a lane they don't have).
- **Sub-bucket (Indonesia only).** Jakarta if admin1/location ~ /jakarta/i;
  Indonesian Papua if ~ /papua/i. Geography metadata, NOT a severity tier.

## The promote pass (structured EVENT → incident)

`gdeltPromote.ts` (`runGdeltPromote`, pure helper `decidePromotion`). A DB→DB
transform over the LOCAL `gdelt_structured_items` table, so it costs ZERO GDELT
query-units (the structured ingest already paid for the fetch). Wired into BOTH
`runIngestOnce` and `runGdeltStructuredOnce`, each in its own try/catch so a
promote failure can never fail the wider ingest.

- **Only `kind='event'` with a mapped lane promotes.** Stories never do.
- **Lane → (topic, relevance):** Protests + "Civil unrest and riots" →
  flashpoint / relevant / score 1; "Security incidents" → conflict / relevant / 1;
  Crime + "Transport disruption" → flashpoint / **irrelevant** / 0.
- **Why irrelevant-as-context:** Crime/Transport are stored `relevance='irrelevant'`
  so they stay OUT of the flashpoint monitor (which filters on relevance) while the
  country reports (which read `includeIrrelevant` + apply their own
  `isCountryRelevant` gate) still surface them in the geography picture.
- **No fabrication:** the lane IS GDELT's own coding; `relevanceReason` records
  exactly `gdelt lane: <lane>`. `source="GDELT Cloud"`, `confidence="low"`.
- **Geography:** GDELT's own per-event lat/lng used DIRECTLY (country centroid is
  fallback only). Indonesian-Papua sub-bucket re-homed to country "West Papua"
  (valid geocode centroid + the tag the West Papua brief reads); Jakarta stays
  "Indonesia". Only the 4 in-scope countries (Indonesia/Philippines/Thailand/PNG)
  promote; a foreign dateline that slipped GDELT's geo coding is skipped.
- **Severity:** `maxSeverity(classifySeverity(...topic), severityFromFatalities)` —
  a confirmed fatality floors to high, ≥6 to extreme (mirrors the T001 pattern).
- **Idempotency + double-insert safety:** each promoted row is stamped
  `analyst_notes = "gdelt_cloud:<externalId>"` (`PROMOTE_MARKER_PREFIX`). Re-runs
  dedupe on that marker; a scraped news row for the same event dedupes on the
  fuzzy key (byte-identical to `dedupeKey` in newsTopic.ts) + source/resolved URL.
  In-run guard sets grow so two same-run events can't double-insert.

## Promoted rows still pass the SLOP-EXCLUDE gate (Option A)

A lane vouches that an event is GENUINE, but it does NOT vouch that the event is
on-topic *noise-free* — GDELT lanes still carry stock-photo wires, sports-media
"protests", suspended strikes, market "rallies", relief/diplomacy copy, etc. So a
promoted row is gated through the topic's SLOP EXCLUDES ONLY — never the full
REQUIRED gate (the lane already earned the keep; re-running REQUIRED would
re-drop genuine lane events on text alone). `hitsSlopExclude(topic, i)` (exported
from `@workspace/relevance`) is the ONE shared slop-only predicate: for flashpoint
it runs `FLASHPOINT_EXCLUDE` + `FLASHPOINT_TITLE_HARD_EXCLUDE`; for conflict it
runs `CONFLICT_EXCLUDE` + `CONFLICT_HARD_EXCLUDE`. A slop hit in `decidePromotion`
DEMOTES the row (relevance='irrelevant', score 0, reason) — it is never deleted
(context stays visible to country reports via `includeIrrelevant`).

Flashpoint branch ORDER matters: title-HARD-exclude → `FLASHPOINT_TITLE_RESCUE_UNAMBIG_RE`
(returns relevant) → body `FLASHPOINT_EXCLUDE`. The rescue MUST front-run the body
homonym scan, else a lane-vouched public-order headline whose body carries an
ambiguous token (e.g. an anti-"air strike" demonstration; "air strike" is a
FLASHPOINT_EXCLUDE homonym) is wrongly demoted. Conflict branch order:
CONFLICT_HARD_EXCLUDE → violence override → CONFLICT_EXCLUDE.

**Known residual (low-sev, needs GDELT lane MISCODING to bite):** `hitsSlopExclude`
runs the TOPIC slop excludes only, NOT the GLOBAL `EXCLUDE_PHRASES`. Sports
"shoot-out"/"penalty shootout" lives in EXCLUDE_PHRASES precisely because
`CONFLICT_VIOLENCE_OVERRIDE` re-admits bare "shootout" past CONFLICT_EXCLUDE — so a
"Security incidents"-laned sports shoot-out headline would survive the slop gate.
Only matters on a double failure (lane miscodes AND sports headline). Future
hardening: prepend `firstMatch(text, EXCLUDE_PHRASES)` in `hitsSlopExclude` behind
a fresh reclean marker (per the marker-gated-reclean invariant above).

**A one-time marker-gated reclean was required** because `backfillRelevance`
permanently SKIPS `gdelt_cloud:%` / `tapa_offline:%` markers (see below), so a
`RELEVANCE_RULE_VERSION` bump can NEVER re-clean already-promoted rows. New/changed
slop excludes therefore need a fresh idempotent boot-migration block (mirror
`gdelt_cloud_slop_reclean_v1`) that replays `hitsSlopExclude` over the stored
promoted flashpoint/conflict `relevant` rows and demotes-only. **Why:** the two
design invariants collide — promoted rows are lane-scored not text-scored, yet a
new slop rule must reach them; the only safe bridge is a marker-gated one-shot,
not the version backfill.

**CRITICAL — the relevance backfill must EXCLUDE promoted rows.** `backfillRelevance`
(migrations.ts) re-scores every incident whose `relevanceVersion != RELEVANCE_RULE_VERSION`
through the TEXT relevance engine, which knows nothing about lanes. On the next
routine `RELEVANCE_RULE_VERSION` bump it would flip Crime/Transport 'irrelevant'→
'relevant' (flooding the monitor) and Protests/Security 'relevant'→'irrelevant'
(silently vanishing), destroying the whole promote design. The backfill WHERE
clause therefore excludes `analyst_notes LIKE 'gdelt_cloud:%'` (NULL-safe: NULL
notes still evaluate). Keep that exclusion whenever the backfill is touched.

**Why the UI badge must avoid #1B6B7A / #A33232:** sub-bucket badges are
geography tags, but those two hexes are RESERVED tier colours (petrol blue =
Insignificant, subdued red = Extreme). Using them makes a geography tag read as a
risk rating and violates the brand spec. Use an Electric Blue (#4655FF) outline.

**QU cost (the real operational constraint).** GDELT Cloud free tier is ~100
QU/mo at ~1 QU per REST call. Broad daily pulls of 4 countries × (events+stories)
≈ 240 calls/mo — MAY exceed free. Mitigations (mirror gdeltEnrich): a cadence
gate (`GDELT_STRUCTURED_INTERVAL_HOURS`, default 24h), a hard per-run call cap
(`GDELT_STRUCTURED_MAX_CALLS`, default 16), a per-feed page cap
(`GDELT_STRUCTURED_MAX_PAGES`, default 2), and graceful no-op when the key is
missing or `GDELT_STRUCTURED_ENABLED=false`. To cut spend, raise the interval
(72h ≈ 80/mo) — don't remove the caps. The promote pass is FREE (0 QU) — it never
calls GDELT, only reads the local table.
**How to apply:** never add a new per-country/per-category call without checking
it against MAX_CALLS; a "just fetch each category separately" refactor would
multiply QU spend. The broad per-country call (NO category) returns all
categories — bucket locally, don't fan out.

## Freeze signature: free-tier QU exhaustion (429 QUOTA_EXCEEDED)

If the layer's "LATEST SOURCE DATE" (`max(source_date)`) AND `max(fetched_at)`
both freeze on ONE date while every OTHER topic stays fresh, the free-plan
monthly Query-Unit budget is spent. `gdeltcloud.com` then returns HTTP 429
`{code:"QUOTA_EXCEEDED", used>limit, resets_at:<1st of next calendar month>}` on
every call. It is NOT a missing key / broken wiring — confirm with a keyed
`curl .../api/v2/events` (the host root still 200s). It AUTO-recovers at the
month reset; no code change unsticks it earlier (only a paid plan upgrade would).
**Why it freezes rather than errors visibly:** the pass runs LAST, isolated in
its own try, so a budget cap can never fail the wider ingest — the surface just
stops advancing.

- **`fetched_at` is a per-ROW insert default**, so `max(fetched_at)` only moves
  on a NON-ZERO insert. A run that inserts 0 (all-429, OR a genuinely quiet news
  window) does NOT advance it, so the cadence gate (keyed on `max(fetched_at)`)
  fails to throttle and the pass re-attempts on EVERY ingest — burning 429-retry
  latency and, in a quiet-but-working window, re-spending QU faster than the 24h
  cadence intends (a contributing cause of blowing the ~100 QU/mo ceiling). A run
  heartbeat (`sources.last_success_at`, like Facebook OSINT's cadence clock)
  would throttle correctly regardless of insert count.
- **Post-reset gap is permanent by default:** once the table is seeded the window
  is `RECENT_LOOKBACK_DAYS` (3d), so the first run after the reset only pulls the
  last 3 days — the exhausted period never backfills unless a one-off wider
  `GDELT_STRUCTURED_RECENT_DAYS`/seed run is done.
- **Prevention:** raise `GDELT_STRUCTURED_INTERVAL_HOURS` (72h ≈ 80/mo) — the
  broad daily 4-country×(events+stories) pull sits right at/over the free budget.

**Wiring touch-points (so a future change doesn't half-wire it).** Like every
other live source, it must thread through: ingest module export → `runIngestOnce`
+ standalone runner → boot freshness gate (gated on its OWN configured+enabled
check) → token-gated admin trigger → `integrationStatus` label
(`GDELT_STRUCTURED_HEALTH_NAME`) → `recordSourceHealth` → OpenAPI route + codegen
→ owner-gated read route → UI page + nav + Sources label. Miss one and the
surface silently drifts stale or the health row goes empty. The promote pass adds
its own touch-points: barrel export → both ingest runners → the backfillRelevance
exclusion above.
