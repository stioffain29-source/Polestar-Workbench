---
name: Flashpoint video-cruft title clean
description: Why flashpoint titles strip "Watch:"/"VIDEO BY" cruft and why the rendered title and the dedup key MUST share one cleaner.
---

# Flashpoint video-cruft title clean

Wire/social feeds prepend a video call-to-action ("Watch:", "Video -", "MUST
WATCH:") and append an attribution credit ("VIDEO BY <NAME>", "(VIDEO)",
"[WATCH]", "- WATCH NOW"). In a STATIC PDF this is meaningless, and worse: a
"Watch:" prefix shifts the dedup key, so the SAME event survives twice.

**Rule:** clean the RENDERED display title AND the dedup signature with the SAME
function. In `flashpointReportDataset.ts`, `cleanDisplayTitle = stripWireCruft(stripMasthead(x))`,
`normaliseTitle()` calls it first (so `titleKey`/`topicSignature` ignore the
cruft), and `enrich()` sets `title: cleanDisplayTitle(r.title)` on the returned
row — classification still runs on the ORIGINAL `r.title`. Because the flashpoint
preview, Related Incidents, and the headless PDF all render `r.title` from the
one dataset, this is preview==PDF parity for free.

**Why:** if you clean only the display title, the two syndicated copies still
dedup apart (key built from raw title) and the table double-counts. If you clean
only the key, the table shows the cruft. One cleaner for both is the invariant.

**No-fabrication boundary (don't regress):**
- Leading strip fires ONLY when a separator (`: - | em-dash`) follows the
  keyword, so "Watch out for protests" is never touched.
- Trailing "VIDEO BY" strip is CASE-SENSITIVE on a capitalised `VIDEO`/`Video` +
  capitalised credit name(s) running to the end. A lowercase prose clause
  ("...video by citizen journalist goes viral") and a sentence-start "Video by
  far the biggest protest" must stay intact. An earlier lowercase-greedy
  `/video by.*$/i` corrupted such headlines — flagged in review.
- Trailing bare WATCH/VIDEO strip REQUIRES a leading separator, so "overnight
  watch" / "clash on video" are safe.

**How to apply:** any new wire-cruft pattern goes in `stripWireCruft` (used by
both surfaces) and gets a no-false-positive regression test in
`__tests__/workbench/flashpointTitleClean.test.ts`. Display/dedup-only change —
no `RELEVANCE_RULE_VERSION` bump.
