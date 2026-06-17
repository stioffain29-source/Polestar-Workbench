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

**External IP block (the real-world gotcha):** the integration code + endpoint/auth format are CORRECT (verified against Liveuamap's official C# example: `a=mpts&resid&time&count&key`), but `liveuamap.com` sits behind Cloudflare and returns a **403 HTML "your IP has been identified for automatic behavior" page to the entire Replit/GCP egress IP** — not just the API path (`liveuamap.com`, `asia.liveuamap.com`, and `a.liveuamap.com/api` all 403). A browser User-Agent does NOT get past it; it is an IP-reputation/ASN block, not a UA or key problem. Do NOT try to evade their anti-bot (ToS + ethics). Resolution is on Liveuamap's side: the account owner must ask Liveuamap support to whitelist the server's public egress IP (their 403 page says to email them the public IP). Dev and prod have DIFFERENT egress IPs (both likely GCP datacenter ranges, so prod may also be blocked) — after republish, test prod and, if still 403, send Liveuamap the prod IP too.
- The UI fails EXPLICITLY (core principle, not a silent empty): a successful fetch always sets `fetchedAt`; a failed one leaves it null. So `configured && !fetchedAt` ⇒ sidebar shows "Live layer temporarily unavailable" instead of a misleading "0 live events". Keep that invariant (don't set `fetchedAt` on the error path in `getLiveuamapEvents`).
