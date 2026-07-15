---
name: Bahasa mass-casualty toll severity + fire same-story class
description: Why the severity classifier and the country same-story dedup both need explicit Indonesian-language parity, and the place-token trap that pairs with it.
---

# Bahasa mass-casualty toll severity + fire same-story class

A Bahasa (Indonesian) headline reporting a mass death toll used to read **Low**,
and one real event (a Bangkok bar fire, toll rising 27→32) showed as THREE
separate Top-3 developments in the Thailand country report. Two independent
language-parity gaps caused it.

## Severity: mass-toll detection must be bilingual
- The mass-casualty EXTREME patterns were English-only ("N killed" / "kills N").
  Foreign-language topics (`indonesia_local`, `apac_local`) carry Bahasa source
  titles, so a rising-toll headline scored on operational words alone → Low.
- Fix lives in `lib/ingest/src/severity.ts`: `ID_MASS_TOLL_RE` covers three
  Bahasa word-orders — `menewaskan/tewaskan N`, `N (orang) tewas`,
  `korban tewas … jadi/mencapai/bertambah N`. It is added to the `EXTREME[]`
  tier and re-exported via `hasMassCasualtyToll`.
- **Number guards are mandatory.** Bahasa prose is dense with non-body numbers:
  money (`miliar/juta/rupiah`), age (`tahun`), `persen`, and years. The shared
  `MASS_COUNT` year-reject plus a Bahasa `ID_COUNT_UNIT_GUARD` stop
  "32 miliar rupiah" / "27 tahun" / "tragedi 1998" reading as a body count.
- **`meninggal` / `wafat` are deliberately EXCLUDED** from the toll regex —
  they are the neutral "passed away" verbs used for illness/obituaries; only the
  violent/sudden `tewas`/`menewaskan` triggers EXTREME.
- **Guard ordering is load-bearing.** The EXTREME return stays gated on
  `!naturalCauseDeath && !biographicalDeath`, and `NATURAL_CAUSE_RE` was extended
  with Bahasa disaster terms (`banjir/longsor/gempa/tsunami/…`) so a
  flood/quake toll ("banjir … 20 orang tewas") is suppressed out of the reserved
  tier exactly like its English equivalent. Any new toll language must keep this
  ordering or disaster/obituary tolls falsely escalate.

**Why:** owner spec reserves EXTREME (subdued-red #A33232) for genuine
mass-casualty security events; over-escalating disasters/obituaries would violate
that and the no-fabrication stance. Historical auto-scraped rows are re-floored
by a marker-gated, **upgrade-only** boot heal (mirrors the confirmed-killing
heal) — never downgrades, never touches analyst severities.

## Same-story dedup: language + generic-verb parity
- `artifacts/workbench/src/lib/countrySameStory.ts` needs a `"fire"` event class
  (`fire|blaze|inferno|kebakaran|razed|gutted|burn|explos|ledakan`) so an English
  "fire" copy and a Bahasa "kebakaran" copy share a class and the Top-3 diversity
  guard treats them as ONE story. Without it the Bahasa copy matched no class
  (the fatal class was English-only) → survived as a separate development.
- The fatal class must match `kills?` (bare "kill" misses "kills").
- **Place-token trap:** `sharedPlaceClass` = shared distinctive PLACE token AND
  shared class within 3 days. Place tokens are content tokens MINUS
  `CLASH_GENERIC_TOKENS`. Any fatal verb NOT in that set leaks as a fake "place":
  "kills" was missing, so two genuinely distinct city fires both worded
  "… fire kills N" over-folded. **Rule: every fatal/outcome verb form used by the
  fatal class must also be in `CLASH_GENERIC_TOKENS`** or it becomes a spurious
  shared-place signal. Event classes that are also generic (e.g. `fire`) belong in
  `CLASH_GENERIC_TOKENS` too so they can never be place tokens.

**How to apply:** when adding a new event-nature class or a new fatal synonym to
the same-story dedup, add the same words to `CLASH_GENERIC_TOKENS` in lockstep.
When adding mass-toll language to severity, add the count-unit guards and keep the
natural-cause/biographical guards ahead of the EXTREME return. No
`RELEVANCE_RULE_VERSION` bump is required for either — this is severity + display
dedup, not the relevance gate.
