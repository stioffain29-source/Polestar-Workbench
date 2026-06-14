---
name: Energy topic relevance precision/recall tradeoffs
description: Why the energy relevance gate excludes-before-required and which geography tokens are deliberately omitted from the exclude.
---

# Energy relevance precision/recall

The energy feed pulls per-country Google-News editions across a wide region (South/SE
Asia + East Asia + Gulf + Australia/NZ), so country-edition feeds frequently
**mis-attribute** an out-of-region grid story (Iberia/Cuba/Ukraine blackout) to an
in-scope byline. The relevance gate (`lib/relevance/src/topicRelevance.ts`) runs
`ENERGY_EXCLUDE` **before** the REQUIRED phrase gate for `topic === "energy"`.

**Why exclude-before-required:** the user is precision-first. Broadening REQUIRED to
catch genuine grid-attack stories (`power grid`, `grid collapse/attacked/sabotage`) would
otherwise let a mis-attributed Cuba/Spain blackout through. Excluding first means the
broadened required can never leak out-of-region junk.

**Geography tokens deliberately OMITTED from the exclude:** bare `turkey`, `russia`,
`europe`. **Why:** they collide with legitimate in-scope Middle East stories — e.g. an
Iraq–Turkey power-line attack, or a Gulf outage tied to Russian/European gas supply. The
Russia–Ukraine war noise that motivated a `russia` exclude is already caught by the
`ukraine` token, so dropping bare `russia/turkey/europe` recovers real recall without
re-leaking the junk. KEEP the unambiguous high-noise tokens: spain/iberia/portugal/cuba/
ukraine/virgin islands/zaporizhzhia, plus US-state names (near-zero collision with
in-scope energy).

**Also omitted on purpose:** `united states`/`u.s.` (appears in legit Gulf
energy-infrastructure strike stories); `national grid` (Indian usage → false-drop risk).

**US CITY names are excluded, not just states.** Country-edition feeds mis-attribute US
storm/outage stories (esp. Texas/ERCOT) to an in-scope byline, and "power outages"
satisfies REQUIRED, so a US-state token alone misses any title without the state name
(e.g. "Austin power outages drop after severe storms" → mis-tagged Philippines). A
curated clearly-US city list (austin/houston/dallas/annapolis/etc., no in-scope
collision) is in the exclude. Also excluded: outage **recovery** framing ("outages drop|
fall|decline|recede|subside") — the opposite of an incident (omit "ease", which appears
in ongoing-crisis prose).

**US TV call signs are CURATED LITERALS, never a broad `\b[wk]..-tv\b` pattern.** A US
storm wire can carry NEITHER a listed city NOR a state (e.g. "Annapolis storm leaves
power outages and road closures — WBAL-TV"): the city/state lists missed Annapolis +
Maryland, so the affiliate call sign in the summary was the only out-of-region signal.
**Do NOT generalise to `\b[wk][a-z]{2,3}-(tv|dt|am|fm)\b`** — it hard-drops in-scope
national broadcasters that share the W/K prefix: **KBS** (South Korea), **WIN** (regional
Australia), **WION** (India). Add specific US call signs to the existing alternation
instead (wbal/wjz/wmar/wusa/wtop/wbz/wcvb/wsb/wgn/ktla/ktvu, like the pre-existing
wfaa/king5). **Why the bug matters:** when such a story slips REQUIRED, the per-feed
**default country** geocodes it to that feed's centroid — the Kuwait energy edition
tagged the Annapolis storm as **Kuwait (29.31/47.48)**. Stop it at the relevance EXCLUDE;
the geocode default is downstream and can't tell US-from-Gulf. Expanded the state list
too (maryland + NE/Midwest), still omitting `georgia` (country collision).

**Mechanism reminder:** any rule change here needs a `RELEVANCE_RULE_VERSION` bump
(`evaluate.ts`) so the api-server boot backfill re-evaluates stored rows; otherwise the
DB keeps the old verdicts.
