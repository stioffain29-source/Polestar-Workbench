---
name: Conflict Watch report — coverage breadth & hotspot prose
description: Why the conflict report read too narrow + too repetitive, and the two structural rules that keep it honest and readable.
---

# Conflict Watch (topic='conflict') report quality

Two failure modes hit this report together; both are structural, not data bugs.

## 1. Coverage read too narrow ("No other theatres" while theatres were active)

**Cause:** (a) conflict used a WEEKLY window — too short for slower-burn, multi-theatre
civil-war topics, so quiet-week theatres (Myanmar, West Papua) fell outside it; and
(b) the conflict REQUIRED relevance gate only matched bare protest/insurgency keywords,
so genuine kinetic civil-war headlines (junta shelling, air/drone strikes, resistance
forces — PDF/Karenni/KIA/TNLA) were tagged irrelevant and silently dropped.

**Rule (UPDATED):** Conflict is a WEEKLY product (7-day window, NOT in `MONTHLY_TOPICS`)
— the user explicitly chose weekly; a 30-day window pulled in stale, out-of-week
incidents. Coverage breadth now comes from (a) kinetic/casualty-bound relevance vocab
AND (b) the Option-B out-of-window pull-in (see section 3), NOT from a wider window.
**Why:** the brief must read as "this week", but a recent high-impact theatre whose last
attack fell just before the week must not vanish at the window edge.
**How to apply:** new civil-war vocabulary must be kinetic- or casualty-bound (weapon,
offensive action, or `actor.{0,40}casualty`), NEVER a bare actor/place name, so
diplomacy/trade/state-visit/humanitarian background pieces still fail. Excludes run
BEFORE required, so adding excludes is always safe. Any gate change needs a
`RELEVANCE_RULE_VERSION` bump or the persisted rows never re-tag on boot. Peace /
"insurgency-free" / "free of insurgency" declarations name an actor word but are the
OPPOSITE of an armed event — exclude them, guarded by `CONFLICT_VIOLENCE_OVERRIDE` so a
genuine kinetic event in the same headline still keeps.

**Precision watch:** `fighting between` and bare group terms (karenni/tnla/mndaa/
brotherhood alliance) are broader than strictly kinetic — replay against live rows to
catch political/humanitarian false positives.

## 2. Prose repeated the lead hotspot ~6×

**Rule:** the FULL lead-hotspot phrase (e.g. "the Afghan border and Khyber Pakhtunkhwa")
may be named at most TWICE — once in the Situation overview and once in the lead
theatre's own paragraph. Every downstream section (What Matters / Watch Next /
Polestar View) must vary it: a generic "the worst-hit parts of <theatre>" /
"where the violence is concentrated", or a SINGLE primary hotspot (first label only).
**Why:** naming the same two-part phrase in every section reads as broken repetition.
**How to apply:** there is a `primaryHotspot()` helper; a hygiene test asserts the full
phrase appears ≤2× across the narrative and never in What Matters/Watch Next/Polestar.

**Phrasing trap:** a single hotspot label is often a border/belt ("Afghan border",
"Naxal belt") which does NOT take "in" — use **"around <hotspot>"**, not "in <hotspot>"
(avoids "in the Afghan border" and the double-"in" of "sits in X in <country>").
Reserve the localised "rest of the country is far quieter" reassurance for theatres
with ≥50% of incidents inside named hotspots; a scattered theatre must not be called
concentrated/contained.

## 3. Ranking is by IMPACT, not incident count (+ Option-B pull-in)

**Rule:** theatre selection and ordering rank by IMPACT, not how many incidents a theatre
logged. `compareAreas` is a tuple: worstSeverity → highImpactCount → casualty → site
movement → operational signal → latestDate → incidentCount → name. Count is the LAST
tiebreak only, so a single Extreme attack outranks a pile of Low chatter. Co-lead parity
(`leadTheatres`) is by driver weight (`max(highImpact, casualty)`) gated on worst-rank ≥4
OR ≥2 drivers — NOT by comparable counts.
**Why:** the user's complaint was that count-ranking buried high-impact theatres under
noisy low-severity ones.

**Option-B out-of-window pull-in:** the builder also scans a pre-window strip
`[win.end − (reportWindowMaxDays−1), win.start)` with `isTopicRelevant`. A theatre with
NO in-window activity is pulled in ONLY if it carries a High/Extreme OR casualty-bearing
driver. Pulled-in areas are flagged `pulledInFromLookback`, get a dedicated paragraph
("stays on the watch list after high-impact attacks … just before this reporting period"
+ dated events + "Nothing new was reported inside the week"), and are EXCLUDED from Fast
Facts, windowIncidents, and relatedIncidents (those stay strict-weekly enriched).

