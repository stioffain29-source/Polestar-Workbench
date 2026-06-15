---
name: PDF pagination page-fill (DOM-rasterise path)
description: How the in-app "Download PDF" decides page breaks and how to stop it leaving big white gaps.
---

The in-app "Download PDF" rasterises the on-screen `.print-report` DOM (`exportElementToPdf` in `artifacts/workbench/src/lib/exportPdf.ts`), so it can only cut the tall canvas at break candidates collected by `collectBreakCandidates`. By default those candidates are STRUCTURAL only (section/table/kpi/row tops). A prose block taller than the page remainder therefore gets pushed WHOLE onto the next page, leaving a half-empty page (the recurring "white space at the bottom" complaint).

Fill the gap by letting prose split at line boundaries:
- Mark the prose `<p>` with `data-pdf-flow`; `collectBreakCandidates` then adds per-line tops (via `Range.getClientRects`), skipping each element's FIRST line so a heading keeps its first body line.
- Scope the marker to ONE report's local prose component (e.g. spot's `Paragraphs`) so other report previews don't get line breaks → no drift.

**Why the dedup had to change:** line tops are ~24px apart, which equals `PAGE_BREAK_GUARD_PX` (24). The old dedup compared each candidate to its immediate sorted predecessor and `>guard`, so it cascade-dropped a whole run of evenly-spaced line tops down to ONE — fill barely improved. Switching to "compare to previous KEPT candidate" keeps ~every-other line top and lets `buildPageSlices` pick a deep break.

**How to apply:** for structural-only reports (no `data-pdf-flow`) previous-kept dedup is a strict superset of the old behaviour (only ever keeps MORE candidates; `buildPageSlices` already picks the deepest useful one), so it cannot regress their pagination. Verify changes by reproducing the user layout in a Playwright clone at 960px (long section BEFORE the tall element to push it down + long single-paragraph section AFTER it) and comparing page-1 fill% — the failure mode needs a tall single paragraph with no internal candidate.

Known limitation: a paragraph can still break before its last line (one-line widow on the next page). Acceptable while "fill the page" is the priority; if it becomes a complaint, also skip the LAST line candidate per paragraph.
