---
name: Country-brief verbatim-repetition gates
description: How repeated boilerplate sentences in country/city briefs are prevented and QC-gated
---

**Rule:** No sentence template may render verbatim twice in one brief — across sections too (Top Developments vs Operational Impact, BLUF vs Outlook). Fixed template sentences need either (a) omit-on-repeat (first use only, §14 omit-never-pad), or (b) deterministic wording variants rotated by a **per-family counter** (per-trajectory / per-severity-band), never a global theme index — a global index modulo hands the same variant to two themes sharing a family. Variant list length must cover the max cardinality (Jakarta = 7 themes → 7 variants each).

**Why:** Owner repeatedly flagged verbatim boilerplate ("slop"): trajectory sentences, severity tails, the fixed Indirect assessed-relevance sentence, escalation triggers, volume sentences — each leaked as ×2-5 repeats in exported PDFs.

**How to apply:**
- QC gate: `checkCountryNarrativeText.ts` `BOILERPLATE_FAMILIES` — every emitted template family MUST have a starter regex there, and the checker normalises whitespace before matching (pdftotext wraps lines mid-sentence). Adding a new template sentence anywhere in brief prose ⇒ add its family regex in lockstep.
- Cross-section restatement uses an exported ALT wording constant (see `INDIRECT_ASSESSED_SENTENCE[_ALT]` in country-engine impact.ts) — same meaning, different words, no new claim.
- Top-3 same-story fold (`isSameStory`): shared PLACE tokens (event city/district/province) are excluded from title anchors — a shared district name must never merge two distinct events.
- Verify by sweeping `verifyCountryBriefs.sh` then a python Counter scan of ≥40-char sentences over the exported .txt files.

## Cross-framing implication repeat (12 Aug 2026)
The BLUF ("For operations, the immediate significance is that the lead event <clause>…") and the lead Top-3 slot ("For operators, an event of this kind <clause>.") can render the SAME CATEGORY_IMPLICATIONS clause a few lines apart — the exact-sentence family counter can't see it because the wrapping sentences differ. Fix: buildTopThree takes the built BLUF text and treats any implication already appearing in it as used (§14 omit-never-pad, cross-section). Gate: checkCountryNarrativeText.ts now also counts each exported CATEGORY_IMPLICATIONS clause across the flattened PDF text (>1 = fail).
