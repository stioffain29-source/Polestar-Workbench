---
name: Live-prod report + PDF acceptance proof
description: How to produce screenshots and screen-faithful PDFs from the LIVE production URL (not dev) when an acceptance pass refuses dev proof.
---

# Live-production report/PDF proof

Unless the owner explicitly says development-only, a requested fix means the
published production application and its live data, not merely workspace code.

**Why:** repeated development-only fixes were described as complete while the
owner was still seeing the unchanged published PDF.

**How to apply:** do not say "fixed" or "done" until the production route and,
for report work, the downloaded production PDF have been verified. If publishing
or production authentication remains user-controlled, state that boundary before
claiming completion.

When an acceptance pass demands proof from the **published** app (refuses dev), the in-app
"Download PDF" must be driven against the production URL in a real browser — `runTest` targets
dev/localhost, and `screenshot external_url` only captures the cover (no scroll, no button click).

**Method that works:**
- Get the prod URL from `getDeploymentInfo().primaryUrl` (never `$REPLIT_DOMAINS` — that's dev).
- Launch Playwright (`require("playwright")`, resolvable in workspace) with
  `executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` and `args:["--no-sandbox"]`.
- `context({ acceptDownloads: true })`; goto the report route, wait for `.print-report`.
- Full-page screenshot, then `Promise.all([page.waitForEvent("download"), button.click()])` on the
  **Download PDF** button; `download.saveAs(...)`.
- Verify screen==PDF by rasterising PDF page 1 with `pdftoppm -png -f 1 -l 1` and eyeballing it
  against the screenshot — they match because Download PDF rasterises the on-screen `.print-report`.

**Why:** screen==PDF is architectural (in-app export rasterises the DOM), so the only thing left to
prove for acceptance is that the *production* screen renders correct, current data — hence drive the
prod URL directly.

**How to apply:** routes are `/reports/:id` (topic reports, e.g. Flashpoint topic=protests) and
`/countries/:slug` (country reports). Topic report PDFs come from the right-hand preview pane's
`.print-report`; country pages render `.print-report` directly. Prod ingest is the token-gated
`POST /api/admin/ingest`; prod DB is read-only replica (`executeSql environment:"production"`).
