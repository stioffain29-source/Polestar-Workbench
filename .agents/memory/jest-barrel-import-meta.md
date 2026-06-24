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
