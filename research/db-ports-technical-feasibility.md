# DB Ports Technical Feasibility Assessment

**Client label:** DB Ports  
**Assessment date:** 22 September 2026  
**Scope:** Fortnightly APAC and Oceania ports, terminals and logistics intelligence service  
**Decision:** **Conditional go for a controlled pilot; no-go for immediate full production**

## Executive conclusion

The existing Workbench provides a credible technical foundation, but it does not currently support a dependable, distribution-ready DB Ports service at the proposed scope. It can collect and store relevant reporting, apply relevance and validity gates, retain sources and dates, group some duplicate reporting, generate structured reports, support analyst editing, and export PDF. It also contains an editable Word-export implementation for Spot Reports that can be adapted.

The limiting issue is not whether the missing functions can be built. The limiting issue is whether one analyst can produce a reliable fortnightly regional service while verifying local reporting, port notices, cargo-security incidents, industrial action, operational effects and regulatory changes.

The limited 14-day test found seven plausible developments, but the underlying dataset was discovery-grade rather than publication-grade. Of 469 keyword-screened rows, 364 had no summary. Accepted items lacked material details such as affected terminals, routes, closure periods, confirmed operational effects and authoritative corroboration. The test therefore demonstrated discovery capability, not dependable regional coverage.

A controlled pilot is feasible if it:

- caps the published edition at five or six verified developments initially;
- uses a curated roster of official and specialist sources;
- treats all generated material as an analyst draft;
- requires manual verification, deduplication, severity assessment and final editing;
- uses explicit geography exclusions;
- retains source provenance and confidence separately from severity;
- uses PDF as the supported output while a DB Ports Word template is added and tested; and
- has backup review for High/Extreme, casualty, sanctions and politically sensitive China–Taiwan–Hong Kong items.

At current maturity, a defensible edition would require approximately **32–51 analyst hours per fortnight** in a normal cycle. A mature, constrained pilot may reduce this toward **16–28 hours**, but that must be measured across at least three or four editions. Full-scope solo production should not proceed unless measured workload stays below roughly 40 hours per fortnight and missed-signal and correction rates remain acceptable.

## What the existing system can already do

| Requirement | Existing capability | Assessment |
|---|---|---|
| Scheduled collection | Shared ingest runner, scheduling, locking, retries and source-health telemetry | Reusable |
| Security/public order | Flashpoint, conflict, strikes and APAC local-news pipelines | Reusable with DB Ports exclusions |
| Cargo and asset security | Cargo Watch, shipping, maritime-security and piracy-related processing | Strong base, but direct ReCAAP ingestion is absent |
| Operational disruption | Regional operational collection plus shipping, strikes, fuel and hazard feeds | Useful discovery; terminal-specific effect model missing |
| Geopolitical/trade exposure | Political, regulatory, conflict, sanctions and trade-control discovery terms | Useful discovery; dedicated trade-exposure assessment missing |
| Natural hazards | Earthquake, typhoon, flood, volcano, tsunami, heat and wildfire discovery | Reusable; operational linkage must be verified |
| Regulatory change | Regional regulatory discovery | Discovery only; no structured port-regulation workflow |
| Provenance | Incidents retain source, URL, dates, country, location, confidence and analyst fields | Reusable |
| Deduplication | Topic-specific title, source and event-family grouping exists | Useful but not reliable enough as the sole publication dedupe |
| Geography | Country and location fields, coordinates and curated geocoding exist | Country-level useful; port/terminal/corridor entity resolution missing |
| Draft generation | Regional and topic reports separate evidence from analytical prose | Reusable pattern |
| Analyst editing | Report editing and persisted report records exist | Reusable |
| PDF export | Established branded export paths exist | Supported |
| Editable Word export | The `docx` package and a working Spot Report DOCX exporter exist | Technically feasible, but DB Ports serializer/template is not implemented |

The system already stores the main item fields: title, summary, country, location, coordinates, occurrence date, incident date, severity, confidence, source, URL, category, business impact, relevance verdict, validity verdict and event-cluster key. This is sufficient for a pilot data model.

## What needs to be added

### 1. DB Ports source roster and coverage controls

Create a dedicated source roster by country, port and theme. Each source needs its access method, language, authority, expected cadence, reliability, manual-review requirement and last successful/relevant item. Existing broad APAC news discovery is not a substitute.

