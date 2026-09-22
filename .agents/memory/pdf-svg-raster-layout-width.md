---
name: PDF SVG rasterisation width
description: Why percentage-width SVG charts lost their right-hand edge in exported PDFs, and the rule for sizing the replacement canvas.
---

Before html2canvas captures a report chart, each inline <svg> is swapped for a browser-drawn <canvas>. That canvas must be sized to the SVG's LAID-OUT box (getBoundingClientRect), not its viewBox units.

**Why:** a chart authored as viewBox="0 0 640 240" width="100%" lays out at the export host's width (~515px). Sizing the replacement canvas to the 640-unit viewBox made it wider than the capture frame, and html2canvas silently cropped the overflow — the newest data point, the final axis tick and part of the header vanished from the exported chart while the on-screen preview looked correct. The clipping is inside the raster, so marker/placement maths looks innocent; measure the embedded image width against the column width to spot it.

**How to apply:** fall back to viewBox/attribute size only when the element has no measurable box. Always pin the cloned SVG's width/height attributes before serialising it to a data URL — a percentage width has no intrinsic size once loaded as an Image. An opt-in scale scope keeps its own contract; everything else follows the laid-out box so preview == PDF.
