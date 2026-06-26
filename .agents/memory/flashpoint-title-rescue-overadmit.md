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

**`protest`/`crackdown` are TWO-SENSE homonyms — sense-gate, don't keyword-match.**
Keeping a row because the headline/body merely *contains* `protest` or `crackdown`
admits four big non-civil-unrest classes: diplomatic complaints ("Manila lodges
protest with China"), interstate/territorial complaints ("Cambodia protests Thai
heritage listing"), symbolic individual gestures ("artist returns medal in
protest"), and enforcement-of-crime crackdowns ("crackdown on electricity theft").
Fix = make these tokens NON-rescuing and NON-required, then decide by SENSE:
- Removed bare `protest`/`crackdown` from the title-rescue set
  (`FLASHPOINT_TITLE_RESCUE_UNAMBIG_RE`) and from `REQUIRED.protests`/`.flashpoint`.
- A verdict fn `flashpointProtestCrackdownVerdict(text, negText)→boolean|null`,
  wired as step 0b (headline) and step 3b (body, after REQUIRED firstMatch):
  `protest` → KEEP if a civil-unrest/violence cue is in PROXIMITY (`.{0,40}` gap,
  `FP_POS_DEMO`/`FP_POS_VIOLENCE`); else DROP if a NEG cue
  (`FP_NEG_GESTURE`/`_DIPLOMATIC`/`_INTERSTATE`); else keep-default (null,
  fail-open). `crackdown` → DROP if `FP_NEG_CRACKDOWN` (crime-enforcement sense)
  AND no `FP_UNREST_COMPANION` word; else keep.
**Critical split: POS uses the full haystack `text`; NEG uses `flashpointNegText`
(title+summary ONLY)** — scanning the source name/URL for NEG words gave false
diplomatic hits (outlet "The Diplomat", "/world/" URL paths). **Why keep-default
is fail-open:** an unrecognised non-civil `protest` use can still slip through, but
that preserves recall — the alternative (drop-unless-positive) silently kills
genuine demonstrations whose headline lacks a violence cue.
**Verified:** real compiled module over the 2994-row flashpoint+protests audit set
→ 72 drops, 0 adds (purely subtractive for these rows). Note: the new keep reasons
score 0.5 in `evaluateIncidentRelevance` (don't match its score-1 regex), but
`relevance_score` is written-only/never read, so it has no functional effect.

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

**Editorial suppression of GENUINE protests (operator per-item removals):** when
the operator wants a specific REAL protest gone (not in any noise category, so the
categorical excludes correctly keep it), do NOT loosen rules — they'd nuke legit
controls. Use `FLASHPOINT_EDITORIAL_SUPPRESS` (an array of tightly title-bound
regexes), checked at the VERY TOP of the flashpoint branch (before title-rescue /
the protest verdict, which would otherwise KEEP them), returning reason
`editorially suppressed (operator-removed protest)`. Bind each pattern to its one
headline (`\bdemands raised by\b…\bwomen's alliance\b`, not bare `demands`). Durable
across backfills (it's in the engine, not a manual DB flip which a later version-
bump backfill reverts). Bump `RELEVANCE_RULE_VERSION`.

**Four more visible-junk classes the protest gate keeps (fixed pre-rescue/early):**
- **Figurative "roadblock"** — bare `roadblock` is a REQUIRED protest tactic, so an
  OBSTACLE-METAPHOR headline ("programme has faced roadblocks", "funding roadblocks
  to the deal") leaks in. Drop only when an obstacle collocation matches AND there
  is NO real-unrest companion (`FP_REAL_UNREST_COMPANION_RE`: protest/march/strike/
  clash/…). The collocation gate (faced/major/political/funding/… + roadblock) is
  what spares a GENUINE "Murray Barracks Roadblock" soldiers' standoff and "roadblock
  robbery" — those have no metaphor collocation so the regex never matches them.
- **Cancelled / suspended industrial action** (non-event) — title-bound: a cancel
  verb (call off/suspend/postpone/defer/scrap/cancel/avert) within `[^.]{0,18}` of
  strike/walkout/stoppage/industrial-action, gated OUT when the title also says it
  CONTINUES or turned to unrest (`continu*/resum*/protest/clash/charge/defy/escalat/
  riot/violen*/killed/injured`). DELIBERATELY excludes the verbs `withdraw` and
  `drop` — "withdraw strike suspension, continue protest" RESUMES action and "drop
  charges against protest leader" is advocacy, both must KEEP. Verb breadth here is
  the trap; the keep-gate is title-only (matches the validated executeSql sweep).
- **Multi-topic news digest** ("CJP's first protest, India-Nepal ties, and Vizag
  steel plant accident") — protest is one bundled list-item, no safe GENERAL rule
  exists, so bind a tight title regex in `FLASHPOINT_OFFTOPIC_DIGEST` to a unique
  co-occurring phrase (`first protest`…`vizag steel plant accident`). Avoid the
  apostrophe in the binding token — DB titles use a CURLY ’ (U+2019), straight `'?`
  won't match.
- **Scraped CMS/CSS dumped into the body** — a malformed scrape (".full-viewport-
  wrapper img { width:100%; object-fit:cover; max-height:calc(…) }") is junk for ANY
  topic, so it goes in the general `EXCLUDE_PHRASES` (runs first, all topics):
  `/\{[^}]{0,40}(object-fit|max-height:\s*calc|width:\s*100%)/` + `viewport-wrapper`.
**Three MORE classes the protest verdict (not the rescue) kept (fixed pre-rescue):**
- **Appeal-for-calm preventive statement** ("PNP calls for calm as Congress
  convenes") — an authorities' statement, no event. Drop when the TITLE is the
  appeal AND the title has no event word AND the full text has no LIVE-unrest. Two
  keep-guards (`FP_CALM_TITLE_EVENT_RE`, `FP_CALM_LIVE_RE`) so "After deadly
  protests, PM urges calm" / "Police call for calm after deadly clashes" survive.
- **Overseas/diaspora venue** — a London/Washington solidarity demo the geocoder
  mis-tags to an APAC country (Oxford Union, Downing Street, White House, …).
  `FP_OVERSEAS_VENUE_RE` + a protest word → drop. Both the Oxford and a "British
  Tamils protest at Downing Street" row are this class.
- **Recruitment-industry complaint over a foreign REQUIREMENT** ("Recruiters
  protest Saudi skills test requirement") — a commercial-lobby grievance, not
  street unrest. actor(recruit/manpower/…) + protest + object(test/rule/quota/…),
  gated OUT by any public-order signal (`FP_INDUSTRY_STREET_RE`: rally/sit-in/
  arrests/outside-ministry) so a real agency street action keeps.
**Four MORE non-civil-unrest classes the protest gate kept (fixed pre-rescue):**
- **Security-deployment preparation** ("Police deploy 4,131 personnel to secure
  Jakarta protests") — a logistics/posture statement, not an event. Drop on
  deploy-verb + force + secure-purpose + a protest word, gated OUT by
  `FP_CALM_LIVE_RE` so a real POST-clash deployment keeps.
- **Labour/industrial-tribunal ruling** ("Fair Work rejects gas giant's claim
  strikes…") — a legal-PROCESS story about whether industrial action is lawful,
  not a stoppage. tribunal-body + strike/industrial-action + process-verb, gated
  OUT by `FP_TRIBUNAL_ACTIVE_STRIKE_RE` so a strike actually under way/cleared keeps.
- **Press-freedom / coverage-suppression** ("silencing PoJK unrest coverage as
  journalist faces detention") — the unrest is the censored REPORTING SUBJECT.
  suppress-of-coverage + press-actor, gated OUT by `FP_PRESS_REAL_VIOLENCE_RE` so a
  journalist hurt in actual violence keeps. (FP_CALM_LIVE_RE is UNUSABLE as the
  guard here — it matches bare "detain".)
- **School-admission / enrolment grievance** ("Kuja residents protest SPMB,
  children not accepted") — an administrative complaint over a student-intake
  system (SPMB/PPDB/zonasi/"not accepted"/"tidak diterima"), not unrest. protest +
  admission-system, gated OUT by `FP_INDUSTRY_STREET_RE` (real street escalation).
- **Diplomatic protest via the foreign ministry** ("urges DFA protest") — added
  DFA/foreign-ministry/state-department alternatives to `FP_NEG_DIPLOMATIC`, so the
  existing protest-verdict step 0b drops it (DFA = Dept of Foreign Affairs, PH).

- **Court / judicial process** ("South Korea court sentences ex-President Yoon to
  30-year jail term") — a legal OUTCOME, not a civil-unrest event, yet it was kept
  (and rated Extreme) and so CROWNED South Korea highest-severity country on the
  monitor. `FP_COURT_PROCESS_RE` (court/tribunal/judge + sentence/jail/convict/
  verdict/…, plus bare "jail/prison term", "N-year jail") placed AFTER school-
  admission, BEFORE the title-rescue, gated OUT by `FP_COURT_UNREST_KEEP_RE` so a
  verdict that actually SPARKS protests/clashes keeps. The monitor's highest-
  severity-country Fast Fact reads the relevance-filtered set, so dropping the row
  from relevance fixes the headline number directly — no UI change needed.
  - RECURRENCE (same SK martial-law case, reworded): "Ex-justice minister GETS 25
    YEARS JAIL for martial law role" slipped the drop — NO institutional court
    word, and the year branch was singular `\d+[- ]year (jail|prison)` so plural
    "25 years jail" missed. Broadened to `\d+[- ]years? (in )?(jail|prison|
    imprisonment|behind bars)`. In LOCKSTEP the keep-guard path (c) gained
    `jail\w*|imprison\w*` outcomes, else "protesters clash AFTER X jailed"
    false-drops (no verdict/sentence word). The monitor re-derives via
    isTopicRelevant so it self-heals at render once redeployed; persisted prod
    rows additionally need the RELEVANCE_RULE_VERSION bump + boot backfill.
    Whenever you touch the court drop, widen the drop AND the keep-guard together.
  - RECURRENCE #2 — ROOT CAUSE was TWO INDEPENDENT LAYERS, only relevance ever
    guarded. The crowning needs BOTH a relevance miss AND a high severity. Severity
    (`lib/ingest/src/severity.ts`) rated the row Extreme because the reserved EXTREME
    tier's `martial law|state of emergency` trigger fires on ANY mention — even a
    retrospective court reference ("...for martial law role"). Defence-in-depth fix:
    a judicial-process guard mirroring `isJudicialDeath` — strip the emergency phrase
    and re-test EXTREME, suppressing Extreme ONLY when the emergency phrase was the
    SOLE extreme signal AND the frame is judicial (`isJudicialProcess`: custodial-
    sentence shapes; bare "verdict"/"prosecutor" EXCLUDED — election-verdict
    collision). GATED by an active-declaration backstop (`ACTIVE_EMERGENCY_RE`:
    declares/imposes/extends/... emergency, either order) so a GENUINE live
    declaration — even one whose summary also mentions a trial — stays Extreme.
    **Invariant:** keep severity `JUDICIAL_PROCESS_RE` sentence-pronouncement shapes
    in lockstep with relevance `FP_COURT_PROCESS_RE` ("gets/handed/to serve + life|N
    years"), or the two layers drift and the class re-opens. Historical stored rows
    re-rate via the marker-gated `runSeverityBackfill` (bump the migrations marker)
    AND the RELEVANCE_RULE_VERSION bump; prod only after a republish.

**Keep-guard \b trap (cost me a test cycle, TWICE):** event keep-guards MUST use
leading-\b STEMS (`protest`, `clash`, `kill`), never a trailing-\b literal —
`/\bprotest\b/` misses "protests"/"protesters", so an inflected real-event headline
leaks past the guard. Same lesson as the strike-target leading-\b-only rule.
**Specifically: `FP_REAL_UNREST_COMPANION_RE` (line ~438) IS itself the trap** —
it is `\b(protest|…|clash|…)\b` with trailing \b, so it misses "protests"/"clashes".
Do NOT reuse it as a keep-guard for a new drop; write a fresh leading-\b-stem regex
(that is why `FP_COURT_UNREST_KEEP_RE` exists separately).

**Prove it three ways:** jest fixtures (DROP targets + KEEP controls) in
`__tests__/relevance/protestsFeedRelevance.test.ts` (run `pnpm exec jest`), the live
`/api/incidents?topic=flashpoint` feed must lack the junk but show it again under
`?includeIrrelevant=true` (filtered, not deleted), and a re-screenshot of
`/topics/protests`. Caveat: a feed grep can match a junk phrase inside a DIFFERENT
row's SUMMARY (the flagged headline may be prod-only via feed non-determinism) —
confirm by TITLE, not a substring of the JSON blob, before claiming a leak.
