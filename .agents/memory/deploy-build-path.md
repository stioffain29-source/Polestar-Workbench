---
name: Deployment build path (Cloud Run, application router)
description: What the publish build actually runs, so build-failure debugging looks in the right place.
---

The Cloud Run publish build for this repo does NOT run the root `pnpm run build`.
It runs each artifact's own `[services.production.build]` from `.replit-artifact/artifact.toml`:
- workbench → `vite build` (needs PORT+BASE_PATH from its `[services.env]`; BASE_PATH is baked into asset URLs)
- api-server → esbuild (`node ./build.mjs`), NODE_ENV=production
- mockup-sandbox → has NO `[services.production]` section, so it NEVER builds in prod (dev-only Canvas)

**Why:** debugging a failed publish by running root `pnpm -r --if-present run build` is a RED HERRING —
it fails at mockup-sandbox's `vite.config.ts` PORT throw, which the deploy never triggers. `.replit`
`[deployment]` has only `postBuild` (store prune), no root `build` hook.

**How to apply:**
- Get the REAL error from `getDeploymentBuild({buildId})` (via deployment skill callbacks in code_execution), not local reproduction.
- Reproduce a suspected artifact build with its exact toml command+env, e.g.
  `PORT=22653 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/workbench run build`
  `NODE_ENV=production pnpm --filter @workspace/api-server run build`
- api-server esbuild bundles `@workspace/ingest` from SOURCE via relative `../../lib/ingest/src/...` paths
  and does NOT run tsc. So a green `pnpm run typecheck` (which rebuilds lib dist) can still hide a wrong-name
  import that the deploy esbuild rejects ("No matching export ... for import X"). Verify by running the actual
  production build command, not just typecheck.
- Deploy builds the current workspace tree (committed HEAD), so a fix committed after a failed publish just
  needs a re-publish; check `git log -- <file>` vs the failed build's commit before assuming code is still broken.
