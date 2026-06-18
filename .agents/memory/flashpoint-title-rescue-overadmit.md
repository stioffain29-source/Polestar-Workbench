---
name: Flashpoint title-rescue over-admit + monitor dedup
description: How the flashpoint relevance title-rescue re-admits metaphors/enforcement stories, and where the monitor/dashboard collapse syndicated rewrites.
---

# Flashpoint title-rescue over-admit & monitor dedup

`FLASHPOINT_TITLE_RESCUE_RE` rescues a row when the HEADLINE carries an
unmistakable public-order word (bare `protest`, `crackdown`, `rally`, …). It runs
in `explainRelevance`'s flashpoint branch and is powerful: it bypasses the
body-context excludes. So any *false positive whose headline merely contains*
one of those words leaks back in. Two real classes seen:

- Metaphor: "instant protest" (a quoted figure of speech) rescued by bare `protest`.
- Animal-welfare / wildlife enforcement: "Vietnam rescues 400 cats in major meat
  trade crackdown" rescued by `crackdown`.

**Rule — fix false positives BEFORE the rescue, never by loosening it:**
1. If the headline phrase itself is unambiguous noise, add it to
   `FLASHPOINT_TITLE_HARD_EXCLUDE` (the homonym check runs *before* the rescue).
   Also add to the body-level `FLASHPOINT_EXCLUDE` for defence in depth.
2. If the class needs nuance (drop enforcement stories but KEEP a genuine
   animal-rights protest), add a gated drop placed AFTER the hard-exclude but
   BEFORE the rescue, with a `PUBLIC_GATHERING_OVERRIDE_RE` (protest/rally/march/
   gather/demand/…) so a real demonstration survives. Mirrors the conflict
   violence-override pattern.
**Why:** loosening the rescue (or widening the broad REQUIRED set) re-breaks
genuine protests that share an ambiguous token. The pre-rescue gate is surgical.

**Precision of the gates themselves (avoid the opposite error — false NEGATIVES):**
- A pre-rescue HARD-exclude is aggressive (runs on every flashpoint title), so
  gate it on the *retrospective/administrative* signature, not a bare noun. The
  "compensation aftermath" drop requires a claims NOUN **and** a RESOLUTION verb
  (settled/paid out/processed/approved/disbursed/reimbursed) in proximity — a
  bare `compensation claims` noun, or grievance verbs (unpaid/rejected/pending),
  would have swallowed a live "rally over unpaid injury claims".
- A metaphor exclude that lives in `FLASHPOINT_EXCLUDE` (AFTER the rescue) still
  needs a guard against the genuine event co-occurring. The tariff-economics
  metaphor drop carries a leading negative-lookahead bailout
  `^(?!.*\b(workers|union|staff|…) (strike|walkout|…)\b)` so "tariffs hit
  factories as workers strike" (a real labour stoppage that does NOT title-
  rescue on its own) survives. Beware traps: "forced-labor" must NOT trip a
  `labour` guard, so the guard needs the worker-noun immediately followed by the
  stoppage verb (and I dropped bare `labour` from the worker list).
**How to verify:** replay the regexes over the targets AND hand-written
edge-case keeps in `code_execution` before trusting — this lib has no vitest
harness; empirical replay (regex test + live-row executeSql) is the convention.

**Always bump `RELEVANCE_RULE_VERSION` (`lib/relevance/src/evaluate.ts`)** so the
api-server boot `backfillRelevance` re-evaluates and re-cleans the DB. Dev cleans
on the next workspace restart; **prod only re-cleans after a republish** (prod DB
is read-only from the workspace; the boot runs in the deployment runtime).

**Monitor/dashboard syndication dedup:** `resolveTrueIncidents("flashpoint"|"protests", …)`
routes to `resolveFlashpointTrue` (`artifacts/workbench/src/lib/trueIncidents.ts`):
relevance-gate, then collapse syndicated rewrites with the report builder's
`dedupeByTitle` (now EXPORTED from `flashpointReportDataset.ts`). This keeps the
monitor count == dashboard-card count (the trueIncidents invariant). The report
builder still has its OWN deeper window-bound kinetic/court dedup — that is
separate and unchanged.

**Masthead-strip trap (why syndication survives dedup):** Google-News titles
append the outlet after a space-padded ASCII " - "/" | " ("Indonesia Protest -
The Herald Journal"), so the SAME wire across N outlets makes N distinct
`normaliseTitle` keys and survives as N cards. `stripMasthead` peels that suffix
before the dedup signature. Bound the peeled tail by WORD COUNT (≤6 words) and
keep a ≥2-word head — do NOT forbid `-`/`.` in the tail: publisher names contain
them ("Journal-News.com", "bdtonline.com"), and a `[^-|]` tail silently leaks
hyphenated outlets as separate cards. em-dashes (—) are left intact (real
clause separators).
