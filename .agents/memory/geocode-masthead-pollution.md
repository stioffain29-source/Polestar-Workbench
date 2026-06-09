---
name: Geocode masthead pollution + theatre clamp
description: Why a real Hormuz strike showed as "Taipei", and the two-layer geocode defense (centroid-distance guard + region bounding-box clamp).
---

# Geocode picks place names out of the source masthead

A genuine Strait of Hormuz strike geocoded to **Taipei** because its source
publication was the **"Taipei Times"** — `geocode()` scans `title + summary`
(which carries the source name) and matched the city inside the masthead.

**Why it slipped past the distance guard:** `geocode()` (in
`lib/ingest/src/geocode.ts`) has a centroid-distance guard (`haversineKm` +
`MAX_CITY_KM`) that rejects a city match too far from the record's country
centroid. But that guard is a NO-OP when the country has no centroid — e.g. a
maritime record whose country is literally `"Strait of Hormuz"`. So topics
whose records can lack a country centroid need their OWN region clamp.

## The rule
- **Two-layer defense.** Layer 1 = country-centroid distance guard (general,
  fires only when a centroid exists). Layer 2 = a region bounding-box clamp for
  topics with no reliable country centroid.
- The **Missile Strike Tracker** is entirely Middle East / Gulf. Both theatres
  (`maritime_hormuz`, `land_gcc`) clamp to a Gulf box (`lat 8..42, lng 30..66`,
  `inGulfTheatre` in `lib/ingest/src/strikes.ts`). Out-of-box geocode → drop:
  maritime falls back to the Hormuz centroid; land falls back to country
  centroid with `location=null` (never invent a city).
- **Limitation:** the box is region-level, not country-level — it won't catch a
  wrong-but-in-region city (one Gulf city mislabelled as another).

**How to apply:** any NEW ingest topic with a fixed geography should add a
region clamp if its records can lack a country centroid; relying on the
distance guard alone leaves a masthead-pollution hole.

## Fixing existing bad rows in prod
Prod DB is read-only from the workspace, so the cleanup is a **marker-gated boot
migration** (`strikes_out_of_theatre_relocate_v1` in
`artifacts/api-server/src/lib/migrations.ts`) that runs in the deployment
runtime on next publish. It **RELOCATES, never deletes** — these are real
incidents with bad geo attribution, so deletion would lose a genuine strike and
break counts/timeline. Maritime out-of-box → Hormuz centroid; land → null
coords/location. Marker-gated so analyst edits afterwards are preserved.

## Out-of-region cross-syndication (commodity feeds)
- Country-edition Google-News feeds cross-syndicate FOREIGN stories that name no in-region country; `classify()` then blind-stamped the feed's `defaultCountry` (a Libyan libyaupdate.com fuel story → Pakistan). Fix: when NO in-region country is detected AND a foreign signal appears, REJECT — `detectOutOfRegion(text, source)` checks foreign tokens by word-boundary in text and by SUBSTRING in source/host (mirrors `hasWord(text) || source.includes(token)`). Pass source+host into classify.
- Marker-gated boot purge for already-stored rows lives in `migrations.ts`. TWO traps burned here:
  1. Drizzle `sql\`\`` is a JS template FIRST — a single `\y`/`\.` reaches Postgres as bare `y`/`.` and silently mangles the regex (a `.ly` clause matched "ly" in Daily/Weekly → mass over-delete). ALWAYS double-escape: `\\y`, `\\.`.
  2. A domain-ccTLD-only delete clause (`.uk|.ly|...`) deletes legit in-region stories from foreign-hosted publishers — DROP it; the foreign-token SUBSTRING on source already catches libyaupdate.com via "libya".
- The purge's INREGION guard must be WIDE (subnational + demonyms: punjab, sindh, queensland, christchurch, …) or valid stories naming only a province get purged. It is the protective net; over-match on purpose.
- **Why:** purge predicate ≠ runtime `detectCountry` alias map, so any parity gap = collateral deletion of real data (user is hostile to data loss).
