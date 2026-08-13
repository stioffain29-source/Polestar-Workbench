---
name: Country editor live-edit layer + analyst map markers
description: Why inline editors need a session-verbatim text layer over the blank=auto sentinel; analyst map markers; operating-risk prose is analyst-editable.
---

**Rule 1 — delete snap-back:** every inline editor whose persisted store uses "" / deleted-key as the "auto flows" sentinel MUST render from a session-local verbatim layer (`liveEditTexts`, keyed `kind:field`, cleared on exiting edit mode). Value = live ?? (saved || auto).
**Why:** a box driven only by `saved || auto` snaps back to engine text the instant the analyst clears it — reported as "text I delete will not delete". Save semantics unchanged: blank still stores the sentinel so auto prose keeps flowing after save.
**How to apply:** any new prefill-style editor (prose blocks, theme paragraphs, action groups) must join the layer; never rely on the persisted sentinel for display during editing.

**Rule 2 — operating-risk prose editability:** operating-risk briefs (Indonesia/Jakarta/generic countries) overlay EXPLICIT analyst edits (`proseResult.edited` / live draft) onto the deterministic dataset in `pngEffectiveDataset`, same as PNG/West Papua. The AI overlay ban stands — `proseResult.sections` is never consulted for operating-risk. Owner asked for all narrative blocks editable (Aug 2026), superseding the earlier "deterministic prose not editable" note.

**Rule 3 — analyst map markers:** `section_overrides.mapMarkers` ({id,lat,lng,label,severity}) render as labelled dots ALONGSIDE the §23 incident dots on the report IncidentMap (showLabels on; incident dots' labels stripped to avoid clutter). Sanitised on read (`sanitizeMapMarkers`). Display-only — never joins aggregates, watchlist or prose grounding.

**Gotcha:** retiring a component means retiring its ROOT `__tests__/workbench/*` suites too — the workbench-scoped jest pattern misses them, so run the full root suite after deletions. 8 root suites (fuel/report-editor prose) were already failing before this work — pre-existing, not from these changes.
