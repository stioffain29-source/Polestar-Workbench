---
name: Regional weekly intelligence scope
description: Durable editorial and visual rules for APAC Weekly and Middle East Weekly.
---

APAC Weekly and Middle East Weekly are regional business-operating intelligence products, not security-only reports. Their evidence set spans security, political, regulatory, weather/natural hazards, cyber and operational disruption, but every included item must have credible operational relevance.

**Why:** The owner amended both products to provide a complete regional operating picture while retaining the existing cover, branding and export workflow. APAC was rebuilt first; the owner subsequently approved repeating the same model for Middle East Weekly.

**How to apply:** BOTH products run independent discovery passes for security/conflict, political, regulatory, business/operational disruption, energy/utilities, weather/hazards and cyber. Persist the discovery domain with each source record; do not infer report structure from a general incident feed. Cluster sources by underlying event before selecting by operational materiality, never article volume; preserve corroborating evidence. Target six genuinely distinct developments (five only after a complete seven-domain/geography/forward-search audit proves a true shortage), and map every selected, plottable development. Reject commentary, declarations without binding action, weak proposed laws, minor local crime/community stories, drills/false claims, aftermath-only incidents and events without demonstrated operating consequence. Keep preview/PDF parity.

Both Regional Weeklies reassess severity from the underlying facts at report time; inherited labels, dramatic wording and source volume do not control it. Consequences, intent, method, casualties and verified operating effects do. Bombing, missile and military-incursion semantics classify before transport or energy words, so a nearby airport, vehicle or pipeline reference cannot override the event itself.

**Why:** The stored incident labels rated routine migration paperwork and a non-binding bill High, while a bomb-and-small-arms attack on territorial defence volunteers was misclassified because “truck” won category precedence.

**How to apply:** Use the reassessed severity in ranking, rendered output and map points. A deliberate attack without verified casualties, damage or closure can remain Moderate; compound attacks with casualties can be High; mass-casualty attacks can be Extreme. Regulatory changes without immediate material disruption remain Low or Moderate. Before canonical generation, compare armed attacks with routine regulatory items and block inconsistent ordering for review. A locality described as a “border province” is not evidence of border closure or cross-border disruption.

Both reports use content-aware pagination rather than a fixed page allocation: avoid sparse section-only pages, flow related sections together, and never clip text. Their risk maps are intelligence visuals built only from final curated Key Developments, showing every plottable selected item and aligned with Week at a Glance and Key Developments. Keep the analytical Regional Outlook, concise factual metrics, non-empty risk themes, six Key Developments where evidence supports them, continuous Business Implications, genuine dated 7 Day Watch capped at five, Polestar Outlook and disclaimer. Empty categories are omitted, not filled with “no material development” prose. Preserve the existing cover, branding, header, footer and jsPDF architecture.

The export quality gate, preview, charts, BLUF, domain synthesis and watchlist must all receive the same region/window-filtered and event-clustered evidence before selecting the final developments. Never validate raw source rows: article volume and duplicate source coverage will falsely block a valid assessment.

**Why:** A gate applied to raw articles reported “more than ten developments” and “duplicates remain” even though the rendered report had already curated and deduplicated them, preventing the analyst from downloading the PDF. The owner explicitly prioritised download access over a fail-closed advisory gate.

Regional Weekly changes must be validated by exporting a real production-backed report and auditing its extracted PDF text. Unit fixtures and the workspace report database are insufficient: the latter may contain no regional report rows, while production exposes saved-record, attribution, clustering and render-branch failures.

**Why:** Helper tests passed while the visible Middle East report still used the old structure, duplicated one event across several developments, leaked raw headlines and misattributed an Oman maritime incident to Iran.

**How to apply:** Use the existing headless exporter with the production database binding without printing credentials. Check the complete PDF text for section structure, word envelopes, event-family duplication, title length, repeated sentences, country/title consistency, map labels and preview/PDF parity before declaring completion.

