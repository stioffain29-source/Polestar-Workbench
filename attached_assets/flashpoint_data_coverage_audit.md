# Flashpoint Data Coverage Audit

Scope: Flashpoint / Activism / Protests / Civil Unrest.
Snapshot date: 2026-05-26. Windows are rolling — current = 7 days, plus 30 and 90 day lookbacks.
Source: live `sources` and `incidents` tables. Relevance filter mirrors `topicRelevance.ts` (`flashpoint` required cues + shared exclusions). No client-facing report changes were made.

---

## 1. Sources currently assigned to Flashpoint (curated `sources` table)

All 14 entries are catalogued under `topic = 'flashpoint'`. Reliability is 1–5.

| # | Source | Type | Status | Last success | Last failure | Reliab. | Coverage / record type |
|---|---|---|---|---|---|---|---|
| 17 | Reuters Asia Pacific Wire | news | operational | — | — | 5 | APAC-wide breaking protest, strike, security-force activity |
| 18 | AFP Asia-Pacific | news | operational | — | — | 5 | Secondary APAC wire (corroborator) |
| 24 | CIVICUS Monitor | api | operational | — | — | 5 | Assembly bans, detentions, internet shutdowns (APAC + global) |
| 25 | Human Rights Watch Asia | rss | operational | — | — | 4 | Crackdowns, mass arrests, security-force conduct |
| 26 | ABC News Australia | rss | operational | — | — | 4 | AU protest, industrial action, policing |
| 19 | Benar News | rss | operational | — | — | 4 | Philippines, Indonesia, Bangladesh |
| 20 | ITUC Global Rights Index | rss | operational | — | — | 4 | International union strike calls, rights restrictions |
| 21 | IndustriALL Global Union | rss | operational | — | — | 4 | Manufacturing / mining / energy union action |
| 30 | Rappler | rss | operational | — | — | 4 | Manila protests, union calls, student mobilisation |
| 31 | Philippine Daily Inquirer | rss | operational | — | — | 4 | Metro Manila city-disruption + protest calendar |
| 32 | Kyodo News (English) | rss | operational | — | — | 4 | Tokyo labour disputes, civic protest, policing |
| 33 | The Japan Times | rss | operational | — | — | 4 | Tokyo / Osaka mobilisation, union action |
| 34 | The Kathmandu Post | rss | operational | — | — | 4 | Kathmandu political mobilisation, student unions, transport strikes |
| 29 | RNZ Pacific | rss | operational | — | — | 4 | PNG, Solomons, Fiji, Indonesian Papua |
| 22 | Education International APAC | rss | operational | — | — | 3 | Teacher / faculty mobilisation |
| 23 | University World News Asia | rss | operational | — | — | 3 | Campus protests, student-union activity |
| 27 | Post-Courier (PNG) | rss | operational | — | — | 3 | Port Moresby — political demos, sectoral strike action |
| 28 | Jubi.id (West Papua) | rss | operational | — | — | 3 | Jayapura / Indonesian Papua. Manual review flagged |
| 35 | Nepal Republica | rss | operational | — | — | 3 | Secondary Nepal national |

(IDs 17 and 18 are above the strict "Flashpoint" cohort because their `topic` is `flashpoint` but they are APAC-wide wires.)

All 14 entries are marked `operational`. None carry a `last_success_at` timestamp — the catalogue rows exist but the ingest pipeline does not appear to be pulling them on the same schedule as the cargo / fuel / shipping sources, which all have current `last_success_at` values. This is the single biggest finding of the audit (see section 5).

---

## 2. Misassigned sources / records

**Source-table level:** the 14 curated flashpoint sources are correctly scoped. No fertiliser, energy or pure armed-conflict sources are catalogued under `topic = 'flashpoint'`.

**Incident-record level:** records carrying `topic = 'flashpoint'` or `topic = 'protests'` include material that does not belong:

