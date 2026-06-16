---
name: Conflict Watch location-led report
description: How the Conflict report is structured and the multi-place gating rule for dropping a report section.
---

Conflict Watch (topic === "conflict") is a LOCATION-LED, dynamically-generated
report: prose is built per-theatre from live incidents by the shared
`buildConflictReportDataset`, which both the preview (`ConflictReportPreview`)
and PDF (`exportConflictReportPdf`) consume — the same parity pattern as
Shipping/Flashpoint. Section spine: Situation → Top Activity Areas (dynamic
top-3 theatres, each a country heading + paragraph) → Other Watched Theatres →
What Matters → Watch Next → Polestar View. Executive Summary is dropped.

Theatre ranking comparator (highest first): worst severity → casualty signal →
incident count → operational relevance → movement/sites/infra/evac → latest
date → theatre name.

Persistence split: ONLY situation/whatMatters/watchNext/polestarView are
editable + persisted (seeded from `ds.auto*` via the conflict branch in
`draftTopicReportProse`). Top Activity Areas + Other Watched Theatres are
render-time auto-only — never persisted, never editable.

**Why:** when a topic DROPS report sections, hiding them from the preview/PDF
is not enough. An architect review caught that the editor still rendered the
dropped fields (Executive Summary / What Happened / Implications), seeded them
into form state, and wrote them on Save — leaving hidden stale boilerplate in
the DB/localStorage.

**How to apply:** to drop a report section for one topic, gate it in THREE
places, not just the preview/PDF: (1) the editor `<Field>` block, (2) the Save
payload (delete the keys), and (3) the localStorage write (skip it). Guard each
with a `form.topic === "<topic>"` check so other topics keep the full field set.
