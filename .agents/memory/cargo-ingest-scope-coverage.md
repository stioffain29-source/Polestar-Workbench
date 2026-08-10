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

## Broadening recall must be paired with a LOAD-context noise gate
Widening the cargoWatch.ts LOCAL_FEEDS queries to (crime-verb)×(cargo-noun)
raises recall but drags in generic theft that names a cargo-ish word (truck /
warehouse / parcel) yet is NOT cargo theft (safe/vault burglary, vehicle theft,
cash-van robbery, arms-dealer story, doorstep-parcel theft). Filter that at the
DISPLAY gate (`cargoAnalysis.ts` `isCargoNoise` inside `classifyScope`), NOT at
ingest relevance.
**Why:** the display gate is the established scope authority (DB already holds
~170 filtered-out cargo_watch rows) and is reversible per page-load; an
ingest-exclude regex can't express the stand-down guard, risking irreversible
false drops, and bumping `RELEVANCE_RULE_VERSION` triggers a heavy global
all-topic backfill for a frontend-only concern.
**How to apply:** each noise class MUST stand down when `CARGO_LOAD_CONTEXT_RE`
(a commodity / quantity / "carrying·laden" framing) is present, so a hijacked
bullion truck or a lorry carrying chocolate stays in. Do NOT force strict
cargo-noun vocab as the admit condition — that over-tightens and false-drops
genuine cargo (e.g. "KitKat chocolate bars", "Amman airport warehouse"). Verify
by replaying old-vs-new `classifyScope` over all rows: confirm only genuine
noise drops, zero genuine cargo lost.

## Tightening to "genuine cargo only": strong-noun tier + commodity branch
When the owner demands Cargo Watch keep ONLY real cargo/goods (containers,
shipments, freight in transit, depots, named commodities) and drop generic
warehouse/truck/cash theft, tighten `hasGenuineCargo` in `cargoAnalysis.ts`,
applied to BOTH the attributed-row tail AND the unattributed recovery path:
- Split cargo nouns into a STRONG tier (`cargo/freight/container/consignment/
  shipment/godown/depot/logistics/lorry`) that admits with a crime verb alone,
  and DELIBERATELY EXCLUDE the ambiguous premises/conveyance words
  `warehouse/truck/parcel` from it — a warehouse stores anything, a truck can BE
  the stolen object, a parcel can be a doorstep package. Those qualify only WITH
  load context.
