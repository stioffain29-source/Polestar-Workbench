---
name: Fuel Watch canonical facts + consistency gate
description: One facts object drives Fuel Watch; factual and semantic validation must not require repeated canonical wording.
---

**Rule:** All Fuel Watch quantitative claims (counts, distinct dates, country ranking/leader, market direction, overall severity, current-condition classes) come from ONE canonical facts builder computed after window filtering. Narrative surfaces (deterministic Market Read / Regional Highlights leader phrasing, the AI prose prompt's FIXED FACTS block, the consistency gate) consume it — none re-derive. Direction has a single authority function with a neutral band; the pressure leader needs a documented margin over the runner-up, otherwise "distributed" and no surface may crown a country.

**Why:** Sections previously resolved authored > AI > deterministic independently and each re-derived trend/leader/counts, so a polished report could contradict itself (rising vs falling crude, different leader per section). Owner spec demanded root-cause fix, fail-closed gate, property tests.

**How to apply (post round-2 landing):**
- Judge semantic compatibility, not repetition of incident headlines, category labels, directional words or derived trigger phrases. Do not rewrite or substitute report prose to satisfy a faulty validator.
  **Why:** the owner explicitly rejected literal repetition gates and the proposed automatic-prose fallback as the wrong fix; different analytical sections serve different purposes.
  **How to apply:** retain factual contradiction and grounded forward-indicator checks, but permit supported paraphrases and derived consequences. Scope changes to Fuel; verify unchanged actual loaded AI/analyst text, including the renderer's AI bullet precedence, not a null-AI fallback proof. A rising benchmark does not prove every product's cost rose, and a sector label or attack does not prove present supply impairment.
- The earlier non-overridable-only decision was superseded by direct editing. Preserve genuine analyst prose during gate fixes; fix unsupported generated assertions at their source instead of clearing edits or weakening the evidence gate.
- The builder self-validates (validation.consistencyErrors); preview shows a blocking panel from those errors and the PDF exporter throws on the same gate — never let preview render what the PDF would refuse.
- Verify the visible report and extracted PDF text, not just the final validator's return value. **Why:** an export branch can still read older text even when validation has checked corrected text. **How to apply:** assert the requested passages in the actual preview and saved PDF.
- Situation and What Happened must stay DISTINCT sections (verbatim-duplicated prose was an owner-flagged defect); highestPriorityIncident must skip raw social-post titles (handle-prefixed @user:/RT captures) unless the window is social-only.
- Gate/builder must agree by construction: when pressure is distributed the sections say "pressure is distributed across …", so the validator accepts distributed phrasing, not just the literal "Distributed pressure" label.
- Fuel's effective report date is market-anchored (latest market close ?? issue date) — preview, AI facts/cache key and PDF must all use it or the gate diverges across surfaces.
- Do not confuse AI-prompt facts with the final rendered evidence. Fingerprint-stale AI and legacy saved prose are not valid stand-ins for the editor's current effective payload when verifying an unblock.
- Deterministic builders that still rank internally (Regional Highlights helper, kept for other callers) must take the facts pressure decision and switch to spread phrasing when distributed.
- An affected-countries table contains countries only: first recover blank geography from event location/title/summary, then omit unresolved rows and disclose the excluded count in the coverage note. Never manufacture an “Unattributed” country to reconcile table and overall totals.
  **Why:** that bucket exposed an internal data-quality gap as if it were a geographic result.
  **How to apply:** overall and severity totals may include the full qualifying set; country rows and active-country counts use only developments with verified country attribution.
