---
name: Plural-blind classifier/lead regexes strand rows
description: Singular-only cue regexes ("\bprotest\b") silently drop plural/agent headlines into "Other" buckets, hiding High rows from every report section.
---
Cue regexes across incidentClassifier (`classifyUnrest` Protest rule + protestCue) and flashpointReportDataset (STRONG_LEAD_RE, both ACTION_REs) must match plural and agent forms: `protest(?:s|ers?|ing)?`, `demonstrat(?:ion|ions|ors?)`, `rall(?:y|ies)`, `march(?:es)?`, etc.

**Why:** "Deadly protests overshadow Pakistan's elections in Kashmir" and "Protesters gather outside Klang council" fell through to "Other operational incident" → bucket `other` → invisible to every read, table and lead-picker while Fast Facts still counted them — the owner's "5 Highs but report says one" defect. `\bprotest\b` does NOT match "protests".

**How to apply:** when adding any keyword cue that gates bucketing/lead/related selection, write plural-tolerant forms and verify on live prod titles via the esbuild harness (buildFlashpointReportDataset over dumped rows). Related guards added at the same time: one shared ENFORCEMENT_RE / hasEnforcementSignal over activism+unrest feeds ALL police-posture claims; tie counts (`topSeverityTieCount`) must be computed once over the enriched set and passed to every section (exec vs forecast disagreed 5-vs-2); forecastDateHasPassed gates BOTH the forecast table and Watch Next.
