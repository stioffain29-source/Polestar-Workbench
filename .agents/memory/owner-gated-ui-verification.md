---
name: Owner-gated UI verification
description: Verify owner-private pages without weakening authentication; screenshots have no session, but controlled development OIDC tests are supported.
---

The workbench is owner-private via Replit Auth (OIDC). The `app_preview` screenshot proxy carries NO owner session, so any `/countries/*`, report, or monitor page screenshots as the login wall. Current testing guidance supports Replit OIDC claim overrides; consult `.local/skills/testing/replit-auth.md` rather than assuming only Clerk is supported. An arbitrary test account still does not pass the workbench's owner gate.

**Why:** every data router is behind `requireOwner`; the SPA also gates client-side. Authenticating a test identity is distinct from authorising it as owner. Never weaken the production gate or reuse owner credentials to make a screenshot pass.

**How to apply:** use controlled development-only claims when full OIDC testing is necessary. Otherwise verify owner-gated UI/PDF work without claiming a live authenticated screenshot:
- Render React bodies headlessly with `renderToStaticMarkup` in a jest/tsx test (section order, tables, prose) — this is the screen==PDF contract because the in-app PDF rasterises the same DOM.
- Use the headless PDF audit scripts (e.g. `auditJakartaPdf.ts`, `validateFonts.sh`) for 3-way section parity + the only-Roboto font gate; they read Postgres directly (mirror the API shape) instead of hitting the owner-gated `/api`.
- Pin pure model/builder logic with unit tests.
- The Leaflet map + its numbered-zone legend + caption rasterise into the PDF as ONE html2canvas image, so `pdftotext` is blind to legend/caption text — you cannot grep the exported PDF to verify them. Instead `renderToStaticMarkup(<CountryReportMap …>)` in a jsdom test: import the component by RELATIVE path (the jest `@/components/CountryReportMap` mapper stubs the alias), and `renderToStaticMarkup` skips the `useEffect` so Leaflet never mounts, yet the legend/caption JSX still renders for assertion (tooltip `title` attrs live in the effect, so they are diff-inspection only).
- Treat the missing live screenshot as an accepted, documented verification gap — pass `skip_validation_reason` for env-blocked e2e rather than burning attempts on the login wall.
- Route round-trip suites that assert the admin-token gate (401/503) MUST call `enableTestAdminToken()` in a `beforeEach`, not just `beforeAll`: the global `jest.setup.ts` beforeEach runs `clearIntegrationEnv()` which wipes `INGEST_ADMIN_TOKEN` before every test, so a one-time beforeAll leaves the gate unconfigured → every request 503s.

Controlled OIDC testing with a temporary authorised development identity was confirmed to work on 2026-09-22. Do not treat the earlier Clerk-only limitation as current.

**Why:** The current test runner can supply development OIDC claims, but an authenticated synthetic identity still needs the separate owner authorisation. This permits realistic editing tests without using the owner's credentials or changing the production access rule.

**How to apply:** Follow the current Replit Auth testing guidance, grant only the temporary test identity the necessary development role, and use a separate temporary edition for mutations. Remove exactly those test records and sessions afterwards, and restore the normal issuer configuration. A plain app-preview screenshot still shows the login wall.

Two traps when driving the owner-gated SPA with a synthetic session:

- The stored session's user object must carry EVERY field of the API's auth-user contract, including the nullable image field. Omit one and the current-user endpoint fails schema validation and returns 500, so the SPA renders the login wall even though the cookie, user row and owner flag are all correct. Symptom to recognise: API routes accept the same cookie happily while only the browser looks logged out.
- Long Workbench pages defeat text-based assertions: Playwright `innerText` and `text=` locators can miss panels far down the page that are genuinely present in the DOM. Assert on `page.content()` or `page.evaluate` over `document.querySelectorAll`, and click by walking the DOM. A panel "missing" from `innerText` on a long page is a harness artifact — check the served module and the HTML before concluding the component does not render.
