---
name: AIS provider cost switch (Datalastic off, AISStream on)
description: Why the paid Datalastic satellite feed is disabled, the free-feed coverage trade-off, and how the provider decision is wired.
---

# AIS provider: free AISStream is active, paid Datalastic is kill-switched off

The PAID Datalastic satellite-AIS feed is disabled via its kill-switch
`VESSEL_REGISTRY_ENABLED=false`. Maritime vessel-movement collection falls back
to the FREE aisstream.io terrestrial feed, which is the active provider.

**Why:** Datalastic continuous monitoring was too expensive. The switch is
cost-for-coverage, accepted deliberately.

**Coverage trade-off (expected, NOT a bug):** the free terrestrial feed cannot
see the Middle-East chokepoints — Strait of Hormuz / Gulf returns ZERO vessels,
Bab el-Mandeb / Red Sea / Gulf of Aden likewise. Those movement panels (Fleet
Intelligence, VesselMap, Red Sea directional flow) must degrade honestly to
"not reported" (no fabrication). Only Asian straits (Singapore, Malacca, etc.)
sample, and even there sparsely over short collect windows. The incident-driven
Hormuz "Chokepoint Status" panel reads NEWS, not AIS, so it is unaffected.

**How the decision is wired:**
- `VESSEL_REGISTRY_ENABLED` is BOTH the Datalastic registry kill-switch AND the
  movement collection-source switch. `useDatalastic = registry.configured &&
  registry.enabled && provider==="datalastic"`. With it off (or no
  `VESSEL_REGISTRY_API_KEY`), collection uses aisstream and the cargo-type split
  (bulk/container/LNG-LPG) is skipped → columns stay NULL.
- The aisstream credential resolves from `AIS_API_KEY` OR `AISSTREAM_API_KEY`
  (shared `resolveAisKey()` in `@workspace/ingest`). The credential was first
  provisioned under `AISSTREAM_API_KEY`; accepting both avoids a duplicate
  secret. Every AIS read site (collector, `isAisConfigured`, scheduler
  `aisMovementActive`, runner empty-summary, `maritimeSources.aisEnv`) goes
  through it, so they never disagree on "is AIS configured".
- Source Health → External Integrations: `ais_movement` "Provider" metric shows
  the active provider (`aisstream`); `vessel_registry` reads `disabled`.

**Re-enable Datalastic later:** set `VESSEL_REGISTRY_API_KEY` and
`VESSEL_REGISTRY_ENABLED=true` (provider `datalastic`). Code was left in place
behind the kill-switch precisely for this.
