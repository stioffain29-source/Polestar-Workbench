---
name: Energy report register retired
description: Owner's scope decision for the Energy Watch closing page.
---

Do not restore Related Incidents to Energy Watch reports. Keep the full disclaimer in 9pt Roboto below the closing assessment, with no gray panel or background.

**Why:** the owner explicitly removed the incident-register page because it added no value, then rejected the gray disclaimer panel. On 2026-09-11 the owner subsequently required smaller price cards and corrected pagination after the fixed page breaks stranded a paragraph on its own page. This supersedes the earlier fixed-five-page architecture, not the prohibition on rewriting prose.

**How to apply:** keep this removal scoped to Energy Watch, preserve its prose and incident data, and do not remove registers from other report types without instruction. After the overview, let prices and narrative flow by actual available space rather than forcing one section per page. Check against the attached report's actual prose length, not only a shorter development report.

Keep the section sequence fixed but let ALL post-cover sections flow. No fixed overview page, market-price page, final-assessment page or maximum page count. Keep the map at its natural aspect ratio; move it instead of compressing it into remaining space.

**Why:** the owner's later explicit flexible-pagination specification supersedes the earlier demand to force the overview onto one page. Five pages was an example, never a contract. Verify short and long cases, including more than five pages.

**How to apply:** keep short assessment sections together when practical, keep Polestar intact, and let the separately atomic 9pt white-background disclaimer move to the next page when necessary. Never cap or shorten recommendations or watch items. Preserve the hierarchy: snapshot → map → markets → situation/issue analysis → what matters → implications → watch next → Polestar → disclaimer.

Match CSS and PDF physical units when rasterising Energy visuals: browser pixels are 96/inch, PDF points are 72/inch. Do not fix inflated captures by shrinking charts into leftover space.

**Why:** a point-valued column width used directly as a CSS pixel width enlarged the exported visuals relative to the preview. The map moved off the snapshot, leaving a large blank tail, even though it fit at its normal browser size. Page-bound checks alone passed this bad layout.

**How to apply:** convert both the DOM capture width and html2canvas viewport width; keep the output width in PDF points. Keep this correction scoped to Energy unless other topics have been verified.

Energy overview and detailed analysis must have distinct jobs: a brief cross-cutting overview, then each geographic/issue development once. Headings must come from the source, never from spotting a familiar place name in a paragraph.

**Why:** the owner rejected repeated Visayas/Dhaka passages after the pagination work. A three-country heading classifier turned overview mentions into duplicate country sections; the generation prompt also encouraged overview/detail retelling. Pagination checks did not catch this content defect.

**How to apply:** check narrative repetition as well as page bounds against the supplied report. Preserve distinct detail and analyst edits; never solve repetition by capping paragraphs or recommendations. Keep Energy prompt invalidation separate from other topics.

Energy's map must include New Zealand as geographic context even when it has no reported incidents; do not turn this framing requirement into invented data.

Keep a stable full-world geographic frame, with North and South America adjacent and the wrap seam at the date line.

**Why:** the owner rejected the Americas appearing on opposite sides after the map was shortened. Data-centred country-by-country wrapping is not acceptable geographic context.

Do not add country-name or incident-count labels to the Energy map.

**Why:** the owner explicitly rejected the unsolicited labels on 2026-09-11. Sharper rendering and wider geography were not permission to add annotations.

Energy Fast Facts must contain substantive reporting evidence, not record-count/severity/classifier metadata. Retain reporting period and most affected country, and populate the remaining cards with specific supported developments.

**Why:** the owner rejected the generic cards and explicitly corrected the suggestion to remove them: useful facts must be populated, not omitted just to simplify the layout.

**How to apply:** preserve places, operational consequences and source-supported quantities; never turn a warning into a confirmed outage or invent numbers to fill a card.

**Why:** the owner explicitly rejected the map omitting New Zealand and requested slightly smaller Fast Facts to accommodate it. Static maps need a complete geographic base, not the monitor's selected-country overlays rendered as standalone land.