### 2. Port, terminal and corridor entity model

Add canonical entities and aliases for:

- ports and port complexes;
- container, bulk, LNG and ferry terminals;
- anchorages and approaches;
- associated road and rail corridors;
- customs points and logistics hubs; and
- client watchlist entities.

Free-text country/location fields cannot reliably resolve transshipment corridors, similarly named ports, Hong Kong/Taiwan geography or incidents occurring offshore.

### 3. Strict geography gate

Use an allow-list for Southeast Asia, Greater China, Japan, South Korea, Australia, New Zealand and relevant Pacific states. Add explicit deny/review handling for:

- Indian Subcontinent;
- Middle East conflict;
- Red Sea;
- Bab el-Mandeb; and
- Houthi reporting.

The gate must operate on the event jurisdiction and affected corridor, not publisher location or a country merely mentioned in the article.

### 4. Materiality gate

Admit an event only when confirmed reporting establishes, or credibly indicates, an implication for at least one of:

1. personnel;
2. port or terminal operations;
3. cargo or assets;
4. landside access;
5. maritime access;
6. supply-chain continuity;
7. regulatory compliance; or
8. business continuity.

A practical rule is:

> **Event evidence + affected function + current consequence or observable trigger**

Routine industry news, general political reporting, minor crime and hazards without an operational connection should fail. A developing issue may enter the watchlist when the consequence is not yet observed, but its trigger, affected function and uncertainty must be explicit.

### 5. Confidence and verification workflow

Keep confidence separate from severity. Recommended states:

- discovered;
- single-source;
- corroborated;
- official;
- analyst-accepted; and
- rejected/out-of-scope.

High-impact claims should require an official source or two credible independent sources. Each item must retain all corroborating links, not only one representative article.

### 6. DB Ports Word template

The codebase already generates editable `.docx` files for Spot Reports. A DB Ports exporter should add the requested item fields, source hyperlinks, confidence state, watchlist and regional overview. It needs layout and round-trip editing tests; PDF-to-Word conversion should not be the permanent workflow.

## Source coverage by country and theme

This matrix rates the likely pilot coverage after adding the identified official sources. “Strong” means an authoritative or machine-readable source exists, not that output can be automated without review.

| Country/region | Security/public order | Cargo/asset security | Operational disruption | Geopolitical/trade | Hazards | Regulatory change |
|---|---|---|---|---|---|---|
| Singapore | Strong | Partial | Partial | Partial | Partial | Strong |
| Malaysia | Partial | Weak | Partial | Partial | Partial | Partial |
| Indonesia | Partial | Weak | Partial | Partial | Partial | Weak |
| Philippines | Partial | Partial | Partial | Partial | Partial | Strong |
| Greater China, Hong Kong, Taiwan | Partial | Weak | Partial | Strong | Partial | Partial |
| Japan | Partial | Weak | Partial | Partial | Partial | Partial |
| South Korea | Partial | Weak | Partial | Strong | Partial | Weak |
| Australia | Partial | Partial | Partial | Partial | Strong | Partial |
| New Zealand | Partial | Weak | Partial | Partial | Partial | Partial |
| Pacific Island states | Partial | Weak | Weak | Partial | Partial | Weak |

### High-value official and automated sources

