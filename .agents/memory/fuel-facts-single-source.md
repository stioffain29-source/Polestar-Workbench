---
name: Fuel Watch canonical facts + consistency gate
description: One facts object drives all Fuel Watch narrative surfaces; lexical fail-closed gate blocks preview+PDF on contradiction.
---

**Rule:** All Fuel Watch quantitative claims (counts, distinct dates, country ranking/leader, market direction, overall severity, current-condition classes) come from ONE canonical facts builder computed after window filtering. Narrative surfaces (deterministic Market Read / Regional Highlights leader phrasing, the AI prose prompt's FIXED FACTS block, the consistency gate) consume it — none re-derive. Direction has a single authority function with a neutral band; the pressure leader needs a documented margin over the runner-up, otherwise "distributed" and no surface may crown a country.

**Why:** Sections previously resolved authored > AI > deterministic independently and each re-derived trend/leader/counts, so a polished report could contradict itself (rising vs falling crude, different leader per section). Owner spec demanded root-cause fix, fail-closed gate, property tests.

**How to apply (post round-2 landing):**
- Fuel's five analytical sections (Exec Summary, Situation, What Happened, What Matters, Polestar View + Market/Operational/Regional reads) are NON-OVERRIDABLE deterministic projections of the canonical facts module — analyst edits and AI prose never surface for fuel (they still do for every other topic; fuel is excluded from the ReportEditor precedence test loops on purpose).
- The builder self-validates (validation.consistencyErrors); preview shows a blocking panel from those errors and the PDF exporter throws on the same gate — never let preview render what the PDF would refuse.
- Situation and What Happened must stay DISTINCT sections (verbatim-duplicated prose was an owner-flagged defect); highestPriorityIncident must skip raw social-post titles (handle-prefixed @user:/RT captures) unless the window is social-only.
- Gate/builder must agree by construction: when pressure is distributed the sections say "pressure is distributed across …", so the validator accepts distributed phrasing, not just the literal "Distributed pressure" label.
- Fuel's effective report date is market-anchored (latest market close ?? issue date) — preview, AI facts/cache key and PDF must all use it or the gate diverges across surfaces.
- A SECOND facts module (the AI-prompt facts + fingerprint for the editor) still exists with slightly different bands/margins — it no longer drives any rendered fuel section, but don't let prompt facts be mistaken for rendered facts.
- Deterministic builders that still rank internally (Regional Highlights helper, kept for other callers) must take the facts pressure decision and switch to spread phrasing when distributed.
