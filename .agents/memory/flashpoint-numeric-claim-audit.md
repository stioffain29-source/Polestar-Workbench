---
name: Flashpoint numeric-claim audit
description: Prevent non-count numbers in source titles from causing false report-validation failures.
---

Slash-separated broadcaster or channel labels such as “24/7” are not incident-count claims. The Flashpoint prose count audit must exclude both sides of such labels while retaining validation of genuine counts near incident-category nouns.

**Why:** An accepted source title containing a broadcaster’s “24/7” label was included in grounded report prose. The final-output audit assigned both numbers to a nearby protest noun and threw during rendering, blanking the report route.

**How to apply:** When expanding numeric-claim validation, test source-title metadata and labels that can appear beside incident nouns. Exclusions must be syntax-specific; do not broadly ignore numbers or relax canonical count comparisons.