- [Singapore MPA](https://www.mpa.gov.sg/home): port and marine notices, circulars and releases.
- [Singapore Customs](https://www.customs.gov.sg/permits-and-licences/trade-controls-and-prohibitions): trade controls and prohibitions.
- [Philippine Ports Authority](https://www.ppa.com.ph/): terminal, tariff and operational notices, often HTML/PDF.
- [Port Klang Authority](https://www.pka.gov.my/): port notices and official updates.
- [Pelindo](https://www.pelindo.co.id/): Indonesian operator releases; Bahasa review required.
- [Hong Kong Marine Department](https://www.mardep.gov.hk/en/): notices, port services and statistics.
- [Taiwan Maritime and Port Bureau](https://www.motcmpb.gov.tw/): official notices and emergency announcements; Traditional Chinese review required.
- [Japan MLIT Maritime Bureau](https://www.mlit.go.jp/en/maritime/): maritime regulatory material.
- [Korea Port-MIS](https://new.portmis.go.kr/): port-information portal; public automation terms need confirmation.
- [AMSA](https://www.amsa.gov.au/vessels-operators/incident-reporting): Australian marine incident reporting.
- [Maritime New Zealand](https://www.maritimenz.govt.nz/): safety, rules and operational updates.
- [ReCAAP ISC](https://www.recaap.org/): Asian piracy and armed-robbery incident reporting. The current Workbench explicitly records that it has no direct ReCAAP connector.
- [Australian Bureau of Meteorology RSS](https://www.bom.gov.au/rss/): official warning discovery. BOM states RSS should not be the only warning source during events.
- [Japan Meteorological Agency](https://www.jma.go.jp/jma/indexe.html): official hazard information.
- [RNZ Pacific RSS](https://www.rnz.co.nz/rss/pacific.xml) and [ABC News RSS](https://www.abc.net.au/news/feed/45910/rss.xml): useful Pacific discovery and corroboration, not port-status authorities.

Most port authorities publish HTML pages and PDFs rather than stable documented APIs. Lawful automation should use verified RSS, documented downloads/APIs, polite page/PDF change detection and source-health monitoring. It must not bypass logins, CAPTCHAs, paywalls, robots restrictions or undocumented private endpoints.

## Limited 14-day test

**Period:** 9–22 September 2026 inclusive  
**Environment:** Existing development database  
**Data used:** `gdelt_structured_items` only  
**Method:** Read-only bounded queries; representative target countries; requested exclusions; keyword screen followed by human materiality review and conservative same-event grouping.

### Test counts

| Measure | Result |
|---|---:|
| In-window rows in represented target countries | 1,406 |
| Keyword/materiality-screened rows | 469 |
| Screened rows without a summary | 364 |
| Screened rows missing URL/date | 0 / 0 |
| Exact same-title duplicate rows | 4 |
| Plausible distinct developments after review | 7 |

The dataset supplied source names, URLs, dates, broad country/category labels and, occasionally, locations. It did not provide publication-ready corroboration, operational impact, confidence or defensible severity for these rows. The severity ratings below are provisional analyst assessments.

### Trial items

| Development | Source/date | Why it provisionally qualifies | Theme | Severity | Automated | Human judgement and missing information |
|---|---|---|---|---|---|---|
| Hong Kong customs seizes cannabis in sea-smuggling case | [GDELT Cloud item](https://gdeltcloud.com/stories/hong-kong-customs-seize-hk125-million-cannabis-in-record-sea-3319d009), 19 Sep | Direct sea-cargo and customs-security event | Cargo/asset security; compliance | High | Source, date, country, category | Terminal/vessel, operational effect, duration and authoritative corroboration missing |
| Philippine carriers reportedly ban EVs after ferry fire | [GDELT Cloud item](https://gdeltcloud.com/stories/philippine-shipping-lines-ban-evs-after-deadly-coron-ferry-f-2a57ab01), 19 Sep | Carrier policy may alter cargo routing | Operational disruption; cargo/assets | High | Source metadata | Carrier names, affected routes/ports, duration and primary-source notice missing |
| Chinese coast-guard vessel collides with Philippine fisheries boat | [GDELT Cloud item](https://gdeltcloud.com/stories/chinese-coast-guard-vessel-collides-with-philippine-fisherie-37fcfeaf), 19 Sep | Maritime safety and disputed-water access exposure | Geopolitical exposure; maritime access | High | Source metadata | Coordinates, damage, navigation restrictions and corroboration missing |
| KM Virgo Transport 8 sinking/search | [Source one](https://gdeltcloud.com/events/indonesia-deploys-divers-to-search-for-km-virgo-victims--cameoplus_b8b9a12fddd25ff7), [source two](https://gdeltcloud.com/stories/indonesia-begins-salvage-operation-after-ship-sinks-129-peop-7a687328), 18–19 Sep | Personnel, salvage and potential maritime-access implications | Personnel; maritime access; disruption | High | Two source rows and dates | Same-event grouping, conflicting missing-person counts, operator, route/port effects and authoritative confirmation require review |
| Flooding in Pasaman, West Sumatra | [GDELT Cloud item](https://gdeltcloud.com/stories/flooding-hits-pasaman-west-sumatra-leaving-one-person-missin-e07ced05), 19 Sep | Only qualifies if access or logistics effects are confirmed | Hazard watch | Moderate/watch | Source metadata | No road, bridge, terminal or closure effect demonstrated; should not enter the bulletin without follow-up |
| Philippine transport regulator system offline after breach | [GDELT Cloud item](https://gdeltcloud.com/stories/philippines-transport-regulator-takes-system-offline-after-d-a7298bbf), 19 Sep | Possible transport-administration and continuity impact | Regulatory/compliance; continuity | Moderate | Source metadata | System function, outage duration, users/ports affected and official notice missing |
| Magnitude 5.2 earthquake near Papua | [GDELT Cloud item](https://gdeltcloud.com/stories/magnitude-52-earthquake-strikes-papua-without-tsunami-warnin-f9a0605b), 19 Sep | Hazard signal only; operational relevance unconfirmed | Hazard watch | Moderate/watch | Source metadata | Port proximity, damage, access disruption and aftershock status missing |

### Test conclusion

Only the first four items clearly meet a provisional materiality threshold from the available text. The remaining three are watch candidates requiring evidence of an operational connection. The trial did not find accepted items for Singapore, Japan, Australia, New Zealand, Fiji or Solomon Islands. This does not establish that nothing happened; it demonstrates that the tested discovery dataset cannot prove full regional coverage.

## Automation opportunities

The following can be substantially automated:

- feed and page monitoring;
- source-health telemetry;
- retrieval and metadata retention;
- target-country and explicit-theatre exclusion;
- initial theme classification;
- first-pass materiality screening;
- canonical URL and normalized title/date/place deduplication;
- candidate port/location matching;
- structured extraction of dates, sources and confirmed claims;
- draft item assembly;
- watchlist matching; and
- PDF/DOCX generation.

Automation should produce a review queue, not a publication decision. GDELT and Google News can broaden discovery, but they are not authoritative evidence and their terms, quotas, attribution and redistribution conditions require review. The system should store concise extracted facts and provenance rather than republishing article text.

## Tasks that must remain human-led

- validating whether a port, terminal, corridor or client asset is actually affected;
- resolving local-language and politically sensitive reporting;
- distinguishing incident occurrence from publication date;
- reconciling conflicting casualty, cargo-loss or closure figures;
- assessing the present event severity from confirmed consequences;
- separating confirmed fact, unverified claim and analytical judgement;
- selecting which developments matter to the client;
- consolidating different reports of one incident;
- writing operational implications and outlook;
- verifying sanctions, trade controls and regulatory changes;
- approving every selected item; and
- performing final editorial and Word-layout QA.

## Estimated setup work

| Workstream | Estimated hours |
|---|---:|
| Scope, taxonomy, exclusions, watchlist and item template | 6–10 |
| Official/specialist source inventory and access review | 12–24 |
| Baseline coverage and false-positive/false-negative test | 10–18 |
| Editorial and verification operating procedure | 6–10 |
| Port/terminal/corridor aliases and materiality rules | 12–24 |
| DB Ports report configuration and validation | 8–16 |
| DB Ports editable Word template and QA | 8–16 |
| **Total realistic setup** | **62–118** |

This estimate is larger than a simple report-template change because dependable coverage and entity resolution are the core work.

## Estimated recurring human production time

| Activity | Optimistic mature pilot | Current/base case | Stress case |
|---|---:|---:|---:|
| Source review and gap checking | 5–7h | 9–13h | 16–24h |
| Verification, dates, location and effects | 3–5h | 6–10h | 12–18h |
| Deduplication and consolidation | 1.5–2.5h | 3–5h | 6–10h |
| Selection and severity | 1.5–2.5h | 3–5h | 5–8h |
| Writing and editing | 3–5h | 6–9h | 10–16h |
| QA and export | 2.5–4.5h | 5–9h | 9–15h |
| **Total per fortnight** | **16.5–26.5h** | **32–51h** | **58–91h** |

The lower 8–16-hour estimates sometimes associated with a mature automated service are not supported by the current trial. They exclude the verification burden created by summary gaps, fragmented official notices and weak terminal-level attribution.

## Primary risks and limitations

1. **Coverage risk:** Current feeds can miss local-language, terminal-level, industrial-action, cargo-theft and Pacific reporting.
2. **Authority risk:** Discovery aggregators can surface relevant stories but do not replace port, regulator, customs, weather, union or operator confirmation.
3. **Entity risk:** Country/location text is insufficient for reliable port, terminal and corridor identification.
4. **False-materiality risk:** Hazards, crime and political developments can appear relevant without a demonstrated operational implication.
5. **Deduplication risk:** Existing topic dedupe is useful but cannot be trusted as the final report-level event grouping.
6. **Legal/terms risk:** Article text retention, snippets, paywalled sources and aggregator redistribution need legal review. [Google News terms](https://www.google.com/intl/en_us/terms_google_news.html) are relevant to any dependency on its aggregation.
7. **Continuity risk:** Official HTML/PDF pages change location and structure. Every adapter needs monitoring and manual fallback.
8. **Workload risk:** Crisis weeks and broad geography can exceed one analyst’s capacity.
9. **Quality-control risk:** One-person production without backup review is unsafe for High/Extreme or politically sensitive assessments.
10. **Output risk:** Editable Word is technically feasible but DB Ports export parity is not yet implemented or tested.

## Recommended minimum viable workflow

1. Define a client watchlist of ports, terminals, logistics hubs, corridors and markets.
2. Maintain an allow-listed source roster by country/theme, separating official, specialist and discovery sources.
3. Collect continuously; review the complete queue twice weekly rather than only at publication time.
4. Apply geography exclusions and the eight-function materiality test.
5. Cluster candidate reports into events while retaining every corroborating source.
6. Route uncertain geography, local language, regulatory items and weak operational links to manual review.
7. Require official or two-source confirmation for high-impact claims.
8. Select no more than five or six developments during the pilot; use the watchlist for incomplete but material signals.
9. Record confirmed facts, confidence, current severity, operational implications and analytical outlook as separate fields.
10. Generate the draft bulletin and editable Word file.
11. Complete analyst verification, editorial review and export QA.
12. Measure hours, candidate volume, missed signals, corrections and source failures for three or four editions.

## Recommendation

**Conditional go.**

Proceed with a constrained, unpublished pilot only. Do not commit to dependable full-scope client production until:

- the dedicated source roster and coverage matrix are operating;
- a direct ReCAAP and official port-notice workflow exists;
- port/terminal/corridor entities and client watchlists are supported;
- exclusions and materiality gates are tested against real data;
- confidence and provenance are visible;
- DB Ports DOCX export is implemented and verified;
- three or four pilot editions remain below 40 analyst hours each; and
- correction and missed-signal rates are acceptable.

If those conditions are not met, narrow the geography or themes, or add analyst/editor capacity.

## Sources

1. [ReCAAP Information Sharing Centre](https://www.recaap.org/)
2. [IMO Maritime Security](https://www.imo.org/en/ourwork/security/pages/maritimesecurity.aspx)
3. [AMSA Incident Reporting](https://www.amsa.gov.au/vessels-operators/incident-reporting)
4. [Maritime and Port Authority of Singapore](https://www.mpa.gov.sg/home)
5. [Singapore Customs Trade Controls](https://www.customs.gov.sg/permits-and-licences/trade-controls-and-prohibitions)
6. [Philippine Ports Authority](https://www.ppa.com.ph/)
7. [Port Klang Authority](https://www.pka.gov.my/)
8. [Pelindo](https://www.pelindo.co.id/)
9. [Hong Kong Marine Department](https://www.mardep.gov.hk/en/)
10. [Taiwan Maritime and Port Bureau](https://www.motcmpb.gov.tw/)
11. [Japan MLIT Maritime Bureau](https://www.mlit.go.jp/en/maritime/)
12. [Korea Port-MIS](https://new.portmis.go.kr/)
13. [Maritime New Zealand](https://www.maritimenz.govt.nz/)
14. [Australian Bureau of Meteorology RSS](https://www.bom.gov.au/rss/)
15. [Japan Meteorological Agency](https://www.jma.go.jp/jma/indexe.html)
16. [New Zealand Customs Important Notices](https://www.customs.govt.nz/about-us/news/important-notices/)
17. [Australian DFAT News](https://www.dfat.gov.au/news)
18. [RNZ Pacific RSS](https://www.rnz.co.nz/rss/pacific.xml)
19. [ABC Australia News RSS](https://www.abc.net.au/news/feed/45910/rss.xml)
20. [GDELT Documentation](https://docs.gdeltproject.org/)
21. [GDELT Cloud Documentation](https://docs.gdeltcloud.com/)
22. [Google News Terms](https://www.google.com/intl/en_us/terms_google_news.html)

