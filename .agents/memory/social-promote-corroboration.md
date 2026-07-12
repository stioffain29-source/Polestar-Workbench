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

**RESOLVED (2026-07-12, superseding the earlier "commit anyway").** The gate was
tightened: `pickCorroboration` now requires at least one SHARED security-EVENT
token (`CORROBORATION_MIN_SECURITY_SHARED`, reusing `hasSecurityEventSignal` at
token granularity), so date proximity + incidental place/org/generic-word overlap
can no longer corroborate. `pickDuplicate` is UNCHANGED (looser duplicate-block is
fine — it only prevents double-count). No `RELEVANCE_RULE_VERSION` bump (this is
promote-gate logic, not the relevance engine).
**Why:** every fake was a non-credible OSINT row promoted ONLY via loose
corroboration to an unrelated same-country incident (earthquake/wildfire/seminar)
that shared no event vocabulary. Requiring a shared event term keeps genuine
security posts promotable while dropping PR/greeting/announcement noise.
**Owner also chose (2026-07-12) to REMOVE the earlier false batch.** A one-off
re-derivation under the new gate deleted 11 of the 16 promoted incidents
(10 not-credible + 1 now-duplicate) and reset their `social_raw` back-links to
context-only; the 5 declared-credible-source rows stayed. Candidate pool for the
re-derivation EXCLUDED social-promoted incidents so a fake couldn't corroborate a
fake. This was done on the DEV DB only — prod would need a boot migration if its
own promoted rows must be purged.
**How to apply:** the corroboration gate is now the durable fix; if new false
social incidents ever appear, check `CORROBORATION_MIN_SECURITY_SHARED` and the
`SECURITY_EVENT_CUES` coverage before loosening anything.

**No native Instagram Apify dataset existed** in the account — only the
Facebook-shaped "Papua & PNG" dataset + a pre-existing KAMMI Instagram backlog
in `social_raw`. So the `scrape:instagram` provider itself was never validated
against real IG-shaped data; real Instagram (KAMMI) posts reached the feeds only
via this Facebook-importer-triggered promote pass.

Also: `runSocialPromote`'s COMMIT branch had never run for real — its final
count query destructured `db.execute(...)` as an array, but `db.execute` returns
`{ rows }` (cf. `tapaPromote.ts`). Per-row inserts commit BEFORE that line, so
the crash left data written but exit 1. Fixed to read `.rows`.
