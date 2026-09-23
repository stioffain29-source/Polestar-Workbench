---
name: Incident id fan-out bind-parameter ceiling
description: Why a read that attaches per-incident detail to "every row we just selected" collapses the whole /incidents endpoint once the dataset grows, and how to write those reads instead.
---

Any read that selects a set of incidents and then fetches related rows with a
single `inArray(<table>.incidentId, ids)` spends ONE Postgres bind parameter per
id. Postgres refuses any statement carrying more than 65,535 of them, so the
query throws as soon as the workspace holds more incidents than that — and the
throw is not local: the whole endpoint 500s.

**Rule:** batch id-keyed fan-out lookups (~1,000 ids per statement) and merge in
memory. Never assume the caller's set is small.

**Why:** the endpoint that does this is the shared one nearly every surface
reads. When it 500s the app does not report an error — each consumer shows its
own empty/stuck state, so the symptoms look like unrelated feature bugs:
country report pages sit on "Loading..." forever (so their Download PDF button
does nothing, because the report element never mounts), the spot-report
incident picker says "No matching incidents", monitors read empty. Nobody
looks at the network tab, so this reads as "the PDF is broken" or "there are no
news articles". Diagnose by curling the endpoint directly before touching any
of the surfaces.

**How to apply:** when adding per-incident enrichment (corroborations, semantic
evidence, summaries, translations) to a list endpoint, route the lookup through
a batching helper. A filtered request can mask the bug — a narrow country
filter stays under the ceiling while the unfiltered call fails — so test the
widest call the UI actually makes, not a convenient small one.

**Verifying owner-gated pages headlessly:** dev holds a long-lived owner session
row, so a Playwright context can reuse the newest `sid` from the sessions table
as a cookie (`secure:false`, domain `localhost`) instead of driving OIDC.
