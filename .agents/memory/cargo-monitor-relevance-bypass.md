---
name: Cargo Watch persisted relevance boundary
description: Cargo surfaces must honor persisted relevance; structured promoted events are made relevant at creation rather than rescued with raw client fetches.
---

Every user-facing Cargo Watch surface must use the default persisted relevance
boundary. `classifyScope` remains a stricter cargo-domain filter after that gate,
not a substitute for it. Monitor, report editor, country reports and exports must
never request raw irrelevant incidents.

**Why:** The owner clarified that every surface is incident-focused and no
client-specific bypass may re-admit rows. Structured TAPA promotions are genuine,
externally classified events; they are persisted as relevant when promoted and
the relevance backfill deliberately skips those promoted rows. Their synthetic
taxonomy titles may not match the general text REQUIRED regex, but that is not a
reason to weaken the display boundary.

**How to apply:** If Cargo Watch becomes thin, diagnose and correct the persisted
classification/promotion path, then backfill deliberately. Never fix it with
`includeIrrelevant`. Preserve structured-source exceptions at promotion/backfill,
not in UI fetches.