- **UAE air-defence / nuclear-plant drone-strike news cycle** — 274 records (90d) under source string `UAE Air-Defense / Missile Activity (Google News)`. This is kinetic armed-conflict / Strike content, not protest / public-order. It also carries massive syndicated duplication (≥11 copies of the same headline). This source string is not in the `sources` table — the records are leaking in from a Google-News query that should be feeding the Strike topic, not Flashpoint.
- **Cargo-theft Google-News queries** routed to `protests`: `APAC Trucking & Transport Crime (Google News)` (58 total), `Australia Freight & Truck Theft (Google News)` (52 total), `Indonesia Cargo Theft (Bahasa Google News)` (41 total), plus Japan / South Korea / Thailand / APAC Tobacco cargo-theft queries. These should be `cargo_watch`, never Flashpoint.
- **Kinetic armed-conflict reporting under `protests`** (Pakistan / Myanmar):
  - "Quadcopter attack kills two school children in KP's Bajaur" (Dawn)
  - "Security forces kill 23 terrorists in multiple Khyber Pakhtunkhwa IBOs" (Dawn)
  - "Wanted terrorist ringleader among 5 militants killed in North Waziristan operation" (Dawn)
  - "FC headquarters attack 'mastermind' killed in Balochistan" (Dawn)
  - "KIA drone strike kills Myanmar junta troops near Hpakant" (Myanmar Now)
  - "Two civilians killed as Myanmar junta escalates offensives" (Myanmar Now)
- **Editorial / market commentary** under `flashpoint`: e.g. "Trump's Iran Dilemma Can Only Be Delayed for So Long" (OilPrice.com), "Drone strikes UAE nuke plant as Trump warns Iran" (MSN syndicate).
- **Baseline / watchlist seed rows inserted as incidents** (12 records this week, all dated 2026-05-23, all with `source = NULL`):
  - "Highlands Highway — Transport Insecurity Corridor"
  - "Port Moresby — Recurring Operational Crime Area"
  - "Lae — Nadzab Airport Access Corridor"
  - "Jacksons Airport Access Corridor"
  - "Lae — Industrial & Port Operational Crime Area"
  - five more PNG watchlist labels in the same pattern, plus India / Bangladesh / Australia / China entries reading as headlines but lacking an originating outlet.
  These look like the new country-baseline watchlist content being persisted as live incidents. They should live in `country_baselines.locationWatchlist`, never in the incident feed.

Net: of 687 records under `topic in (flashpoint, protests)` in the last 90 days, only **435 (63%)** pass the Flashpoint relevance regex once the obvious noise (cargo theft, kinetic armed conflict, market commentary, syndicated duplicates) is excluded.

---

## 3. Regional coverage (qualifying records only)

Counts are records that (a) carry `topic in (flashpoint, protests)`, (b) pass the Flashpoint required-cue regex, (c) survive the shared exclusion list, (d) match the country / region tokens.

| Country / area | 7d | 30d | 90d | Rating |
|---|---:|---:|---:|---|
| Pakistan | 12 | 52 | 52 | Adequate (Dawn dominant; but mixed with kinetic — see §2) |
| Papua / PNG / W. Papua | 0 | 49 | 67 | Backstop OK, current week empty |
| South Korea | 3 | 30 | 30 | Adequate (Yonhap dominant) |
| India | 9 | 29 | 29 | Adequate (Livemint + SCMP, mixed quality) |
| Indonesia | 2 | 11 | 11 | Weak |
| Hong Kong / China | 4 | 11 | 11 | Weak (SCMP Telegram only) |
| Australia | 1 | 8 | 8 | Weak |
| Thailand | 0 | 4 | 4 | Weak |
| Bangladesh | 3 | 4 | 4 | Weak |
| Japan | 0 | 2 | 2 | **Absent in practice** (Japan Times + Kyodo catalogued, not flowing) |
| Nepal | 1 | 2 | 2 | **Absent in practice** (Kathmandu Post + Republica catalogued, ~3 records) |
| Sri Lanka | 1 | 1 | 1 | **Absent** (Ada Derana only) |
| Philippines / Manila | 0 | 1 | 1 | **Absent** (Rappler + Inquirer + Benar catalogued, not flowing) |
| Malaysia | 0 | 0 | 0 | **Absent** (no source) |

The pattern is consistent: the countries the curated source list claims to cover (Philippines, Japan, Nepal, parts of Indonesia, Australia) are precisely the ones with no records. The countries with strong feeds (Pakistan via Dawn, South Korea via Yonhap, Papua via Jubi / Loop PNG / Post Courier, India via Livemint) are catalogued under different source strings than the curated flashpoint list, suggesting two parallel ingest paths that aren't reconciled.

