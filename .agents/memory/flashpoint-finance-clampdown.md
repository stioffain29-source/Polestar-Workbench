---
name: Flashpoint finance/regulatory crackdown exclude
description: Why financial "crackdown"/"clampdown" stories leak into the civil-unrest (flashpoint) topic and how the polysemy gate drops them.
---

# Financial "crackdown"/"clampdown" is a markets story, not civil unrest

A regulatory/markets "crackdown" or "clampdown" (banks, insurers, investment,
capital flows, money flows, securities, the bourse) reads as civil unrest because
"crackdown" is the same polysemous keep-token used for a police crackdown on
protesters. Example that wrongly rated China Extreme: "Beijing's investment
clampdown clouds outlook for Hong Kong banks and insurers" — body "China's
crackdown could … weigh on money flows".

**Why the older gate missed it:** `FP_NEG_CRACKDOWN` only fires when a finance word
sits within ~30 chars of the literal token ("investment crackdown"). When the
finance vocabulary is spread across the sentence (crackdown here, "money flows" /
"capital" / "banks" elsewhere), the adjacency window never matches, so the record
falls through to KEEP.

**Fix shape (precision-first):** a separate `FP_NEG_FINANCIAL` context regex
(banks/insurers/investment/capital flows/money flows/securities/bourse/central
bank…) applied in `flashpointProtestCrackdownVerdict`'s crackdown branch, dropping
the row ONLY when `!FP_UNREST_COMPANION` (no protest/rally/tear gas/curfew/student/
activist/dissent word). That gate is the precision lever: a genuine "police
crackdown on protesters outside the stock exchange" still has an unrest companion
and survives. "clampdown"/"clamp down" added as a branch trigger too, but it can
never become a bare KEEP because reaching the branch with no unrest companion +
finance context drops it (and a non-finance bare clampdown is rare and still
needs a companion to mean anything).

**How to apply:** add new finance vocab to `FP_NEG_FINANCIAL`, never loosen the
`!FP_UNREST_COMPANION` guard, and bump `RELEVANCE_RULE_VERSION` so the boot
backfill re-cleans stored rows. Verify by re-querying the offending incident's
`relevance_status` after an api-server restart, and confirm the country's monitor
severity drops.

## Regulatory crackdown now also covers internet/website/domain/scam-site

The `FP_NEG_CRACKDOWN` negative-sense list (the OTHER crackdown gate, distinct
from `FP_NEG_FINANCIAL`) gained internet/website/domain/online/app/platform/
e-commerce/streaming/fake-site/scam-site/phishing vocab so a "fake site
crackdown" / "crackdown on scam domains" routes to the non-civil-unrest verdict.
A crackdown ON PROTESTERS still keeps (unrest companion present).

## Product/tech "demonstration", fandom, and investor-glitch homonyms (title hard-exclude)

Three homonym classes that TITLE-RESCUE into KEEP are dropped by
`FLASHPOINT_TITLE_HARD_EXCLUDE` (runs BEFORE title-rescue), each gated so a real
street protest survives:
- product/tech DEMO — "demonstration" + kick-off / launch-of-<tech> / "public
  and private demonstration". A bare "public demonstration outside parliament"
  has none of those cues so it keeps.
- entertainment/fandom — "fans protest <concert/tour/ticket/album>". A protest
  merely near a concert venue keeps.
- markets — investor/trader "protest" + brokerage glitch / forced sell-off /
  margin call. Workers protesting outside a stock exchange over wages keep.

**Regex trap:** a trailing `\b` after an alternation group like
`(concert|gig)\b` fails on the plural "concerts" — the group matches "concert"
then `\b` sees "s" (both word chars, no boundary). Use `\w*` (or `s?`) instead
of a trailing `\b` when the object word can be plural.

**Harness:** `artifacts/workbench/scripts/replayFlashpointRelevance.ts` replays
the shipped gate over an 800-row prod snapshot (query in its header), printing
per-topic KEEP/DROP + a drop-reason histogram + survivors carrying a homonym
marker — the triage loop for spotting the NEXT leak class.