Collector coverage is valid only when real weather, cyber and forward-search runs persist their sources, timings, fetched/accepted counts and errors. Never infer a completed check by regex-scanning the incident register or hardcode a successful status. A discovery-domain label is not sufficient classification evidence: cyber requires explicit cyber semantics plus an operational consequence, and other domains must be classified from the event text and current impact.

**Why:** Synthetic coverage metadata and trusted discovery labels admitted trivial airport/police stories as Cyber and made missing source checks look complete.

**How to apply:** Audit the raw regional candidate funnel for drop reasons, then validate the final deduplicated developments for publication. Persist the exact selected evidence snapshot, evidence IDs, fingerprint and the complete region-wide forward-event snapshot. Save, reload and export from those persisted snapshots; never re-query live evidence during PDF rendering. The 7 Day Watch is region-wide and must not be limited to countries already represented in Key Developments.

Each Regional Weekly has one persisted canonical report object. Preview, saved reload and PDF read that object directly; none may re-curate incidents or rebuild developments, maps, metrics, watch items or prose independently.

**Why:** Preview and PDF previously reconstructed the same report through different builders and inputs, so a saved report could visibly change between surfaces.

**How to apply:** Preserve an explicit event/policy date; otherwise the later occurrence-timestamp rule below applies, labelled as a reported evidence date rather than pretending it is the event date. Build once, persist the complete canonical object, validate it after reload and fail closed when absent or stale. Event-family keys must describe the actual event, never just a country: same-country events such as a capital missile attack and a pipeline shutdown remain separate, while variant headlines for one cross-border incursion collapse together.

Regional Weekly maps must appear in both preview and the actual Download PDF path. The owner's later request to replace the map supersedes the earlier no-map direction.

**Why:** An old drawing function still existed but was never called by the active PDF branch; its presence in source was not proof of export parity. Effect-driven map libraries also cannot populate an immediately captured static HTML snapshot.

**How to apply:** Use the same static-renderable map in both surfaces. Separate overlapping numbered badges without changing geographic anchors or saved points. Await remote basemap tiles under a bounded deadline and stop export on tile failure rather than shipping blank geography. Verify the actual browser-generated PDF visually, not just extracted text.

Technical validity is not editorial acceptance. A Regional Weekly fails if it is a sparse incident digest padded into multiple pages, recycles the same boilerplate across sections or regions, hides evidence behind source counts, or substitutes generic “verify and monitor” instructions for a specific business-risk judgement.

**Why:** The owner rejected technically valid exports because large blank pages, trivial count charts, clipped map labels, repetitive prose and unsupported headline-level claims made them look unfinished and analytically weak.

**How to apply:** Review the rendered PDF as a client deliverable. Every section must add a distinct layer of judgement; recommendations must identify the exposed business function, trigger and decision; sources must be auditable; charts must show a meaningful comparison or trend; and page composition must not use whitespace to disguise thin evidence.

The owner’s APAC reference standard is a concise, edited regional narrative with broad domain coverage: six material developments plus a lower-severity hazard note, specific casualty/impact facts, market and subnational geography, distinct Polestar judgement, and a multi-item forward watch.

**Why:** This breadth makes the report a regional operating picture rather than a padded digest of whatever few incidents survived the pipeline.

**How to apply:** Use the reference’s content model, not its wording: Regional Outlook synthesises the week; Risk Picture explains each exposure; Key Developments carry verified facts, interpretation and seven-day indicators; Business Implications separates decisions by function; 7 Day Watch lists concrete triggers; Outlook ranks what matters next. Verify every claim and do not invent breadth.

Regional report acceptance must inspect the exact environment and saved row the owner is viewing. A development PDF proves nothing about a newly created production row.

**Why:** The Regional Reports create action saved empty production rows while a separate development acceptance harness produced a complete canonical row; identical titles hid the mismatch and led to false completion claims.

**How to apply:** Trace the browser route/report ID and query that environment's row before debugging renderers. Report creation must persist the canonical object atomically; never create an empty regional row and expect the editor to reconstruct it later. Do not claim live-page parity from a development export.

The Regional Reports landing page must always keep “Create Report” available, even when a current draft exists; “Open Current Report” is a separate action.

