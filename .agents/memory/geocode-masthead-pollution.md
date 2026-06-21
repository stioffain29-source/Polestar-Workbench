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

## Out-of-region cross-syndication (flashpoint / protests)
- Distinct from the commodity case above: here the foreign story DOES name an in-region country, so the "no-in-region-country ⇒ reject" rule does NOT fire. Two paths mis-stamp it: (a) the masthead leaks the country into BOTH title AND summary (a Belfast riot from "Japan Today" ⇒ Japan), so a title-only masthead strip can't catch it; (b) a diaspora protest names an APAC country as its SUBJECT while physically held abroad ("Tamil groups protest in London"). Fix is a **foreign-LOCATION** reject (`FOREIGN_LOCATION` in `lib/ingest/src/flashpoint.ts`), run after DENY and BEFORE country resolution so the leaked country never matters.
- **Two-tier precision (the trap):** bare tokens ONLY for unambiguous city names (belfast/glasgow/dublin/…). City names that are also English football clubs (london/manchester/liverpool/…) AND country/region names that are often a mere actor reference (united kingdom/great britain/northern ireland) must be VENUE-gated — require a location preposition (`(in|at|outside|near|across|to)\s+(the|central|…)?\s*<name>`). A bare `liverpool` purges a sports wire about an APAC footballer ("season with Liverpool"); a bare `united kingdom` purges an in-region story that only cites the UK as an actor.
- **DELETE not relocate here** (unlike the strike geo-fix): an out-of-region UK event belongs to NO APAC country report, so there is nothing to relocate it to. Marker-gated boot purge in `migrations.ts`; its SQL regex must mirror the JS regex EXACTLY (same optional locality modifiers, same bare-vs-venue split) or runtime ingest and the purge disagree and historical rows survive.

## Flashpoint masthead-leak with NO in-content location (the "why the Philippines?" crown)
- A THIRD class, distinct from the two above: the headline names NO place at all and contains NO foreign token, so neither `FOREIGN_LOCATION` nor the "no-in-region-country" rule can fire. The publisher CITY in the Google-News masthead (appended to BOTH title and summary) becomes the SOLE country signal — an overseas "G7 protest turns from carnival to violent stand-off - The Manila Times" was stamped Philippines and, as the only High in the 7-day window, was crowned highest-severity country.
- Fix = strip the masthead BEFORE country resolution (mirrors cargoWatch, which already did this; flashpoint did not). `geoHaystack(title,summary)` cuts the trailing " - "/" | " masthead off the title AND `summary.split(source).join(" ")` removes that exact source string from the summary; `resolveFlashpointCountry()` runs resolvePapuaPng + COUNTRY_ALIASES on the cleaned hay. Masthead-only ⇒ null ⇒ classify drops it as `no-apac-country`. DENY/FOREIGN/relevance still see the FULL `hay`, geo-only sees the stripped one.
- Existing rows: marker-gated boot migration `flashpoint_masthead_country_relocate_v1` re-runs `resolveFlashpointCountry` over every stored flashpoint row and RELOCATES (country='Unknown', coords null) any that now resolve null. RELOCATE not delete + durable lever is the COUNTRY column (relevance backfill never touches it).
- Frontend belt-and-braces: `Protests.tsx` countrySeverity must skip `Unknown`/`—` so an unlocated row can never crown "Highest Severity Country".
- **Magnitude + trade-off (verify before shipping):** this relocated ~480 of ~2544 attributed rows (~19%) — re-tally the high/extreme sample before accepting. MOST are genuine foreign mis-stamps correctly removed (narco-boat/Oman/Ukraine/Lebanon/Bolivia/G7 via Manila/BSS mastheads). But it is BLUNT: a national-agency masthead that contains the COUNTRY name ("Bangladesh Sangbad Sangstha", "One Papua New Guinea") was a CORRECT signal for genuinely-local stories whose in-content place the gazetteer misses (Camp Crame→Manila, PNG "Central", "South Korean" demonym) — those become Unknown (false-relocated) and, going forward, are DROPPED at ingest. Accepted as the honest/conservative trade-off (don't attribute a country we can't prove from content; rows still visible in lists) and it aligns with the user's anti-fabrication stance. The principled un-blunting is GAZETTEER EXPANSION (add the missed local tokens/demonyms), not masthead luck — left as a separate scope.