- Add a named-FREIGHT-COMMODITY branch (`scrap/metals/grains/fuel/cigarettes?/
  clothing/...`) so the commodity is the stolen TARGET even without a premises
  word ("12 tonnes KitKat", "scrap iron from a truck", "cigarette distributor
  warehouse"). Use singular/plural (`cigarettes?`) and include the literal
  category words the feed tags rows with (`alcohol`, `clothing`). OMIT
  petty-theft-prone consumer items (phones/laptops/jewellery) and bare vehicles.
- `isCargoNoise`'s stand-down `hasLoad` MUST use the SAME definition
  (`CARGO_LOAD_CONTEXT_RE || CARGO_COMMODITY_RE`) as `hasGenuineCargo`, or a
  commodity-only theft ("diesel stolen from a truck") is dropped as vehicle-theft
  noise BEFORE the genuine-cargo gate ever runs.
**Why:** the old broad `CARGO_NOUN_RE` counted bare warehouse/truck/parcel, so
generic Indonesian warehouse/cash/vehicle burglaries dominated the in-scope set
(~291–303 raw → 208 after tightening; deduped display ~162 → ~110).
**How to verify:** frontend-only (NO DB write, NO `RELEVANCE_RULE_VERSION` bump);
replay old-vs-new `classifyScope` over the live rows and confirm generic
warehouse/truck/cash drop while container/commodity/hijack rows stay (KitKat
cluster mostly kept). Tradeoff the owner ACCEPTED: a bare commodity + crime verb
("beer stolen from a shop") can admit a petty retail theft — keeping genuine
commodity cargo was prioritised over that rare false-positive.

## Per-country gaps (Philippines/Sri Lanka) are a LOCAL-LANGUAGE feed gap
A country reading ~0 cargo rows while Indonesia/Thailand dominate is almost always
a feed-LANGUAGE gap, not a classifier regression. Indonesia/Thailand lead because
they have local-language `LOCAL_FEEDS` (Bahasa/Thai); English Google News barely
surfaces local cargo theft, and an English `"Sri Lanka"` query returns India
"godown" fire/seizure noise, not real SL cargo crime.
- Fix = add a `LOCAL_FEEDS` entry (lang label + proven query). The local stage is
  LANGUAGE-AGNOSTIC: `lang` is only a passthrough label; the LLM screen translates
  and returns canonical `country` via `canonScopeCountry`, so NO `COUNTRY_ALIASES`
  edit is needed for screened items (unlike the English title-gate path).
- Tagalog/Filipino surfaces REAL PH cargo theft (truck diesel-siphon, copper off a
  moving truck, stolen goods loads). Sinhala/Tamil for Sri Lanka genuinely yields
  ~0 — SL cargo-theft reporting barely exists even in local press; add it as a
  standing net (like the zero-yield Arabic feed) but be HONEST that it stays empty.
- Zero-yield feeds are harmless: 0 items → 0 LLM calls.

## The local-language stage SKIPS in a plain CLI shell (no OpenAI env)
`scrape:cargo-watch` run from an interactive bash shell only runs the ENGLISH
regex stage and commits a few rows; the `LOCAL_FEEDS` LLM stage no-ops because the
shell lacks `AI_INTEGRATIONS_OPENAI_*` (those are injected into the api-server
WORKFLOW, not your shell — `/api/integrations/status` showing openai `working`
reflects the api-server process, not the CLI). So you can't observe PH local-feed
population from a CLI scrape here. The admin route (`POST /api/admin/ingest`) runs
in the api-server process WITH the env, but is `INGEST_ADMIN_TOKEN`-gated (401
without the token). Net: dev-verify the feed by fetching its RSS URL directly;
real population happens on the next prod ingest after republish.

## "Lack of reporting" in Cargo Watch is usually real sparseness, not a bug
Genuine RECENT (≤30d) APAC/Middle-East cargo-theft reporting genuinely runs
only a handful of incidents/month. Broadening feeds and tightening noise is the
durable, honest win — recall + precision — NOT a dramatically larger recent
count. Resist inflating numbers with generic theft to satisfy the complaint;
the depth lives in the wider windows.

## "Regional not Indonesia-only": geography is a FEED lever, filter loosening is depth-only
Owner recurring demand: Cargo Watch is a REGIONAL report (APAC **and** Middle
East), not Indonesia-heavy. Two honest levers, and they do DIFFERENT jobs:
- **Feeds (`LOCAL_FEEDS`)** rebalance GEOGRAPHY but only for FUTURE ingests, and
  the local-language stage is `llmReady`-gated → it NO-OPS without
  `AI_INTEGRATIONS_OPENAI_*`. So added Arabic-Saudi (gl=SA — the UAE gl=AE
  edition historically returns 0), Vietnamese, Malay, Hindi, Bengali, Urdu,
  Chinese editions help ONLY on the next prod ingest IF OpenAI is keyed there.
  Adding feeds needs NO `RELEVANCE_RULE_VERSION` bump (ingest inputs, not rules).
- **Frontend filter loosening (`classifyScope`)** re-scopes ALREADY-INGESTED rows
  so it is the only lever that changes the CURRENT report — but it adds DEPTH, not
  geography, and can even nudge Indonesia's share UP (most previously-excluded
  rows are Indonesian generic theft). Be honest about this tension: loosening the
  filter does NOT by itself fix an "too Indonesia-heavy" complaint.
**Why:** the immediate report only shows rows already in the DB for its window;
new feeds can't retro-populate it. Verified by replaying old-vs-new
`classifyScope` over all live rows (base64-dump via executeSql → tsx replay
importing the real `cargoScope` + a temporary reversed `.__old` copy for the
before side; delete the copy after — an unused fn in `src/lib` breaks typecheck).

## Transit-hijack rescue: a goods vehicle waylaid in transit is genuine cargo
The owner-authorised loosening (REVERSING an earlier tightening) that admits
borderline-but-genuine cargo crime the filter dropped: a HEAVY GOODS vehicle
(`ten-wheeler/lorry/container truck/goods vehicle/tanker truck/prime mover/...`,
`HEAVY_GOODS_VEHICLE_RE`) violently **ambushed / waylaid / intercepted / held up**
(`TRANSIT_ATTACK_VERB_RE`) in transit is genuine cargo-in-transit crime even with
NO named load — the freight IS the target. `hasTransitHijack = both REs present`.
Wire it BOTH ways: `hasGenuineCargo` returns true on it AND `isCargoNoise`'s
`NOISE_VEHICLE_TARGET_RE` line stands down on it (else the vehicle-theft noise
gate drops it BEFORE the genuine-cargo gate runs — same trap as the `hasLoad`
stand-down). `hijack` alone already passed via `CARGO_ACTION_RE`; the gap was the
non-"hijack" ambush/road-robbery verbs. Precision holds because it fires only on
verb+heavy-vehicle PAIR — parked-vehicle theft, premises burglary, cash-van, arms
never match. Frontend-only, NO version bump. Replay proof: over 1123 live rows it
flipped exactly 3 excluded→in_scope (1 truck ambush + 2 new commodities
animal-feed/granite), zero noise; all 192 cargo jest tests still pass.

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

**Fuel topic had the same class of gap (Kharg, Aug 2026):** Fuel Watch's live feed only asked for refinery/depot/pipeline incidents — a crude EXPORT terminal going idle (Kharg blockade halt) was invisible though FT/Reuters covered it. Fix pattern is identical to cargo: add the vocabulary class in LOCKSTEP across the Google News feed query, the ingest allow list, and the relevance REQUIRED patterns (+ version bump), then verify by triggering a live ingest and checking rows land relevant.
