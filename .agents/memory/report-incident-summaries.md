---
name: Per-incident AI summaries in report Related Incidents tables
description: Durable rules for attaching a one-line AI summary under each Related Incidents row in topic/conflict/shipping reports, with parity and cache-freshness constraints.
---

# Per-incident AI summaries (topic / conflict / shipping reports)

Topic, Conflict and Shipping reports show one short AI line under each Related
Incidents row (preview AND PDF). Flashpoint/protests/fuel are OUT of scope (they
have no related-incidents table). Reuses the country-report prompt contract,
fingerprint cache and editable-fallback pattern.

## Generate from the EXACT rendered related set, keyed on FULL incident identity
**Why:** the backend caps accepted incidents (≤60) and its cache fingerprint +
prompt grounding depend on the full incident text, not just id/title. Sending a
different/larger set than the table renders makes summaries stale or bypasses the
cache (wallet-DoS). Keying the regenerate trigger only on id/title lets a changed
summary/severity/location silently keep a stale line — same class of bug as the
country-report cache lesson (`country-ai-prose.md`).

**How to apply:** build the generate input from the SAME dataset the table renders
from, and gate the regenerate effect on a hash of the WHOLE canonical input array
(all grounded fields), not a subset.

## One shared resolver guarantees preview==PDF parity
Both previews and PDFs resolve each row's line through the single shared resolver
(AI line keyed by stringified id, else a deterministic fallback grounded only on
the incident's own fields: type + location + date + five-tier severity, British
English, no fabricated facts, no parenthetical counts). Never render a summary any
other way or the two surfaces drift.
