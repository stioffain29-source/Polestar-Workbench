---
name: Flashpoint numeric-claim audit
description: Prevent non-count numbers in source titles from causing false report-validation failures.
---

Slash-separated broadcaster or channel labels such as “24/7” are not incident-count claims. Neither are valid compact clock times when their syntax establishes a time, such as “scheduled from 1300,” “beginning 1800,” or “1500–1630.” The Flashpoint prose count audit must exclude these narrowly while retaining validation of genuine counts near incident-category nouns.

**Why:** Accepted source text included both a broadcaster’s “24/7” label and forward-schedule times. The final-output audit assigned those numbers to nearby protest/strike nouns and threw during rendering, blanking the report route.

**How to apply:** When expanding numeric-claim validation, test source-title metadata, labels, and schedule-time syntax that can appear beside incident nouns. Exclusions must be syntax-specific; do not broadly ignore four-digit numbers or relax canonical count comparisons.