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
