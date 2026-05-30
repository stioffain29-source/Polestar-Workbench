---
name: Flashpoint weak-operational filters
description: Classes of records the classifier accepts on surface keywords but which must be filtered out of Flashpoint prose / tables / Related Incidents.
---

The Flashpoint topic classifier is intentionally permissive on surface vocabulary (protest, strike, rally, curfew) because it is the single gate into the entire report. The downstream prose builders and Related Incidents must apply a second, stricter filter for *operational* signal. The recurring noise classes are:

- Stock-photo wire captions ("Licensable picture: ... — Reuters Connect", Getty / Alamy / EPA-EFE).
- Sports-media protests (French Open prize money, ATP, NBA, etc.). Players-vs-league disputes are not public-order risk.
- Strikes / rallies that have been *suspended, called off, cancelled, withdrawn, postponed* — the live signal is gone.
- Retrospective legal process about a past public-order event (SK martial-law trials, perjury sentencings, "ex-spy chief denies allegations", anniversary commentary). Civil unrest must mean *live* public-order risk.
- Standalone court verdicts (suspended terms, indictments) that the classifier keeps because of "rioters" / "courthouse" vocabulary but which carry no live disruption.
- SEO keyword-stuffed captions: 3+ commas in title, or non-Latin script mixed with English keyword runs in the same title — almost never real headlines.
- Non-APAC headlines syndicated by an APAC outlet. Strip the trailing " - <Source>" suffix before testing geography; the source name is often the only APAC token.
- Defence-procurement / weapons-system wire copy ("India offers BrahMos", arms/defence deals, fighter-jet/submarine acquisitions) — kept by the classifier on the word "strike" ("precision strike", "strike range") but it is not public-order risk.
- Legislative / parliamentary process ("X passes bill", "cabinet clears law", "co-payment bill") — wire copy often says "opposition protests" rhetorically so it files as Protest, but it is not a street event.
- Sports keyword noise ("striker", a "11-second strike", tennis "rally", title "march") beyond the named-league filter. Motorsport is a sneaky case: "rally" is also a protest synonym, so a WRC headline ("Paddon's final Rally1 event - DirtFish") passes the protest gate. Catch it on motorsport-specific markers (rally1/rally2, WRC, DirtFish, Autosport, Motorsport, MotoGP, Grand Prix, F1/Formula 1, "special stage"/SSn), NOT the bare word "rally".

**"rally"/"strike" are the single worst noise source — keyword filtering alone is never "done." Verify with a live KEPT-vs-DROPPED audit, not a self-checking harness: `pnpm --filter @workspace/workbench run audit:flashpoint` dumps both lists straight from `/api/incidents` so a human can eyeball them. The first homonym pass still leaked ~9/34; these are the senses that survive a naive "needs an instrument/league word" filter:**
- Market rallies signalled by a RESULT word, not a named instrument: rout / valuation / profit / "N% rally" / "AI infrastructure rally" / "tin rally lifts profit".
- Sports match-report vocab the league list misses: a goal "strike" at half/full-time, "players rally" behind a team-mate, "protest the referee's call", regional sports (sepak takraw, kabaddi, etc.).
- Business "strike a deal" (commercial agreement, not industrial action).
- Fact-check / debunk pieces that say it is NOT a protest.
- Opinion-poll / approval-rating stories (a survey result, not an event).
- Public-health outbreaks (bird flu / dengue / etc.).
- Non-APAC protests syndicated by an APAC outlet ("...EU on Georgia's independence day - Free Malaysia Today").

**Where each belongs (layer matters):** topic-irrelevance homonyms (market/sports/deal/fact-check/poll/health) go in `FLASHPOINT_EXCLUDE` (`topicRelevance.ts`) — a hard exclusion that runs before the relevance tiers, so it cleans the report dataset AND the generic seeding path at once. Geography drops stay in `NON_APAC_FOCUS_RE` (`flashpointReportDataset.ts`), which strips the trailing " - <Source>" suffix first.
**Two anti-over-match rules learned the hard way:** (1) broad lexical tokens like "full-time" are unsafe at the hard-exclusion layer ("full-time workers rally" is real) — anchor them to an adjacent sports word. (2) Do NOT geo-drop on `ukraine`/`russia`: APAC solidarity protests are real public-order events; keep `georgia` only, and keep `APAC_HOOK_RE` stocked with major APAC *cities* (Tokyo, Seoul, Manila…) so a city-named solidarity headline survives even when it names a non-APAC cause.
**Consciously-kept borderline records (do NOT keyword-filter — the cure is worse):** a genuine labour strike with a wrong country tag (Icelandic "Eimskip" mislabelled Philippines — needs entity resolution, not regex) and awareness stunts ("amplify voices of Gaza Children" — filtering "Gaza" would drop real pro-Palestine APAC protests).

