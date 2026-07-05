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

## Off-region theatre gate needs foreign ACTORS, not just country names
- The shared off-region gate (`FP_OFFSHORE_THEATRE_RE` matches AND no
  `FP_APAC_ANCHOR_RE` rescue) drops foreign-syndicated stories the geocoder
  misfiles under a default APAC country. It originally listed COUNTRY names +
  demonyms only.
- Levant land-conflict headlines name the FORCE or the VILLAGE, not the country
  ("IDF seals Hezbollah tunnel system in Tebnit"). With no country token and no
  APAC anchor the gate never fired, and a kinetic REQUIRED keyword ("hostage")
  then KEPT the row in Conflict Watch (stored country had defaulted to Bangladesh).
- Fix = add the unambiguous foreign actors (idf, hezbollah + spellings
  hizbollah/hizbullah/hezballah, hamas) to `FP_OFFSHORE_THEATRE_RE`; bump
  `RELEVANCE_RULE_VERSION` so the boot backfill re-marks stored rows irrelevant.
- **Why safe across the shared users (flashpoint/protests/indonesia_local):** the
  APAC-anchor rescue still keeps a genuine local story that merely references the
  actor ("Gaza solidarity rally in Jakarta"); only rows with NO in-region place
  drop. India-tagged Hezbollah syndication drops too — correct (foreign).
- **Scope:** relevance-layer only, so it fixes the conflict MONITOR and the
  conflict REPORT (both honour the default gate). Country reports fetch
  `includeIrrelevant` and are NOT affected — do not add a speculative
  country-report guard unless that surface is flagged.

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

## CONFLICT_HARD_EXCLUDE + the slop-only predicate for vouched rows
- `CONFLICT_EXCLUDE` runs BEFORE REQUIRED and is skipped by the violence override
  (so a genuine kinetic event survives). `CONFLICT_HARD_EXCLUDE` is a SEPARATE,
  smaller list of UNAMBIGUOUS conflict noise that must drop even when a violence
  word co-occurs (e.g. sports/photo/market homonyms that a bare kill/attack token
  would otherwise rescue) — it mirrors flashpoint's `FLASHPOINT_TITLE_HARD_EXCLUDE`
  role. Keep it curated to noise that can NEVER be a real armed event; anything
  ambiguous belongs in `CONFLICT_EXCLUDE` (override-gated), not here.
- Both feed the shared `hitsSlopExclude(topic, i)` (exported from
  `@workspace/relevance`): the SLOP-EXCLUDE-ONLY predicate used to gate externally
  vouched rows (GDELT lane-promoted incidents) without re-running the full REQUIRED
  gate. For conflict it runs `CONFLICT_EXCLUDE` + `CONFLICT_HARD_EXCLUDE`; for
  flashpoint `FLASHPOINT_EXCLUDE` + `FLASHPOINT_TITLE_HARD_EXCLUDE`. See
  `gdelt-structured-layer.md` for the promote/reclean wiring.
- **Why:** a lane proves genuineness, not topical cleanliness; the excludes are the
  reusable "noise" half of the relevance rules, split out so both the text gate and
  the promote pass share ONE definition of slop and can never drift.
