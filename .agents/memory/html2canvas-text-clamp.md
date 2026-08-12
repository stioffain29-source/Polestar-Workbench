---
name: html2canvas text clamp/clipping
description: Why line-clamped text shears in html2canvas DOM-rasterised exports (card PNGs) and the clamp recipe that survives it.
---

# html2canvas text clamping shears glyphs

**Symptom:** text exported via html2canvas (the card-builder MasterCard PNG, any
DOM-rasterise export) is clipped mid-letter while the same DOM looks fine in the
browser preview.

Two distinct failure modes, in order of discovery:

1. `display:-webkit-box` + `-webkit-line-clamp` is **unsupported by html2canvas**
   — it renders the box as a legacy flexbox and vertically **centre-clips** the
   text (slices letters in half top *and* bottom). Never use line-clamp for
   anything that will be rasterised.

2. Plain `overflow:hidden` + `maxHeight` still **bottom-shears** every clamped
   block (and even single lines), because html2canvas renders text a few px
   **lower** than the browser. A clip edge flush with the last line (maxHeight ==
   exactly N*lineHeight, or a single-line block whose height == one line) cuts
   the glyph bottoms/descenders. Tell-tale: in the export, *every* clamped
   element shears while *every* non-clamped element is perfect.

**Recipe that survives html2canvas** (`clampLines` in MasterCard.tsx):
```
display: "block",
overflow: "hidden",
boxSizing: "content-box",   // so maxHeight bounds content only, pad is extra room
lineHeight,
maxHeight: `${lines * lineHeight}em`,
paddingBottom: "0.3em",     // drops the clip edge below descenders
```
**Why 0.3em:** the observed shear was ~25–30% of a line, so the html2canvas
vertical offset is large at card font sizes; smaller buffers regress.

**Known trade-off (accepted):** with content-box the pad lives inside the visible
overflow window, so genuinely *overflowing* content (an N+1th line) can peek a
thin sliver into the 0.3em pad. Only happens on content longer than the cap
(analyst-controlled, concise by design) — far better than mid-letter shearing.
If it ever matters, switch card text to deterministic pre-render text-fitting
rather than CSS clamping.

**How to verify:** drive the live page with Playwright + the app's *own*
html2canvas build (`node_modules/.pnpm/html2canvas@1.4.1/.../html2canvas.min.js`,
injected via `addScriptTag({content})`), clone the 1080x1350 card, rasterise at
scale 1, and *view the PNG*. Preview screenshots alone will NOT reveal the shear
— it is html2canvas-specific.

## Third failure mode: badge/chip text renders vertically off-centre

Same root cause (html2canvas draws text low), different symptom. A small coloured
severity **chip** (the Spot Report risk-rating badge) that is perfectly centred
on screen renders with its label sitting LOW in the box in the exported PDF —
big colour gap above the text, almost none below. CSS centering does NOT survive:
`line-height == box-height`, flex `align-items:center`, padding tweaks all fail
because html2canvas ignores them and still draws the glyph baseline low.

**The only deterministic fix is to NOT let html2canvas lay out the text** —
replace the chip with a real `<canvas>` at export time. The browser draws the
canvas bitmap with `ctx.textBaseline = "middle"` + `fillText(text, w/2, h/2)`
(pixel-perfect both axes), and html2canvas rasterises the canvas bitmap verbatim.
This is exactly what the country-report TABLE chips already do (`severityChip()`
in exportPdf.ts). The pattern: tag the on-screen chip span with a data attribute
(e.g. `data-sev-chip` + label/color), and in `applySeverityBadgeExportLayout`
`node.replaceWith(canvasChip)` for tagged nodes BEFORE the generic span-restyle
loop so they aren't double-processed. Scope by the data attribute so other
reports' badges are untouched.

**Why this is the right call, not CSS:** the in-app "Download PDF" rasterises the
`.print-report` DOM, so the only stable text in an html2canvas export is text it
doesn't lay out (canvas bitmap or pre-rendered image). Reach for canvas whenever
exact text placement matters in a rasterised export.

**Match on-screen size** so preview==PDF parity holds: replicate the chip's
fontSize / letter-spacing / padding / height / border-radius in the canvas. Set
`ctx.letterSpacing` (feature-detect with `"letterSpacing" in ctx`) BEFORE both
`measureText` (to size the box) and `fillText`. NOTE `canvas.width=`/`height=`
RESETS all ctx state — re-apply scale, font, letterSpacing, fillStyle, align,
baseline after sizing.

## There are TWO html2canvas rasterise paths — each needs its own canvas swap

The `.print-report` DOM-rasterise path (`applySeverityBadgeExportLayout` in
exportPdf.ts) is NOT the only html2canvas surface. Report *chart/graphic* embeds
go through a SEPARATE path — `embedChartMarkupInPdf` in `embedReportChartInPdf.ts`
— which renders a React component into an off-screen host and html2canvases it.
The exportPdf.ts canvas mechanism does NOT run on this path, so chips inside
embedded graphics stay low even after the .print-report path was "fixed".

Concretely: the **cargo pattern graphics** (`CargoSupplyChainExposure`,
`CargoPatternDashboard`, `CargoActivityMatrix`) render `SevChip`/`TagChip`
(CargoGraphicPrimitives.tsx) and numbered stage markers via this embed path. The
fix is a `rasteriseChipsToCanvas(host)` pass inside `embedChartMarkupInPdf`, run
AFTER `document.body.appendChild(host)` + `await waitForFonts()` and BEFORE
`html2canvas`. Tag each pill `[data-raster-chip]` (+ label/bg/fg/font/weight/
radius/tracking/upper attrs) and each numeral `[data-raster-numeral]`; the pass
measures `getBoundingClientRect`, builds a size-matched `<canvas>`
(`textBaseline:"middle"`, rounded-rect for pills / circle for numerals), copies
margins + `flex:0 0 auto`, and `replaceWith`s it. Data-attr scoping makes it a
pure no-op for every non-cargo report sharing embedReportChartInPdf.

Screen side: give those same primitives `display:inline-flex; align-items/
justify-content:center; lineHeight:1` (per chip-vertical-centering.md) so screen
stays centred and preview==PDF holds.

**The jsPDF-NATIVE badges were already fine.** The incident-card "SEVERITY: X"
badges in `drawSelectedIncidents` (exportTopicReportPdf.ts) are drawn with jsPDF
`pdf.text`, NOT html2canvas, and their hand-tuned baseline sits ~0.15pt high of
centre — visually correct. A stale PRODUCTION pdf can show ALL badges low while
current code only has the html2canvas ones low; regenerate from current code via
the harness before concluding which path is actually broken.

**Chart-embed host clip (Aug 2026):** when the LAST element of an `embedChartMarkupInPdf` host is a bare text line (e.g. the jet fuel chart's "N observations…" caption), the low-drawn glyphs fall below the measured canvas height and the PDF shows the line sliced in half. Fix lives in the shared host: `padding-bottom` on the offscreen host in embedReportChartInPdf.ts (canvas height includes it, pagination unaffected). Verify via the real-DOM harness — `TOPIC=fuel npx tsx scripts/verifyEnergyMarketPricesPdf.ts` drives the fuel branch too (output filename says FertiliserWatch, cosmetic only).
