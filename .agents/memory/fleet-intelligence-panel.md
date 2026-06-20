---
name: Live Fleet Intelligence panel (Shipping monitor)
description: AIS-derived flags-of-registry + fleet-composition panel on the Shipping monitor, and the no-fabrication constraints that govern it.
---

The Shipping monitor's "Live Fleet Intelligence" panel is the legitimate, real-data
answer to the user's fury at fabricated vessel NAMES in design mockups. They wanted
the TYPE of information shown there (Top Flags of Registry, Fleet Composition by
vessel type, per-chokepoint counts, headline stats) — computed from REAL AIS data,
never invented.

How it works:
- Aggregates the SAME live AIS sightings the Live Vessel Map plots — it reuses
  `useListMaritimeVessels({maxAgeHours:24, limit:2000})` with the generated query
  key, so the two share one cache entry and there is NO extra fetch.
- Flag of registry derived ONLY from each vessel's MMSI (ITU MID = first 3 digits,
  leading digit 2–7). Unresolvable MMSI → counted as "flag not derivable", never
  guessed (`lib/maritimeMid.ts` `flagFromMmsi`).
- Fleet composition from the broadcast AIS ship-type only (tanker 80–89, cargo
  70–79, else "Other / not reported"). A precise bulk/container/LNG-LPG split is
  NOT possible from AIS alone — it needs the paid datalastic vessel-registry layer
  (`lib/ingest/src/vesselRegistry.ts`), which today fills only the 3 aggregate
  `maritime_movement` columns, nothing per-vessel.

**No-fabrication constraint (cost a code-review round):** the activity tiles
("At anchor / moored", "Under way") must show "—" (label "… — not reported") when
`navStatusReported === 0`, so an UNKNOWN activity split is never rendered as a
fabricated 0. The aggregator (`lib/fleetIntelligence.ts`) tracks navStatusReported
for exactly this gate.

**Impossible-from-this-data (told the user explicitly, do NOT add as fake):**
"Top Destinations" (AIS destination field is not stored) and multi-day transit/
crossing charts (sightings are pruned at 24h) cannot be built without new capture.

Files: `artifacts/workbench/src/components/FleetIntelligence.tsx`,
`artifacts/workbench/src/lib/fleetIntelligence.ts`,
`artifacts/workbench/src/lib/maritimeMid.ts`; wired into
`artifacts/workbench/src/pages/Shipping.tsx` after the Live Vessel Map card.

Data reality (2026-06): dev DB ~18–80 real AIS vessels, ALL Singapore Strait;
ship_type ~96% NULL so composition is thin until registry enrichment. Prod
`maritime_movement` is EMPTY because AIS_ENABLED=false (no prod ingest) — the panel
populates in prod only once AIS is enabled and the app republished.