All three new classes are gated on `!LIVE_PUBLIC_ORDER_RE`: a *genuine* protest against a bill or arms deal will mention a crowd/march/tear gas/road closure and is kept; rhetorical "opposition protests the bill" copy is not. Do NOT broaden the exemption to the bare word "protest" — that re-admits exactly the junk (e.g. the "Japan passes bill" item) the user flagged.

**Why:** the classifier sees the report as a corpus; the reader sees one record at a time. A "protest" record with no place, no actor, no impact and no time-of-day is worse than no record. It signals to the reader that the brief is keyword-driven, not analyst-driven.

**How to apply:** keep weak-operational filtering at the dataset layer (between classifier and prose builders), never in the classifier itself — the classifier must keep these records visible in raw counts so reporting is honest. Apply identically to activism rows, unrest rows, Watch Next / forecast extraction, and Related Incidents prioritisation; any one of those leaking weak items will rebreak the brief.

Civil-unrest live-hook gate: a record is allowed only if it contains a current public-order verb (crackdown, tear gas, water cannon, baton, curfew imposed / extended, road closure, roadblock, clash, mass arrest, sit-in, troops deployed). The presence of "curfew" or "martial law" alone in a legal-process headline is not enough.

Related Incidents diversification: rank globally, then do a country-round-robin first pass (one record per country until cap), then fill remaining slots from the global ranking. Otherwise the strongest single country (PTI / Pakistan in this corpus) eats every slot.

Forecast signal labels must never fall back to a bare "Protest mobilisation". Compose them as `actor + trigger + form` and append `(City)` when a city is detectable in title/summary. The country column already carries the country.

Forecast table must also dedupe by `(country, signalLabel)` after shortSignalLabel is applied. Title-level dedupe alone is not enough: two distinct records (e.g. a Samsung pay-talks strike notice and a court injunction against the same union) can both collapse to "Union injunction ruling — sectoral strike risk" for South Korea and render twice. Collapse on the rendered label, not just the source title.

Out-of-scope crime classifications (Armed robbery, Armed group activity, Crime / public safety, Piracy / armed robbery) must be hard-dropped at the dataset root — *before* enriched/countryCount/highestSeverity are computed — not only at the Related Incidents prioritiser. Filtering only at Related lets crime records skew the country chart, the highest-severity Fast Fact and the auto Executive Summary's "shaped by" driver line; the reader then sees an exec summary that talks about robbery in an activism brief.

**Single-selector rule (the contradiction killer):** Flashpoint/Protests had THREE divergent filter regimes that disagreed — (A) Fast Facts + Related Incidents counted from an `enriched` set that *kept* weak/novelty items "so totals stay honest"; (B) prose reads used the cleaned activism/unrest rows; (C) the form-seeded prose used `filterIncidentsToWindow({byTopic:true})` which for a `protests` report only saw the `protests` bucket, never the merged `flashpoint` bucket — so it seeded "No usable signal" while Fast Facts showed records. Fix: ONE exported selector `selectFlashpointUsable(incidents, topic, issueDate)` returns the single clean set (merged flashpoint+protests, minus kinetic/court/crime/novelty/weak-operational, deduped); BOTH the dataset builder AND `draftTopicReportProse` (for flashpoint|protests) consume it. **Why:** the "honest totals" design was the bug — the count must equal the narrated/tabled set or the brief self-contradicts. **How to apply:** never reintroduce a separate "honest count" that includes records the prose/table exclude; if you add a consumer of flashpoint incidents, route it through `selectFlashpointUsable`, not a fresh filter.
