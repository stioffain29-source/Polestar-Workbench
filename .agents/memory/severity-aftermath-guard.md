---
name: Aftermath / benefit severity guard
description: Why welfare-payout copy stores as High severity, and the shape any "this violence word is only a reference" severity guard and its DB heal must take.
---

A cheque written to the families of an earlier attack is not a fresh attack.
The kinetic word in "scholarships for the families of the shooting victims"
names the BENEFICIARIES, but it sits in the same clause as the handover, so the
violence tiers fire and the row stores High — High map markers and High fast
facts whose underlying text is a welfare announcement. The attack already has
its own row and its own rating.

**How to apply — the shape of a reference-only guard:**

1. Anchor the benefit term in the TITLE. A body mention must never demote a
   live report.
2. Strip the bounded reference span ("families of the <event>", "korban
   penembakan") and REQUIRE that something was actually stripped. Without that
   requirement the guard fires on a benefit announced ALONGSIDE a live event
   ("insurance payout offered as refinery fire spreads") and buries it.
3. Reject the span when it contains live framing (ongoing/active/fresh/
   berlangsung). A tolerant span matcher swallows qualifiers, so "victims of
   ongoing militant attack" would otherwise carry the live event away inside
   the reference, where no later veto can see it.
4. Re-rate the remainder through the canonical classifier, as a TITLE and a
   SUMMARY — never merged into one string. Tiers distinguish title-led framing
   from body context, so merging lets a body mention masquerade as the lead and
   silently flip the verdict.
5. Do not hand-write a second veto vocabulary: any hand-written list omits
   fire, outage, strike, curfew, seizure and maritime tiers, and each omission
   is a buried incident.
6. Apply the verdict as a demote-only CAP on the classifier's result, never as
   an early return — an early "low" would RAISE a row the classifier had put at
   insignificant.

**Healing stored rows:** severity is written once at ingest, so a classifier
change never reaches history by itself. A heal must compute the new tier
through the shared per-row function (classifier + structured fatality floor),
not write a flat tier, or a confirmed-toll row lands below what its toll
implies.

**When an earlier heal was too loose:** tightening the predicate does NOT undo
the rows the loose pass already flattened. The repair pass must be scoped WIDER
than the corrected guard — to the whole candidate class — and re-rate it
through the canonical function. Gate that upward repair on evidence the loose
pass actually ran in THIS database (its marker) and on the exact value it wrote;
otherwise a fresh environment, production included, silently gets up-rated by a
migration that is supposed to be demote-only.
