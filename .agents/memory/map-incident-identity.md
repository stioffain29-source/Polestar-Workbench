---
name: Map incident identity
description: How corroborating news records should appear on the main incident map.
---

The main map must render one marker per distinct real-world event, not one marker per publisher or source record. Multiple sources remain attached to that marker as corroborating evidence.

**Why:** The owner explicitly confirmed that multiple sources are valuable for verification but duplicate map spots for one incident are not. Article-count markers overstate incident volume and make fallback-location clusters misleading.

**How to apply:** Consolidate same-event records before geographic clustering. Prefer authoritative event-cluster identifiers, then conservative same-story matching scoped by topic and country. Never deduplicate by coordinates, because unrelated unresolved incidents legitimately share fallback locations. Preserve every source URL on the representative marker.