---
name: Flashpoint semantic admission
description: Durable rules for fail-closed Flashpoint event validity, canonical report facts, prose provenance, and safe adjudication.
---

Flashpoint / protests rows are admitted only when one shared semantic contract
accepts a current-version decision. Relevance, country assignment, source
membership, a trusted-provider label, or a legacy NULL decision can never
substitute for event evidence. Normal API surfaces and report builders must fail
closed against the same contract.

**Why:** separate keyword, geography, report, and PDF gates repeatedly disagreed.
Misleading subjects became locations, uncertain articles became incidents, old
AI prose was silently treated as current, and display-only fixes left counts and
other surfaces contaminated. A single versioned contract makes those failures
observable and forces deliberate re-adjudication when the rules change.

**How to apply:**
- Require actor, activity, physical event location, supported country, strict
  event type, supported date/currentness, no contradictions, and independent
  confidence thresholds. Hold uncertainty; never upgrade a provider's invalid
  or needs-review verdict.
- Normalize provider representation mismatches before the contract: an exact,
  parseable ISO timestamp may project to its date, while arbitrary date text
  stays held. For a future event, treat literal `eventOccurred=false` as
  established only when the provider verdict is already valid; never upgrade a
  provider `needs_review` decision.
- Bump the semantic version whenever acceptance meaning changes. Old versions
  stay hidden until backfilled; incomplete manual, social, or structured-source
  writes remain review candidates rather than receiving synthetic confidence.
- A semantic-version publish must converge newest stale decisions independently
  of full ingest: finish one recent batch before the scheduler starts, then
  cover the report window in bounded background batches. Never infer production
  recovery from development backfill counts.
- Audit coverage must report current-version `needs_review` rows as adjudicated
  holds, separately from genuinely blank or stale decisions. Treating a hold as
  "unadjudicated" defeats the required three-state model and creates false gaps.
- Validate before non-exact dedupe and derive every report fact from one
  immutable accepted set. Preview and PDF consume the same resolved model, and
  structural contradictions hard-fail at the final boundary.
- Keep AI cache identity separate from the canonical generation-basis
  fingerprint. Missing or stale basis never becomes current merely because an
  editor renders or saves it.
- Adjudication writes compare-and-set against the exact evidence snapshot so a
  concurrent edit cannot be overwritten. Retries append decision history; they
  do not erase an earlier hold or resurrect an older cached verdict.