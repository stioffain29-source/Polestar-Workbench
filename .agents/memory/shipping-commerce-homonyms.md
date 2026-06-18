---
name: Shipping commerce-homonym leak
description: Freight-economics words leaking into the maritime-SECURITY relevance gate
---

- The shipping topic is maritime SECURITY (attacks, closures, piracy, war-risk). Freight-economics homonyms — "port congestion", "freight rate" — are pure commerce and were leaking in because they sat in the shipping REQUIRED phrase set (`lib/relevance/src/topicRelevance.ts`).
- FIX is precision-first: REMOVE the over-broad required phrase (dropped "congestion" from the port-disruption alternation; deleted the bare `/\bfreight rate/` entry). Do NOT add a broad `SHIPPING_EXCLUDE` — that risks over-denying genuine security stories that mention congestion/rates in passing.
- Any REQUIRED / relevance edit must bump `RELEVANCE_RULE_VERSION` so the version-gated boot re-clean re-evaluates persisted rows. Verify by replaying live: commerce rows flip to "dropped: no required topic phrase matched" while controls (port closure, piracy, vessel attack) stay relevant.

**Why:** congestion/freight-rate are inherently commercial; a genuine maritime-security event never depends SOLELY on them, so removal is safe and over-deny is the bigger risk.
