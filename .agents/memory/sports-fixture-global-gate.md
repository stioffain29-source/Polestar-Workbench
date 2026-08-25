---
name: Global sports-fixture gate
description: Owner ruling "no sport in any report" — one global gate, override design, and the summary-token trap that let sports in.
---

**Rule:** Owner banned ALL sports coverage from every report. One global gate in the relevance lib: `SPORTS_FIXTURE_RE` (match-report idioms; result-verb OR numeric scoreline OR rout verb bound within one clause to a competition word; fan/supporter walkout or boycott grievances) minus `SPORTS_UNREST_OVERRIDE_RE`, exported as `isSportsFixtureNoise`. Wired into three surfaces: `explainRelevance` (after general excludes, BEFORE title-rescue), `hitsSlopExclude` (top), and `isCountryRelevant` — plus a second rescue lane in the country sports-noise drop (`COUNTRY_SPORTS_NOISE_RE && !HARD_SECURITY && !SPORTS_UNREST_OVERRIDE`).

**Why:** A football headline ("Harimau Malaya fall to Vietnam in Asean Cup semis") reached the incident map. Root cause: keep-tier cue tokens must be SUMMARY-safe, not just title-safe — bare `stoppage` in the unambiguous public-order REQUIRED regex fired on "stoppage time" in the *summary*. Fixed via `stoppage(?!s?[ -]time)` at all 5 cue sites.

**Override design (architect-reviewed):** every override cue must be immune to ordinary sports vocabulary or the gate defeats itself — `injur\w*` matches "injury time" (only casualty-FRAMED injury phrasing counts: "dozens injured", "injuries reported"), bare `shot`/`shooting` matches "shot on target" (gunfire needs qualifiers), bare `crush` matches "crushed rivals 5-0" (crowd-crush phrasing only), `dead` matches cricket's "dead rubber" (negative lookahead). Police-response is a proximity pattern (`police …{0,40} fired|deploy|dispers|baton…`), not just "police fired".

**How to apply:** deliberately does NOT fire on bare competition mention — pre-match security colour ("fireworks near team hotel") stays. Any tuning: replay against ALL relevant prod rows (script pattern: tsx, async main, absolute-path import) and inspect every flip; expect only genuine sports. Bump RELEVANCE_RULE_VERSION; prod rows can be flipped immediately via direct SQL on PROD_DATABASE_URL with the new version stamped. Tests: `__tests__/relevance/sportsFixtureGate.test.ts`.
