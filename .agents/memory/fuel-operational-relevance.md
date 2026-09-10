---
name: Fuel operational relevance
description: Precision-first admission boundary for Fuel Watch and the required live-replay check before changing it.
---

**Rule:** Fuel Watch admits a story only when article evidence demonstrates a fuel-market or fuel-operations consequence. Bare oil, tanker, refinery, chokepoint, actor, or outlook mentions are insufficient.

**Why:** Subject and entity words admitted commentary and metadata leakage, while an over-tight first correction removed real price actions, tax changes, supply agreements, and import/export flow changes.

**How to apply:** Evaluate masthead-stripped title and summary only; never use publisher, URL, assigned country, or stored location as evidence. Treat explicit price/cost moves, fuel-linked fiscal actions, executed supply contracts, and measured flow changes as consequences. Exclude long-horizon forecasts, daily price tickers, and equity-only reactions.

**Rule:** Relevance changes require both a rule-version bump and a live replay over recent stored rows before acceptance.

**Why:** Fixture tests missed a large recall regression that was visible immediately against the current 30-day corpus.

**How to apply:** Compare old persisted verdicts with the new rule, inspect every lost row by semantic class, and correct generalized grammar rather than adding country, entity, or headline exceptions.