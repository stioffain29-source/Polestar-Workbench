---
name: Social promote dating honesty
description: Why a scraped social post needs real, recent provenance before it may become an incident, and where that gate must live.
---

A social post may only become an incident when the POST ITSELF carries a real
publication timestamp inside the promote window, and the date the incident would
be filed under is inside that window too. Missing, unparseable and future-dated
timestamps all count as "no date". A post that fails is kept as reviewable
context — never deleted, never hidden.

**Why:** group scrapers return PINNED posts that can be years old, and many posts
carry no usable timestamp. The date chain used to fall back to "now", so either
case would have been filed as an incident dated TODAY — a fabricated current
event feeding every window, monitor, map and report. Checking only the event date
is not enough: the classifier INFERS an event date from caption text, so a pinned
years-old post whose caption names a weekday carries a current-looking date.
Provenance is what refuses it. Age is also checked before credibility so the skip
reason names the real blocker.

**How to apply:** one pure resolver, injectable clock, shared by the batch pass
and the manual promote route — two copies of this rule will drift, and the manual
route is exactly where an analyst would push an old post through. The stored
promotable/eligibility flag is computed at collection time and does NOT know
about this gate, so any read that shows an action button must re-derive it
server-side; never mirror the window length in the client. A flag re-derived in
application code cannot also be filtered in SQL: filter it after the policy is
applied and page the scan until the caller's limit is filled, or blocked rows
silently eat the page and vanish from both the filter and its complement. Count date rejections
in whatever "rejected" telemetry the pass reports, or the totals stop adding up.
Label rows no credible source stands behind as UNVERIFIED. Expect a historical
backlog to bucket almost entirely as too-old; that is the gate working, not data
loss.

Test fixtures for anything downstream of this gate must be dated RELATIVE to the
run. A fixture pinned to a calendar date silently ages out of the window and
turns unrelated promote assertions into "too-old" failures months later.