**The contradiction trap (the bug an architect caught):** do NOT mix in-window and
pulled-in theatres in one combined sort. A pre-window High would then sit at the TOP of
the Top Activity Areas list while the Situation headline says a lower-severity in-window
theatre is "the most serious theatre this period" — the list and the prose disagree.
**Fix:** sort each group separately and concat IN-WINDOW FIRST. A theatre with no in-week
activity can never be "most serious this period", so pulled-in theatres are a
standing-watch tier BELOW the live week, never ranked over a live theatre. The Situation /
Polestar headline leads on the top in-window theatre (or, in an empty week, the top
pulled-in one); the pulled-in theatres are a dated secondary clause.
**How to apply:** a test asserts the in-window theatre precedes the pulled-in one in
`topActivityAreas` and that `topActivityAreas[0].pulledInFromLookback === false` whenever
any in-window theatre exists.

## 4. Prose hygiene (full rewrite — readable, non-templated, non-contradicting)

These are PROSE-ONLY rules; they touch no ranking/relevance logic, so do NOT bump
`RELEVANCE_RULE_VERSION` when changing them.

**Cited standout must be kinetic, not a reaction headline.** When choosing the period's
"most serious incident", a real armed event must outrank a political/reaction headline of
the same severity ("vigil held…", "families demand justice…"). `eventScore` = +2 kinetic
+2 casualty −3 reaction-lead; `topEvents` sorts severity FIRST, then this score, so it
only re-orders WITHIN a severity tier — it never overrides the tier.
**Why:** a reaction headline was being paraded as the week's worst incident.

**Concentration claims are gated on localised focus.** "its activity concentrated around
<hotspot>" may only be used when the lead theatre is localised (≥50% of incidents inside
named hotspots, `focusOf().localised`). For a sub-50% theatre, name the flashpoint with
softer wording ("with <hotspot> among the areas most affected") or omit it. This applies in
EVERY section, including the Polestar View — an architect caught the Polestar View saying
"concentrated around Manipur" while the theatre's own paragraph correctly read "the
heaviest activity around Manipur": same dataset, two surfaces, self-contradiction.
**How to apply:** a sub-national-honesty test asserts `autoPolestarView` never matches
`/concentrated around <hotspot>/i` when coverage <50%.

**A bare country is NEVER the grammatical subject of a seriousness judgement.** A large
country is never wholesale "the main concern" / "the most serious theatre" unless the whole
country is at war — only its NAMED PARTS can carry that claim. Make the SUBJECT the
*activity* or the *region*, with the country as location: "The most serious activity this
period is in <Country>, around <hotspots>" (Situation/Polestar lead), "<Country>'s sharpest
activity centres on <hotspots>" (area paragraph), "<Country> also saw serious activity this
period" (secondary) — never "<Country> is the most serious theatre / is the main concern /
is/was/remained serious". This applies to Situation, Polestar AND secondary clauses, not
just the area paragraph (the user re-opened the complaint precisely because the first fix
only scoped the area paragraph and left Situation/Polestar saying "India is the most serious
theatre"). **Why:** a huge country (India) read as if entirely at war.
**How to apply:** tests ban, across the whole rendered narrative, `/is the main concern/i`,
`/is the most serious theatre/i`, `/are the most serious theatres/i`,
`/\b(is|was|remained) (the most )?serious\b/i`, and `/\bworst\b/i` (the word "worst" was
over-repeated — use varied vocab: sharpest/heaviest/hardest-hit-once/affected/most exposed).

**Section wording must vary; Situation and Polestar must not read verbatim-identical.**
Rank-vary the area-paragraph openings (`v = min(rank, 2)`) and give `secondaryClause` a
`variant` param so the Polestar View ("remained serious too" / "stayed quieter") differs
from the Situation ("was also serious this period" / "was quieter"). Headlines are run
through sentence-case hygiene (lowercase mid-headline common nouns + a leading single "A",
keep proper nouns/acronyms) so a cited event reads as prose, not a scraped feed row.
**Verify:** `artifacts/workbench/scripts/dumpConflictProse.ts` (`ISSUE=YYYY-MM-DD npx tsx
…`) renders every section for eyeballing; preview/PDF parity is automatic because both
read the one `buildConflictReportDataset`.
