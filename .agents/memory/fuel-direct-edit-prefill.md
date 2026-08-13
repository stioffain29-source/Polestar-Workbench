---
name: Fuel Watch direct-edit prefill
description: Owner edits Fuel Watch by cutting/replacing rendered text in place; editor boxes prefill with exactly what renders, unedited boxes save as "".
---

The owner's editing model for Fuel Watch (and likely other topic reports if asked): they want to **delete/cut/paste directly over whatever the engine wrote**, not compose into blank override boxes.

Rule: every fuel narrative box in the report editor pre-fills with EXACTLY the text the preview/PDF currently renders. Since Aug 2026 the ONLY correct way to do this is `resolveFuelEffectiveSections` (fuelReportConsistency.ts) — the single authority (analyst row field → AI → canonical deterministic sections; reads via pickRead) that ReportPreview, exportTopicReportPdf's fuel branch AND the prefill all call. Never re-derive with `aiOr(ai, proseDraft)`: that was the bug that made the draft show rich AI prose while the PDF exported weaker canonical text (three surfaces drifted apart). implications/watchNext still come from `buildFuelWatchReportData().narrativeData` (default top-up lives there).

Companion (Aug 2026): `buildFuelWatchReportData` also exposes `reportFacts`, RECONCILED to canonicalFacts on pressure leader AND overall severity/distribution (the two facts builders rank/cap differently — unreconciled, the prose-tolerant gate false-blocks the canonical text itself). The PDF/preview run BOTH gates: strict canonical gate (canonical payload + resolved Gulf read override) and the prose-tolerant `assertFuelReportConsistent(reportFacts, effective)` over the FINAL effective text. Preview must validate the RESOLVED Gulf override (not the builder's auto-read errors) or a bad override previews clean but the PDF throws.

**Why:** owner: "I want to be able to delete and cut and paste content direct in there to replace anything you've written." Blank saved-only boxes read as "not allowing me to edit."

Companion lesson (owner answer "my edits don't show up in the preview/PDF"): a **blocked or failed Save must surface next to the Save button**. Previously fuel validation errors rendered far down the page and the PATCH mutation surfaced nothing — a silent no-op Save reads as "edits don't show up" after reload discards the form. Editor now shows Saving…/Saved./Save failed + a saveBlocked notice at the button.

**How to apply:** one-shot prefill effect per report id in ReportEditor (after main seed AND after the AI narrative settles), baselines kept in a ref; on Save a box still trim-equal to its baseline persists `""` so unedited sections keep following live AI/auto text (never freeze today's AI copy into the DB). Extending this to another topic = same pattern: prefill from that topic's exact render resolution + baseline-compare on save.
