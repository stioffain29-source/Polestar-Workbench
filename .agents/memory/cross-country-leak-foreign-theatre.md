---
name: Cross-country leak — foreign maritime theatre guard
description: Why country reports leaked other countries' incidents and the geography signal that fixes it (aggressive "happened-in" filter)
---

# Country reports leaking other countries' incidents

Country reports fetch a 90-day incident window and match client-side on the
semicolon-separated `country` tag. A single regional event is cross-tagged onto
EVERY nationality it names, so the same story populates many country reports. The
user's binding complaint: the South Korea report shows Iran/Strait-of-Hormuz
vessel stories. They chose the AGGRESSIVE fix: keep only incidents that happened
in / are primarily about this country; drop anything driven by another country
even if this country is involved.

## Signals that DON'T work (disproven on live rows, do not retry)

- **Mention-count / dominance** — KEEPS the leak. The Hormuz stories are
  saturated with "South Korea", "Korean vessel", "Seoul's stance" (nationality +
  metonym) because the story is framed around the country's reaction; the event
  is in Hormuz. Replay kept 49/53 South Korea and 203/265 UAE — exactly the rows
  to drop.
- **Tag order (first-listed country)** — the classifier lists the framed country
  first ("South Korea; Iran"), so first-tag keeps the leak too.
- **Stored geo `location` / lat-lng** — empty on ~all compound rows (462/463), so
  no usable stored geography.

## The signal that works: named foreign THEATRE (geography)

`isForeignTheatreContext(text, reportName)` in `countryMatch.ts`. A record that
NAMES a foreign maritime/conflict theatre (Strait of Hormuz, Persian Gulf, Gulf
of Oman, Fujairah, Habshan, Bandar Abbas, Bab-el-Mandeb, Gulf of Aden) is
dropped from a report whose country is NOT a member (littoral) of that theatre.
Gulf members = Iran, Oman, UAE, Saudi Arabia, Qatar, Bahrain, Kuwait, Iraq,
Yemen — their reports KEEP it (it's their own waters). Wired into the `incidents`
useMemo filter in `CountryReport.tsx`, after `isForeignDominantContext`, exempting
`isCrossBorderPapuaPng`. Read TITLE+SUMMARY only (masthead/URL never name a Gulf
choke-point → avoids pollution).

**Why this and not strict drop-all-compound:** aggressive must KEEP genuinely
in-country compound rows (a strike ON UAE's Fujairah stays in UAE; domestic India
fuel prices tagged "India; Iran" stay in India because they name no foreign
theatre). The guard only fires when the narrative positively places the event in
a foreign theatre (no-fabrication: never drop on absence of evidence).

**Live replay (today=2026-06-26, 90-day window):** 345/463 compound rows name a
Gulf marker. Drops — South Korea 43/53, India 21/58, Japan 13/16, China 17/29,
Pakistan 19/60, Singapore 6/7. Zero drops for Gulf littorals (UAE, Iran, Saudi,
Qatar, Oman). Matches every user example.

## How to apply / extend

- This is a FRONTEND report filter. Do NOT bump `RELEVANCE_RULE_VERSION` (mirrors
  the other `countryMatch.ts` guards; the server's relevance verdict is bypassed
  here via `includeIrrelevant`).
- Do NOT import the `@workspace/ingest` barrel into the frontend (bundles pg →
  "Buffer is not defined"); the small theatre map is self-contained in
  `countryMatch.ts`.
- Add a new theatre = one `{ re, members }` entry in `FOREIGN_THEATRES`. Each
  theatre's members must list every country whose own waters/territory it is, in
  both canonical and alias forms (e.g. "united arab emirates" AND "uae"), or that
  country's report will wrongly drop its own incidents.
- **Residual (intentional, not a bug):** non-maritime foreign-LAND leaks (e.g. a
  "North Waziristan operation" tagged "Pakistan; India" showing in the India
  report) are NOT caught — generalising land geography reintroduces the
  metonym false-keep and needs a per-country gazetteer. Only add if the user
  flags it; the binding complaint was the Gulf maritime cluster.
