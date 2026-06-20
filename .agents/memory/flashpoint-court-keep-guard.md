---
name: Flashpoint court-process keep-guard
description: The court/legal-process drop must only rescue on a LIVE reaction to the outcome, not a bare protest word
---

# Flashpoint court-process keep-guard (FP_COURT_UNREST_KEEP_RE)

**Rule:** the flashpoint court/legal-process drop (sentencing/verdict/conviction)
may only be rescued by a LIVE unrest reaction *to the ruling* — never by the bare
appearance of a protest word. A retrospective verdict that merely *mentions* a past
rally/protest/death as the subject of the case ("union rally death", "court convicts
protest activists", "sentenced for 2019 rally") is a legal outcome, not civil unrest,
and must drop so it cannot inflate a country's severity ranking.

**Why:** a single court story crowned an otherwise-quiet country the Extreme
"Highest Severity Country" on the Protests monitor because the old guard matched any
bare "rally"/"protest"/"riot". The user flagged this and wants such items gone
retroactively and prevented going forward.

**How to apply:**
- Rescue paths must encode a reaction *to the outcome*: active-response tokens (tear
  gas / water cannon / baton charge / barricades / curfew / looting / arson), verdict
  SPARKS/TRIGGERS unrest, protest breaks out AFTER/OVER/AGAINST the ruling, or an
  unrest verb whose OBJECT is the court ruling ("hundreds protest court ruling").
- The object-form path must require the unrest word to PRECEDE the "court" word, or a
  retrospective "court convicts protest activists" re-qualifies.
- Never put bare `march` in any path — it collides with the month ("March court
  ruling…"); genuine marches are caught via "demonstrat"/"protest" instead.
- Any change needs a `RELEVANCE_RULE_VERSION` bump (boot backfill re-cleans stored
  rows) and a LIVE audit, not a self-checking harness: confirm the known court item
  drops, a genuine "protest court ruling" reaction keeps, and the delta is only
  legal-process records.