## Hiding foreign flashpoint junk: NEGATIVE foreign-theatre exclude, NOT positive APAC anchor
- The natural next step ("only KEEP rows that POSITIVELY name an APAC place") is WRONG — it hid ~30 genuine APAC protests whose only geo cue is a LOCAL entity the gazetteer misses (Manibela, Mendiola, Camp Crame, Oli/Lekhak). A positive-anchor *requirement* punishes sparse-attribution rows.
- Robust gate (in `topicRelevance.ts`, flashpoint/protests branch): hide ONLY when the masthead-stripped body POSITIVELY matches a foreign theatre (`FP_OFFSHORE_THEATRE_RE` — full country+capital+leader+DEMONYM list incl. plurals: nigerian/peruvians/israelis…) AND lacks an APAC anchor (`FP_APAC_ANCHOR_RE`, kept PROTECTIVE-only: APAC demonyms/plurals, NOT "chinese"). Keyed off a POSITIVE foreign place, never a missing anchor.
- **Masthead strip is REQUIRED and SYMMETRIC**: both the foreign-detect AND the anchor run on the SAME stripped text (`mastheadStrippedGeoText`, mirrors `geoHaystack`: cut title source after max(lastIndexOf(" - ")," | "), remove source from summary, lowercase). Otherwise an APAC publisher's masthead ("The Japan Times") fakes an anchor on foreign junk → only the Manila-Times copy hides and the Japan-Times copy of the SAME story survives.
- **Ordering trap:** the gate must run BEFORE the title-rescue KEEPs (or genuine-protest-phrased foreign junk gets rescued first), but a finance/sports "rally"/"strike" homonym that merely names a foreign place ("Ethereum's Iran rally fizzles") must drop with the precise "homonym" reason, not "out-of-region". Guard the gate with `!firstMatch(text, FLASHPOINT_EXCLUDE)` so homonyms fall through to the homonym exclude. Row drops either way; the guard only preserves the accurate reason (a relevance test asserts this).
- **Accepted casualties:** Malaysia-solidarity rows naming ONLY a foreign cause (a Gaza expo, an Israeli figure in MY) still hide — unavoidable once the masthead is stripped, since nothing in-content proves the APAC venue.
- **Why** (the principle): attribute/keep only what the CONTENT proves; prefer a NEGATIVE precision exclude over a positive requirement so the default for an ambiguous row is KEEP, not hide. Bump `RELEVANCE_RULE_VERSION` so the boot relevance backfill re-cleans stored rows.

## Conflict topic needed its OWN out-of-region gate (it was flashpoint-only)
- The negative foreign-theatre gate above lived ONLY in the flashpoint/protests branch. The CONFLICT branch had just `CONFLICT_EXCLUDE` (relief/peace), no geo gate — so a Niger airport raid from an India-edition insurgency feed passed the conflict REQUIRED gate, got the feed-default country (India) + India centroid, and read as a genuine Indian incident ("this does not belong"). Fix: add the SAME `FP_OFFSHORE_THEATRE_RE && !FP_APAC_ANCHOR_RE` gate to the conflict branch, on `mastheadStrippedGeoText`. NOT gated on the violence override (a fatal foreign raid is exactly what must drop).
- **The masthead is not always after a dash.** The title-suffix strip (`max(lastIndexOf(" - ")," | ")`) assumes Google-News form "<headline> - <Source>". SOME feeds append the source to the SUMMARY ONLY, with NO dash and NO dash in the title either (summary = "<headline> <Source>"). Then the dash strip is a no-op and the unstripped source ("India Today") leaks "india" as a false APAC anchor → gate never fires. Fix: ALSO strip the persisted `i.source` (available on `RelevanceInput`) from both fields.
- **Strip the source as a WHOLE PHRASE, never a bare substring.** `summary.split(source)` is fine for a long masthead but catastrophic for a short source — `split("ani")` guts "animal", `split("ap")` guts "capture". Use `\b<reEscape(source)>\b` (regex-escape first; sources contain `&`/`.` e.g. "pg&e"). Keeps genuine in-region anchors that appear in the BODY (only the masthead instance is removed).
- Verified: 15 conflict rows correctly dropped (Niger/Iran/US/Syria/Israel/Nigeria/Lebanon/Egypt/Russia/Ukraine/Nicaragua under APAC feed-default countries), ZERO genuine in-region rows lost (Myanmar airstrikes, India Manipur/Naxal, Pakistan KPK all stay relevant). Pakistan stories keep (Pakistan IS an APAC anchor) even when feed-mislabelled India — that's a separate country-attribution nuance, not this gate.

## newsTopic generic path leaked the masthead COUNTRY (not just a city)
- Distinct from the geocode CITY leak above: the generic news-topic path
  (`classify()` in `lib/ingest/src/newsTopic.ts`, used by conflict/energy/
  fertiliser/fuel) ran `detectCountry` over the RAW title+summary. A cross-
  border story from an Indian outlet ("Afghanistan strikes militant hideouts
  inside Pakistan — The Times of India") leaked "india" from the masthead, and
  because `detectCountry` returns the FIRST alias-ordered match (India before
  Pakistan), the publisher's country beat the event's. This RESOLVES the
  "separate country-attribution nuance" flagged at the end of
  conflict-relevance-excludes.md (Pakistan rows mislabelled India under an
  India-edition feed).
- Fix = `stripSourceMasthead(hay, sourceName)` (split out the lowercased source
  as a contiguous phrase) BEFORE `detectCountry`, on the already-lowercased
  haystack. Flashpoint already did this; the generic path did not.
- Existing rows: marker-gated `conflict_india_to_pakistan_relocate_v1` RELOCATES
  (not deletes) India-tagged conflict rows whose title is a "<verb> Pakistan"
  event with NO India-location/actor token → Pakistan. The India-token guard is
  what keeps genuine India events that merely CITE Pakistan (Kashmir/Pahalgam/
  Parliament-attack) correctly under India.
