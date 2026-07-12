---
name: Social promote corroboration gate (too loose) + owner-accepted false incidents
description: Why social_raw OSINT posts promote into incidents on weak corroboration, and the owner's explicit decision to accept the resulting false incidents.
---

The DB→DB social promote pass (`runSocialPromote`) turns un-promoted `social_raw`
OSINT rows into incidents. Every Facebook/Instagram row is collector-stamped
non-credible, so a row can ONLY promote when `pickCorroboration`
(`facebookOsintEligibility.ts`) matches it to a live incident. That scorer is
TOO LOOSE: `score = 0.5*overlap + 0.5*dateScore`, threshold 0.5, min 2 shared
tokens. Same-day date proximity alone contributes the full 0.5, so ANY 2
incidental same-country shared tokens (place/org names, generic 4+ char
Indonesian words, "2026") auto-corroborate. Result: non-incident KAMMI PR posts
(Eid greeting, seminar/forum promos, event-doc videos, rupiah commentary)
promote as fake "Civil unrest / protest — Indonesia" flashpoint incidents,
"corroborated" by unrelated earthquakes / wildfires / counter-terror seminars.

**Owner DECISION (2026-07-12): shown this false-positive behaviour in full, the
owner chose "commit anyway" and DECLINED tightening the gate.** The Facebook
"Papua & PNG" Apify dataset was committed (`import:apify-facebook --commit`):
90 new `social_raw` rows + 17 promoted incidents (8 KAMMI Instagram → flashpoint,
9 Facebook → 6 conflict + 3 flashpoint), all marked `analyst_notes=social_raw:%`,
`confidence=low`.
**Why:** the owner wanted the real social data in the feeds now, false positives
included. Do NOT purge these rows or "fix" the corroboration gate as unsolicited
cleanup — it was a deliberate, informed choice; reverting would undo their call.
**How to apply:** if a future task asks to cut false social-promoted incidents,
the real repair is requiring SECURITY-MEANINGFUL token overlap (not any shared
tokens) in `pickCorroboration` — confirm with the owner first.

**No native Instagram Apify dataset existed** in the account — only the
Facebook-shaped "Papua & PNG" dataset + a pre-existing KAMMI Instagram backlog
in `social_raw`. So the `scrape:instagram` provider itself was never validated
against real IG-shaped data; real Instagram (KAMMI) posts reached the feeds only
via this Facebook-importer-triggered promote pass.

Also: `runSocialPromote`'s COMMIT branch had never run for real — its final
count query destructured `db.execute(...)` as an array, but `db.execute` returns
`{ rows }` (cf. `tapaPromote.ts`). Per-row inserts commit BEFORE that line, so
the crash left data written but exit 1. Fixed to read `.rows`.
