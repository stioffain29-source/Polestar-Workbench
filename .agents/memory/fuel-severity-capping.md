---
name: Fuel severity capping (market commentary vs concrete disruption)
description: How/why capFuelMarketSeverity downgrades high/extreme fuel incidents, and the rule order that keeps commentary out of the Extreme tier.
---

# Fuel severity capping

`capFuelMarketSeverity` (artifacts/workbench/src/lib/fuelNarratives.ts) is the gate on the Related-Incidents severity chip in the Fuel Watch PDF. Rule order (only ever DOWNGRADES high/extreme, never raises):

1. casualty phrasing → keep elevated
2. speculative/commentary/policy framing (warns, could, may, forecast, proposal, postpone, "set to", risk/threat…) → moderate
3. concrete physical disruption (shutdown, attack, drone, missile, fire, explosion, blockade, seizure, strike, spill, derail…) → keep elevated
4. everything else (pure market/price/policy signal) → moderate

**Why:** the user explicitly required that market commentary and policy WARNINGS must NOT render Extreme unless there is *direct* operational disruption. An earlier allow-list approach (FUEL_NONPHYSICAL_RE) was the wrong shape — it tried to enumerate every market phrase and leaked "extreme" on anything it missed (e.g. "pipeline 50% complete"). The inverted default (downgrade unless proven operational/casualty) is the robust form.

**Why the speculative guard runs BEFORE the operational check:** headlines often name-drop an operational word inside a forecast ("Australian strike *could* worsen markets", "warns supply *may* halt"). Those are commentary, so the `could/warns/may` guard must win over the bare "strike"/"halt" token. Casualties bypass the guard.

**How to apply:** when a real concrete-event headline is being wrongly downgraded, it's because it contains a speculative word — check FUEL_SPECULATIVE_RE before widening the operational list. Do not re-introduce the "disruption" token into the operational regex; it matches "supply/market disruption" commentary.
