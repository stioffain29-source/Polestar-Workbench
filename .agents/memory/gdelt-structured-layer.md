---
name: GDELT Cloud structured event layer
description: standalone structured CONTEXT source (own table, isolated ingest, owner-gated read-only UI) — never an incident; lane/sub-bucket rules and QU-cost mitigations.
---

# GDELT Cloud structured event layer

A pilot STRUCTURED CONTEXT source, kept deliberately isolated from the incident
pipeline.

- **Never an incident.** Rows live in their OWN `gdelt_structured_items` table.
  No incident-counting surface, report, or PDF may read them — the whole point is
  to surface GDELT's daily Events + Stories without inflating the incident count.
  Any future feature that joins this table into a report/PDF breaks the product
  invariant.
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

**Why the UI badge must avoid #1B6B7A / #A33232:** sub-bucket badges are
geography tags, but those two hexes are RESERVED tier colours (petrol blue =
Insignificant, subdued red = Extreme). Using them makes a geography tag read as a
risk rating and violates the brand spec. Use an Electric Blue (#4655FF) outline.
**How to apply:** any new tag/badge on this surface picks from neutral/Electric
Blue, never the reserved tier ramp.

**QU cost (the real operational constraint).** GDELT Cloud free tier is ~100
QU/mo at ~1 QU per REST call. Broad daily pulls of 4 countries × (events+stories)
≈ 240 calls/mo — MAY exceed free. Mitigations (mirror gdeltEnrich): a cadence
gate (`GDELT_STRUCTURED_INTERVAL_HOURS`, default 24h), a hard per-run call cap
(`GDELT_STRUCTURED_MAX_CALLS`, default 16), a per-feed page cap
(`GDELT_STRUCTURED_MAX_PAGES`, default 2), and graceful no-op when the key is
missing or `GDELT_STRUCTURED_ENABLED=false`. To cut spend, raise the interval
(72h ≈ 80/mo) — don't remove the caps.
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
surface silently drifts stale or the health row goes empty.
