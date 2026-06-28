---
name: Country-report fire/explosion wording gate
description: How the generic country-report Fire & Explosion paragraph decides "deliberate cause" wording, and why it must gate on `deliberate`, not `security`.
---

# Country-report fire/explosion paragraph: strict deliberate gate

The generic country-report (Indonesia/PNG/West Papua; NOT Jakarta — Jakarta has its
own `jakartaBrief.ts` theme paragraph) Fire & Explosion paragraph in
`countryIncidentThemes.ts` (`buildFireParagraph`) writes source-safe operational
language: it states what is known (incidents + where), that cause was not
consistently identified, and the operational concern (local disruption). It does
NOT classify cause unless a source explicitly says so.

The security-relevant sentence ("Where source reporting identified deliberate fire
or arson, it has been treated as security relevant…") is gated on
`summariseFireCauses(items).deliberate > 0`, where `deliberate` counts ONLY
`classifyFireCause` causes `arson-suspicious` or `attack-related`.

**Why:** the user's no-fabrication mandate forbids classifying a fire's cause
(deliberate/arson/attack/security-relevant) unless a source explicitly states it.
The classifier's broader `security` relevance ALSO includes `protest-related`
fires, which are mere contextual association (a fire near a protest), not an
explicit deliberate cause. Gating on `.security` would falsely print the
deliberate/arson sentence for protest-adjacent fires. `deliberate` was added as a
separate, additive field precisely so `.security` semantics stay intact for the
other consumer (`pngReportDataset.ts`).

**How to apply:** never loosen the fire wording gate back to `.security`. If new
deliberate cues are added, extend `classifyFireCause`'s `arson-suspicious` /
`attack-related` tags so `deliberate` picks them up — do not widen the gate.
Forbidden methodology/backend wording in the report body (e.g. "recorded as not
yet reported", "Arson or attack is not inferred", "Some fires were deliberate and
others accidental or operational") must stay out.
