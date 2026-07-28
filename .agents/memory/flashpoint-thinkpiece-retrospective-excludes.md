---
name: Flashpoint think-piece/retrospective excludes
description: How essay/retrospective headlines are dropped from flashpoint without touching live High-Commission/anniversary/commission-demand protests
---

Think-pieces and aftermath items about PAST unrest ("protests are a call for democratic renewal", "Post-Protest Bangladesh", "commission submits protest probe report") carry protest keywords but no live public-order signal. They are dropped in FLASHPOINT_TITLE_HARD_EXCLUDE (pre-title-rescue) via distinctive ESSAY framing, never bare nouns or ungated verb phrases (a standalone "submits report to" was rejected in review as over-broad — it would swallow live "protesters submit report to speaker"):

- Copula thesis: `protests (are|is|:) a (call for|warning|lesson|turning point…)`.
- "questions/lessons emerging/learned from", "may/could learn from/about".
- `protest-fueled (transition|shift|era…)` compound; `post-(protest|uprising) <place>` label.
- Obituary/profile: leading "Who was …?", "rise and (killing|fall) of".
- Leading `can|could|should|will …?` interrogative (extends what/why/how/did openers).
- Commission/inquiry AFTERMATH: inquiry NOUN + procedural VERB (submits/hears/finds/seeks extra/directs further investigation). The verb gate is what keeps live lookalikes: "Demands Release of Karki Commission Report", any protest AT a High Commission, "Police Commissioner apologises" (no \b match on commissioner).

**Why:** bare "commission"/"anniversary"/"a call for" all appear in genuine live-protest headlines; only the verb/copula binding is safe. Verified against 400d of live rows via artifacts/workbench/scripts/replayFlashpointRelevance.ts — only think-piece/aftermath flips.

**How to apply:** any new retrospective cue must be bound to essay framing, replayed over live rows, and RELEVANCE_RULE_VERSION bumped (boot backfill re-cleans persisted rows).
