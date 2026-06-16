---
name: Conflict topic relief/peace exclude + violence override
description: How the conflict relevance gate drops humanitarian/relief noise without dropping genuine kinetic events
---

The conflict topic relevance gate is REQUIRED-only (actor words like rebel/insurgent + kinetic verbs). A humanitarian story that merely NAMES former combatants ("Ex-rebels help in relief operations for quake victims") slips through because "rebels" matches REQUIRED.

Fix shape (in `lib/relevance/src/topicRelevance.ts`): a narrow `CONFLICT_EXCLUDE` (former-combatants-in-peaceful-role + natural-disaster-relief framing) that runs BEFORE the conflict REQUIRED gate, but GATED on a `CONFLICT_VIOLENCE_OVERRIDE` regex — when a hard armed-violence signal is present the exclude is skipped.

**Why the override is mandatory:** the disaster/relief exclude is actor-independent and kinetic-blind. Without the override it would drop a relief convoy that is AMBUSHED, or a peace process with former rebels that COLLAPSES after an ambush. The override sends those back to REQUIRED so they are kept.

**Why the override excludes bare death words:** killed/dead/wounded/injured also describe disaster tolls ("earthquake kills 30"). Putting them in the override would re-open the relief noise this fix closes. The override is ARMED-specific (ambush/firefight/gun battle/airstrike/bombing/kidnap/gunmen/armed attack...), not generic death.

**How to apply:** any new conflict off-topic exclude that is not itself armed-context-bound must sit behind the violence override. After changing the rules, bump `RELEVANCE_RULE_VERSION` in `lib/relevance/src/evaluate.ts` so the api-server boot backfill re-cleans persisted rows; prod only re-cleans after a republish (workspace prod DB is read-only). Regression tests live in `__tests__/relevance/explainRelevance.test.ts`.
