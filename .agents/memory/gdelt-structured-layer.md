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

**Wiring touch-points (so a future change doesn't half-wire it).** Like every
other live source, it must thread through: ingest module export → `runIngestOnce`
+ standalone runner → boot freshness gate (gated on its OWN configured+enabled
check) → token-gated admin trigger → `integrationStatus` label
(`GDELT_STRUCTURED_HEALTH_NAME`) → `recordSourceHealth` → OpenAPI route + codegen
→ owner-gated read route → UI page + nav + Sources label. Miss one and the
surface silently drifts stale or the health row goes empty. The promote pass adds
its own touch-points: barrel export → both ingest runners → the backfillRelevance
exclusion above.
