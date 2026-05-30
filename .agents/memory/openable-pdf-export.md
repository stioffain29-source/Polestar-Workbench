---
name: Openable, screen-matching PDF export
description: How to produce client PDFs that open everywhere AND match the on-screen report window
---

# Openable PDFs that match the screen

The jsPDF headless builders (`exportReportPdfHeadless.ts`) have TWO defects for client delivery:
1. **Won't open** — jsPDF emits CID TrueType fonts with `Adobe-Identity-H`; poppler/macOS Preview/some browsers error "Unknown character collection 'Adobe-Identity-H'" and render blank.
2. **Wrong window** — they build the report for the window ending at the report's `issueDate` (the week BEFORE), while the on-screen React preview recomputes to the current window (issueDate→today). Result: PDF shows last week, screen shows this week — a screen≠PDF violation.

**Working method:** render the live page with headless Chromium and use `page.pdf()` (Skia/PDF). This captures the exact on-screen `.print-report` DOM → current window, and Skia PDFs open everywhere with selectable text.

**Why:** the on-screen preview is the source of truth for the data window; rasterising/printing the DOM inherits it for free, exactly like the in-app "Download PDF" button (html2canvas path).

**How to apply:** `artifacts/workbench/scripts/exportReportPdfBrowser.mjs`.
- Chromium is NOT usable via `npx playwright install` here — the bundled headless shell is missing `libglib-2.0.so.0`. Use the **system Nix chromium** via `executablePath` (env `CHROMIUM_BIN`, e.g. `/nix/store/<hash>-chromium-*/bin/chromium`; the hash changes — resolve with `ls /nix/store | grep chromium-`). Launch with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`.
- Before `page.pdf()`, the editor's two-pane layout (fixed height + `overflow-hidden` preview card at `ReportEditor.tsx`) clips output to ONE page. Fix: in `page.evaluate`, clone `.print-report` into a clean `document.body`, set html/body `height:auto;overflow:visible`, and inject `overflow:visible !important;max-height:none !important` on `.print-report *`. Then pagination flows correctly (Flashpoint→7pp, Shipping→5pp).
- Verify with `pdfinfo` (Producer `Skia/PDF`), `pdftotext` (reporting period shows current week), and grep for last-week dates to confirm zero leakage.
