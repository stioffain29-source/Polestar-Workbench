---
name: LLM reasoning-model token cap
description: gpt-5* reasoning models burn max_completion_tokens on reasoning FIRST; a low cap returns empty content and silently fails (no error status).
---

gpt-5-mini / gpt-5* are REASONING models: `max_completion_tokens` is consumed by
reasoning tokens BEFORE any visible output. A low cap is fully spent on reasoning →
HTTP 200 with `finish_reason="length"` and EMPTY content. The call does not error —
it just returns nothing, so callers that treat empty as failure "fail" with no clue why.

**Why:** title translation shipped raw Bahasa headlines to readers; prod logged
`translated=0 candidates=3 failed=3`. Empirically reproduced: 200-cap →
`reasoning_tokens=200`, `content=""`; 8192-cap → `finish=stop`, correct translation.
A one-line headline needs only ~30 visible tokens — everything else is reasoning
headroom, NOT output cost.

**How to apply:** any chat-completions call to a gpt-5* model MUST set
`max_completion_tokens` ≥ 8192 and never lower (matches the OpenAI integration skill).
It is an UPPER bound, not a target, so cost/latency rise only with actual reasoning.
Failure is INTERMITTENT: short/simple inputs fit under a small cap (some rows succeed),
harder ones blow it — so "most rows work, a few ship raw" is the signature, not a
marker-list gap. Audit ingest LLM sites together: title translation + cargo
translate/screen + country prose must all stay at ≥8192.
