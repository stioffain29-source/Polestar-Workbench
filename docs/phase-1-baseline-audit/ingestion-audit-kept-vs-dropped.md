# Ingestion Audit — Kept vs Dropped

**Polestar Workbench · Phase 1 baseline audit**

| Field | Value |
| --- | --- |
| Audit date | 2026-08-26 |
| Production URL | https://document-asset-manager-stioffain29.replit.app/ |
| Data source | Live prod snapshot (180 days) |
| Flashpoint issue date | 2026-05-31 |
| Purpose | Pinpoint where slop enters the pipeline and where real signal is lost |

---

## 1. Executive summary

This audit samples incidents at each pipeline gate — **relevance filter**, **report selector**, **cargo scope classifier**, and **country render guards** — and lists representative **kept** vs **dropped** rows with the reason each decision was made.

**How to read the samples:**
- **KEPT + slopClass FP** = false positive (noise that survived — fix target)
- **DROPPED + slopClass FN** = false negative (signal lost — precision risk)
- **DROPPED** with documented exclude reason = filter working as designed

---

## 2. Pipeline funnel (where slop enters or signal is lost)

```
RSS / GDELT / Social ingest
  → classify (country, topic, masthead strip)
  → explainRelevance  ←── RELEVANCE_RULE_VERSION
  → report window (issue date + cadence)
  → topic selector (e.g. selectFlashpointUsable, isCargoInScope)
  → classifier + prose + PDF
```

### Slop source map

| Area | Code location | Known noise classes |
| --- | --- | --- |
| Shared relevance engine | `lib/relevance/src/topicRelevance.ts` | Homonyms (strike/rally), off-region syndication, commerce vs maritime |
| Cargo slop filter | `lib/relevance/src/cargoSlop.ts` | Trade press, legislation, US mastheads, aggregate loss commentary |
| Cargo display scope | `artifacts/workbench/src/lib/cargoAnalysis.ts` | Generic warehouse/truck theft, vehicle-target noise, needs-review bucket |
| Flashpoint weak-ops | `flashpointReportDataset.ts → selectFlashpointUsable` | Sports strike, market rally, photo wires, court-only, kinetic-only |
| Geocode pollution | `lib/ingest/ geocode lookup` | Source masthead leaking as location |
| Region feeds | `News region feeds` | country='Unknown' on subnational items |
| Country geography gate | `countryMatch.ts (render path)` | Foreign subject filed under Indonesia/Jakarta |
| Social promote | `Facebook/Instagram/KAMMI promote pass` | Minted incidents without corroboration |

### Flashpoint funnel (merged flashpoint + protests buckets)

| Stage | Count |
| --- | ---: |
| Relevance-kept | 528 |
| − kinetic-only | 0 |
| − court-only | 0 |
| − out-of-scope crime | 0 |
| − dedupe | 1 |
| − weak/novelty | 11 |
| **Final report set** | **8** |

---

## 3. Summary by topic

| Topic | Total sampled | Kept | Dropped | Drop rate |
| --- | ---: | ---: | ---: | ---: |
| flashpoint | 877 | 405 | 472 | 54% |
| protests | 427 | 123 | 304 | 71% |
| cargo_watch | 301 | 171 | 130 | 43% |
| shipping | 469 | 252 | 217 | 46% |
| fuel | 756 | 383 | 373 | 49% |
| energy | 108 | 52 | 56 | 52% |
| fertiliser | 79 | 37 | 42 | 53% |
| strikes | 336 | 333 | 3 | 1% |

**Top drop reasons — flashpoint:** excluded: flashpoint homonym (pattern) (208); dropped: ambiguous token (rally/strike) without public-order cue (119); excluded: flashpoint homonym in headline (pattern) (48); dropped: no flashpoint public-order signal (19); excluded: out-of-region theatre (foreign syndication, no APAC anchor) (15)

**Top drop reasons — protests:** dropped: no flashpoint public-order signal (271); excluded: court/judicial process (legal outcome, not a civil-unrest event) (8); excluded: flashpoint homonym (pattern) (6); dropped: ambiguous token (rally/strike) without public-order cue (6); excluded: 'protest'/'crackdown' in non-civil-unrest sense (diplomatic/gesture/interstate/enforcement) (4)

**Top drop reasons — cargo_watch:** excluded: cargo commentary/non-incident (pattern) (77); dropped: no required topic phrase matched (34); excluded: cargo off-topic (pattern) (18); excluded: cargo livestock (no commercial supply-chain anchor) (1)

**Top drop reasons — shipping:** dropped: no required topic phrase matched (183); excluded: shipping off-topic (pattern) (30); excluded: general-news noise (pattern) (2); excluded: briefing / explainer, not a discrete incident (2)

**Top drop reasons — fuel:** dropped: no required topic phrase matched (337); excluded: fuel off-topic (pattern) (27); excluded: general-news noise (pattern) (9)

**Top drop reasons — energy:** dropped: no required topic phrase matched (50); excluded: energy off-topic (pattern) (6)

**Top drop reasons — fertiliser:** dropped: no required topic phrase matched (41); excluded: general-news noise (pattern) (1)

**Top drop reasons — strikes:** excluded: general-news noise (pattern) (3)

---

## 4. Sample rows — kept vs dropped

