---
name: Fuel Watch direct-edit prefill
description: Owner edits Fuel Watch by cutting/replacing rendered text in place; editor boxes prefill with exactly what renders, unedited boxes save as "".
---

The owner's editing model for Fuel Watch (and likely other topic reports if asked): they want to **delete/cut/paste directly over whatever the engine wrote**, not compose into blank override boxes.

Rule: every fuel narrative box in the report editor pre-fills with EXACTLY the text the preview/PDF currently renders (analyst edit → AI → deterministic; reads use their auto view text; implications/watchNext must come from `buildFuelWatchReportData().narrativeData` because the fuel renderer applies default top-up there — `aiOr(ai, draft)` alone is NOT parity).

**Why:** owner: "I want to be able to delete and cut and paste content direct in there to replace anything you've written." Blank saved-only boxes read as "not allowing me to edit."

Companion lesson (owner answer "my edits don't show up in the preview/PDF"): a **blocked or failed Save must surface next to the Save button**. Previously fuel validation errors rendered far down the page and the PATCH mutation surfaced nothing — a silent no-op Save reads as "edits don't show up" after reload discards the form. Editor now shows Saving…/Saved./Save failed + a saveBlocked notice at the button.

**How to apply:** one-shot prefill effect per report id in ReportEditor (after main seed AND after the AI narrative settles), baselines kept in a ref; on Save a box still trim-equal to its baseline persists `""` so unedited sections keep following live AI/auto text (never freeze today's AI copy into the DB). Extending this to another topic = same pattern: prefill from that topic's exact render resolution + baseline-compare on save.
