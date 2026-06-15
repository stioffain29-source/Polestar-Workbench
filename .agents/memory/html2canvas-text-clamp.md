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
