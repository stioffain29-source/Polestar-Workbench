---
name: Shipping off-region relevance gate (theatre override)
description: How off-scope shipping incidents (Black Sea / Baltic / UK shadow-fleet / Baltic Dry Index) are dropped without losing in-theatre Gulf/Asia stories
---

# Shipping off-region drop, gated by a tracked-theatre override

The shipping topic is APAC + Middle East only, but broad REQUIRED phrases like
"tanker seized" / "armed attack on tanker" happily rescued European stories
(UK/Scotland/Black Sea/English Channel/Baltic, Royal-Navy shadow-fleet seizures)
into "Confirmed Maritime Incidents". The fix lives in `lib/relevance/src/topicRelevance.ts`:

- `SHIPPING_OFF_REGION` — explicit off-theatre geography + UK/Baltic-actor ↔
  shadow-fleet adjacency pairs (`.{0,40}` bounded, both orders).
- `SHIPPING_THEATRE_RE` — the tracked chokepoints (Hormuz, Bab el-Mandeb, Red
  Sea, Gulf of Aden, Suez, Singapore/Malacca, etc.).
- Gate in `explainRelevance`: drop a shipping incident when an off-region pattern
  matches **AND** no tracked-theatre pattern matches. A named tracked theatre
  overrides the drop, so "UK will help reopen the Strait of Hormuz" stays.
- Baltic Dry Index (and capesize/panamax/supramax index) noise goes in
  `SHIPPING_EXCLUDE` — it's commerce, not maritime security, and drops
  regardless of any theatre word.

**Why the ordering matters:** the off-region gate must run BEFORE the shipping
REQUIRED pass, or a broad required term re-admits the off-region story. It must
run AFTER global noise excludes. This precedence was architect-confirmed sound.

**How to apply / extend:**
- Always bump `RELEVANCE_RULE_VERSION` (`evaluate.ts`) so the boot relevance
  backfill re-cleans persisted rows — the frontend boards read the persisted
  `relevant` column, not a live re-eval.
- Precision-first: add specific off-region geography, never a broad exclude.
- Known precision tradeoff (accepted): a story that names only bare "Gulf"
  (not in `SHIPPING_THEATRE_RE`) AND uses UK shadow-fleet framing would drop.
- Verify by replaying `explainRelevance("shipping", row)` over live DB rows
  (import the lib via relative `../../lib/relevance/src/index.ts` from a
  `@workspace/scripts` tsx run; the db pool comes from `@workspace/db`, since
  scripts has no direct `pg`/`@workspace/relevance` dep).
