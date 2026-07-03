---
name: Incident severity classification
description: How ingested flashpoint/cargo_watch incidents get their five-tier severity, and why a backfill exists.
---

Severity is rated from incident text (title+summary), not hardcoded. The scrapers used to
write `severity: "low"` for every row, collapsing the Severity Distribution chart to one bar.

- `classifySeverity(title, summary, topic)` in `lib/ingest/src/severity.ts` is the single source
  of truth, used by BOTH scrapers and the backfill. Tiers scanned highest-first; strongest signal wins.
- **Extreme is reserved** for fatal / mass-casualty / emergency-rule language only — this is the
  brand rule (subdued red `#A33232` marks Extreme only), so do not loosen the EXTREME regexes.
- cargo_watch has a moderate *floor* for a completed theft (stolen/robbery/burglary); pilferage/
  attempted/recovered drops to low. flashpoint defaults to low (peaceful/planned protest);
  forward-looking threats/plans/advisories → insignificant.

**Why a backfill exists:** scraper dedupe never re-touches existing rows, so fixing the scraper
alone leaves historical auto-scraped rows stuck at low. `runSeverityBackfill` reclassifies EXISTING
rows scoped to `analyst_notes LIKE 'auto-scraped:%'` (never overwrites analyst-entered severities).
It lives in the lib (not just the CLI script `scripts backfill:severity`) for the same reason as the
scrapers: the workspace only sees a read-only prod replica, so prod must be re-rated from the
deployment runtime which owns the writable DB.

**How to apply:** if you change the classifier signals, re-run `pnpm --filter @workspace/scripts run
backfill:severity -- --commit` on dev, and run the equivalent in the deployment to fix prod.

## Reaction / advocacy headline guard

