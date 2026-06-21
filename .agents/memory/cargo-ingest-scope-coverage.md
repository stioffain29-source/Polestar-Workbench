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

## "Cargo looks thin" is often a DISPLAY/attribution gap, not missing rows
When the OpenAI secret is absent the ingest LLM is inert, so the cargo "thin"
fix is a DETERMINISTIC FRONTEND layer in `cargoAnalysis.ts` (NO DB writes):
- A **Bahasa cargo-vocab gate** (`gudang/kargo/truk/...` NOUN **AND** a theft
  VERB `pencurian/dibobol/dijarah/...`) rescues local-language warehouse/truck
  theft the English-only `CARGO_INCIDENT_RE` dumped into `excluded_non_cargo`.
  Require BOTH noun+verb — Bahasa is ASCII so a noun-only gate leaks generic theft.
- A curated **sub-national gazetteer** recovers an in-scope country for rows the
  source left `Unknown`. Read **title+summary only, never the source/feed label**
  (feed names carry misleading regions, e.g. "Australia Freight & Truck Theft").
- **Recovery branch must use a STRICTER predicate than the broad cargo gate**:
  cargo NOUN + crime verb, OR a cargo action (hijack/smuggle/pilfer/siphon), OR
  the Bahasa noun+verb pair. **Why:** for an unattributed row, the broad gate's
  bare generic-crime words (`theft|robbery|raid`) + a gazetteer place would admit
  "motorcycle theft in Penang". Attributed (stored-country) rows keep the broad gate.
- Genuinely-cargo-but-unattributed rows go to **needs-review, never fabricated**
  into a country.
- The reconciliation **banner must partition EVERY record**: in_scope_raw +
  out_of_scope_geo + excluded_non_cargo + needs_review = total; report dedup
  separately (distinct vs collapsed syndicated copies). The original "thin"
  complaint was largely this banner hiding a big needs-review bucket.
**How to verify safely:** replay old-vs-new `classifyScope` over the live
`relevance_status='relevant'` rows (the page set; raw DB count is larger) and
confirm every newly-in-scope row is genuine + the strict gate demotes zero
genuine recoveries.

## "Cargo dashboard shows only 4 / hasn't changed" = the 30D filter, not a bug
The recurring "cargo is light / nothing changed" report is usually the **30D
range pill** being selected. The Cargo Watch page DEFAULTS to **All Time**
(`useState<RangeKey>("all")`), which renders the full in-scope set (~160+
incidents, map spanning APAC + Middle East + East Asia). Recent cargo-theft
reporting in the covered region genuinely runs only ~6 incidents/month, so ANY
short window (24h/7d/30d) looks tiny — that is real monthly sparseness, NOT
staleness or a display bug. The depth lives in the wider windows (e.g. ~174
records in 180d vs ~6 in 30d).
**Don't reflexively blame prod-staleness:** verified dev and prod cargo data are
identical and current (same total, same last-incident, prod self-refreshes), and
the published app also defaults to All Time and shows the rich set. Before
"fixing" anything, screenshot the All Time view (dev AND the live prod URL) and
diff dev vs prod counts — the answer is almost always "working as intended, user
was on the 30D filter."
