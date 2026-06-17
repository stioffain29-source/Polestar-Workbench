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

**Rule:** a multi-theatre conflict topic needs BOTH a monthly window (it lives in
`MONTHLY_TOPICS`, cadence Monthly) AND kinetic/casualty-bound relevance vocab.
**Why:** breadth depends on the slow theatres surviving the window AND the gate.
**How to apply:** new civil-war vocabulary must be kinetic- or casualty-bound (weapon,
offensive action, or `actor.{0,40}casualty`), NEVER a bare actor/place name, so
diplomacy/trade/state-visit/humanitarian background pieces still fail. Excludes run
BEFORE required, so adding excludes is always safe. Any gate change needs a
`RELEVANCE_RULE_VERSION` bump or the persisted rows never re-tag on boot.

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
