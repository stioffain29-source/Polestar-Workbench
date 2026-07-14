---
name: Flashpoint "demonstration" display-homonym
description: Why product/vehicle/skill "demonstration" (showcase sense) leaks into the Protests feed, and the shape of the robust fix.
---

# Flashpoint "demonstration" display/showcase homonym

The Protests feed kept admitting showcase-sense "demonstration" headlines
("SkyDrive conducts high-speed demonstration flights of flying car"; pedalo /
skateboard / knotting / cooking demonstrations).

**Root cause:** `FLASHPOINT_TITLE_RESCUE_UNAMBIG_RE` matches the BARE word
"demonstration", so any headline containing it is title-rescued in
`explainRelevance` (and in `hitsSlopExclude`, the GDELT-lane path) BEFORE any
body homonym exclude runs. The old narrow product-DEMO entry in
`FLASHPOINT_EXCLUDE` only caught launch/kick-off/"of AI/tech" and, being an
`FLASHPOINT_EXCLUDE` member, ran only AFTER the rescue anyway.

**Fix shape (do not narrow back):**
- `FP_DISPLAY_DEMONSTRATION_RE` — three branches: `demonstration <display-noun>`
  (flight/lap/run/match/session/project…), `demonstration of <physical/tech/skill
  object>` (car/drone/recipe… — abstract objects like support/anger/solidarity/
  people-power are DELIBERATELY absent so real "demonstration of people power"
  survives), and `<activity/craft/sport> demonstration` (cooking/martial-arts/
  pedalo…).
- `FP_PROTEST_COMPANION_RE` — a protest-specific spare list that DELIBERATELY
  omits the bare word "demonstration" (the display sense shares it) but DOES
  include `demonstrators?` (display sense never says "demonstrators", real
  protests do — this spares "demonstration runs into second week as demonstrators
  defy ban").
- The gated check (`display RE matches AND no protest companion`) must run in the
  PRE-RESCUE block (after the cancelled-action check) so it front-runs the
  title-rescue. It is mirrored into `hitsSlopExclude` BEFORE that function's own
  title-rescue too (GDELT-lane path); keep the two in lockstep.

**Why enumerated, not "any &lt;noun&gt; demonstration":** cannot blanket-exclude
`<noun> demonstration` because student/farmer/mass/street/public demonstration
are real protests. Precision-first: prefer over-sparing (a rare leak) to dropping
a genuine protest.

**Mechanism:** a rule change re-scores EXISTING persisted rows only after a
`RELEVANCE_RULE_VERSION` bump (boot `backfillRelevance` re-evaluates rows whose
stored version differs; it skips only `gdelt_cloud:`/`tapa_offline:` markers, so
Google-News scraped rows like SkyDrive re-score). `topicConfigs.ts` needs NO
mirror — it covers energy/fertiliser/fuel allow gates only; the shared relevance
engine is the sole flashpoint authority.
