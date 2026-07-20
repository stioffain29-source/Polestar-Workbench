---
name: Report editor topic-scoped incident fetch
description: Why ReportEditor must scope its incident fetch by report topic, and the fuel→shipping / flashpoint→protests bucket map behind it.
---

# Report editor must scope its incident fetch by topic

**Symptom that this prevents:** every report in the builder rendered as "Fuel
Watch from last week" regardless of its real topic (flashpoint, energy, …).

**Root cause:** `ReportEditor` seeded its `form` from the loaded report ONLY
after the incident fetch resolved (`if (!incidents) return` in the seed effect).
That fetch was `useListIncidents({})` — no params — which the `/incidents` route
serves with only a relevance filter and **no limit**, i.e. every
relevance-passing row. As the DB grew (the `indonesia_local` topic alone added
~14k rows; total ~28k ≈ 26 MB before the corroborations join), that payload got
heavy enough to stall/never-resolve, so the seed never ran and `form` stayed at
its EMPTY default (`topic: "fuel"`). The preview keys off `form.topic`, and the
fuel preview clamps to the latest market close → "last week". This is
DB-growth-sensitive, which is why it appeared suddenly.

**Rule:** the builder renders ONE topic's report, so scope the fetch to exactly
that topic. Drive it off a reactive `activeTopic` = `seededId === report.id ?
form.topic : report?.topic` (NOT `report.topic` alone — the topic dropdown is
editable; NOT `form.topic` alone — chicken-and-egg, form seeds after incidents).
Use a `seededId` **keyed by report id**, never a bare `seeded` boolean:
navigating A→B with B's report cached would otherwise seed B from A's
still-loaded topic bucket (blank window → Option A dating + prose parity break,
never reseeds).

**Bucket map (every report reads its own topic PLUS):**
- `fuel` → also `shipping` (fuel cross-reads shipping producer/operational actions).
- `flashpoint` | `protests` → BOTH `flashpoint` AND the legacy `protests` bucket.
- `cargo_watch` → its existing separate raw `includeIrrelevant` fetch (the gated
  primary set is filtered out and replaced).
- everything else → own topic only.
Topics are mutually exclusive per row, so merge the disjoint buckets with plain
concat (no dedupe). Return `undefined` from the merged memo until EVERY query the
active topic needs resolves, or the one-shot seed freezes a partial window.

**Still open (separate follow-up):** the same unbounded `useListIncidents({})`
lives on the Incidents / Map / Timeline pages — same 26 MB risk. Also the
`TOPICS` dropdown includes `maritime_security`, which is NOT in the ListIncidents
Topic enum, so selecting it post-seed 400s the scoped fetch (latent, saving it
already 400s server-side).