---

## 4. Classification quality (sample of 60 most recent records)

- **Correctly classified protest / activism / unrest** (good):
  - "PTI launches protest drive for Imran's release" (Dawn) → Protest ✅
  - "PTI workers stage protests in various cities, defy Section 144" (Dawn) → Protest ✅
  - "Chemists strike on May 20: Why Indian pharmacists are protesting e-pharmacies" (Livemint) → Strike / labour action ✅
  - "ACT public schools: May 22 strike to delay morning traffic" (Canberra Times) → Strike / labour action ✅
  - "Cab, auto strike in Delhi-NCR: Three-day Chakka jam" → Strike / labour action ✅
  - "Dhaka Protests Demanding Justice For Ramisa Akhter" → Protest ✅
  - "Pakistan: Students hold protest in Balochistan against delay in laptop distribution" → Student activism ✅
  - "Young Indians protest through parody 'cockroach' party" (SCMP) → Protest ✅
- **Misclassified armed conflict** (should be Strike / armed-group activity, not Flashpoint / Protests):
  - "Quadcopter attack kills two school children in KP's Bajaur" (twice — both classified as `protests`)
  - "Security forces kill five terrorists, including wanted commander, in North Waziristan IBO"
  - "Security forces kill 23 terrorists in multiple Khyber Pakhtunkhwa IBOs"
  - "Wanted terrorist ringleader among 5 militants killed in North Waziristan operation"
  - "FC headquarters attack 'mastermind' killed in Balochistan"
  - "KIA drone strike kills Myanmar junta troops near Hpakant"
  - "Two civilians killed as Myanmar junta escalates offensives north of Monywa"
  - 7+ UAE Barakah-nuclear drone-strike headlines under `flashpoint`
- **Misclassified court / legal background** (no operational protest signal):
  - "Ex-NIS deputy chief denies allegations of delivering message backing Yoon's martial law" (Yonhap)
  - "Ex-spy chief Cho Tae-yong sentenced to 1 1/2 yrs in prison for perjury in martial law trial" (Yonhap)
  - "Probe under way over alleged irregular drone acquisition linked to Yoon's martial law bid" (Yonhap)
  - "Imran's cases will be fixed after Eid, CJP assures PTI" (Dawn — political process, not action)
  - The Yoon martial-law back-catalogue is dominating South Korea's 30-day count but is courtroom litigation, not live unrest.
- **Misclassified labour action**:
  - "Lee County trio arrested after attempted diesel theft and failed truck and ATV g…" (US cargo theft mis-routed via Australia Freight Google News)
  - "PMV passengers robbed on Mt Hagen approach" (EMTV) → armed robbery, not labour
- **Misclassified crime / non-political**:
  - "Armed robbery at Manu Cash and Carry; one suspect shot by police during pursuit" (The PNG Sun) — armed robbery, not protest
  - "Lae armed robbery leaves three dead, two wounded; child hit by stray bullet" — armed robbery
  - "Man charged with stealing camera equipment from Bondi shooting victim in aftermath of terror attack" (Guardian Australia) — post-event theft, severity tagged Extreme
- **Duplicate syndicated records**: the UAE Barakah drone-strike single news event has at least **11, 10, 6, 5, 3, 3, 2, 2, 2, 2, 2, 2, 2** copies (different MSN syndicate URLs of the same wire story), all attributed to the same `UAE Air-Defense / Missile Activity (Google News)` source string. One event is generating ~50 records.
- **Soft commentary / parody**: "Young Indians protest through parody 'cockroach' party" landed twice (one `protests`, one `flashpoint`) and reads as a feature piece, not an incident.
- **Static baseline rows surfacing as incidents** (PNG): see §2 — Highlands Highway, Port Moresby, Lae corridors, Jacksons / Nadzab airport access. These are locations from the country baseline being inserted into `incidents` with severity `low`, `source = NULL`, occurred today.

---

## 5. Source gaps

Comparing the source types the audit asks about against what is catalogued **and** actually producing records:

