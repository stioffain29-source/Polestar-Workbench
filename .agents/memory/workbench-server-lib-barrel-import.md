---
name: Workbench client importing a server-lib ROOT barrel
description: Why the workbench crashes with "Buffer is not defined" and how to import server-lib helpers safely into the browser
---

# Client must never import a server lib's ROOT barrel

**Rule:** the workbench (browser/Vite) client must NEVER import from a
server-side lib's PACKAGE ROOT (e.g. `from "@workspace/ingest"`). Import only a
dedicated SUBPATH export that points at a PURE module
(e.g. `from "@workspace/ingest/optionalIntegrations"`).

**Why:** `@workspace/ingest`'s root barrel (`src/index.ts`) re-exports dozens of
modules, many of which transitively import `@workspace/db` (→ `drizzle-orm/node-postgres` + `pg`), `rss-parser`, `exceljs`, and the OpenAI client. Vite's dev
optimizeDeps pre-bundles the WHOLE package entry with NO tree-shaking, so even
importing one tiny symbol from the root drags `pg` into the browser bundle.
`pg`'s `postgres-bytea` references the Node-only `Buffer` global, producing a
hard runtime crash: `Error: Buffer is not defined` (accompanied by Vite
"Module stream/events/timers has been externalized for browser compatibility"
warnings). A production Rollup build might tree-shake it away, but dev crashes.

**How to apply:** when the client needs a helper that lives in a server lib,
add a leaf/subpath entry to that lib's `package.json` `exports` map pointing at
a self-contained PURE module (mirror the existing `./pngExtract`,
`./westPapuaExtract`, `./structuredExtract`, `./optionalIntegrations`,
`./markers` entries), then import via the subpath. Never add the symbol to a
client file via the root barrel. The comment atop
`artifacts/workbench/src/lib/incidentTitle.ts` already warns that `@workspace/db`
cannot be pulled into the client — the same hazard.

**Recurrence:** the GDELT idempotency-marker helpers (`markerExternalId`,
`promoteMarker`, `PROMOTE_MARKER_PREFIX`) are pure strings but originally lived
in the db-heavy `gdeltPromote.ts`, so a client `import { markerExternalId } from
"@workspace/ingest"` in `CountryReport.tsx` re-crashed the app. They now live in
the dependency-free `lib/ingest/src/markers.ts` (subpath `@workspace/ingest/markers`),
re-exported from `gdeltPromote.ts` for server consumers. Client code needing any
marker helper MUST import from `@workspace/ingest/markers`, never the root.
Symptom that it regressed: Vite dev-log "optimized dependencies" line lists
`pg`/`drizzle-orm`/`postgres` — those must never appear for the client.
