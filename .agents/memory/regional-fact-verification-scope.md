---
name: Regional fact verification failure scope
description: Why a regional weekly build must fail per candidate, not per run, and why each wording rule must name the abuse it detects.
---

A candidate whose facts cannot be verified is dropped and recorded; only the
arithmetic of the surviving set can fail the run.

**Why:** the pipeline already refuses to publish under its five-development
floor, so one unverifiable sentence out of a dozen candidates used to destroy an
entire paid run — collection, extraction and every model call — and the screen
showed a single candidate's error string instead of what was actually lost.
Protocol-shaped throws (extraction omitted/duplicated a candidate, the
correction pass answered the wrong ids) were the same mistake: a model's
bookkeeping error became a total failure although the affected candidates could
simply be dropped.

**How to apply:**
- Per-candidate structural and fact checks return a rejection carrying the
  candidate id, a reason with no id embedded in it, and the offending
  statement/quote. Rejections split into scope decisions ("excluded") and
  evidence failures ("unverified"); only the latter enter the bounded correction
  pass and the server warning log.
- The run fails only when the verified set falls under the floor, with a message
  stating how many of how many candidates passed and the distinct reasons.
- Loosening is never the fix for a failing candidate: exact-source-span,
  numeric-claim, casualty-pairing, source-leak and copied-headline checks keep
  their strictness.

A wording rule must reject only the abuse its message names, because the
correction pass is prompted with that message.

**Why:** the fact-sentence rule rejected any double-quote character anywhere
while telling the model not to wrap a headline in report-attribution text. A
sentence naming a vessel, storm, operation or official designation in quotes was
rejected, and the repair pass was told to fix something that had not happened.

**How to apply:** quoting is legitimate around a short named thing. Fail a
quoted span only when it runs to headline length, when it reproduces the source
headline, or when the sentence carries report-attribution verbs — and emit a
distinct message for each so the repair instruction matches the failure.
