---
name: Fuel Watch canonical facts + consistency gate
description: One facts object drives all Fuel Watch narrative surfaces; lexical fail-closed gate blocks preview+PDF on contradiction.
---

**Rule:** All Fuel Watch quantitative claims (counts, distinct dates, country ranking/leader, market direction, overall severity, current-condition classes) come from ONE canonical facts builder computed after window filtering. Narrative surfaces (deterministic Market Read / Regional Highlights leader phrasing, the AI prose prompt's FIXED FACTS block, the consistency gate) consume it — none re-derive. Direction has a single authority function with a neutral band; the pressure leader needs a documented margin over the runner-up, otherwise "distributed" and no surface may crown a country.

**Why:** Sections previously resolved authored > AI > deterministic independently and each re-derived trend/leader/counts, so a polished report could contradict itself (rising vs falling crude, different leader per section). Owner spec demanded root-cause fix, fail-closed gate, property tests.

**How to apply:**
- The gate validates the FINAL effective text (authored > AI > deterministic via one shared resolver used by preview and PDF) — preview shows a blocking panel, PDF export throws; both read the same facts + resolved sections, mirroring the cargo gate pattern.
- Fuel's effective report date is market-anchored (latest market close ?? issue date) — preview, AI facts/cache key and PDF must all use it or the gate diverges across surfaces.
- The FIXED FACTS block is part of the prose fingerprint: direction/leader flips regenerate cached AI prose.
- Lexical gates need scope discipline or they false-block: direction wording only checked in sentences with price/market context (demand "softened" is not a price claim); leader-claim regex requires the literal "pressure point" (singular); distributed-pressure violations only fire when a KNOWN country is crowned (thematic Gulf/chokepoint leads allowed); generic topped-up bullet sections (Implications/Watch Next) are not gated.
- Deterministic builders that still rank internally (Regional Highlights) must take the facts pressure decision and switch to spread phrasing when distributed.
