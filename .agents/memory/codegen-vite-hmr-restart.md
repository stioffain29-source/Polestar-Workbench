---
name: codegen breaks workbench HMR until restart
description: Running api-spec codegen while the workbench vite dev server is up leaves it in a broken hot-reload state; restart before e2e testing.
---

Running `pnpm --filter @workspace/api-spec run codegen` regenerates `@workspace/api-client-react` (and the zod lib). If the workbench vite dev server is already running, vite fails to hot-reload every page that imports the regenerated client and logs `Failed to reload /src/pages/*.tsx ... (see errors above)` in the browser console. The page then serves a partial/stale module graph — a real symptom seen: an e2e probe found the top of a page but the LAST panel was missing and `document.scrollHeight === innerHeight` (page not scrollable), as if rendering stopped partway.

**Why:** vite's HMR cannot reconcile a wholesale regeneration of a workspace dependency's barrel; the module graph is left inconsistent until a clean reload.

**How to apply:** after ANY codegen run (or lib change the workbench imports), `restart_workflow "artifacts/workbench: web"` (and the api-server) BEFORE screenshotting or running `runTest`. A green typecheck does NOT mean the running dev server is healthy — check browser console for `Failed to reload` lines, and restart rather than trusting a partial render.
