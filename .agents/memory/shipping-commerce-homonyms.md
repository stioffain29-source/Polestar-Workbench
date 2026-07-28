---
name: Shipping commerce-homonym leak
description: Freight-economics words leaking into the maritime-SECURITY relevance gate
---

- The shipping topic is maritime SECURITY (attacks, closures, piracy, war-risk). Freight-economics homonyms — "port congestion", "freight rate" — are pure commerce and were leaking in because they sat in the shipping REQUIRED phrase set (`lib/relevance/src/topicRelevance.ts`).
- FIX is precision-first: REMOVE the over-broad required phrase (dropped "congestion" from the port-disruption alternation; deleted the bare `/\bfreight rate/` entry). Do NOT add a broad `SHIPPING_EXCLUDE` — that risks over-denying genuine security stories that mention congestion/rates in passing.
- Any REQUIRED / relevance edit must bump `RELEVANCE_RULE_VERSION` so the version-gated boot re-clean re-evaluates persisted rows. Verify by replaying live: commerce rows flip to "dropped: no required topic phrase matched" while controls (port closure, piracy, vessel attack) stay relevant.

**Why:** congestion/freight-rate are inherently commercial; a genuine maritime-security event never depends SOLELY on them, so removal is safe and over-deny is the bigger risk.

## Sale-and-purchase verb ambiguity (2026-07-28)
"lands" and "orders" in the S&P exclude collaterally swallowed live coverage ("projectile LANDS near tanker", "Iran ORDERS tanker to stop"). Ambiguous verbs may only pair with an unambiguous vessel-CLASS/newbuild object, never bare tanker/vessel/tonnage. UKMTO "projectile near tanker" advisories also needed their own REQUIRED phrase (they'd only ever ingested because the exclude short-circuited first). KEEP/DROP fixture suites now pin fuel + shipping (__tests__/relevance/fuelExcludes.test.ts, shippingExcludes.test.ts).

## Masthead-TLD verb trap (2026-07-28)
The relevance haystack concatenates title+summary, so a source-name TLD can complete a commerce-verb match ACROSS the boundary: "…Breakingthenews**.net** UK receives report of **vessel**…" fired `\bnets?\b … vessel` and hid a live vessel-fire advisory. `nets?` now carries `(?<!\.)`. When adding short commerce verbs, check whether a masthead/TLD substring (".net") can satisfy them at a `\b` boundary. Also: UKMTO "vessel ON fire / ablaze" needed its own REQUIRED phrase (the adjacent "vessel fire" alternation misses the preposition).
