---
name: Incident read cache invalidation
description: Why incident API responses must bypass conditional browser caching when relevance status changes.
---

Incident-list responses must not use conditional browser caching. Relevance
backfills alter which stored rows qualify without changing incident creation
timestamps, so an old ETag can return 304 and preserve rejected incidents in the
map and other live surfaces.

**Why:** Production rows were correctly reclassified as irrelevant, but the
owner still saw them because the browser received a 304 and reused its previous
incident payload.

**How to apply:** Keep ETags disabled for the operational API and send incident
reads with no-store semantics. After relevance cleanup, verify authenticated
incident requests return 200 and verify the affected production rows directly.