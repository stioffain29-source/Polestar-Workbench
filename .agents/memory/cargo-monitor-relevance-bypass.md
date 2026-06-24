---
name: Cargo Watch monitor bypasses server relevance gate
description: Why the Cargo Watch monitor fetches includeIrrelevant and trusts its own classifyScope instead of the server's persisted relevance verdict.
---

The Cargo Watch monitor (`CargoWatch.tsx`) fetches `useListIncidents({ topic: "cargo_watch", includeIrrelevant: true })` and lets the page's own `classifyScope` (the curated cargo gate in `cargoAnalysis.ts`) be the SOLE scope authority. It must NOT inherit the server's persisted `relevance_status`.

**Why:** The server relevance engine is a GENERAL topic classifier. For cargo it marks many genuine cargo thefts `irrelevant` (e.g. a cigarette-distributor warehouse raid with a fatality, ship stowaways, a one-ton commodity haul, a clothing-warehouse robbery). The API drops `irrelevant` rows by default, so the browser never sees them and the 30-day view reads an implausible ZERO — even though the frontend `classifyScope` would correctly accept them as in-scope. Verified once: of ~29 live last-30d rows, classifyScope accepted 10 in-scope, but 9 of those 10 were server-marked `irrelevant`, so only ~1 survived both gates.

**How to apply:** If the cargo monitor ever reads empty/thin again, first check whether genuine cargo rows are being dropped by the server relevance gate, NOT by classifyScope. The fix lives on the FRONTEND fetch (trust classifyScope), not in a relevance-rule change — so no `RELEVANCE_RULE_VERSION` bump or backfill. This mirrors the deliberate `CountryReport.tsx` precedent (it fetches `includeIrrelevant` and uses `isCountryRelevant` as sole authority). Scope the change to the monitor only; the cargo report (ReportEditor) and Dashboard card use separate fetches and are a separate product decision unless the user reports they disagree.
