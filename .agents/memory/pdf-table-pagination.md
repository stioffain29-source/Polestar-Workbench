---
name: jsPDF table keep-together pagination
description: How the jsPDF report builder prevents orphaned table headers/rows, and which fuel export path is the faithful repro.
---

# jsPDF table keep-together (Related Incidents, Producer/Buyer)

A jsPDF table must NOT start at the foot of a page (heading + header + one
orphan row, rest spilling over). The fix pattern, applied per major table in
`exportTopicReportPdf.ts`:

1. **Pre-measure the whole block** (section heading allowance + table header
   band + every row + trailing gap), then `ensureSpace(...)` BEFORE
   `drawSectionHeading` so it breaks to a fresh page up-front.
2. **Measurement must mirror rendering EXACTLY** — same font face/size
   (`setRoboto(pdf,"regular"); setFontSize(8)`), same wrap width
   (`colTitleW - 8`), same per-row formula (`Math.max(rowH, lines*11 + ROW_PAD)`).
   If measure and draw diverge, keep-together under-measures and re-orphans.
   `splitTextToSize` depends on the CURRENTLY-set font, so re-assert the row
   font right before the render loop (a prior `drawSectionHeading`/measure can
   leave bold/other size active).
3. **Related Incidents also reserves the Disclaimer** so the table + disclaimer
   land on the same page. Reserve the disclaimer's ACTUAL height via
   `measureDisclaimerHeight(ctx)` (wraps the real legal text at the real width)
   — never a fixed constant, which drifts if the text/margins change.
4. **Row-reduction fallback**: if heading + table + disclaimer can't fit even on
   a fresh page (`ctx.H - TOP - BOTTOM`), drop rows from the bottom and
   re-measure until it fits (loop down to 0).
5. Producer/Buyer Actions has its own `ensureSpace(30 + measuredTableH)` before
   its heading, with measure/draw kept in lockstep.

**Why:** users repeatedly hit a Fuel Watch PDF orphan (heading+header+1 row at
the bottom of page 3). The cause was always a measure/draw mismatch or no
up-front break, not the data.

## Which fuel export path to test (CRITICAL)

The in-app "Download PDF" for **fuel** goes through the jsPDF builder
`exportTopicReportPdf` (the `else` branch of `ReportEditor.downloadPdf`), NOT the
DOM-rasterise `exportElementToPdf`. Only `shipping`/`flashpoint`/`protests` use
the DOM-rasterise path. So the `report-data-provenance` note ("in-app PDF
rasterises the screen") is true for those topics but NOT fuel.

Faithful repro of the in-app fuel PDF = the headless script, which calls the
SAME jsPDF function:
`cd artifacts/workbench && REPORT_ID=<id> TOPIC=fuel OUT_PATH=/tmp/x.pdf npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts`
Inspect pagination with `pdfinfo` + `pdftotext -layout` (form-feed = page break;
the trailing form-feed shows a phantom extra page — trust `pdfinfo` page count).
Render with `pdftoppm -png -r 80` to eyeball. Difference from in-app: headless
reads prose from the DB (empty → topUp defaults), in-app uses the seeded editor
form; layout-equivalent for pagination.
