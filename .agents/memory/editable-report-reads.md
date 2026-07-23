---
name: Editable report "reads" via shared pickRead
description: How every narrative "read" paragraph in topic reports is made owner-editable while preserving preview==PDF parity and no-fabrication.
---

Every narrative "read" paragraph in a topic report (shipping / cargo / fuel / conflict, plus the pre-existing flashpoint) is owner-editable: a saved override, when non-blank, replaces the auto-generated dataset text; blank falls back to the live generated read (no fabrication).

The single authority is `artifacts/workbench/src/lib/pickRead.ts`: `pickRead(override, auto)` returns the trimmed override if non-blank, else `auto ?? ""`. It is shared by EVERY topic preview component AND every jsPDF builder so the two surfaces can never drift.

**Why:** preview==PDF parity is a HARD project rule, and the no-fabrication rule means a blank field must show generated text, never a placeholder. A local copy of the helper (cargo once had its own `pick()` in `ReportPreview.tsx`) is a drift hazard even when momentarily equivalent — always import the shared `pickRead`, never re-define a local equivalent.

**How to apply (adding a new read or new topic):**
- Add a nullable column on the reports table + idempotent boot ALTER (prod DB is read-only from workspace) + OpenAPI field + Orval codegen.
- ReportEditor: a textarea gated by `form.topic`, wired through FormState/EMPTY/seed/save. Seed savedOnly topics with `pick(saved, "")` (no dataset build needed); blank => auto at render time.
- Preview component AND jsPDF builder both resolve the read via `pickRead(savedOverride, autoFromDataset)` with the SAME dataset/auto source.
- Conflict is special: per-theatre reads live in a JSONB map `conflictAreaReads` keyed by theatre name; the editor enumerates theatres from the SAME `buildConflictReportDataset(...).topActivityAreas` the preview/PDF render, uses a merge-setter that preserves other keys, and prunes blank entries from the save payload so absent keys fall back to generated text. Plus a single `conflictOtherWatchedRead`.

**Testing note:** the in-app "Download PDF" rasterises the on-screen preview DOM, so the preview is the primary parity surface (jsPDF builders are headless-only). E2e proof = type a unique marker into a read textarea, assert it appears in the live preview, clear it, assert it disappears — this exercises both override and fallback paths without depending on live data content. App is owner-private (Replit Auth); the dev DB already has a claimed owner whose sub can be reused for `testReplitAuth` login.

## Topic section overrides (task 438 extension)
- `reports.section_overrides` jsonb now also carries `fastFactOverrides` (keyed by the AUTO tile LABEL — exact case, e.g. fuel's "Brent crude" not "Brent Crude"), `panelReads` (`gulf-hormuz` fuel chokepoint read), and `marketPriceOverrides` (energy). One authority: `topicSectionOverrides.ts` (applyFastFactOverrides / applyMarketPriceOverrides / pruneTopicSectionOverrides) used by BOTH previews and PDF exporters; blank override = revert to auto.
- Gotcha: override keys are exact-label matches, so any change to a builder's tile label silently orphans saved overrides; the editor UI derives keys from the same builder (autoFastFacts memo) so UI-saved keys stay correct.
- Historical trap: `exportShippingReportPdf` once took a `redSeaFlow` param (removed with the deprecated Red Sea flow section); stale 9-arg callers (tests, headless script) silently shifted args — check positional callers whenever a PDF exporter signature changes.
