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

## Reversed-order state-violence companion (actor-leads vs casualty-leads)
- The conflict REQUIRED "actor→casualty" line only fires when the state force
  PRECEDES the kill word within a short span ("junta attacks kill three
  civilians"). A real event where the CIVILIAN casualty leads and the state
  force + operation TRAIL it ("Five civilians killed in Indonesian military
  operation") is the SAME unambiguous event but slips the gate and drops.
- Fix = a SECOND tightly-bound REQUIRED pattern: civilian-victim noun + kill
  word + state military force + operation/raid/sweep context. Bind all four
  parts hard or it degrades into a generic "military operation killed" admitter.
- Guard with a NEGATIVE test (civilian road-accident toll, no force/operation →
  drop) and replay the full conflict set: the new pattern must add ZERO
  newly-kept rows beyond the events it is meant to rescue.
- **Why:** word-order is not semantics; a one-directional adjacency regex
  silently loses half the real state-violence-against-civilians stories.

## Exam-name excludes must be verb/context-bound, never the bare exam name
- A bare exam-name exclude (e.g. "neet") meant to kill exam-logistics human-
  interest ("what's it like getting to a NEET centre") ALSO eats genuine exam-
  malpractice PROTESTS ("NEET paper leak: Youth Congress protests, chief
  detained") — a real flashpoint/protests event.
- Fix = bind the exclude to the travel/logistics FRAME: a movement verb
  (getting|reach|travel|commute|en route|drive|walk|head…) within ~30 chars of
  "neet centre/center". The protest copy has no travel-to-centre framing.
- **Why/how:** EXCLUDE_PHRASES is a flat GLOBAL list (any match → off-topic, no
  companion gating, no violence override), so an over-broad entry there silently
  kills real events across EVERY topic. Verify the protected keep with a test +
  full replay before bumping RELEVANCE_RULE_VERSION.
