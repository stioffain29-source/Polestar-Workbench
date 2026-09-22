---
name: Regional editorial gate repair
description: How a rejected regional analytical draft must be re-asked, and why a repair may only replace the failing section.
---

A regional weekly report is written by the model and then judged by hard validators
(word limits plus the content policy). When a draft is rejected, the retry must be
given **measurements taken from that draft**, not the same prose instruction that
already failed: the measured word count against the allowed range, the actual
offending sentences, which selected countries are named, and the evidence keys
required. A generic "leave a margin inside the limit" retry does not recover.

A repair replaces **only the sections the validator named**. Every other section is
retained verbatim from the previous draft, and the per-development analysis is kept
out of the rewrite entirely; a fixed-fact, evidence, severity, map, watch or
coverage failure is the only case that regenerates the whole analytical object.

Rules the writer cannot satisfy reliably must be stated as something countable.
"Synthesise regional risks rather than list separate country updates" is enforced as
a maximum number of sentences that name exactly one selected country, and that same
threshold is exported from the policy module so the prompt, the diagnostics and the
validator cannot drift apart.

**Why:** the outlook gate fired on a real creation attempt and the single blind
corrective retry did not clear it, so creation failed outright. Spreading a whole
regenerated narrative back over the draft would also let verified prose be reworded
or dropped silently, because the validators only check maxima and non-emptiness.

A partial-rewrite path is the trap when the content rules are version-gated.
Rebuilding a saved edition re-stamps it with the current editorial version, so the
current rules are then applied to prose that path deliberately preserves — and the
retry can only rewrite its own section, so the failure is unfixable. Such a path
must pre-flight the retained prose under the current rules **before** the first
paid call and say plainly that the edition predates the standard and needs full
regeneration. Never re-stamp it silently, and never half-correct it.

**How to apply:** when adding or tightening any regional editorial rule, add its
measurement to the diagnostics, state it countably in the instruction, and make sure
the failure message names the section it belongs to — the repair router matches
section names in the validator message, and an unrecognised message falls back to
full regeneration. Retries stay bounded (one generation plus two repairs); never
truncate the prose or fall back to raw headlines to satisfy a gate.
