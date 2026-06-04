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

**Mechanism reminder:** any rule change here needs a `RELEVANCE_RULE_VERSION` bump
(`evaluate.ts`) so the api-server boot backfill re-evaluates stored rows; otherwise the
DB keeps the old verdicts.
