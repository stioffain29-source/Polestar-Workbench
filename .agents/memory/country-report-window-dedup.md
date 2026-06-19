---
name: Country report window dedup layer
description: Where syndication dedup must happen for country reports, and why the generic vs PNG layouts can silently diverge.
---

The generic country report renders its active 7-day window WITHOUT deduping syndicated copies unless you dedup at the `windowIncidents` input to `computeCountryFastFacts`. That single input is the choke point: `computeCountryFastFacts` derives every window surface (severity/type/area counts, latest date) from it AND returns it unchanged as `facts.windowIncidents`, which the Related Incidents table, the map and the charts all read. Dedup there and all of them agree; dedup only the table and the counts/map drift.

**Why:** the PNG country layout dedups internally (`buildPngReportDataset` → its own `dedupeByTitle`), but the GENERIC layout had no dedup, so the same wire re-run under an identical headline showed and counted twice (e.g. Papua showed one VOI.id incident on two dates). The two report variants dedup at DIFFERENT layers, so a fix on one does not cover the other.

**How to apply:** for the generic path, run `dedupeCountryWindowIncidents` (in `monitorDedupe.ts`, keys on `canonicalTitleKey`, keeps best by severity then newest `occurredAt`) over `active.incidents` and feed the result to BOTH `computeCountryFastFacts` and the prose drafter. Leave the PNG `buildPngReportDataset` call on raw `active.incidents` (it dedups itself). Also note `cleanIncidentTitle` only strips keyword-list mastheads — a bare-domain publisher handle ("voi.id") needs an explicit bare-domain branch to be stripped from display.