| Type | Catalogued | Producing records | Notes |
|---|---|---|---|
| Local media (APAC) | Partial | Partial | Dawn (PK), Yonhap (KR), Livemint (IN), Post Courier (PNG), Bangkok Post (TH), Bangladesh Daily Star, Ada Derana (LK), Kathmandu Post (NP) all producing. Rappler, Inquirer, Benar, Kyodo, Japan Times all catalogued but producing 0 records. |
| Union / labour notices | Yes (ITUC, IndustriALL, Education International) | **No** | Catalogued, 0 records observed |
| Police advisories | No | No | Missing entirely |
| City transport disruption notices | No | No | Missing — would catch Chakka jam, ACT school strikes earlier |
| Campus / student activism | Yes (University World News Asia) | **No** | Catalogued, 0 records |
| Protest calendars | No | No | Missing entirely |
| Election / court trigger monitoring | No | No | Missing — would have framed the Yoon martial-law / Imran-PTI clusters as trigger windows rather than free-form crackdown noise |
| Local APAC stringers | Partial | Partial | Jubi, Loop PNG, Post Courier producing for Papua. None for Manila / Jakarta / Bangkok / Dhaka / Colombo. |
| Social mobilisation indicators | No | No | Missing entirely (no Twitter/X-style civic mobilisation feed beyond a couple of telegram channels) |
| Civic-space monitors | Yes (CIVICUS, HRW Asia) | **No** | Catalogued, 0 records |

---

## 6. Flashpoint Data Coverage Audit (the required table)

| Country / Area | Current window (7d) | 30d | 90d | Main sources actually feeding | Coverage rating | Main gaps | Action required |
|---|---:|---:|---:|---|---|---|---|
| Pakistan | 12 | 52 | 52 | Dawn (dominant) | Adequate (volume) | Kinetic Balochistan / Waziristan stories drowning protest signal | Re-route armed-conflict records to Strike topic; keep PTI / Section 144 / sit-in cues in Flashpoint |
| Papua / PNG / W. Papua | 0 | 49 | 67 | Jubi, Loop PNG, Post Courier, EMTV, Cenderawasih Pos, X: Papua unrest verbs | Strong backstop, current week empty | No live wire this cycle; baseline watchlist rows polluting feed | Investigate why nothing landed this week; stop persisting baseline-watchlist rows as incidents |
| South Korea | 3 | 30 | 30 | Yonhap (dominant) | Adequate but skewed | Yoon martial-law courtroom backlog dominates → background noise, not live unrest | Demote courtroom / legal-process records to a separate "judicial process" bucket; preserve the genuine protest signal |
| India | 9 | 29 | 29 | Livemint, SCMP (Telegram), Indian Express | Adequate | No dedicated protest calendar; chemist / Chakka-jam style records arrive late | Add union-association feeds (IMA, AICTU); add city-transport disruption notice ingestion |
| Indonesia | 2 | 11 | 11 | Cenderawasih Pos, Suara Papua, occasional Benar | Weak | Benar catalogued but not producing; no Jakarta / Java mobilisation feeds | Diagnose Benar ingest; add Tempo, Kompas, Detik headlines for Jakarta-Java |
| Hong Kong / China | 4 | 11 | 11 | SCMP Telegram (only) | Weak | Single telegram source; no mainland protest-monitor feed; mostly tangential mentions | Add a China Labour Bulletin feed or equivalent; treat SCMP Telegram as corroborator, not primary |
| Australia | 1 | 8 | 8 | ABC News Australia (Google News), Guardian Australia | Weak | Guardian is tagging cargo / shooting / theft stories as Extreme protests; ABC RSS catalogued but parallel "Google News" string is what feeds | Reconcile ABC ingest paths; add union (ACTU), state-police media releases, transport disruption notices |
| Thailand | 0 | 4 | 4 | Bangkok Post | Weak | Single national daily; no local press, no campus / labour feed | Add Khaosod English, Prachatai, Nation Thailand |
| Bangladesh | 3 | 4 | 4 | Bangladesh Daily Star | Weak | Only 1 catalogued outlet; Dhaka student / political mobilisation under-covered | Add Prothom Alo, New Age, Dhaka Tribune |
| Japan | 0 | 2 | 2 | Japan Times (1 record, 30d) | **Absent in practice** | Japan Times + Kyodo catalogued but not flowing | Diagnose RSS ingest for IDs 32 and 33; until then assume blind on Tokyo / Osaka |
| Nepal | 1 | 2 | 2 | Kathmandu Post (3 records, 90d), Republica (none) | **Absent in practice** | Both Nepal sources catalogued, almost nothing flowing | Diagnose RSS ingest for IDs 34 and 35; meanwhile add MyRepublica / Online Khabar via Google News fallback |
| Sri Lanka | 1 | 1 | 1 | Ada Derana | **Absent** | No catalogued source — Ada Derana arriving via stringer | Add Daily Mirror SL, Sunday Times SL, Newswire as catalogued sources |
| Philippines / Manila | 0 | 1 | 1 | Benar News (6 records, 90d total combined w/ Indonesia) | **Absent in practice** | Rappler + Inquirer + Benar catalogued, ~0 records reaching Philippines | Top priority — investigate why Rappler, Inquirer ingest is returning nothing; add Manila Standard, GMA News fallback |
| Malaysia | 0 | 0 | 0 | none | **Absent** | No catalogued source | Add Malaysiakini, The Star, FMT, Bernama |

