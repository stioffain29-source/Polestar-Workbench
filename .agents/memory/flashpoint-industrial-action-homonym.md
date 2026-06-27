---
name: Flashpoint industrial-action crime-strike homonym
description: Why property-crime "thieves strike" / metal-theft headlines leak onto the civil-unrest monitor as "industrial action", and how to exclude them safely.
---

# Flashpoint industrial-action "strike" homonym (property crime)

FLASHPOINT_INDUSTRIAL_ACTION_RE admits a record when a stoppage word
(strike/walkout/stoppage) sits near an industrial ANCHOR (copper, metal, rail,
mine, etc.). So a property-crime headline using the VERB "to strike" — "Copper
thieves strike Auckland train line", "burglars strike again", "cable thieves
strike substation" — is wrongly kept as labour action on the Protests & Civil
Unrest monitor. This is the only keep-path these crime stories hit (no
protest/rally/title-rescue cue).

**Fix:** exclude in FLASHPOINT_EXCLUDE (runs at gate step 1, AFTER title-rescue
and the protest/crackdown-in-title verdict, BEFORE the industrial-action admit
path) with two patterns bound to a crime ACTOR: a metal-anchor + thief/thieves
phrase, and a crime-actor (thief/thieves/burglar/robber/raider/crook/shoplifter)
+ strike/struck.

**Why:** bind to the ACTOR noun, NOT the bare noun "theft". An earlier draft
keyed the first pattern on "copper/fuel theft" (bare noun) and would have dropped
a genuine labour story like "workers strike over fuel theft at smelter". A pure
"metal theft disrupts rail" headline needs no exclude — with no stoppage word it
is never admitted anyway.

**How to apply:** any time you widen FLASHPOINT_INDUSTRIAL_ACTION_RE's industrial
anchors, re-check this crime homonym still fires; keep the two excludes in
lockstep. FLASHPOINT_EXCLUDE only affects the flashpoint/protests topics. Bump
RELEVANCE_RULE_VERSION so the api-server boot backfill re-cleans persisted rows;
prod applies only after a republish. Verify with control strings (genuine LNG/
copper-mine worker strike, anti-govt rally, miners walkout must NOT be excluded)
before committing.
