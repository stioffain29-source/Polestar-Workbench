---
name: jest route-test harness gotchas
description: Two non-obvious traps when unit-testing an Express route in isolation in this repo — a missing req.log, and shared helper files run as empty suites.
---

# Testing an Express route on a bare app

When a suite mounts a single router on a hand-built `express()` app (e.g.
`countryProseRoute.test.ts` does `app.use(express.json()); app.use(router)`),
two repo-specific traps appear:

## 1. `req.log` is undefined → HTML 500 → `res.json()` SyntaxError

Route handlers log via `req.log` (the repo convention — pino-http attaches it in
the REAL api-server, never `console.log`). A bare test app has no pino-http, so
`req.log` is `undefined`; the first `req.log.warn(...)` throws, Express returns
its default **HTML** error page, and the test's `await res.json()` dies with
`SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

**Tell-tale:** only the ONE test that exercises a logging branch (often the
error/degraded path) fails; the happy-path and early-return tests pass because
they never reach a `req.log.*` call. The failure surfaces in the test, not the
server, so the stack trace points at `JSON.parse`, not the route.

**Fix (harness, not route):** insert a no-op logger before the router:
```ts
app.use((req, _res, next) => {
  (req as unknown as { log: Record<string, () => void> }).log = {
    info() {}, warn() {}, error() {}, debug() {},
  };
  next();
});
```
The route itself is correct — do NOT remove the `req.log` call to make the test
pass.

## 2. Shared `*TestHelpers.ts` run as empty suites

`testMatch` is `**/__tests__/**/*.ts?(x)`, so a non-test helper living next to
suites (e.g. `__tests__/api-server/adminAuthTestHelpers.ts`, which only exports
`TEST_ADMIN_TOKEN` / `adminAuthHeaders`) is discovered as a suite and fails with
"must contain at least one test." Keep it importable but undiscovered by adding
`"/__tests__/.*TestHelpers\\.ts$"` to `testPathIgnorePatterns` in
`jest.config.js`. Ignore patterns gate suite DISCOVERY only — imports still
resolve, so the helper keeps working for the suites that import it.

**Why:** these are easy to misread as a route bug or a broken import. Both are
harness gaps; the production code is fine.
