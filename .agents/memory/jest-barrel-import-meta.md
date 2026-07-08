---
name: jest barrel import.meta breakage
description: Why every ts-jest suite importing the @workspace/ingest barrel can suddenly "fail to run" with an import.meta SyntaxError.
---

# Barrel re-export of an `import.meta` module breaks ALL ts-jest suites

If a barrel (e.g. the `@workspace/ingest` root `src/index.ts`) re-exports a module
that uses `import.meta` (e.g. a dev-env loader doing
`fileURLToPath(import.meta.url)` for workspace-root resolution), then **every**
jest suite that transitively imports that barrel fails to LOAD with:

```
SyntaxError: Cannot use 'import.meta' outside a module
```

The suite never runs a single test — it dies at parse/transform time.

**Why:** `tsconfig.base.json` sets `module: esnext`; the `ts-jest` preset
(`createDefaultPreset`) transforms TS with that config and emits `import.meta`
literally, but jest's `testEnvironment: node` runs CommonJS, where `import.meta`
is a parse error. Dev (`tsx`/ESM) and the esbuild api-server build are unaffected
— only jest. So a **green typecheck and a healthy dev server do NOT imply green
jest**; a barrel change can silently break the whole jest suite.

**How to apply:**
- Symptom: a batch of previously-passing jest suites all start "failing to run"
  with `import.meta` after an unrelated change — look for a newly-added
  `import.meta`-using module that got pulled into a barrel everything imports.
- Fix at the source: keep `import.meta`-using dev helpers OUT of the root barrel
  (expose via a subpath export only), or make the path resolution CJS-safe
  (e.g. walk up from `process.cwd()` to find `pnpm-workspace.yaml` instead of
  `import.meta.url`).
- This is the jest-side sibling of the browser-side barrel hazard (a barrel that
  pulls `pg`/`drizzle` into the browser bundle). Same lesson: barrels leak their
  heaviest/most-environment-specific transitive dependency to every importer.

## Sibling pre-existing failure: generated Orval query-key `is not a function`

`__tests__/workbench/reportEditorPreviewRenders.test.tsx` and
`reportEditorPreviewLayout.test.tsx` fail (all ~18 cases, EVERY topic) with
`TypeError: (0 , api_client_react_1.getListMarketPricesQueryKey) is not a function`.
This is a PRE-EXISTING harness issue, not any report/preview change: it hits
flashpoint identically to shipping/energy/etc. because `ReportEditor` calls the
market-prices hook regardless of topic.

**Why:** the generated `@workspace/api-client-react` client defines
`export const getListMarketPricesQueryKey = () => …` and references it in the same
generated module graph; under ts-jest's CJS interop a circular import leaves that
binding `undefined` at call time (TDZ-style) → "not a function". Typecheck is
green (the export exists) and dev/prod are fine — jest only.

**How to apply:** if you touch a topic report and see this error, do NOT chase it
as your regression — confirm `git status` shows `lib/api-client-react` +
`ReportEditor.tsx` clean, then rely on the per-topic `bespokeReport*` /
`renderToStaticMarkup` suites (which import the preview directly, not through the
market-prices hook) to validate your change.
