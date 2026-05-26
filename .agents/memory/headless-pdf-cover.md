---
name: Headless PDF cover embedding
description: prepareCoverImage uses DOM Image + canvas; in headless tsx exports it must fall back to a raw-bytes data URL so the cover photo is actually embedded.
---

`prepareCoverImage` in `src/lib/pdfChrome.ts` uses `new Image()` + `<canvas>` to cover-fit-crop the hero photo before handing it to `jsPDF.addImage`. Neither global exists in the Node tsx export runner, so without a Node branch the exporter throws "Image is not defined", silently falls back to the gradient hero, and the published PDF ships without its cover photo.

**Why:** the headless export (`scripts/exportReportPdfHeadless.ts`) shares the same library code as the browser preview by design — preview/PDF parity is a hard rule in `replit.md` — so the fix must live in `prepareCoverImage`, not in a separate Node-only exporter path.

**How to apply:** branch on `typeof Image === "undefined" || typeof document === "undefined"`. In the Node branch, fetch the URL, read the blob as a Buffer, sniff PNG vs JPEG by magic bytes (PNG starts `89 50 4E 47`), and return `{ dataUrl: data:<mime>;base64,<b64>, format }`. jsPDF.addImage with explicit slot W/H will stretch the raw image to fit — acceptable because the registered cover assets are already near-16:9 and the slot is sized accordingly. Cover-fit-crop quality is only available in the browser preview path.

Confirm by running `pdfimages -list <pdf>`; the cover JPEG should appear as a page-1 image object with non-trivial dimensions (a typical hero is ~1300×230 after the slot scale).
