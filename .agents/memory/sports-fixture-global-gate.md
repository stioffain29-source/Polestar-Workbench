---
name: Global sports-fixture gate
description: Owner ruling "no sport in any report" — one global gate, override design, and the summary-token trap that let sports in.
---

**Rule:** Owner banned ALL sports coverage from the product. Sports records are removed from relevance-backed APIs and every map, monitor, and report—not retained as Insignificant or merely hidden in one view. One global gate rejects named sports, match-report idioms, standings/scorelines, result verbs and fan grievances, minus a narrowly framed real-world casualty/disorder override. Scripted TV and professional-wrestling coverage is a separate pre-override exclusion because fictional "firefight" and wrestling "rebel/dynamite" wording must never invoke the security rescue.

**Why:** A football headline ("Harimau Malaya fall to Vietnam in Asean Cup semis") reached the incident map. Root cause: keep-tier cue tokens must be SUMMARY-safe, not just title-safe — bare `stoppage` in the unambiguous public-order REQUIRED regex fired on "stoppage time" in the *summary*. Fixed via `stoppage(?!s?[ -]time)` at all 5 cue sites.

**Override design (architect-reviewed):** every override cue must be immune to ordinary sports vocabulary or the gate defeats itself — `injur\w*` matches "injury time" (only casualty-FRAMED injury phrasing counts: "dozens injured", "injuries reported"), bare `shot`/`shooting` matches "shot on target" (gunfire needs qualifiers), bare `crush` matches "crushed rivals 5-0" (crowd-crush phrasing only), `dead` matches cricket's "dead rubber" (negative lookahead). Police-response is a proximity pattern (`police …{0,40} fired|deploy|dispers|baton…`), not just "police fired".

**How to apply:** Any tuning must replay against ALL relevant production rows and inspect every flip. Bump RELEVANCE_RULE_VERSION so persisted rows re-evaluate. Keep entertainment rejection ahead of security overrides. Team-vs-team league/cup syntax is unambiguous fixture coverage even when the sport is omitted. Raw-data consumers such as the geospatial map must call the same gate, and severity classification must short-circuit sports noise so fixture words such as “clash” can never produce High.
