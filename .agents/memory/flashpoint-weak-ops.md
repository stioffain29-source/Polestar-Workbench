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

**Why:** the classifier sees the report as a corpus; the reader sees one record at a time. A "protest" record with no place, no actor, no impact and no time-of-day is worse than no record. It signals to the reader that the brief is keyword-driven, not analyst-driven.

**How to apply:** keep weak-operational filtering at the dataset layer (between classifier and prose builders), never in the classifier itself — the classifier must keep these records visible in raw counts so reporting is honest. Apply identically to activism rows, unrest rows, Watch Next / forecast extraction, and Related Incidents prioritisation; any one of those leaking weak items will rebreak the brief.

Civil-unrest live-hook gate: a record is allowed only if it contains a current public-order verb (crackdown, tear gas, water cannon, baton, curfew imposed / extended, road closure, roadblock, clash, mass arrest, sit-in, troops deployed). The presence of "curfew" or "martial law" alone in a legal-process headline is not enough.

Related Incidents diversification: rank globally, then do a country-round-robin first pass (one record per country until cap), then fill remaining slots from the global ranking. Otherwise the strongest single country (PTI / Pakistan in this corpus) eats every slot.

Forecast signal labels must never fall back to a bare "Protest mobilisation". Compose them as `actor + trigger + form` and append `(City)` when a city is detectable in title/summary. The country column already carries the country.
