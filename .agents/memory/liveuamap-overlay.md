---
name: Liveuamap live-map overlay
description: How the paid Liveuamap live-event feed is wired as a cached server proxy + Leaflet overlay, and the constraints that keep it safe/cheap.
---

Liveuamap (liveuamap.com) live conflict-event points are shown as a SEPARATE Leaflet overlay on the Geospatial Map, fed by a cached server-side proxy. They are deliberately NOT ingested into the incidents DB / reports / relevance.

**Why not ingest:** Liveuamap's data API is PAID and licensed; mixing it into the curated incidents corpus would create licensing exposure and break the report preview/PDF parity model. It is a live reference layer only.

**Why a server proxy (not a direct browser fetch):** the API key is paid+metered and the workbench is intentionally PUBLIC (no auth). A browser fetch would leak the key; a naive pass-through would let anonymous traffic burn the paid quota.

**How to apply / invariants when touching it:**
- Key is `LIVEUAMAP_API_KEY` (global secret, shared dev+prod). Unset ⇒ the whole feature cleanly no-ops: the endpoint returns `configured:false, events:[]` and the UI shows "Live layer not configured yet." (mirrors the ReliefWeb optional-source pattern). Secrets are global, so once set, dev shows live data and prod shows it only AFTER a republish.
- Quota guard: the server cache is keyed by REGION ONLY. It always fetches the max page per region and slices to the requested `count`; the public `count` must never widen the cache key or it multiplies paid upstream calls. Regions are an allowlist of ~24 APAC/ME slugs → numeric resid ids; invalid region/count are Zod-rejected (400) before any paid call. In-flight coalescing + TTL (12m fresh) + stale-on-error (60m) + short fail cache (3m).
- Cache is in-memory per instance, so autoscale multiplies upstream calls by instance count (bounded to ~24 regions/12m each). Acceptable for low traffic; a shared cache would be needed only if quota gets tight.
- Untrusted upstream: treat every field as hostile. `link` is sanitised server-side to http/https only (`safeUrl`) because it is rendered into `<a href>` (javascript:/data: would be an XSS sink). Keep only rows with finite in-range lat/lng and a non-empty name.
- Contract-first: the route lives behind the OpenAPI spec (`/liveuamap/events`, schemas LiveuamapRegion/Event/EventsResponse) → codegen → Zod-validated route + `useListLiveuamapEvents` hook. Markers use brand Electric Blue #4655FF (no shadows/blurs/neon/gradients).
