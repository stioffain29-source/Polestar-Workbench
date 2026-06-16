---
name: Conflict relevance excludes (economic / diplomacy noise)
description: Why off-topic business/diplomacy stories leak into Conflict Watch and how to exclude them without dropping real armed events.
---

# Conflict relevance excludes

The conflict REQUIRED gate keys off bare actor tokens (naxal/naxalite, maoist,
militant, insurgent, rebel, separatist). So stories that merely NAME an insurgency
as background — a "post-Naxal investment push", a "diplomacy to prevent a militant
spillover" — pass REQUIRED and pollute the armed-violence report.

**Rule:** fix this with TIGHTLY-bound `CONFLICT_EXCLUDE` patterns in
`lib/relevance/src/topicRelevance.ts`, never by loosening REQUIRED. Bump
`RELEVANCE_RULE_VERSION` so the boot backfill re-cleans stored rows. The excludes
run BEFORE REQUIRED and are SKIPPED when `CONFLICT_VIOLENCE_OVERRIDE` matches, so a
genuine kinetic event always survives.

**Why precision-first matters here:** broad money/diplomacy words collide with real
events. A Maoist BOUNTY ("reward of Rs 8 lakh") shares "lakh/crore" with investment
stories; "mediated/talks + militant" appears in real reports of militant violence
*around* talks and in insurgent ceasefire declarations. Bind the actor word to an
EXPLICIT investment frame ("investment push", "proposals worth", "investor summit"),
and gate the diplomacy exclude on the word "spillover" specifically — not on bare
"talks/militant".

**How to apply:** before shipping any conflict-exclude regex, replay it against the
FULL conflict row set (haystack is lowercased; `[^.]` spans stop at periods — "U.S."
breaks a span). Confirm it matches ONLY the intended noise and zero currently-relevant
rows. Lock both the drops and the protected keeps into
`__tests__/relevance/explainRelevance.test.ts`.
