---
name: Conflict lone-shooter crime gate + cited-event dedupe
description: School/mass shootings are crime, not conflict — excluded PRE-violence-override; area-paragraph cited events need casualty-figure dedupe and end-anchored attribution stripping.
---
Conflict relevance: lone-shooter/school-shooting/mass-shooting phrasing is excluded BEFORE the violence-keep override, unless an armed-group/military actor is named (CONFLICT_LONE_SHOOTER_RE + CONFLICT_ARMED_ACTOR_RE in topicRelevance, mirrored in both conflict branches incl. explainRelevance).

**Why:** the violence override ("deaths = keep") made crime shootings un-excludable by normal excludes; a Thai school shooting was framed as "armed clashes across the country". Replay over all live rows flipped only genuine crime (19 prod / 45 dev), zero insurgent rows.

**How to apply:** any new "crime vs conflict" leak needs a pre-override gate, not a REQUIRED tweak; bump RELEVANCE_RULE_VERSION and replay live rows first. In conflictReportDataset area paragraphs: cited events dedupe via token-Jaccard ≥0.45 OR same-day + shared casualty figure (numbers taken ONLY from ±40 chars around casualty verbs — route/district numbers must not merge distinct events); attribution tails stripped only when END-anchored (`:\s*(qualifier ≤3 words) (police|sources|media|…)$`) so substantive colon clauses survive; toll capper suppressed when cited events already state deaths.
