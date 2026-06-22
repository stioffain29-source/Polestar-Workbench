---
name: Fuel Tracker disruption panel
description: The fuel monitor leads with a curated analyst disruption panel (own dataset) above the live price feed; how to treat it and the aviation-fuel relevance precision rule.
---

# Fuel Tracker disruption panel

The fuel monitor (`/topics/fuel`) has TWO distinct layers, by design:

1. A curated **analyst disruption panel** (`FuelDisruptionPanel`, fed by
   `SOUTH_ASIA_FUEL_ALERT` in `artifacts/workbench/src/lib/fuelDisruptionAlert.ts`)
   that leads the page ABOVE the KPIs/market prices.
2. The **live FRED price feed** (`runMarketPricesIngest`) below it.

**Why:** the page used to be only oil prices; the analyst brief is the operational
fuel-disruption layer (country controls, rationing, business/transport/aviation/
power impact, protest risk). It must not be buried under price commentary.

**How to apply:**
- The disruption panel is a HARDCODED curated dataset, not a live feed — that is
  intentional, NOT fabrication. Every field is transcribed from the analyst alert;
  unknown fields render "Not reported". Do not "fix" it by deleting it or wiring it
  to incidents. If asked to update it, edit the dataset to match a new alert.
- Provenance honesty: the dataset's `sourceNote` distinguishes transcribed facts
  from analyst synthesis (Polestar View / advice / watch-next). Keep that split if
  you regenerate it — don't claim source documents the alert never cited.
- Relevance precision: in `lib/relevance/src/topicRelevance.ts`, aviation/jet fuel
  must be **disruption-bound** (shortage/levy/export/ration/schedule-cut/etc.) in
  both directions — a bare `jet fuel` / `aviation fuel` token leaks routine market
  and technical chatter into the fuel topic. Any parser change here needs a
  `RELEVANCE_RULE_VERSION` bump so the boot backfill re-cleans persisted rows.
