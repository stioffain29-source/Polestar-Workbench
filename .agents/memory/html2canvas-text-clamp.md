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
