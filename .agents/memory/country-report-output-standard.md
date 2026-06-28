---
name: Country-report output standard
description: The analyst-grade output rules every country report (Papua/PNG/Thailand/Philippines/Indonesia) must obey — forbidden filler, charts-off, clean map, Papua zone captions.
---

# Country-report output standard

Authoritative rules that the country-report RENDER + PROSE must obey (from the
"Rework the country report output standard" spec). Dataset builders/libs were
left intact; only render + prose wording changed.

## Forbidden BLUF / Current-Situation filler (NOT greppable as "forbidden")
These three phrasings are banned in country-report prose — re-introducing any of
them is a regression:
- "Reported this period, centred on…"
- "Open-source reporting was led by…"
- "Treat quiet stretches as provisional…" (and "treat the quiet period as provisional")

A BLUF must instead be judgement-led: what changed · where risk concentrates ·
stable/improving/deteriorating · why it matters for business users. An EMPTY-window
BLUF still answers these (state the coverage gap, not an invented improvement).
**Why:** spec explicitly forbids the trio as generic filler; a future prose edit
could silently re-add them. **How to apply:** any edit to `operatingRiskProse.ts`,
`pngReportDataset.ts`, or the structured-brief builders.

## Charts OFF by default (all countries)
No Severity Distribution and no Incident Breakdown by Type by default. A chart may
appear ONLY where it supports the written assessment, and never from raw classifier
buckets. Removing the by-type chart (it read `facts.typeCounts`) is also what kills
off-topic taxonomy leakage (e.g. fertiliser) on generic countries — Incident Details
themes map only the closed `PngCategory` security set, so they cannot leak taxonomy.
**How to apply:** keep `CountryReportVisuals` chart-free; guarded by a render test.

## Map = clean report graphic
Controls are disabled at construction (`zoomControl:false`, `attributionControl:false`);
with attribution off the tile-layer attribution string is never drawn, so NO control
container exists — no CSS hide is needed or present. **Gotcha:** this project's Leaflet
classes are emitted with an `.l-` prefix, NOT `.leaflet-`, so a hard-coded
`.leaflet-control-container { display:none }` rule would silently no-op anyway.

## Papua zone legend captions are standing PROFILES, not this-period claims
The five Papua numbered-callout captions are monitoring-framed standing AREA profiles
sourced verbatim from the spec examples (e.g. Bird's Head → "Infrastructure, fire and
local disruption monitoring"). They are deliberately NOT data-driven this-week claims,
so they are no-fabrication-safe — do NOT "fix" them as stale or wire them to live
incidents. Only Papua/West Papua zones carry descriptions; Indonesia/Jakarta zones stay
data-driven.