**Why:** Replacing creation with opening prevented analysts from starting the next report while an existing draft remained current.

**How to apply:** Show both actions when a current report exists. The create handler must create a new row rather than redirecting to the current one.

The landing-page Create control must be a real link to a dedicated creation route, not a long-running async click handler on the report grid. That page follows the server-owned creation job and redirects after persistence, with visible stages and an in-page retryable error.

**Why:** repeated inline implementations appeared frozen during 20–30 second source collection/build work, encouraged repeat clicks and duplicate drafts, and once failed to send any request at all.

**How to apply:** navigate immediately on click, show real Collecting/Building/Opening progress on the destination, preserve the creation identity through refresh/reconnection, persist the canonical object atomically, and only then redirect to the editor. Keep Create available beside Open Current Report.

Regional creation must be one durable server-owned job, not one long-lived HTTP request. The browser must not download the incident set, build the canonical report, then issue a second save request.

**Why:** splitting collection, synchronous browser assembly and persistence made the button appear frozen. Moving all work into a single awaited HTTP request still left no recovery identity when the browser reported “Failed to fetch.” The precise transport cause was unproven; missing completion logs alone do not establish that a request never reached the app.

**How to apply:** use short authenticated submission/status calls. Retries and refreshes must resume the same attempt; each explicit Create remains a new report even on the same topic/date. Persist the complete canonical report and successful job result together before opening the editor. Collection runs outside the HTTP process with actual termination on its deadline or parent loss, not merely a rejected timeout promise. Never present a development route-harness check as proof of the private production browser flow.

Regional reports use the source occurrence timestamp when a distinct incident date was not extracted, and the map plots every selected, plottable development rather than an arbitrary top three.

**Why:** incident rows are designed for consumers to fall back to occurredAt, but the regional builder instead dropped every null incidentDate row; this collapsed a healthy evidence set to one card and one map dot. The three-point map cap then hid valid evidence even in healthy reports.

**How to apply:** preserve explicit incidentDate when present; otherwise use occurredAt as the evidence date. Curate to the requested region before canonical assembly, require at least five selected developments, and pass all selected coordinate/fallback points to preview and PDF renderers.

A marker-coverage fix is not a visual map replacement. Do not explain an unchanged map as a stale saved report without checking the newest production snapshot and both visible renderers.

**Why:** the newest saved report already contained the expanded marker set while the preview still used the previous map design and the active PDF path omitted the map. Recommending another creation or publish without changing those renderers would not address the owner's visual complaint.

**How to apply:** establish whether the request concerns design, geography or marker coverage; verify that specific change in the actual preview and PDF. Keep saved analytical facts intact when changing presentation.

Raw news and analytical writing are separate trust boundaries. Extract source-linked factual statements first; only those checked facts enter the analytical writer. Keep article text, supporting quotations and outlet names in the evidence archive, not reader-facing development cards.

**Why:** The owner explicitly rejected further template/prompt patching around raw headlines. That approach leaked publishers, misassigned US policy to New Zealand, duplicated one Nepal LPG shortage and turned casualty headlines into malformed prose. A valid JSON shape did not prevent the model from quoting a headline inside a supposedly rewritten fact.

**How to apply:** Verify supporting spans, numbers and casualty roles before selection; treat event jurisdiction separately from affected nationality. Reject copied or quoted headlines and attribution wrappers. Use bounded correction followed by explicit failure, never truncation or raw-copy fallback. Select useful distinct events after extraction; genuine cyber evidence must not be crowded out by multiple attack articles or unchanged tariff context. Preserve the same saved canonical object through preview, reload and PDF; refresh an existing report without discarding analyst work.

The forward calendar is also source material, not already-edited report copy.

**Why:** A scheduled-event record can contain a news headline and reader instructions rather than an event name; cleaning only past developments leaves that separate route for headline leakage.

**How to apply:** Apply the same source-to-report boundary to 7 Day Watch. An institution issuing an advisory is not necessarily the event organiser, and a shared generic label does not establish that two gatherings are the same event.