A headline LED by an advocacy/statement verb ("<group> demands ban … seeks justice for six slain
Nagas") is a REACTION to a prior event — its casualty words ("slain", "killing") are references, not
a fresh attack — so it must NOT trigger the reserved Extreme/High tiers. `isReactionLed(title)` /
`REACTION_LEAD_RE` (title-lead anchored, {0,4} words; EXCLUDES protest/rally/clash, which can BE the
violent event) gates the shared Extreme, shared High, and conflict armed-clash High **only for
topic ∈ {flashpoint, conflict}**. Other topics (shipping/cargo/fuel/…) keep escalation on purpose: a
reaction-framed deadly maritime attack is often the ONLY record of a real kinetic event.

## Healing existing rows after a CLASSIFIER change — surgical migration, NOT the full backfill

**Why:** wiring `runSeverityBackfill` into `runIngestOnce` (or broadening its scope to re-rate the
whole auto-scraped table) re-applies the GDELT **fatality floor** (`severityFromFatalities`) and
historical classifier drift to ~every row — a dry-run flipped 217 rows and *increased* Extreme by
~59. That is off-scope drift for a targeted "stop over-rating X" bug and risks new complaints.
**How to apply:** heal existing rows with a marker-gated boot migration in `migrations.ts` that is
(a) auto-scraped only, (b) current High/Extreme only, (c) gated on the exact change (e.g.
`isReactionLed`), (d) **downgrade-only** (`SEVERITY_RANK[next] < stored`), and (e) STILL applies the
fatality floor (`next = floor ? maxSeverity(text, floor) : text`) so a confirmed-fatality row is
never downgraded. Fix the migration BODY (don't bump the marker key) when prod hasn't run it yet —
prod runs each marker once, and an uncorrected earlier body would execute first there.

## Fatal-WORD vs fatal-EVENT — the bare-"death" collision (and the bidirectional heal)

The reserved Extreme tier keys off a bare `\bdeath\b`/`\bkilled\b`, which fires on text where a fatal
WORD is present but no fatal EVENT happened. Three guards in `severity.ts` strip these out of the
Extreme gate (each: detect the non-event phrasing, then re-test EXTREME on the stripped text so a
headline that ALSO carries a real killing — "10 killed; mastermind sentenced to death" — still rates
Extreme):
- `isNaturalCauseDeath` — lightning/flood/earthquake/drowning deaths with NO security/crowd signal.
- `isJudicialDeath` — "sentenced to death" / death sentence / death penalty / death row / death
  anniversary. **Why this guard can't reuse the security keep-list:** "sentenced to death for role in
  protest crackdown" contains "protest", so a security-signal gate would wrongly keep it — the
  judicial guard must be the strip-and-retest, independent of the crowd/security keep-list.
- The INVERSE problem (fatal EVENT under-rated): present-tense kills and past-tense "killed" + a
  kinetic noun (`isFatalKineticAttack`) were stored High/Low by legacy/stale rows the present-tense
  predicate alone missed. Also widen the fatal vocabulary as real misses surface — e.g. "burn(ed|t)
  alive" was absent (only "burn to death" existed) so an airstrike that "leaves prisoners burned
  alive" read Low.

**Why the heal is now bidirectional:** the original reported bug was two-sided (fatal airstrikes
under-rated AND non-killing "death" headlines over-rated), so the boot migration scans
machine-provenance (`auto-scraped:%` / `legacy:db`) flashpoint/conflict/strikes rows and does BOTH:
UPGRADE on `isFatalKineticAttack || isPresentTenseFatalOrPluralStrike` (strictly higher) and
DOWNGRADE on `isNaturalCauseDeath || isJudicialDeath` (strictly lower). Marker bumped per classifier
change. **Scope discipline that held:** do NOT blanket re-rate `legacy:db` rows whose stored Extreme
the classifier wouldn't reproduce (e.g. a military-PR "anniversary" headline) — that is the
flagged-unsafe ~414-row territory; the heal only touches rows a specific predicate matches. The
Missile Strike Tracker (`strikes` TABLE, separate from the `strikes` topic) is left untouched.

## Illness / biographical death — the FOURTH strip-and-retest guard, and its cancel-list trap

`isBiographicalOrIllnessDeath` joins natural-cause/judicial as a guard against bare-`death` over-rating:
a Father's-Day-concert puff piece ("the death of his father … to Covid-19" six years ago) read
EXTREME. It fires on illness/obituary/biographical cues (covid/cancer/"passed away"/"death of his
father"/"late father") **only when no `SECURITY_OR_CROWD_SIGNAL_RE` is present**.
**Trap:** that cancel-list is what stops the guard from suppressing a REAL violent death that merely
mentions a relative ("death of his father after a hijacking"). It was missing common violent-crime
cues — `robber*|hijack*|homicide|murder*|kidnap*|abduct*|hostage` — so adding new bio cues without
those creates false-negative suppression. The cancel-list errs toward KEEPING Extreme; widen it in
lockstep with any bio-cue addition.

## A dateline YEAR misread as a mass body-count (false Extreme)

The mass-casualty regexes (`MASS_COUNT_FATAL_RE` = a count then a fatal word within ~3 words)
matched a bare 4-digit YEAR standing in for the toll: "Trial begins in **2025** Lorain shootout
that **killed** 2" read EXTREME — "2025" satisfied `MASS_COUNT`, then "...shootout that killed"
satisfied the fatal-word window. `COUNT_UNIT_GUARD` only rejects a number FOLLOWED by a unit
("200 jobs", "10-year-old"), not a year used AS the count.
**Fix:** a year guard inside `MASS_COUNT` — `(?!(?:19|20)\d\d\b)` before the numeric branch — so a
19xx/20xx token can never be the count. A REAL toll next to a year survives because the real number
is elsewhere ("**2019** Pulwama attack that **killed 40**" → 40 matches → still Extreme).
**Why / how to apply:** any headline carrying a four-digit year within a few words of killed/dead is
a false-Extreme risk; tradeoff is a rare text-only toll of exactly 1900–2099 deaths is now
suppressed (acceptable — structured `severityFromFatalities` still floors those to Extreme).

## Confirmed-killing → HIGH rule placement (cannot suppress Extreme)

The "killed in military op → low" under-rating is fixed by a confirmed-killing→**High** rule placed
AFTER the Extreme + High scans and BEFORE Moderate, so it can only lift a sub-High row and can
NEVER downgrade a genuine Extreme (mass-casualty is matched and returned first). Extreme stays
reserved for a mass toll ≥ `MASS_FATALITY_THRESHOLD` (6) — a single/low-count killing is High, by
design. There are **two entry paths**, both gated by the strip-and-retest death guards:
- fatal-signal regex AND `SECURITY_OR_CROWD_SIGNAL_RE` both match (the original path); OR
- a **victim→verb past-tense killing on its own** (`PAST_TENSE_FATAL_RE` = a `FATAL_PERSON` within
  ~2 words of an explicit killing verb) — needed because "American Pilot Killed in Papua; TPNPB …"
  names NO security-keyword noun ("pilot"/"TPNPB" aren't in the keep-list), so requiring a separate
  security keyword missed it. `hasConfirmedKillingSignal` exports this for the heal predicate.

**The victim→verb path needs a FIFTH guard — `accidentalDeath`** (`ACCIDENTAL_DEATH_RE` gated on no
security signal). Without it, transport/workplace/industrial deaths ("driver killed in crash",
"worker killed in factory accident", "miners killed in mine collapse") carry `FATAL_PERSON` + a kill
verb and would over-rate to High. **Bind structural-collapse terms to a structure noun**
(mine/building/roof/wall/scaffold collapse) so a bare "collapse" (e.g. a ceasefire collapse — a
security event, not an accident) never matches and never suppresses a real killing.

## Cross-language gap — severity is set at INGEST, BEFORE translation

`classifySeverity` is English-only and runs at ingest, *before* `display_title` translation, so a
non-English violent headline matches no keyword and falls to the LOW default — a Bahasa "Pelajar …
ditembak saat operasi militer" (student shot in a military op) read LOW. **Do NOT fix this by moving
classification after translation** (translation is best-effort/optional and may never run). Fix it
with language-specific markers in the classifier itself: `ID_FATAL_RE` (violent killings → Extreme),
`ID_VIOLENCE_RE` (violence/injury → High), surfaced via `hasIndonesianViolenceSignal`. Keep them
TIGHTLY violence-bound and exclude cross-language homonyms — `serangan` (also "heart attack"),
`korban jiwa` (also disaster/accident tolls) — and mirror the violent terms into
`SECURITY_OR_CROWD_SIGNAL_RE` so the death guards never suppress a genuine foreign-language killing.
The heal upgrades existing Bahasa-violence rows; other languages remain an open gap (extend the same
way per language).

**Bare `tewas` (died) is a two-sided homonym — gate it, don't blanket-exclude.** Explicit Bahasa
killings floor High unconditionally (`ID_FATAL_RE`: `tembak mati` shot-dead, `tewas tertembak`
died-shot, `tertembak` shot). But bare `tewas` alone is BOTH a disaster toll ("10 tewas akibat
banjir" — flood) AND a real killing, so it escalates ONLY when a Bahasa security context co-occurs
(`ID_BARE_TEWAS_RE` gated by `ID_SECURITY_CONTEXT_RE` — operasi militer / TNI / Polri / KKB /
penembakan …). This admits "Operasi Militer …, Gembala GKII Tewas" (High) while leaving the flood
toll off the floor — an earlier blanket-exclude of `tewas` dropped genuine killings.
