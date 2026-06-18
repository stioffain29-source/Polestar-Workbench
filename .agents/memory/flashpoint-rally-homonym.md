---
name: Flashpoint "rally" homonym disambiguation
description: How the flashpoint relevance rules tell a political rally apart from market/crypto/sports/motorsport "rally" and disaster headlines.
---

"rally" is the most overloaded flashpoint token — it is a market move, a
sports comeback, a motorsport event, and a political demonstration. The
relevance engine (`lib/relevance/src/topicRelevance.ts`) handles this in TWO
ordered stages, and the ORDER is load-bearing:

1. `FLASHPOINT_EXCLUDE` runs FIRST. It kills the non-political senses
   (instrument/market/crypto/currency rallies, sports/motorsport rallies,
   natural-disaster headlines). Anything that survives is a candidate.
2. The ambiguous tier (`explainRelevance`) then KEEPS a surviving "rally"
   only if `FLASHPOINT_PUBLIC_ORDER_CUE_RE` OR `FLASHPOINT_POLITICAL_RALLY_RE`
   matches. The political set requires an explicit political OBJECT
   (against a govt/policy, for rights/a demand, anti-(war|regime|…),
   opposition/grand/mass/election/labour rally, rally behind a party/leader)
   — never a bare "rally".

**Why the two-stage order matters:** if you add `rally for …` / `rally
against …` as a KEEP cue without first adding the finance/sports collisions
to `FLASHPOINT_EXCLUDE`, headlines like "rally for the peso" or "Japan rally
for a draw" get wrongly re-admitted. Always add the homonym EXCLUDE in the
same change as any new political KEEP cue.

**How to apply / verify:** any change here needs a `RELEVANCE_RULE_VERSION`
bump in `lib/relevance/src/evaluate.ts` so the api-server boot
`backfillRelevance` re-evaluates stored rows. There are NO relevance unit
tests — verify by running the real engine over live DB rows (a throwaway
`tsx` script importing `../../lib/relevance/src/index` + the `@workspace/db`
pool) and check the raw-vs-relevant gap and the flip lists, then restart the
api-server workflow and confirm the persisted `relevance_version` /
`relevance_status` in the dev DB.

**Accepted tradeoff:** the relevance lib is TOPIC relevance, not geography.
A US "mass rally" (Trump/MAGA) is topically a political rally and will be
kept; geo-scoping is the scraper's job (`lib/ingest/src/flashpoint.ts`
FOREIGN_LOCATION), which is out of scope for this lib.
