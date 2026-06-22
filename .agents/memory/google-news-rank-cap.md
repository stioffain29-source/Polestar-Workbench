---
name: Google News rank-cap & targeted feeds
description: Why a topic monitor can miss real local items even when ingest runs fresh, and the targeted-feed remedy
---

- A broad per-country OR-query (e.g. `ENERGY_TERMS "Philippines"`) is rank-capped by Google News at roughly 70–100 ranked items per feed. Highly-syndicated national stories crowd out hyperlocal items (sub-national brownouts, one utility's load-shedding), so a topic monitor shows a coverage gap even though ingest ran fresh.

- Distinguish a COVERAGE gap from a FILTER bug: a dry-run scrape (no `--commit`) reporting "New to insert: 0" across every feed means the live feeds return nothing we don't already store — the missing items are NOT being filtered, they're not being fetched. Then confirm reachability by probing Google News RSS directly for the specific item using that COUNTRY's edition (`gl`/`hl`/`ceid`, e.g. PH:en) + `when:Nd`.

- Remedy: add a place-anchored targeted feed in the country's own edition that requires a sub-national place token AND a topic term (mirror the conflict sub-national feeds — "Philippines insurgency" etc. — in `topicConfigs.ts`). This surfaces items the broad query rank-caps out. Additive feeds need NO `RELEVANCE_RULE_VERSION` bump when the items already pass the existing allow-list + relevance gate (verify: similar rows are already marked `relevant`, e.g. the May Visayas brownout cluster).

- Hard limit: some hyperlocal items are simply not on Google News under any English query. Verified empirically: Bangladesh "WZPDCL load shedding" and Vietnam "Can Tho power cut" return EMPTY. An RSS-fed monitor cannot match a broad live-web-research briefing; that residual gap is structural, not a bug — say so plainly.

**Why:** recurring "I'm not seeing X in [topic] Watch" reports are usually this rank-cap coverage gap, not a relevance/filter defect, and chasing them with relevance loosening only adds noise.

**How to apply:** dry-run + direct country-edition RSS probe to classify the gap; if the item is reachable, add a targeted edition feed; if the probe is empty, tell the user it is unreachable via RSS.
