---
name: Red Sea directional-flow panel + new AIS theatre wiring
description: How the Red Sea crossings (inbound/outbound by heading) panel keeps monitor==preview==PDF parity, its honesty contract, and the full chain for adding a new AIS-tracked chokepoint theatre.
---

# Red Sea directional-flow panel & adding an AIS theatre

## Honesty contract (directional flow)
- inbound/outbound are the **heading split of each LIVE AIS sample** (vessel course relative to the gateway bearing), NOT completed transits. Never say "N ships crossed" — always "directional flow" / "by heading".
- A sample only becomes a bar group when BOTH inbound and outbound are non-null (a sample with no derivable direction is dropped, never drawn as a fabricated zero). A gateway with no such sample shows an honest empty state, not an invented baseline.
- Totals sum repeated snapshots, so the same vessel can recur across samples → label them "inbound/outbound **observations** across N AIS samples", never as a unique-vessel count.
- Bars: Outbound = Navy #0b0a3d, Inbound = Electric #465bff. NEVER red (#A33232 is Extreme-only). HTML/div grouped bars on screen + equivalent jsPDF rectangles — no recharts (html2canvas mangles SVG on rasterised PDFs).

## Parity (single source of truth)
- `artifacts/workbench/src/lib/maritimeDirectionalFlow.ts` is the ONE pure builder (`buildGatewayFlow`, `buildRedSeaDirectionalFlow`, `RED_SEA_GATEWAYS`, shared display constants). Monitor, report preview AND jsPDF all consume the SAME `GatewayFlowSeries[]` → screen==preview==PDF by construction.
- **Per-gateway fetch, not global**: the panel reads each gateway's history with `useListMaritimeMovement({theatre, limit:40})` (one query per gateway). The Maritime Intelligence BOARD reads the global movement pool (limit ~200, latest snapshot per theatre). These are different fetches — the headless PDF exporter MUST fetch per-gateway (theatre-scoped limit 40) for the flow panel too, or it diverges from the verified on-screen surfaces in a populated DB.
- `exportShippingReportPdf` takes `redSeaFlow?` and falls back to `buildRedSeaDirectionalFlow(movement)` when omitted, so the section is never silently empty when movement data exists.

## Adding a new AIS-tracked chokepoint theatre (e.g. Suez Canal)
Every surface must learn the theatre or it silently drops:
1. `lib/ingest/src/maritimeMovement.ts` `AIS_THEATRES` — bbox + inboundBearing + center + radiusNm.
2. `artifacts/workbench/src/lib/shippingAnalysis.ts` — `ChokepointKey` union + `CHOKEPOINTS` + `CHOKEPOINT_RULES`.
3. `artifacts/workbench/src/lib/maritimeIntelligence.ts` `BOARD_CHOKEPOINTS`.
4. `artifacts/workbench/src/components/VesselMap.tsx` boxes.
5. parity test expected titles (`__tests__/workbench/maritimeReportParity.test.ts`).
- The theatre STRING must match byte-for-byte across all of the above (the movement query filters by exact theatre name). No DB migration needed — `maritime_movement` rows are theatre-keyed by string.

**Why:** mirrors the flashpoint-apac-coverage chain — a single missed registration point makes the new theatre vanish from one surface while looking fine on the others.
