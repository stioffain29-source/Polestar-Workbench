---
name: Regional weekly intelligence scope
description: Durable editorial and visual rules for APAC Weekly and Middle East Weekly.
---

APAC Weekly and Middle East Weekly are regional business-operating intelligence products, not security-only reports. Their evidence set spans security, political, regulatory, weather/natural hazards, cyber and operational disruption, but every included item must have credible operational relevance.

**Why:** The owner amended both products to provide a complete regional operating picture while retaining the existing cover, branding and export workflow. APAC was rebuilt first; the owner subsequently approved repeating the same model for Middle East Weekly.

**How to apply:** Run six independent discovery passes first: security/conflict, political, regulatory, weather/hazards, cyber/information risk and business/operational disruption. Persist the discovery domain with each source record; do not infer the report structure from a general incident feed. Cluster sources by underlying event before selecting by operational materiality, never article volume or fixed quotas; preserve corroborating evidence. Both regional reports select no more than four genuinely distinct developments with no force-fill, and their maps use no more than three items from that final set. Reject commentary, declarations without binding action, minor local crime/community stories, aftermath-only incidents and events without demonstrated operating consequence. Keep preview/PDF parity. Quality findings are advisory and must never prevent the analyst from downloading the PDF for further editing.

Both reports use content-aware pagination rather than a fixed page allocation: avoid sparse section-only pages, flow related sections together, and never clip text. Their risk maps are intelligence visuals built only from final curated Key Developments, capped at three items and aligned with Week at a Glance and Key Developments. Keep the analytical Regional Outlook, concise factual metrics, non-empty risk themes, no more than four Key Developments, continuous Business Implications, genuine dated 7 Day Watch capped at five, Polestar Outlook and disclaimer. Empty categories are omitted, not filled with “no material development” prose. Preserve the existing cover, branding, header, footer and jsPDF architecture.

The export quality gate, preview, charts, BLUF, domain synthesis and watchlist must all receive the same region/window-filtered and event-clustered evidence before selecting the final developments. Never validate raw source rows: article volume and duplicate source coverage will falsely block a valid assessment.

**Why:** A gate applied to raw articles reported “more than ten developments” and “duplicates remain” even though the rendered report had already curated and deduplicated them, preventing the analyst from downloading the PDF. The owner explicitly prioritised download access over a fail-closed advisory gate.

Regional Weekly changes must be validated by exporting a real production-backed report and auditing its extracted PDF text. Unit fixtures and the workspace report database are insufficient: the latter may contain no regional report rows, while production exposes saved-record, attribution, clustering and render-branch failures.

**Why:** Helper tests passed while the visible Middle East report still used the old structure, duplicated one event across several developments, leaked raw headlines and misattributed an Oman maritime incident to Iran.

**How to apply:** Use the existing headless exporter with the production database binding without printing credentials. Check the complete PDF text for section structure, word envelopes, event-family duplication, title length, repeated sentences, country/title consistency, map labels and preview/PDF parity before declaring completion.