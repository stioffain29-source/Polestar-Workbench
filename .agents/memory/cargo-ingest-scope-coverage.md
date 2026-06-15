---
name: Cargo ingest scope coverage & attribution
description: Why "cargo watch reporting light" is usually a feed COVERAGE gap, how the three cargo scope lists must stay in lockstep, the Google-News masthead trap, and the piracy routing rule.
---

# Cargo ingest scope coverage & attribution

## Three scope lists must mirror the frontend, or a path silently starves
`lib/ingest/src/cargoWatch.ts` has THREE independent in-scope lists that must all
match the frontend authority `artifacts/workbench/src/lib/cargoAnalysis.ts`
(`APAC` + `MIDDLE_EAST`):
1. the **feed** country lists (`ME_COUNTRIES`, `APAC_COUNTRIES`) — what Google News is queried for;
2. the **English** classifier `COUNTRY_ALIASES` — what the title-only country gate accepts;
3. the **LLM/local-language** path `SCOPE_CANON` — what translated incidents canonicalise to.

**Why:** "cargo watch reporting seems light" was NOT a filter bug — it was a
coverage gap. The feeds queried only ~8 APAC + 7 ME countries while the page
counted ~20 APAC + 13 ME as in-scope, so genuine China/Japan/Australia/Iran/etc.
incidents were never fetched. `SCOPE_CANON` already listed the 6 missing ME
countries (Iran, Iraq, Yemen, Israel, Lebanon, Syria) but the feeds/aliases did
not — so the LLM path accepted them and the English path dropped them.

**How to apply:** whenever the frontend scope set changes, update ALL THREE in
lockstep. A feed-only/alias change needs NO `RELEVANCE_RULE_VERSION` bump (it
changes ingest inputs, not the central relevance rules). Prod refreshes via the
scheduler/admin route only after a republish.

## Classify the masthead-STRIPPED title, never the raw Google News title
The country gate is TITLE-ONLY. Google News appends `" - Source Name"`, so a
publisher masthead ("South China Morning Post", "Japan Today", "Bangkok Post")
satisfies the in-scope-country requirement and mis-tags an out-of-country story
to its publisher's country. `processFeed` must call `classifyFeedItem` (strips
the masthead, THEN classifies); `classify` on the raw title is the trap.
**Why:** produced bad rows like a SE-Asia piracy item tagged "China" via SCMP,
and a Japan-Today story with no Japan in the headline tagged "Japan".

## Piracy routing: shipping owns it; cargo keeps it only if cargo-related
Per product rule, piracy belongs in the SHIPPING feed UNLESS the item is cargo
related. Do NOT add piracy/pirate to the cargo DENY list — DENY runs BEFORE
ALLOW, so it would also kill genuinely cargo-related piracy. The cargo ALLOW
gate (requires a cargo-theft phrase) already routes it correctly: cargo-related
piracy passes, pure piracy fails `no-allowlist-match`. Shipping already has full
piracy coverage (`shipping.ts` feeds/ALLOW + `relevance/topicRelevance.ts`).

## Precision when widening aliases
- Don't add an alias that collides across scope: "tripoli" is BOTH Lebanon and
  Libya (out of scope) — omit it, keep "beirut".
- Bare "korea" maps to South Korea, so North Korea (out of scope) is guarded via
  `FOREIGN_CONTEXT` ("north korea"/"pyongyang"/"dprk") rather than a new alias.
- Widening country coverage does NOT loosen precision: the ALLOW/DENY phrase
  gates still require a cargo-crime phrase and still drop military/maritime noise.
