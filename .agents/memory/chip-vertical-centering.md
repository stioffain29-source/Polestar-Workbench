---
name: Severity chip vertical centering (screen)
description: Why all-caps severity pills read off-center on screen, the correct CSS, and how to measure centering empirically.
---

# Severity chip vertical centering (on-screen pills)

All-caps severity chips (EXTREME/HIGH/...) in fixed-height pills read off-center
in ways that are easy to "fix" wrong.

**The trap:** `lineHeight` equal to the chip height (e.g. `lineHeight:"22px"`,
height 22) centers the font's *em-box*, not the visible glyphs. All-caps text has
no descenders, so the caps sit in the TOP of the em-box and the label reads HIGH.

**Wrong fix:** nudging down with asymmetric top padding (e.g. `padding:"7px 10px 0"`).
It overshoots — the label then reads LOW. (Box-model slope is ~0.5 device px of
caps-center movement per 1px of border-box top padding.)

**Correct fix:** `lineHeight:1` + SYMMETRIC vertical padding (`padding:"0 10px"`) with
`display:inline-flex; align-items:center`. The flex centering then centers the glyph
line box, and for `lineHeight:1` the cap-center ≈ line-box-center (verified ~0.4 px).

**Why PDF is decoupled:** the in-app country PDF rasterizes the on-screen DOM, but
`exportPdf.ts` (`applySeverityBadgeExportLayout`) overrides these badges to
`padding:0` + `lineHeight:height` (or swaps in a `<canvas>` with `textBaseline:middle`)
before html2canvas. So screen-only padding/lineHeight tweaks cannot regress the PDF.

**How to measure centering empirically (reusable):** Playwright screenshot of the
live chip at `deviceScaleFactor:6`, then ImageMagick to get the glyph bounding box:
`magick interior.png -colorspace Gray -threshold 55% -format "%@" info:` → `WxH+X+Y`.
Compare glyph-band center `Y+H/2` to the chip-crop center. Crop the chip interior
first so rounded-corner anti-aliasing and the surrounding white background don't
pollute the threshold. (A hand-rolled PNG decoder is error-prone — use ImageMagick.)
Range/getBoundingClientRect rects are unreliable for caps (they include descender
space), so trust the pixel trim, not Range rects.
