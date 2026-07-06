---
name: Owner-gated UI verification
description: How to visually/behaviourally verify owner-private workbench pages when app_preview and the testing skill cannot authenticate.
---

The workbench is owner-private via Replit Auth (OIDC). The `app_preview` screenshot proxy carries NO owner session, so any `/countries/*`, report, or monitor page screenshots as the login wall. The testing skill's Playwright runner can override **Clerk** auth only — NOT Replit Auth — so it cannot drive these pages either.

**Why:** every data router is behind `requireOwner`; the SPA also gates client-side. There is no in-environment way to mint an owner session for the proxy/test browser.

**How to apply:** verify owner-gated UI/PDF work WITHOUT a live authenticated screenshot:
- Render React bodies headlessly with `renderToStaticMarkup` in a jest/tsx test (section order, tables, prose) — this is the screen==PDF contract because the in-app PDF rasterises the same DOM.
- Use the headless PDF audit scripts (e.g. `auditJakartaPdf.ts`, `validateFonts.sh`) for 3-way section parity + the only-Roboto font gate; they read Postgres directly (mirror the API shape) instead of hitting the owner-gated `/api`.
- Pin pure model/builder logic with unit tests.
- The Leaflet map + its numbered-zone legend + caption rasterise into the PDF as ONE html2canvas image, so `pdftotext` is blind to legend/caption text — you cannot grep the exported PDF to verify them. Instead `renderToStaticMarkup(<CountryReportMap …>)` in a jsdom test: import the component by RELATIVE path (the jest `@/components/CountryReportMap` mapper stubs the alias), and `renderToStaticMarkup` skips the `useEffect` so Leaflet never mounts, yet the legend/caption JSX still renders for assertion (tooltip `title` attrs live in the effect, so they are diff-inspection only).
- Treat the missing live screenshot as an accepted, documented verification gap — pass `skip_validation_reason` for env-blocked e2e rather than burning attempts on the login wall.
