---
name: Shared relevance engine + persisted gate
description: How incident "slop" filtering works after unification — one lib, persisted columns, central API filter, boot backfill.
---

# Shared relevance engine (@workspace/relevance)

The per-incident relevance decision lives in ONE place: the `@workspace/relevance`
lib (`topicRelevance.ts` = rules/source of truth; `evaluate.ts` =
`evaluateIncidentRelevance(topic,input) -> {relevant,status,score,reason,version}`
+ `RELEVANCE_RULE_VERSION`). The workbench's `topicRelevance.ts` is a thin
`export * from "@workspace/relevance"` re-export, so all in-app importers and
report/PDF parity are untouched. Ingestion (flashpoint/cargoWatch) + manual
`POST /incidents` persist the verdict; a boot `backfillRelevance()` re-evaluates
rows whose stored version is null/stale.

**Why this shape:** slop (volleyball/rally/pageant/PMI/MAGA) used to persist in the
DB at permissive ingest and was filtered ONLY at display-time on SOME frontend
surfaces (Dashboard, Reports gated; Topic/Incidents/Map/Timeline + server topic
COUNTS leaked). One engine + persisted columns + a central server filter kills the
per-surface whack-a-mole. User preference: "signal thin > noise in" (conservative
false-drops are acceptable).

**The non-obvious safety fact:** the GENERIC topic report path
(`exportTopicReportPdf` / `draftReportProse` / `topicFastFacts`) ALREADY gated
EVERY topic through `isTopicRelevant`. So persisting + API-filtering the rows it
marks irrelevant does NOT change report output for any topic (incl. static
energy/fertiliser) — it only aligns the previously-ungated browse surfaces and
counts. Before trusting a gate that touches static/import-only topics, confirm the
report builder already applied the same `isTopicRelevant` — if it did, you are
unifying, not regressing.

**How to apply:**
- Default API filter = exclude `relevanceStatus='irrelevant'`, ALLOW NULL
  (fail-open) so nothing vanishes mid-rollout (`artifacts/api-server/src/lib/relevanceFilter.ts`).
  Manual-created rows show until evaluated — correct (analyst added them on purpose).
- Admin/raw escape hatch `?includeIrrelevant=true` is read directly off `req.query`
  (NOT in the OpenAPI spec) so no codegen churn; the typed client never sends it.
- To RE-CLEAN the whole table against changed rules: bump `RELEVANCE_RULE_VERSION`;
  the boot backfill re-evaluates every row on the next deploy. Reaches prod only
  after a republish (new code must ship first), same as the ingest scheduler.
- The `score` field is heuristic (derived from the reason text) and is NOT used for
  gating — only `status` gates. Don't build logic on `score` without hardening it.
