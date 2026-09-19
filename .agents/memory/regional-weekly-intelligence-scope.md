---
name: Regional weekly intelligence scope
description: Durable editorial and visual rules for APAC Weekly and Middle East Weekly.
---

APAC Weekly and Middle East Weekly are regional business-operating intelligence products, not security-only reports. Their evidence set spans security, political, regulatory, weather/natural hazards, cyber and operational disruption, but every included item must have credible operational relevance.

**Why:** The owner amended both products to provide a complete regional operating picture while retaining the existing cover, branding and export workflow. APAC was rebuilt first; the owner subsequently approved repeating the same model for Middle East Weekly.

**How to apply:** APAC runs independent discovery passes for security/conflict, political, regulatory, weather/hazards, cyber/information risk, business/operational disruption and energy; do not add APAC's energy lane to Middle East without a separate review. Persist the discovery domain with each source record; do not infer report structure from a general incident feed. Cluster sources by underlying event before selecting by operational materiality, never article volume; preserve corroborating evidence. APAC may publish four to six genuinely distinct developments (fewer only after an audited true-shortage finding), and its map uses no more than three items from that final set. Reject commentary, declarations without binding action, weak proposed laws, minor local crime/community stories, drills/false claims, aftermath-only incidents and events without demonstrated operating consequence. Keep preview/PDF parity. Quality findings are advisory and must never prevent the analyst from downloading the PDF for further editing.

APAC severity is reassessed from current operational consequence at report time; inherited incident severity, casualties, dramatic wording and source volume do not control the report rating. Bombing or armed attacks against defence/security actors classify before transport words, so vehicle references cannot turn them into operational disruption.

**Why:** The stored incident labels rated routine migration paperwork and a non-binding bill High, while a bomb-and-small-arms attack on territorial defence volunteers was misclassified because “truck” won category precedence.

**How to apply:** Use the APAC-assessed severity in both ranking and rendered output. Regulatory changes without immediate material disruption remain Low or Moderate; a locality described as a “border province” is not evidence of border closure or cross-border disruption.

Both reports use content-aware pagination rather than a fixed page allocation: avoid sparse section-only pages, flow related sections together, and never clip text. Their risk maps are intelligence visuals built only from final curated Key Developments, capped at three items and aligned with Week at a Glance and Key Developments. Keep the analytical Regional Outlook, concise factual metrics, non-empty risk themes, no more than four Key Developments, continuous Business Implications, genuine dated 7 Day Watch capped at five, Polestar Outlook and disclaimer. Empty categories are omitted, not filled with “no material development” prose. Preserve the existing cover, branding, header, footer and jsPDF architecture.

The export quality gate, preview, charts, BLUF, domain synthesis and watchlist must all receive the same region/window-filtered and event-clustered evidence before selecting the final developments. Never validate raw source rows: article volume and duplicate source coverage will falsely block a valid assessment.

**Why:** A gate applied to raw articles reported “more than ten developments” and “duplicates remain” even though the rendered report had already curated and deduplicated them, preventing the analyst from downloading the PDF. The owner explicitly prioritised download access over a fail-closed advisory gate.

Regional Weekly changes must be validated by exporting a real production-backed report and auditing its extracted PDF text. Unit fixtures and the workspace report database are insufficient: the latter may contain no regional report rows, while production exposes saved-record, attribution, clustering and render-branch failures.

**Why:** Helper tests passed while the visible Middle East report still used the old structure, duplicated one event across several developments, leaked raw headlines and misattributed an Oman maritime incident to Iran.

**How to apply:** Use the existing headless exporter with the production database binding without printing credentials. Check the complete PDF text for section structure, word envelopes, event-family duplication, title length, repeated sentences, country/title consistency, map labels and preview/PDF parity before declaring completion.

Collector coverage is valid only when real weather, cyber and forward-search runs persist their sources, timings, fetched/accepted counts and errors. Never infer a completed check by regex-scanning the incident register or hardcode a successful status. A discovery-domain label is not sufficient classification evidence: cyber requires explicit cyber semantics plus an operational consequence, and other domains must be classified from the event text and current impact.

**Why:** Synthetic coverage metadata and trusted discovery labels admitted trivial airport/police stories as Cyber and made missing source checks look complete.

**How to apply:** Audit the raw regional candidate funnel for drop reasons, then validate the final deduplicated developments for publication. Persist the exact selected evidence snapshot, evidence IDs, fingerprint and the complete region-wide forward-event snapshot. Save, reload and export from those persisted snapshots; never re-query live evidence during PDF rendering. The 7 Day Watch is region-wide and must not be limited to countries already represented in Key Developments.

APAC Weekly has one persisted canonical report object. Preview, saved reload and PDF read that object directly; none may re-curate incidents or rebuild developments, maps, metrics, watch items or prose independently.

**Why:** Preview and PDF previously reconstructed the same report through different builders and inputs, so a saved report could visibly change between surfaces.

**How to apply:** Build once after curation, persist the complete canonical object, validate it after reload and fail closed when it is absent or stale. Every Key Development must carry a verified actual event/policy date. Never substitute publication, scrape, ingestion or report dates; exclude unresolved DATE UNVERIFIED items. Keep the Middle East path unchanged unless separately requested.

The APAC canonical-object migration must preserve the established APAC geographic map renderer. Do not replace it with the generic incident map or a differently projected PDF-only map.

**Why:** A parity fix accidentally changed the visible map design even though the owner explicitly prohibited design changes.

**How to apply:** Feed canonical points into the existing APAC map component. The PDF must mirror that component's APAC projection, aspect ratio, sea/land palette, pins and callouts; canonicalizing data is not permission to replace presentation.

Regional report acceptance must inspect the exact environment and saved row the owner is viewing. A development PDF proves nothing about a newly created production row.

**Why:** The Regional Reports create action saved empty production rows while a separate development acceptance harness produced a complete canonical row; identical titles hid the mismatch and led to false completion claims.

**How to apply:** Trace the browser route/report ID and query that environment's row before debugging renderers. Report creation must persist the canonical object atomically; never create an empty regional row and expect the editor to reconstruct it later. Do not claim live-page parity from a development export.