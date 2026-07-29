---
name: Country-engine §7 gate tuning
description: How to tune the held-queue confidence gate safely (dry-run replay, companion overrides)
---

The §7 gate's held band is tuned by adding targeted SOFT exclusion rules in classify.ts, not by moving the 50/70/85 thresholds — genuine incidents (fires, accidents) sit at confidence 55 because there is no "Fire" category, so band-wide auto-exclusion would drop real events.

**Why:** Live held-queue replay showed two dominant noise classes (judicial/corruption process reporting ≈ `legal_process`; preparedness/awareness/risk-warning PR ≈ `preparedness_or_awareness`). First-cut regexes wrongly excluded rallies over graft cases and police raids in corruption probes — fixed with companion overrides (unrest cues skip both rules; raid/search cues skip legal_process) plus dropping bare "<hazard> threat" alternates.

**How to apply:** Any future gate rule change must be verified by a dry-run replay over live rows per slug: bundle a script with esbuild (`--format=cjs --external:pg-native`, output INSIDE artifacts/api-server so node resolves deps; no tsx in repo), run buildCanonicalEvents, and diff held/included against persisted country_engine_events — inspect `includedLost` titles specifically, that is where regressions hide. New exclusion reasons go in EXCLUSION_REASONS (types.ts); zod routes pick them up automatically. Note: country_engine_audit bulk_override rows were EMPTY as of Jul 2026 — analysts had run no bulk passes, so patterns came from the held pool itself.

Inclusion-side tuning works the same way: the held band also shrinks by ADDING a precision-first CATEGORY_RULES entry (e.g. "Fire and accident" — every alternate binds fire/blaze to an occurrence verb/structure noun, lookbehind excludes "open fire") so genuine events reach the matched-category 78 band; verify with the same per-slug replay, inspecting the GAINED titles for metaphor/prevention leaks. Replay diff note: foreign-venue crime wires (Seattle/Oklahoma/Mexico) surfaced as held→included at 92 — an attribution gap, not a category-rule bug.