### flashpoint

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-30 | China | Myanmar’s junta chief turned president heads to India, with an eye on  | The Kathmandu Post | relevance | Passed relevance gate | — |
| KEPT | 2026-05-30 | Japan | Tokyo rally demands return of Japanese abductees in N Korea - Nation T | Google News — Japan  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-30 | Japan | Thousands rally in Tokyo against Takaichi moves under 'No War' banner  | Google News — Japan  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-30 | China | Thousands rally in Tokyo against Takaichi government's dangerous polic | Google News — Japan  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-30 | Japan | Thousands rally in Tokyo against Takaichi government's dangerous polic | Google News — Japan  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-29 | Nepal | Nepal Rights Body Urges Charges Against Ex-PM Over Gen Z Protest Death | Google News — Nepal  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-29 | Bangladesh | Hasina’s Lawyer Urges UN to Retract Bangladesh Protest Death Toll Repo | Google News — Bangla | relevance | Passed relevance gate | — |
| KEPT | 2026-05-29 | Bangladesh | "Highly Inaccurate": Sheikh Hasina On UN Report On Bangladesh Protest  | Google News — Bangla | relevance | Passed relevance gate | — |
| KEPT | 2026-05-28 | Nepal | Peaceful Polling underway in Nepal after countrywide GenZ protest - Ne | Google News — Nepal  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-28 | Bangladesh | Bangladesh Editors, Media Owners to Protest Mob Attacks on Press and C | Google News — Bangla | relevance | Passed relevance gate | — |
| KEPT | 2026-05-28 | Philippines | Fisherfolk protest rising commercial fishing in municipal waters - The | Google News — Philip | relevance | Passed relevance gate | — |
| KEPT | 2026-05-28 | Nepal | Use of lethal force, Oli & Lamichhane under lens—Nepal’s NHRC on Gen Z | Google News — Nepal  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-28 | Bangladesh | Violence Erupts in Bangladesh as Police Clash with Dhaka University St | Google News — Bangla | relevance | Passed relevance gate | — |
| KEPT | 2026-05-27 | Nepal | NHRC recommends action against Oli, Lekhak, Gurung over Gen Z protest  | Google News — Nepal  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-27 | Philippines | BAYAN, labor leaders face raps over May 1 rally in Manila - ABS-CBN | Google News — Philip | relevance | Passed relevance gate | — |
| KEPT | 2026-05-27 | Nepal | Former Nepal PM K P Sharma Oli arrested over Gen Z protest crackdown \| | Google News — Nepal  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-26 | Malaysia | Thousands rally for EU on Georgia’s independence day - Free Malaysia T | Google News — Malays | relevance | Passed relevance gate | — |
| KEPT | 2026-05-26 | Philippines | Protest vs tree cutting in Manila - Daily Tribune | Google News — Philip | relevance | Passed relevance gate | — |
| KEPT | 2026-05-25 | Sri Lanka | Former Sri Lankan IGP arrested in connection with May 2022 attack on p | Google News — Sri La | relevance | Passed relevance gate | — |
| KEPT | 2026-05-24 | Philippines | Benguet students protest against Villanueva as Senate education chair  | Google News — Philip | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Bangladesh | Licensable picture: Protest Against Child Rape In Dhaka, Bangladesh -  | Google News — Bangla | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Bangladesh | Dhaka Protests Demanding Justice For Ramisa Akhter \|  Were living in f | — | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | India | Bangladesh Anti India Protest BJP TMC , बांग्लादेश में भारत विरोधी प्र | — | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Indonesia | Licensable picture: Protest in solidarity with Palestinians and Global | Google News — Indone | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Malaysia | Top UN court says right to strike protected in key labour treaty - Fre | Google News — Malays | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-30 | Japan | Gauff’s French Open title defence ends, Sabalenka, Osaka set up last-1 | Free Malaysia Today | relevance | excluded: sports-governance protest (not security- | — |
| DROPPED | 2026-05-30 | Japan | Paddon 7th as Evans leads Ogier into FORUM8 Rally Japan finale - Talk  | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Bangladesh | Bangladesh lodges protest with Indian High Commission over Hasina’s ac | Google News — Bangla | relevance | excluded: flashpoint homonym in headline (/\b(file | — |
| DROPPED | 2026-05-30 | Philippines | Lightning strike kills Cebuano fisherman - Manila Bulletin | Google News — Philip | relevance | excluded: flashpoint homonym (/\b(lightning\|thunde | — |
| DROPPED | 2026-05-30 | Japan | Evans tightens WRC Rally Japan grip after a closing Solberg crashes ou | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Rally Japan: Day 2 - TGR-WRT’s rally leader Evans handles the heat - N | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Abductees' families urge govt. to take concrete steps at Tokyo rally - | Google News — Japan  | relevance | dropped: ambiguous token (rally/strike) without pu | — |
| DROPPED | 2026-05-30 | Japan | Oliver Solberg denies taking too much risk in WRC Rally Japan crash -  | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | WRC Rally Japan: Elfyn Evans leads Sebastien Ogier after Oliver Solber | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Philippines | Taklimakan Rally 2026: GWM TANK Dominates the Unforgiving Desert - The | Google News — Philip | relevance | excluded: flashpoint homonym (/\b(taklimakan\|silk  | — |
| DROPPED | 2026-05-30 | Japan | Rally Japan – SS14: Elfyn Evans holds a commanding lead, Sébastien Ogi | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Evans leads Ogier into FORUM8 Rally Japan finale after Solberg exit -  | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Solberg’s reply to Ogier after Rally Japan crash - DirtFish | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | WRC Rally Japan: Solberg crashes out while fighting for the lead - Aut | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | WRC Rally Japan: Oliver Solberg crashes out while fighting for the lea | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Oliver Solberg crashes out of Rally Japan - Motorsport Week | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Ogier slams Solberg who crashed out of Rally Japan - DirtFish | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Ogier slams Solberg’s Rally Japan crash - DirtFish | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Japan | Rally Japan: Oliver Solberg turns up pressure on Elfyn Evans - Motorsp | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Indonesia | Barito Group Rally Helps Limit JCI Losses - Jakarta Globe | Google News — Indone | relevance | excluded: flashpoint homonym (/\b(stock\|stocks\|sha | — |
| DROPPED | 2026-05-30 | Japan | Rally Japan – SS9: New fastest time for Oliver Solberg, Elfyn Evans st | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |
| DROPPED | 2026-05-30 | Bangladesh | US boat strike kills three alleged drug smugglers - Bangladesh Sangbad | Google News — Bangla | relevance | excluded: flashpoint homonym (/\b(ukrainian\|russia | — |
| DROPPED | 2026-05-30 | Bangladesh | Zelensky says Russia preparing 'new massive strike' - Bangladesh Sangb | Google News — Bangla | relevance | dropped: ambiguous token (rally/strike) without pu | — |
| DROPPED | 2026-05-30 | Philippines | ArenaPlus, NBA strike sports betting deal in Philippines - Philstar.co | Google News — Philip | relevance | excluded: flashpoint homonym in headline (/\b(spor | — |
| DROPPED | 2026-05-30 | Japan | Solberg catching Evans for Rally Japan lead - DirtFish | Google News — Japan  | relevance | excluded: flashpoint homonym (/\brally (japan\|finl | — |

### protests

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-23 | Pakistan | PTI launches protest drive for Imran’s release | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | South Korea | (LEAD) Ex-NIS deputy chief denies allegations of delivering message ba | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Pakistan | PTI workers stage protests in various cities, defy Section 144 in Isla | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | South Korea | Probe under way over alleged irregular drone acquisition linked to Yoo | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Pakistan | Imran’s cases will be fixed after Eid, CJP assures PTI | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Papua New Guinea | Lae armed robbery leaves three dead, two wounded; child hit by stray b | The National | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | China | Young Indians protest through parody ‘cockroach’ party | South China Morning  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | India | Chemists strike on May 20: Why Indian pharmacists are protesting e-pha | Livemint (India busi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | Pakistan | Afridi, Aleema claim shots were fired at Adiala sit-in participants | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Pakistan | Over 200 protesting metro bus employees demand salaries in Rawalpindi | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Pakistan | Teachers protest abduction of Gwadar University VC, others | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Pakistan | TTAP, PTI announces countrywide protests on Friday against Imran's imp | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | India | Bhopal ‘dowry death’: Twisha Sharma's kin protests in front of MP CM's | Livemint (India busi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | Pakistan | JI emir challenges petroleum levy in FCC, terms it 'unconstitutional' | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | South Korea | (2nd LD) Court mostly grants Samsung Electronics' injunction request a | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | South Korea | Court partially accepts Samsung Electronics' injunction request agains | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | South Korea | Lee says 1980 pro-democracy movement was reborn in thwarting 2024 mart | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | South Korea | 4 courthouse rioters get suspended terms for attacking reporters | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | China | 4 plead guilty to rioting during 2019 PolyU siege in Hong Kong | South China Morning  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | Pakistan; United Arab Emirates; Saudi Arabia; Qatar | Opposition lawmakers stage protest in National Assembly, demand medica | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | South Korea | (LEAD) Lee says 1980 pro-democracy movement was reborn in thwarting 20 | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | South Korea | (LEAD) Court partially accepts Samsung Electronics' injunction request | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-17 | Australia | Students of newly merged Adelaide University protest changing of gradu | ABC News Australia ( | relevance | Passed relevance gate | — |
| KEPT | 2026-05-17 | Australia | Protesters march at Nakba Day rallies around Australia - Australian Br | ABC News Australia ( | relevance | Passed relevance gate | — |
| KEPT | 2026-05-16 | India | NEET UG 2026 paper leak: Youth Congress protests in Delhi; chief Uday  | Livemint (India busi | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-22 | Myanmar | Two civilians killed as Myanmar junta escalates offensives north of Mo | Myanmar Now (via Goo | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-21 | India; Bangladesh; Sri Lanka; Nepal | Will Cockroach Janta Party spark a Nepal, Bangladesh-style Gen Z prote | Livemint (India busi | relevance | excluded: flashpoint homonym in headline (/^\s*(?: | — |
| DROPPED | 2026-05-21 | Pakistan | Quadcopter attack kills two school children in KP's Bajaur | Dawn (Pakistan) | relevance | excluded: student non-mobilisation (attack/crime/p | — |
| DROPPED | 2026-05-21 | Pakistan | Quadcopter attack kills two schoolchildren in KP's Bajaur | Dawn (Pakistan) | relevance | excluded: student non-mobilisation (attack/crime/p | — |
| DROPPED | 2026-05-21 | South Korea | (LEAD) Ex-spy chief Cho Tae-yong sentenced to 1 1/2 yrs in prison for  | Yonhap English (Sout | relevance | excluded: court/judicial process (legal outcome, n | — |
| DROPPED | 2026-05-21 | Papua New Guinea | Armed robbery at Manu Cash and Carry; one suspect shot by police durin | The PNG Sun | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-20 | China | Bolivia’s capital under siege as protests and blockades deepen crisis  | South China Morning  | relevance | excluded: out-of-region theatre (foreign syndicati | — |
| DROPPED | 2026-05-19 | Papua | TPNPB claims retaliatory attack killed 1 Indonesian soldier in Yahukim | Jubi | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-19 | Myanmar | Buddhist abbot detained, beaten for defying Myanmar junta ally in Kach | Myanmar Now (via Goo | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-18 | India | ‘I proudly declare India is now Naxal-free,’ says Amit Shah in Bastar | Indian Express (Indi | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-18 | Papua | Intan Jaya regent calls for protection of civilians after church compo | Cenderawasih Pos | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-18 | India | Supreme Court disapproves own ruling denying bail to Umar Khalid in De | Livemint (India busi | relevance | excluded: court/judicial process (legal outcome, n | — |
| DROPPED | 2026-05-18 | Papua | Two TPNPB fighters killed in clash; group claims retaliatory killing o | Jubi | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-18 | Pakistan | 35 terrorists killed during action in hills around Quetta | Dawn (Pakistan) | relevance | excluded: flashpoint homonym (/\b(intelligence[- ] | — |
| DROPPED | 2026-05-17 | Australia | Tech founders use AI-generated images to poke fun at Anthony Albanese  | Guardian Australia | relevance | excluded: flashpoint homonym in headline (/\b(fact | — |
| DROPPED | 2026-05-17 | Pakistan | TTP commander responsible for Fatehkhel bombing killed in Bannu | Dawn (Pakistan) | relevance | excluded: flashpoint homonym (/\b(intelligence[- ] | — |
| DROPPED | 2026-05-15 | Myanmar | Myanmar junta intensifies attacks along Chin-Magway border - Myanmar N | Myanmar Now (via Goo | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-15 | South Korea | Special counsel seeks 5-yr prison term for former Army officer linked  | Yonhap English (Sout | relevance | excluded: court/judicial process (legal outcome, n | — |
| DROPPED | 2026-05-15 | Pakistan | In setback for SPSC, Sindh High Court suspends competitive exam result | Dawn (Pakistan) | relevance | excluded: student non-mobilisation (attack/crime/p | — |
| DROPPED | 2026-05-14 | India | Is Modi ‘coup-proofing’ India’s military? | Japan Times | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-14 | India | Red Fort area blast case: NIA’s 7,500-page chargesheet says all 10 acc | Livemint (India busi | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-14 | Philippines | Political tension in the Philippines escalates after Senate gunfire | Japan Times | relevance | excluded: 'protest'/'crackdown' in non-civil-unres | — |
| DROPPED | 2026-05-14 | Philippines | Chaos after gunfire in Philippines Senate - Australian Broadcasting Co | ABC News Australia ( | relevance | dropped: no flashpoint public-order signal | — |
| DROPPED | 2026-05-14 | Thailand; Cambodia | Cambodia protests Thai heritage listings of 79 sites | Bangkok Post (Thaila | relevance | excluded: 'protest'/'crackdown' in non-civil-unres | — |
| DROPPED | 2026-05-14 | Myanmar | Rival resistance forces launch joint attacks to repel junta advance in | Myanmar Now (via Goo | relevance | dropped: no flashpoint public-order signal | — |

### cargo_watch

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-15 | Indonesia | Kasus pencurian kargo Soetta ancam kepercayaan ekspor-impor Indonesia  | Indonesia Cargo Thef | relevance | Passed relevance gate | — |
| KEPT | 2026-05-13 | Indonesia | Police Bust Cargo Theft Syndicate at Soekarno-Hatta Airport | Jakarta Globe | relevance | Passed relevance gate | — |
| KEPT | 2026-05-12 | Papua New Guinea | Trade-goods truck hijacked outside Lae, Morobe police investigating or | The National (PNG, v | relevance | Passed relevance gate | — |
| KEPT | 2026-05-11 | Indonesia; West Papua | Industrial-zone warehouse theft in Sorong, Polres investigating organi | Cenderawasih Pos (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-08 | Indonesia | Polrestabes Medan Didesak Tangkap Perampok Truk Milik Pengusaha Eksped | Indonesia Cargo Robb | relevance | Passed relevance gate | — |
| KEPT | 2026-05-08 | Indonesia | Polrestabes Medan Didesak Tangkap Perampok Truk Milik Pengusaha Eksped | Indonesia Cargo Robb | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | India | Warehouse theft — Other | — | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Australia | Cargo container stolen from Sydney freight depot, syndicate suspected | Fully Loaded (Austra | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Malaysia | Other land-based cargo theft — Fuel | — | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Vietnam | Container theft at Ho Chi Minh City inland freight depot, syndicate su | VnExpress (via Googl | relevance | Passed relevance gate | — |
| KEPT | 2026-05-03 | Malaysia | Lorry driver robbed, cargo stolen in Johor | The Straits Times | relevance | Passed relevance gate | — |
| KEPT | 2026-05-02 | Cambodia | Container theft at Sihanoukville freight depot, syndicate suspected | Khmer Times (via Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-01 | Papua New Guinea | Container theft at Lae inland freight depot, Morobe police investigati | Post Courier (PNG, v | relevance | Passed relevance gate | — |
| KEPT | 2026-05-01 | India | Truck hijacked on highway, cargo worth Rs 2 crore stolen | Times of India | relevance | Passed relevance gate | — |
| KEPT | 2026-05-01 | New Zealand | Truck hijack on Waikato Expressway near Hamilton, police make arrests | Stuff (NZ, via Googl | relevance | Passed relevance gate | — |
| KEPT | 2026-04-29 | Indonesia | Warehouse theft — FMCG | — | relevance | Passed relevance gate | — |
| KEPT | 2026-04-29 | Malaysia | Cargo theft syndicate busted after truck hijack in Selangor | The Star (Malaysia) | relevance | Passed relevance gate | — |
| KEPT | 2026-04-28 | Vietnam | Truck hijack on QL51 near Bien Hoa, Dong Nai police arrest organised c | Tuoi Tre News (via G | relevance | Passed relevance gate | — |
| KEPT | 2026-04-27 | Papua New Guinea | Truck hijack on Highlands Highway near Mount Hagen, Western Highlands  | Post Courier (PNG, v | relevance | Passed relevance gate | — |
| KEPT | 2026-04-27 | New Zealand | Container theft at Mount Maunganui inland freight depot, Bay of Plenty | NZ Herald (via Googl | relevance | Passed relevance gate | — |
| KEPT | 2026-04-27 | Laos | Truck hijack on Route 9 near Densavanh, Savannakhet police make arrest | Laotian Times (via G | relevance | Passed relevance gate | — |
| KEPT | 2026-04-27 | Bangladesh | Truck hijack on Dhaka-Chattogram highway near Cumilla, freight consign | Prothom Alo (English | relevance | Passed relevance gate | — |
| KEPT | 2026-04-25 | Unknown | Pencurian Gudang Sembako di Selomerto Wonosobo Terungkap, Kerugian Cap | Indonesia Cargo Thef | relevance | Passed relevance gate | — |
| KEPT | 2026-04-24 | Unknown | Cargo Theft Incidents Fall in Q1, but Organized Crime and Impersonatio | APAC Trucking & Tran | relevance | Passed relevance gate | — |
| KEPT | 2026-04-24 | Unknown | จุดจบโซนเซลฟ์เซอร์วิส ซื้อขนมร้าน Greggs ต้องให้ พนง.หยิบ สกัดภัยลักขโ | Thailand Cargo Theft | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-21 | West Papua | Kekerasan HAM Berat Papua Meningkat, SRP: Hentikan Operasi Militer! | Suara Papua (West Pa | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | West Papua | Pemprov Papua percepat penanganan infrastruktur di Kabupaten Kepulauan | Jubi (Papua, Bahasa  | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | West Papua | Gubernur Fakhiri prioritaskan perbaikan jalur barat dan pengembangan b | Jubi (Papua, Bahasa  | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | West Papua | Pemenuhan SDM nakes merupakan kebutuhan mendesak di Papua Tengah | Jubi (Papua, Bahasa  | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-19 | West Papua | Pemkot Diminta Bantu Fasilitasi Penyelesaian Masalah di Perum Organda | Cenderawasih Pos (Pa | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-19 | West Papua | Masa Bongkar Semakin Panjang, PT SPIL Bongkar Kontainer di Timika | Cenderawasih Pos (Pa | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-16 | Pakistan | FIA to probe agency raid on jewellery shop in Karachi’s Sarafa Bazaar | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-15 | Pakistan | Probe shows foreigners' involvement in network run by alleged drug que | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | Pakistan | Civil servants’ asset declarations to be made public in redacted form, | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-11 | Pakistan | Police say 25 sacrificial goats worth Rs1.9m stolen from Karachi's Gul | Dawn (Pakistan) | relevance | excluded: cargo livestock (no commercial supply-ch | — |
| DROPPED | 2026-05-07 | Unknown | Ogun Police Foil Truck Hijack Attempt, Recover Stolen Vehicle and Fake | APAC Truck Hijack (G | relevance | excluded: cargo off-topic (/\bogun\b.{0,30}(nigeri | — |
| DROPPED | 2026-05-05 | Unknown | Valid carrier authorities are being used in cargo theft schemes - Frei | Australia Freight &  | relevance | excluded: cargo off-topic (/\b(cargo\|freight) (the | — |
| DROPPED | 2026-05-05 | Unknown | $4 million cargo theft recovery shows what enforcement can do - Freigh | Australia Freight &  | relevance | excluded: cargo off-topic (/\b(cargo\|freight) (the | — |
| DROPPED | 2026-05-04 | Laos | Warehouse heist in Vientiane logistics zone, electronics consignment s | Vientiane Times (via | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-04 | Bangladesh | Container heist at Chattogram inland container depot, Chittagong polic | The Daily Star (Bang | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-04 | New Zealand | Warehouse heist in Auckland's Wiri logistics belt, electronics consign | NZ Herald (via Googl | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-04 | Cambodia | Warehouse heist in Phnom Penh's Russey Keo logistics zone, electronics | Phnom Penh Post (via | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-04 | Unknown | "개인정보만 훔치는 해커? 화물까지 빼돌린다"…FBI의 경고 - 디지털데일리 | South Korea Cargo Th | relevance | excluded: cargo off-topic (/\bfbi\b.{0,20}(warn\|wa | — |
| DROPPED | 2026-05-04 | Unknown | Kantin Sekolah hingga Gudang Dibobol, Maling Gas Terekam CCTV, Warga M | Indonesia Cargo Thef | relevance | excluded: cargo off-topic (/kantin sekolah/) | — |
| DROPPED | 2026-05-04 | Papua New Guinea | Warehouse heist in Port Moresby's Gerehu logistics zone, electronics c | The National (PNG, v | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-02 | Vietnam | Warehouse heist in Bac Ninh industrial park, electronics consignment s | VnExpress (via Googl | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-01 | Unknown | 米トラック協、司法省に貨物盗難対応強化を要請 - LOGISTICS TODAY | Japan Cargo Theft (J | relevance | excluded: cargo off-topic (/司法省.{0,24}(対応\|対策\|取締\|取り | — |
| DROPPED | 2026-05-01 | Laos | Cross-border freight robbery at Boten checkpoint, Luang Namtha police  | Laotian Times (via G | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-01 | Australia | Semi-trailer break-in at Melbourne logistics yard, freight consignment | Big Rigs (Australia) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-01 | Unknown | LA서 4백만 달러 상당 도난 화물 압수 .. 1명 체포 - 라디오코리아 모바일 | South Korea Cargo Th | relevance | excluded: cargo off-topic (/la서.{0,24}(화물\|도난\|압수\|체포 | — |

### shipping

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-22 | Iran | Strait of Hormuz closure risks greatest global energy supply shock in  | Hellenic Shipping Ne | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Iran | Iran proposes permanent toll for Strait of Hormuz shipping | Hellenic Shipping Ne | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | China; Iran | First coordinated VLCC transits through Hormuz raise cautious hopes of | Splash247 | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Iran | Strait of Hormuz disruption helps drive 8% rise in Panama Canal transi | Hellenic Shipping Ne | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | South Korea; Iran | FM Cho says probe into Hormuz Strait vessel attack in final stage | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | South Korea; Iran | S. Korea, Iran continue 'close, serious' discussions regarding recent  | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-18 | Iran | Iran to unveil Strait of Hormuz traffic plans, will collect tolls | Hellenic Shipping Ne | relevance | Passed relevance gate | — |
| KEPT | 2026-05-17 | Iran | Bulk carrier attacked by multiple small craft off Iran, UKMTO says - M | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-15 | Pakistan; India; Thailand; Singapore; Iran | 11 Pakistanis, 20 Iranians aboard US-seized vessels repatriated, says  | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-15 | Iran | UKMTO Reports Vessel Seized by Unauthorized Personnel Near Strait of H | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | South Korea; Iran | S. Korea to conduct additional probe into vessel attack in Hormuz, pus | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | Vessel seized off UAE and heading toward Iranian waters: UKMTO - The N | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates | Reports of vessel on fire off UAE's Sharjah - UKMTO - Devdiscourse | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | Vessel seized off UAE coast by unauthorized individuals now heading to | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | India; United Arab Emirates | UAE condemns terrorist attack on Indian-flagged vessel off Oman coast  | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | India; Iran | Vessel boarded and heading to Iran as India-flag vessel attacked - Llo | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | India; Iran; Qatar | Two India-Bound LPG Tankers Clear Hormuz in Dark Mode | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | Vessel seized off UAE coast, headed toward Iranian waters: UK maritime | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | Vessel seized off UAE coast, moved toward Iranian waters, UKMTO says - | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | Iran | Global trade’s next top priority: Bypassing the Hormuz chokepoint | Hellenic Shipping Ne | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | Hormuz Crisis: Vessel Seized Off UAE Heading to Iran - Deccan Herald | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | UKMTO says Honduran-flagged vessel seized by Iran near UAE - upi.com | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | UKMTO says Honduran-flagged vessel seized by Iran near UAE - Yahoo | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | United Arab Emirates; Iran | Vessel seized off UAE coast headed for Iranian waters: UK agency - Yen | UKMTO Advisories (vi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | South Korea | (URGENT) S. Korea will take 'diplomatic offensive' once actor behind v | Yonhap English (Sout | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-22 | Unknown | Freight rate recovery ‘more about demand than blanked sailings’ | The Loadstar | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Unknown | Drewry: World Container Index Up 6% | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Unknown | CMA CGM delivered resilient results and demonstrated its ability to ad | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Iran | Strait of Hormuz closure may trigger ‘severe’ food price crisis: FAO | Hellenic Shipping Ne | relevance | excluded: shipping off-topic (/\bfao\b/) | — |
| DROPPED | 2026-05-22 | Unknown | Euroholdings Ltd Reports Results for the Quarter Ended March 31, 2026  | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Unknown | VHBS New ConTex Container Ship Time Charter Assessment Index Week 21 | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Unknown | Baltic Dry Index climbs to 2991 up 27 points | Hellenic Shipping Ne | relevance | excluded: shipping off-topic (/\bbaltic (dry\|excha | — |
| DROPPED | 2026-05-22 | Unknown | Frontline cashes in on ageing suezmax pair | Splash247 | relevance | excluded: shipping off-topic (/\b(suezmax\|vlcc\|afr | — |
| DROPPED | 2026-05-22 | China | Peter Georgiopoulos returns to VLCC arena with up to 10 newbuilds at W | Splash247 | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Baltic Dry Index Falls to Over 2-Week Low | Hellenic Shipping Ne | relevance | excluded: shipping off-topic (/\bbaltic (dry\|excha | — |
| DROPPED | 2026-05-21 | Unknown | Redundancies as Maersk green think tank feels the squeeze | Splash247 | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Cargo carriers split on freighter strategy as Boeing delays extend | The Loadstar | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Maritime Association of the Port of New York and New Jersey Honors Ind | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Drewry: Container Spot Rates Continue Climb as Early Peak Season Gains | gCaptain | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Indonesia; Vietnam; Cambodia | CMA CGM Strengthens Vietnam-U.S. West Coast Network with Mekong Transp | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Latsis-linked EuroHoldings grows product tanker exposure with second L | Splash247 | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | China | Ibaizabal heads back to suezmax newbuilds | Splash247 | relevance | excluded: shipping off-topic (/\b(heads? back to\|r | — |
| DROPPED | 2026-05-20 | New Zealand | Maersk expands methanol fleet with new delivery | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | Unknown | Baltic Dry Index falls to 3005 down 49 points | Hellenic Shipping Ne | relevance | excluded: shipping off-topic (/\bbaltic (dry\|excha | — |
| DROPPED | 2026-05-20 | Unknown | Dynacom lands $65m for ageing suezmax | Splash247 | relevance | excluded: shipping off-topic (/\b(lands?\|orders?)\ | — |
| DROPPED | 2026-05-20 | Unknown | Baltic Dry Index Falls for 4th Day | Hellenic Shipping Ne | relevance | excluded: shipping off-topic (/\bbaltic (dry\|excha | — |
| DROPPED | 2026-05-19 | Unknown | Cavotec renews service agreement with Port of Salalah in Oman | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-19 | Iran | Maintenance work and weather threatens to boost Panama Canal congestio | The Loadstar | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-19 | Unknown | CMB.TECH pockets $29m gain from veteran suezmax disposal | Splash247 | relevance | excluded: shipping off-topic (/\b(suezmax\|vlcc\|afr | — |
| DROPPED | 2026-05-19 | Unknown | Baltic Dry Index falls to 3054 down 38 points | Hellenic Shipping Ne | relevance | excluded: shipping off-topic (/\bbaltic (dry\|excha | — |

### fuel

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-23 | India | Petrol, Diesel prices hiked for third time: Check latest fuel rates in | Livemint (India busi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-23 | Unknown | Third fuel price hike in 2 weeks: Petrol price raised by 87 paise, die | Indian Express (Indi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Japan; Saudi Arabia; Iran | Japan to Welcome First Crude Cargo via Hormuz Since War Began | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Pakistan; Iran | Parliamentary caucus warns against using fuel levy as revenue measure | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Iran | Volatility Spikes as Iran Diplomacy Collides With Hormuz Fears | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Japan; Iran | Japan to Receive First Oil Tanker to Exit Hormuz Since War Began | gCaptain | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Australia | Australian government plans for ‘worst-case scenario’ retail fuel rati | Guardian Australia | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Pakistan | Govt cuts petrol price by Rs6/Litre, HSD by Rs6.80 ahead of Eid ul Adh | Profit Pakistan Toda | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Iran | Colombia's Natural Gas Crisis Deepens as Strait of Hormuz Closure Cuts | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | India; China; Japan; South Korea; Taiwan; Saudi Arabia; Iran | Why Saudi Arabia Is Losing Asia’s Oil Buyers | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Unknown | Pacific leaders warned of 'prolonged' fuel crisis as new plan endorsed | ABC News Australia ( | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Iran | Govt reduces petrol by Rs6 per litre, high-speed diesel by Rs6.8 | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | India | Delhi-NCR taxi, auto strike over fuel price hike begins — Check demand | Livemint (India busi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Iran | StanChart Says Record SPR Withdrawals Are Tightening U.S. Oil Buffers | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Pakistan | Centre to resume gas supply to KP filling stations today | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Unknown | Pacific Leaders Invoke Biketawa Declaration Over Looming Fuel Crisis | Post-Courier (Papua  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Unknown | Europe faces jet fuel supply risk despite temporary demand reprieve | Hellenic Shipping Ne | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | United Arab Emirates; Iran | ADNOC CEO Says Hormuz Oil Flows May Not Fully Recover Before 2027 | gCaptain | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Japan; Iran | Japan’s Crude Imports from Middle East Slump to Lowest on Record | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | United Arab Emirates | ADNOC Warns Gulf Oil Disruptions Could Last Until 2027 | OilPrice.com | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Pakistan; Iran | Hub administration fixes Iranian petrol price at Rs250 per litre | Profit Pakistan Toda | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Iran | Hub fixes Iranian petrol price at Rs250 per litre | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | South Korea | Gov't to extend fuel tax cut through July amid consumer price pressure | Yonhap English (Sout | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates; Iran | New UAE Pipeline Bypassing Hormuz Now 50% Complete, ADNOC CEO Says | gCaptain | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | China; Iran; Qatar; Iraq | Two Supertankers Exit Hormuz With Crude Bound for China | OilPrice.com | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-22 | Unknown | Kazakhstan Court Upholds $1.4 Billion Award Against Gazprom | OilPrice.com | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Australia | News live: Australian tourist who died hiking Inca Trail identified; C | Guardian Australia | relevance | excluded: general-news noise (/\bnews live\b/) | — |
| DROPPED | 2026-05-22 | India | Petrol, diesel prices today, 22 May: Check fuel rates in Delhi, Mumbai | Livemint (India busi | relevance | excluded: fuel off-topic (/\b(petrol\|diesel\|fuel)  | — |
| DROPPED | 2026-05-22 | Pakistan; Iran | Oil prices rise as investors doubt breakthrough in US-Iran peace talks | Profit Pakistan Toda | relevance | excluded: fuel off-topic (/\b(oil futures\|crude fu | — |
| DROPPED | 2026-05-22 | United Arab Emirates; Iran | Is UAE Building Anti-Drone Shield Around Oil Facilities Amid Iran Atta | UAE Air-Defense / Mi | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | United Arab Emirates | UAE Left OPEC to Pump More as End of Oil Era Looms, Presidential Advis | gCaptain | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Iran | Oil Prices Rise as Traders Grow Skeptical of U.S.-Iran Deal | OilPrice.com | relevance | excluded: fuel off-topic (/\b(oil futures\|crude fu | — |
| DROPPED | 2026-05-22 | Iran | US-Iran War LIVE: Crude oil prices may hit $200 per barrel if Hormuz c | Livemint (India busi | relevance | excluded: general-news noise (/\blive (updates?\|bl | — |
| DROPPED | 2026-05-22 | Singapore | Singapore fuel oil stocks rise to near one-month high | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Saudi Arabia; Iran | Saudi Arabia Forced to Boost Fuel Oil Imports as Gas Output Dips | OilPrice.com | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | India | Petrol, diesel prices today, 21 May: Check fuel rates in Delhi, Mumbai | Livemint (India busi | relevance | excluded: fuel off-topic (/\b(petrol\|diesel\|fuel)  | — |
| DROPPED | 2026-05-21 | Japan | Korea, Japan Expand Energy Swap Cooperation | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Iran | Citi forecasts Brent crude to reach $120 per barrel in near term | Hellenic Shipping Ne | relevance | excluded: fuel off-topic (/\b(forecasts?\|projects? | — |
| DROPPED | 2026-05-21 | Pakistan | Petroleum Division proposes cutting levy target to Rs1 trillion, reduc | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Tanker Market’s Disruption More Stark Than Ever | Hellenic Shipping Ne | relevance | excluded: fuel off-topic (/\b(share price\|stock pr | — |
| DROPPED | 2026-05-21 | China | Zodiac expands tanker orderbook with quartet of suezmax newbuilds | Splash247 | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Oil Could Enter Red Zone by July/August: IEA | OilPrice.com | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Iran | U.S. Marines board Iranian oil tanker in Gulf of Oman | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Heidmar Maritime Holdings Corp. Grows Managed Fleet With Five Strategi | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Fujairah Terminals Signs Strategic Land Lease Agreements with Fujairah | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Saudi Arabia | Saudi Oil Export Income Jumped to 3.5-Year High in March as Prices Soa | OilPrice.com | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Pakistan; Iran | Oil rebounds on uncertainty over Iran peace deal and inventory drawdow | Profit Pakistan Toda | relevance | excluded: fuel off-topic (/\b(oil futures\|crude fu | — |
| DROPPED | 2026-05-20 | Saudi Arabia | JODI: Saudi Arabia Crude Exports Sink To Record Lows | OilPrice.com | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | Iran | IEA: Oil Shock Sparks Surge in EV Sales | OilPrice.com | relevance | excluded: fuel off-topic (/\b(ev\|electric vehicle\| | — |
| DROPPED | 2026-05-20 | India | Petrol, diesel prices today, 20 May: Fuel rates in Delhi, Mumbai, Beng | Livemint (India busi | relevance | excluded: fuel off-topic (/\b(petrol\|diesel\|fuel)  | — |

### energy

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-23 | Unknown | Gurugram power outage: What caused massive blackout on Friday — from o | Livemint (India busi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Unknown | New power tariff may raise bills for homes using over 400 units from J | The Nation Thailand  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Sri Lanka | Govt. will not seek electricity tariff hike until September  Minister | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | Pakistan | Power tariff likely to rise by Rs1.72/unit under April FCA | Profit Pakistan Toda | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Pakistan | Electricity prices may drop by Rs1.93 per unit | Profit Pakistan Toda | relevance | Passed relevance gate | — |
| KEPT | 2026-05-12 | Pakistan | Storm topples 12 grid towers, sparks power crisis in Lahore’s heartlan | Profit Pakistan Toda | relevance | Passed relevance gate | — |
| KEPT | 2026-05-10 | Unknown | Increased electricity tariffs to take effect from tomorrow amid public | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-09 | Sri Lanka | PUCSL to announce decision on special electricity tariff revision toda | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-09 | Unknown | 18% electricity tariff hike on consumers exceeding 180 units is extort | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-09 | Sri Lanka | PUCSL approves 18% electricity tariff increase for consumers exceeding | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-08 | Pakistan | Karachi Power Crisis \| Long Load Shedding \| Electricity Shortage Heatw | Aaj News (Pakistan,  | relevance | Passed relevance gate | — |
| KEPT | 2026-05-08 | Indonesia | Indonesia pushes ASEAN cross-border power grid expansion | Antara News (Indones | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Pakistan | Provincial assembly raises concern over karo-kari incidents in Sindh | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Pakistan | 10 found dead as Karachi endures ‘hottest day in eight years’ | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Pakistan | @Invest_Kardo: Seeing the import bill trust me load shedding of power  | X: Pakistan fuel/gri | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Vietnam | Vietnam turns to Laos for electricity to prevent power shortage - phno | Phnom Penh Post (via | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Sri Lanka | Public consultation on proposed electricity tariff revision to be held | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Pakistan | @DialoguePak: K-Electric has announced that if the “feels-like” temper | X: Pakistan fuel/gri | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Pakistan | @OmarAyubKhan: 1. The heat wave building up across Pakistan is going t | X: Pakistan fuel/gri | relevance | Passed relevance gate | — |
| KEPT | 2026-05-05 | Sri Lanka | Public consultation on proposed electricity tariff revision begins tod | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-04 | Pakistan | @WritersRightPK: If anyone has awakened this nation after Allama Iqbal | X: Pakistan fuel/gri | relevance | Passed relevance gate | — |
| KEPT | 2026-05-04 | Pakistan | @oltuser9: Not only that the greenery is diminishing but on the other  | X: Pakistan fuel/gri | relevance | Passed relevance gate | — |
| KEPT | 2026-05-04 | Pakistan | PTI accuses govt of ‘unprecedented economic crisis’, slams claims of s | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-04 | Pakistan | Sweltering heat, loadshedding and water shortages add to people’s woes | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-04 | Pakistan | @omerq22: @KElectricPk Our area was load-shedding EXEMPT but for the p | X: Pakistan fuel/gri | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-22 | Pakistan | FBR suspends K-Electric’s sales tax registration | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-22 | Unknown | TEPCO employees recorded civil trials in violation of court rules | Japan Times | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-20 | Pakistan | Biogas will not be used to fuel buses on Red Line corridor, Sindh Asse | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-16 | Pakistan | Sindh Assembly reverberates with heated discussion over ‘drug menace’ | Dawn (Pakistan) | relevance | excluded: energy off-topic (/\bno load[- ]?sheddin | — |
| DROPPED | 2026-05-15 | Pakistan | Nepra approves tariff for 204MW electricity imports from Iran, warns C | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | Pakistan | Nepra allows digital payments for regulatory fees through new amendmen | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | Unknown | CEB to award Rs. 8.5bn VRS compensation tomorrow - Daily Mirror - Sri  | Daily Mirror (Sri La | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | South Korea | (LEAD) KEPCO Q1 net profit up 6.7 pct on cost-saving efforts | Yonhap English (Sout | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | Indonesia; Bangladesh | PLN Indonesia Power to develop 495 MW solar project in Bangladesh | Antara News (Indones | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | Pakistan | Govt, Karachi consumers oppose ₨60 billion K-Electric tariff adjustmen | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | Pakistan | Nepra tasked to probe IPPs performance, payments amid surging electric | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-09 | Pakistan | Nepra approves ₨42.6 billion investment plan for PESCO, cuts proposed  | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-08 | Pakistan | Nepra questions plan to expand Pakistan’s power generation capacity to | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-07 | South Korea | KEPCO, KHNP uncooperative with each other: state auditor | Yonhap English (Sout | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-06 | Pakistan | Nepra to hear K-Electric’s Rs58 billion tariff adjustment claims on Ma | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-06 | Unknown | CO₂e emissions in the Rotterdam port area rose in 2025 due to increase | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-06 | Pakistan | Nepra withdraws Rs42 billion penalties imposed on National Transmissio | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-06 | Unknown | Russians turn to cash as internet blackouts disrupt payments | Japan Times | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-06 | Pakistan | Nepra walks back Rs42bn penalties on National Transmission and Dispatc | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-06 | Indonesia | DevvStream Named Exclusive Partner to PLN Indonesia Power for Carbon C | Antara News (Indones | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-05 | Pakistan | Extreme heat prompts nationwide emergency protocols | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-05 | Bangladesh | @NCPDiasporaUSA: May 5, Shapla Chattar Massacre Day. In 2013, state fo | X: Bangladesh fuel/g | relevance | excluded: energy off-topic (/\b(media\|news\|press\|i | — |
| DROPPED | 2026-05-05 | Pakistan | Hot weather to persist in Karachi but temperature to stay below 40°C | Dawn (Pakistan) | relevance | excluded: energy off-topic (/\bno load[- ]?sheddin | — |
| DROPPED | 2026-05-05 | Unknown | First phase of VRS compensation for ex-CEB employees by May 15  Minis | Ada Derana (Sri Lank | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-04 | Pakistan | @NarrativesM: K-Electric announces no loadshedding in Karachi during t | X: Pakistan fuel/gri | relevance | excluded: energy off-topic (/\bno load[- ]?sheddin | — |

### fertiliser

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-22 | Unknown | U.S. fertilizer prices pause 13-week rise for first time since Februar | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | India | India’s IPL scraps 521,000t ammonia tender after suppliers bid less th | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-22 | Unknown | Yara’s Le Havre ammonia-urea plant shuts down on technical incident, r | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | Unknown | USDA accelerates Blue Point ammonia permitting and restarts stalled fe | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | Unknown | On-farm green ammonia gains traction in Canada as fertilizer market tu | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Unknown | EU plans to secure fertiliser supply - irishsun.com | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Japan | UNDP head warns of food shortages amid surging fertilizer prices | Japan Times | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | India | India faces twin threat of heat waves and fertilizer shortages ahead o | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | India; Nepal | Nepal seeks urgent fertiliser imports from India ahead of paddy season | Kathmandu Post (Nepa | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Unknown | EU plans to secure fertiliser supply - malaysiasun.com | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Unknown | Yara CEO: fertilizer shortage is costing 10 billion meals per week glo | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-17 | Indonesia; Australia | Australia thanks Indonesia for fertilizer exports: Minister | Antara News (Indones | relevance | Passed relevance gate | — |
| KEPT | 2026-05-16 | Indonesia | President says many countries seek Indonesia's fertilizer supply | Antara News (Indones | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | India | Govt eyes GSFC to boost automotive-grade urea supply amid Gulf disrupt | Livemint (India busi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-14 | India | US lawmakers cite India’s fertiliser imports amid farm cost crisis - l | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-13 | Sri Lanka | Learn from Sri Lanka’s experience on impact of fertilizer supply chain | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-13 | Pakistan | PM orders uninterrupted supply of fertiliser to safeguard food securit | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-12 | Unknown | Rice sufficiency and security: High fertiliser prices result in inadeq | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-12 | Unknown | Which Countries Rely Heavily on Gulf Fertilizer Imports? - the-star.co | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-12 | India | India’s IPL seeks lower DAP prices in 1.2 million-ton import tender | Fertilizer Daily | relevance | Passed relevance gate | — |
| KEPT | 2026-05-12 | Unknown | Govt. denies fertiliser shortage \| Daily FT - newspaper - Magzter | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-11 | Unknown | West Asia War Hits Home: Are We Prepared? Fuel, Forex & Fertiliser Sup | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-11 | Unknown | Additional fertiliser subsidy for small tea estate owners - Hiru News | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-09 | Unknown | No fertilizer shortage for Yala Season - Minister Lal Kantha | Ada Derana (Sri Lank | relevance | Passed relevance gate | — |
| KEPT | 2026-05-09 | Sri Lanka | Fertiliser supply: Sri Lanka feels the heat of global turmoil - The Mo | Asia Fertilizer (Goo | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-22 | China | Dry Bulk Market: China Soybean Imports on the Rise | Hellenic Shipping Ne | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-21 | Unknown | Sugar exports fall below 5% as Centre prioritizes domestic market | Livemint (India busi | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-19 | Pakistan | KP govt, governor, opposition join hands over wheat, CNG crises | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-19 | Indonesia | Indonesia expands rice exports as stocks hit record high: Ministry | Antara News (Indones | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-18 | Pakistan | Pakistan pivots rice exports to Africa and Asia as shipping disruption | Aaj News (Pakistan,  | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-18 | Saudi Arabia | Second phosphate cargo crosses Strait of Hormuz since Iran war began — | Fertilizer Daily | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-18 | Pakistan | CM Afridi seeks PM's intervention on CNG crisis in KP, warns of possib | Dawn (Pakistan) | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-15 | India; Thailand | India bans sugar exports until Sept 2026 to cool local prices | Kathmandu Post (Nepa | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-15 | Unknown | Monsoon likely to hit Kerala around 26 May, may boost kharif sowing | Livemint (India busi | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | India | India’s fertilizer ministry establishes joint buying consortium for DA | Fertilizer Daily | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | Sri Lanka | Fertiliser crisis and Sri Lanka’s long road to self-sufficiency - Dail | Asia Fertilizer (Goo | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | India | India bans sugar exports till Sept 2026 as Centre moves to cool domest | Livemint (India busi | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-14 | India; Thailand | India bans sugar exports until Sept 2026 to cool local prices | Livemint (India busi | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | Unknown | ATOME gets green light on $665M Paraguay green fertilizer plant backed | Fertilizer Daily | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | Sri Lanka | Fertiliser crisis and Sri Lanka’s long road to self-sufficiency - Dail | Asia Fertilizer (Goo | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-13 | Indonesia | Indonesia records highest rice stocks in history: minister | Antara News (Indones | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-12 | Thailand | Thai Rice Exports Set for Second-Half Recovery as Super El Niño Trigge | The Nation Thailand  | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-12 | Unknown | e-Vikas is driving behavioural shift towards need-based fertiliser use | Asia Fertilizer (Goo | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-11 | Pakistan | KP flour millers warn of flour crisis amid wheat supply disruption fro | Profit Pakistan Toda | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-11 | Unknown | Q1 rice exports earnings climb almost 30% - Phnom Penh Post | Phnom Penh Post (via | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-11 | Unknown | How Asean can reduce its heavy dependence on imported agricultural inp | Asia Fertilizer (Goo | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-11 | Unknown | Fertilisers stock comfortable to meet requirement of Kharif sowing sea | Asia Fertilizer (Goo | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-11 | Thailand | Thai Chamber says US corn imports will not hurt farmers - Nation Thail | The Nation Thailand  | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-10 | Malaysia | Malaysia plans cloud seeding for drought-hit 'rice bowl' | VnExpress Internatio | relevance | dropped: no required topic phrase matched | — |
| DROPPED | 2026-05-09 | Malaysia | Malaysia plans cloud seeding for drought-hit ‘rice bowl’ - Borneo Bull | Borneo Bulletin (Bru | relevance | dropped: no required topic phrase matched | — |

### strikes

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-22 | Pakistan | FC headquarters attack ‘mastermind’ killed in Balochistan | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Pakistan; India | Security forces kill five terrorists, including wanted commander, in N | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Pakistan; India | Security forces kill 23 terrorists in multiple Khyber Pakhtunkhwa IBOs | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Pakistan; India | Wanted terrorist ringleader among 5 militants killed in North Wazirist | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-21 | Myanmar | KIA drone strike kills Myanmar junta troops near Hpakant - Myanmar Now | Myanmar Now (via Goo | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | IAEA sounds alarm after drone nearly strikes UAE nuclear station - RBC | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | UAE says drone that hit near its nuclear plant was launched from Iraq  | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | Drone strike sparks fire near UAE nuclear plant - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | UAE warns Iraq after drone strike on Barakah nuclear plant - Caliber.A | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | Concerns Grow Over Nuclear Safety After Drone Strike On UAE Nuke Plant | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | Drone strike near UAE nuclear plant prompts warning from IAEA chief -  | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-20 | United Arab Emirates | Drone strike hits UAE nuclear plant amid Iran truce strain - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | UAE says drone that hit near its nuclear plant was launched from Iraq  | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Trump warns Iran as UAE nuclear plant hit in drone strike - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | UAE nuclear site hit by drone as Trump warns Iran - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Drone strike hits UAE nuclear plant as Trump warns Iran - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Trump warns Iran of harder strikes after UAE drone attack - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | Pakistan; India | Security forces kill 22 terrorists in North Waziristan operation: ISPR | Dawn (Pakistan) | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Markets fall as Trump warns Iran and UAE hit by drone strike - MSN | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Drone hit near Barakah Nuclear Power Plant came from Ira1, says UAE -  | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Drones that targeted UAE’s Barakah nuclear plant came from Iraqi terri | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | Fire sparked after drone strike at UAE nuclear plant - E&E News by POL | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | IAEA confirms power restored to Barakah Unit 3 after drone strike hits | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | UAE Signals Tough Action After Drone Hits Near Barakah Nuclear Facilit | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| KEPT | 2026-05-19 | United Arab Emirates | UAE Restores Power to Drone-Hit Nuclear Plant, Watchdog Says - Bloombe | UAE Air-Defense / Mi | relevance | Passed relevance gate | — |
| DROPPED | 2026-05-20 | Australia | Man charged with stealing camera equipment from Bondi shooting victim  | Guardian Australia | relevance | excluded: general-news noise (/\bnews live\b/) | — |
| DROPPED | 2026-05-15 | Australia | Neo-Nazi group National Socialist Network criminalised under hate laws | Guardian Australia | relevance | excluded: general-news noise (/\bnews live\b/) | — |
| DROPPED | 2026-05-13 | Australia | One Nation senator Malcolm Roberts again fails to rule out Bondi beach | Guardian Australia | relevance | excluded: general-news noise (/\bnews live\b/) | — |

### flashpoint (final report)

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KEPT | 2026-05-30 | Japan | Tokyo rally demands return of Japanese abductees in N Korea | Google News — Japan  | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-30 | Japan | Thousands rally in Tokyo against Takaichi moves under 'No War' banner | Google News — Japan  | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-30 | China | Thousands rally in Tokyo against Takaichi government's dangerous polic | Google News — Japan  | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-28 | Bangladesh | Bangladesh Editors, Media Owners to Protest Mob Attacks on Press and C | Google News — Bangla | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-28 | Philippines | Fisherfolk protest rising commercial fishing in municipal waters | Google News — Philip | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-28 | Bangladesh | Violence Erupts in Bangladesh as Police Clash with Dhaka University St | Google News — Bangla | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-26 | Philippines | Protest vs tree cutting in Manila | Google News — Philip | selectFlashpointUsable | In final report set | — |
| KEPT | 2026-05-24 | Philippines | Benguet students protest against Villanueva as Senate education chair | Google News — Philip | selectFlashpointUsable | In final report set | — |
| DROPPED | 2026-05-30 | China | Myanmar’s junta chief turned president heads to India, with an eye on  | The Kathmandu Post | weak-operational | Cut by selectFlashpointUsable (weak-operational) | FN |
| DROPPED | 2026-05-30 | Japan | Thousands rally in Tokyo against Takaichi government's dangerous polic | Google News — Japan  | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-29 | Nepal | Nepal Rights Body Urges Charges Against Ex-PM Over Gen Z Protest Death | Google News — Nepal  | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-29 | Bangladesh | Hasina’s Lawyer Urges UN to Retract Bangladesh Protest Death Toll Repo | Google News — Bangla | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-29 | Bangladesh | "Highly Inaccurate": Sheikh Hasina On UN Report On Bangladesh Protest  | Google News — Bangla | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-28 | Nepal | Peaceful Polling underway in Nepal after countrywide GenZ protest - Ne | Google News — Nepal  | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-28 | Nepal | Use of lethal force, Oli & Lamichhane under lens—Nepal’s NHRC on Gen Z | Google News — Nepal  | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-27 | Nepal | NHRC recommends action against Oli, Lekhak, Gurung over Gen Z protest  | Google News — Nepal  | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-27 | Philippines | BAYAN, labor leaders face raps over May 1 rally in Manila - ABS-CBN | Google News — Philip | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-27 | Nepal | Former Nepal PM K P Sharma Oli arrested over Gen Z protest crackdown \| | Google News — Nepal  | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-26 | Malaysia | Thousands rally for EU on Georgia’s independence day - Free Malaysia T | Google News — Malays | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-25 | Sri Lanka | Former Sri Lankan IGP arrested in connection with May 2022 attack on p | Google News — Sri La | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-22 | Bangladesh | Licensable picture: Protest Against Child Rape In Dhaka, Bangladesh -  | Google News — Bangla | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-22 | Bangladesh | Dhaka Protests Demanding Justice For Ramisa Akhter \|  Were living in f | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-22 | India | Bangladesh Anti India Protest BJP TMC , बांग्लादेश में भारत विरोधी प्र | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | Indonesia | Licensable picture: Protest in solidarity with Palestinians and Global | Google News — Indone | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | Malaysia | Top UN court says right to strike protected in key labour treaty - Fre | Google News — Malays | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | Australia | ACT public schools : May 22 strike to delay morning traffic \| The Canb | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | India | Cab , auto strike in Delhi - NCR : Three - day Chakka jam in Capital , | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | Pakistan | Pakistan : Students hold protest in Balochistan against delay in lapto | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | China | Young Indians protest through parody  cockroach  party \| South China M | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-21 | China | Chinese delegation arrives at the National Assembly ; government reque | — | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-20 | Malaysia | Union to strike Thursday at South Korean chip giant Samsung Electronic | Google News — Malays | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-16 | Bangladesh | Attempted rape on varsity campus in Bangladesh sparks protest, calls f | Google News — Bangla | selector | Cut by selectFlashpointUsable (unknown) | FN |
| DROPPED | 2026-05-16 | Japan | Nakba Day solidarity demonstration held against Japan’s Industry Minis | Google News — Japan  | selector | Cut by selectFlashpointUsable (unknown) | FN |

### cargo_watch (scope)

| Verdict | Date | Country | Title | Source | Stage | Reason | FP/FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DROPPED | 2026-05-21 | West Papua | Kekerasan HAM Berat Papua Meningkat, SRP: Hentikan Operasi Militer! | Suara Papua (West Pa | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-20 | West Papua | Pemprov Papua percepat penanganan infrastruktur di Kabupaten Kepulauan | Jubi (Papua, Bahasa  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-20 | West Papua | Gubernur Fakhiri prioritaskan perbaikan jalur barat dan pengembangan b | Jubi (Papua, Bahasa  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-20 | West Papua | Pemenuhan SDM nakes merupakan kebutuhan mendesak di Papua Tengah | Jubi (Papua, Bahasa  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-19 | West Papua | Pemkot Diminta Bantu Fasilitasi Penyelesaian Masalah di Perum Organda | Cenderawasih Pos (Pa | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-19 | West Papua | Masa Bongkar Semakin Panjang, PT SPIL Bongkar Kontainer di Timika | Cenderawasih Pos (Pa | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-14 | Pakistan | Civil servants’ asset declarations to be made public in redacted form, | Dawn (Pakistan) | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-11 | Pakistan | Police say 25 sacrificial goats worth Rs1.9m stolen from Karachi's Gul | Dawn (Pakistan) | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-08 | Indonesia | Polrestabes Medan Didesak Tangkap Perampok Truk Milik Pengusaha Eksped | Indonesia Cargo Robb | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-08 | Indonesia | Polrestabes Medan Didesak Tangkap Perampok Truk Milik Pengusaha Eksped | Indonesia Cargo Robb | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-07 | Unknown | Ogun Police Foil Truck Hijack Attempt, Recover Stolen Vehicle and Fake | APAC Truck Hijack (G | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-05 | India | Warehouse theft — Other | — | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-05 | Unknown | Valid carrier authorities are being used in cargo theft schemes - Frei | Australia Freight &  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-05 | Unknown | $4 million cargo theft recovery shows what enforcement can do - Freigh | Australia Freight &  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-04 | Unknown | "개인정보만 훔치는 해커? 화물까지 빼돌린다"…FBI의 경고 - 디지털데일리 | South Korea Cargo Th | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-04 | Unknown | Kantin Sekolah hingga Gudang Dibobol, Maling Gas Terekam CCTV, Warga M | Indonesia Cargo Thef | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-01 | Unknown | 米トラック協、司法省に貨物盗難対応強化を要請 - LOGISTICS TODAY | Japan Cargo Theft (J | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-05-01 | Unknown | LA서 4백만 달러 상당 도난 화물 압수 .. 1명 체포 - 라디오코리아 모바일 | South Korea Cargo Th | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-29 | Indonesia | Warehouse theft — FMCG | — | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-28 | Unknown | IANA 2026 Business Meeting to tackle cargo theft, AI and economic vola | Australia Freight &  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-25 | Unknown | Pencurian Gudang Sembako di Selomerto Wonosobo Terungkap, Kerugian Cap | Indonesia Cargo Thef | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-24 | Unknown | Cargo Theft Incidents Fall in Q1, but Organized Crime and Impersonatio | APAC Trucking & Tran | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-24 | Unknown | จุดจบโซนเซลฟ์เซอร์วิส ซื้อขนมร้าน Greggs ต้องให้ พนง.หยิบ สกัดภัยลักขโ | Thailand Cargo Theft | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-23 | Unknown | Where control is lost in modern cargo theft - FreightWaves | Australia Freight &  | isCargoInScope | Out of scope / non-cargo | — |
| DROPPED | 2026-04-23 | India | Insider-enabled theft — Other | — | isCargoInScope | Out of scope / non-cargo | — |

---

## 5. Recommended fix surfaces (Phase 2 input)

| Priority | Surface | Typical slop | Fix type |
| --- | --- | --- | --- |
| High | Flashpoint `selectFlashpointUsable` | Sports/market homonyms, court-only | Selector rule + replay |
| High | Cargo `cargoSlop.ts` + `cargoAnalysis.ts` | US trade press, generic theft | Relevance exclude + scope gate |
| High | Country `isForeignSubjectForIndonesia` | Foreign events on Indonesia brief | Render guard (no version bump) |
| Medium | Geocode / Unknown country | Masthead as location | Backfill + alias expansion |
| Medium | Social promote pass | Uncorroborated minted incidents | Demote-only guard |

---

## 6. Regenerating this report

```bash
PROD_DATABASE_URL="..." pnpm --filter workbench run audit:export-snapshot
ISSUE=2026-05-31 pnpm --filter workbench run audit:ingestion-report
```

*Generated by `artifacts/workbench/scripts/generateIngestionAuditReport.ts`*