---

## 7. Conclusions

**Flashpoint is weak because of three compounding problems, not one.**

1. **Ingest gap, not catalogue gap.** The curated source list (Rappler, Inquirer, Benar, Kyodo, Japan Times, Kathmandu Post, ITUC, IndustriALL, CIVICUS, HRW Asia, University World News, RNZ Pacific) is broadly correct in shape, but most of those rows have **no `last_success_at` timestamp and produce 0 records**. The cargo / fuel / shipping / energy sources do carry `last_success_at` values, so the ingest pipeline works — it just is not pulling the Flashpoint catalogue. This is why the report looks empty: not because the world is quiet, but because the pipes are not connected.
2. **Topic pollution.** A Google-News query for UAE air-defence / drone-strike activity is dumping ~270 kinetic-armed-conflict records into `topic = 'flashpoint'`, with single news events generating 10+ duplicates. Plus cargo-theft Google-News queries are landing under `protests`, and Pakistan / Myanmar military-operation records are landing under `protests`. The frontend classifier already tries to short-circuit kinetic content (see `classifyUnrest` in `incidentClassifier.ts`) — the fix is upstream, at the ingest-topic assignment layer, not in the report writer.
3. **Baseline rows surfacing as incidents.** Twelve records this week, all dated today, all with `source = NULL`, all reading as locations from the country baseline ("Highlands Highway — Transport Insecurity Corridor", "Jacksons Airport Access Corridor"). These should live in `country_baselines.locationWatchlist`, not in the incident feed. They are inflating PNG's count and breaking the current-window picture.

**Which countries are genuinely quiet vs under-covered.**

- **Genuinely quiet this cycle**: Pakistan-ex-kinetic, South Korea-ex-courtroom, India, Papua. These have working feeds and the current week is what it is.
- **Under-covered (catalogue mismatch)**: Philippines, Japan, Nepal — sources catalogued, not delivering. Priority for ingest diagnosis.
- **Under-covered (catalogue gap)**: Malaysia, Sri Lanka, Thailand, Bangladesh, Indonesia (Jakarta side), mainland China. Need additional catalogued outlets.

**Which sources need fixing or reassignment.**

- **Reassign**: `UAE Air-Defense / Missile Activity (Google News)` → Strike topic (not Flashpoint). All `* Cargo Theft (Google News)` / `* Freight & Truck Theft (Google News)` → Cargo Watch (not Protests). Verify they are not double-tagged.
- **Fix ingest**: Rappler (30), Philippine Daily Inquirer (31), Benar News (19), Kyodo News (32), Japan Times (33), Kathmandu Post (34), Nepal Republica (35), CIVICUS (24), HRW Asia (25), ITUC (20), IndustriALL (21), Education International (22), University World News (23), RNZ Pacific (29). All catalogued, all reporting `operational`, none producing records.
- **De-duplicate**: implement headline-hash dedupe before insertion. One UAE drone strike is generating 50 records via MSN syndicate URL variants.
- **Stop persisting**: country-baseline watchlist labels as live incidents.

**No client-facing report changes have been made.** The next decision is what to do with this audit — fix the ingest first, then re-run the audit, then decide whether Flashpoint prose / classification needs further work.
