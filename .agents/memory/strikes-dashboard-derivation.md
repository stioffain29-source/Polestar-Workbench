---
name: Strike Tracker dashboard client-side bucketing
description: How Strikes.tsx derives Target/Weapon/Casualties/Impact buckets and why the precedence is ordered the way it is.
---

# Missile Strike Tracker dashboard derivation (`artifacts/workbench/src/pages/Strikes.tsx`)

The strike breakdowns are derived CLIENT-SIDE (no schema/API change). The DB
stores `target_category`/`infrastructure` enums for ~23% of rows and leaves the
rest `unknown`; `casualties` is NULL on ~99%. So buckets come from DB enums +
incident-descriptive text.

## Target precedence — order is deliberate
1. **Military / US-forces signal FIRST** (`MILITARY_RE`), before the DB enum.
   **Why:** GCC headlines are dominated by interceptions over military / US-forces
   air bases ("Prince Sultan Air Base", "air base hosting US forces"). The old
   code's civil-Aviation regex (`airbase|air base`) mis-tagged these as Aviation.
   Running the military signal first forces them to Military even if a row were
   DB-tagged airport_aviation.
2. **DB enum** via `mapDbTarget` (prefer `target_category`, fall back to
   `infrastructure`; `energy_infrastructure` splits oil_gas→Oil & Gas,
   power→Power / Grid).
3. **Text fallback** (`TARGET_TEXT`) only when DB is unknown.
4. **`Unknown / unattributed`** — replaced the old verb-triggered `"Other"`
   catch-all (`/attack|strike|hit|target/`) that swallowed most rows into one
   meaningless bucket.

## strikeText excludes source + sourceUrl
`strikeText()` joins only `summary + analyst_notes + location`. The outlet
`source` name and the opaque base64 `sourceUrl` slug are EXCLUDED — they carried
no target signal and polluted every regex (e.g. "Taipei Times" leaking a city).
Any new deriver must use `strikeText`, not re-add source/url.

## Charts render even when Unknown dominates
`dominatedByUnknown(data) > 50%` shows a subdued data-quality caveat under the
card title instead of hiding the chart. The old `isAllUnknown` gate silently
hid charts; the user wants the attribution gap visible as incompleteness, not
absent. Caveat text is muted/italic — NOT red (red reserved for Extreme tier).

## Layout: 4 + 4, sub-location is generic
Top row: Total by country / Sub-locations / Attack context / Weapon family.
Bottom "Strike profile": Target / Weapon / Casualties / Impact. The sub-location
drill-down keys to the selected country (or most-affected when no filter): UAE →
emirate map, every other country → `cleanLocation`. The maritime port/chokepoint
chart was removed and must NOT be reintroduced (explicit out-of-scope).

## Casualties = three buckets
"Casualties reported" / "No casualties reported" / "Unknown / not reported"
(last only renders when populated; it dominates given NULL casualties). The
dense strike-log table cell uses `casualtyShort` (Reported/None/—) so the long
chart labels don't break the 90px column.
