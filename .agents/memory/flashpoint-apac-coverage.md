---
name: Flashpoint APAC coverage chain + homonym gates
description: Adding an APAC country to the Protests/flashpoint monitor, the two precision-homonym gates that leak, and the backfill timing gotcha.
---

# Adding an APAC country to the flashpoint (Protests & Civil Unrest) monitor

Coverage for a country is only complete when the WHOLE chain is threaded — a
missing link silently drops the country (rows reject, mis-attribute, or fail to
geocode):

1. Seed a Google-News civil-unrest feed (idempotent-on-name) in
   `migrations.ts` FLASHPOINT_REGIONAL_SOURCES; `repairFlashpointSeedUrls`
   updates url/sourceType for an existing row by name.
2. `COUNTRY_ALIASES` in `lib/ingest/src/flashpoint.ts` (attribution).
3. `FP_APAC_ANCHOR_RE` in `lib/relevance/src/topicRelevance.ts` (so the country
   + its cities count as an in-region anchor).
4. City→centroid rows in `lib/ingest/src/geocode.ts` (markers silently drop
   without a centroid; centroid keys must match the classifier country alias).
5. Bump `RELEVANCE_RULE_VERSION` so the boot backfill re-rates.

Feeds only reach PROD after a republish. Workspace `DATABASE_URL` is the
writable DEV db; prod is read-only from here. Some countries have no native
Google-News edition (e.g. South Korea has no en-KR) → use en-US/US edition.
Sparse recent windows (West Papua, PNG) are STRUCTURAL, not a bug.

**Why:** repeated skeptical-user rounds prove "missing" countries by name; the
gap is almost always one un-threaded link in this chain.

# Two precision-homonym classes that leak into "relevant"

- **Interstate diplomatic "protest"** — `FP_NEG_INTERSTATE` keys off a nation
  list (`FP_NEG_INTERSTATE_NAT`) that must include CAPITALS as state proxies
  (tokyo, beijing, seoul…). "North Korea Protests Seoul-EU Rebuke" leaked
  because the object "Seoul" was not in the list, so the actor-nation+protests+
  target-nation pattern never matched and the bare word "protest" kept it by
  default. Add the capital when a new country joins.
- **Sports "march"/"play"** — the march guard covered "march TO the final" but
  not "march INTO [sport] semis"; add a variant allowing an optional sport word
  between ("march into hockey semis"), plus a bare "play football/cricket/…"
  exclude. These go in `FLASHPOINT_TITLE_HARD_EXCLUDE` (runs BEFORE the
  title-rescue) so the ambiguous cue can't rescue them.

**How to apply:** when adding APAC countries, also add their capital to the
interstate nation list and replay the live feed for these two homonym shapes.

# Backfill timing gotcha (don't conclude "it didn't fire")

`backfillRelevance` (boot, in `migrations.ts`) re-rates EVERY row whose stored
`relevance_version` ≠ current via SEQUENTIAL one-row-at-a-time awaited UPDATEs —
NO per-boot cap. On a multi-thousand-row table it runs for ~a minute after
`listen`, so a mid-flight query shows a SPLIT version distribution (some new,
some old) and the target rows still un-flipped. WAIT for it to converge (poll
`GROUP BY relevance_version`) before deciding the rules didn't apply. The column
is `relevance_version` (not `relevance_rule_version`).
