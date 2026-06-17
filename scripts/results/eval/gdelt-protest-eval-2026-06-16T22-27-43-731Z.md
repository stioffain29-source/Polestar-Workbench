# GDELT vs Flashpoint — Protest Coverage Evaluation

- **Generated:** 2026-06-16T22:27:43.731Z
- **Window:** 2026-05-17 → 2026-06-16 (30 days)
- **Scope:** APAC / Pacific flashpoint theatres (mirrors `lib/ingest/src/flashpoint.ts` COUNTRY_ALIASES + Papua/PNG)
- **GDELT surface:** Conflict Events API, `disorder_type=Demonstrations` (Protests + Riots)
- **Endpoints:** `GET /api/v1/conflict-events/summary`, `GET /api/v1/conflict-events`
- **QU spent this run:** 8 (cap 24; free budget 100/month)
- **GDELT base:** `https://gdeltcloud.com`

## 1. Event counts per source

| Source | Events in window (APAC scope) |
| --- | ---: |
| GDELT (Demonstrations = Protests + Riots) | 239 |
| Flashpoint (current DB, relevance-gated — what the app shows) | 308 |
| Flashpoint (current DB, raw incl. keyword false-positives) | 838 |

> The relevance-gated row mirrors the app's default read filter (`relevance_status` NULL or != 'irrelevant'); the raw row is the unfiltered scrape. Compare GDELT against the relevance-gated count for a like-for-like read.

GDELT world-wide Demonstrations total for context: 915.

World-wide Demonstrations split by event type:
- Protests: 852
- Riots: 38
- Violence against civilians: 23
- Strategic developments: 2

## 2. Geographic coverage & gaps

| Country | GDELT | Flashpoint | Notes |
| --- | ---: | ---: | --- |
| Japan | 0 | 217 | Flashpoint-only |
| India | 164 | 32 |  |
| Philippines | 5 | 129 |  |
| Indonesia | 32 | 85 |  |
| Bangladesh | 4 | 112 |  |
| Malaysia | 0 | 70 | Flashpoint-only |
| Nepal | 1 | 51 |  |
| Sri Lanka | 4 | 29 |  |
| Australia | 8 | 23 |  |
| China | 0 | 31 | Flashpoint-only |
| West Papua | 0 | 26 | Flashpoint-only; GDELT folds into Indonesia |
| Pakistan | 18 | 4 |  |
| Papua New Guinea | 0 | 13 | Flashpoint-only |
| South Korea | 3 | 4 |  |
| United Arab Emirates | 0 | 4 | Flashpoint-only |
| Thailand | 0 | 3 | Flashpoint-only |
| Saudi Arabia | 0 | 3 | Flashpoint-only |
| Myanmar | 0 | 1 | Flashpoint-only |
| Qatar | 0 | 1 | Flashpoint-only |
| Vietnam | 0 | 0 |  |

- **Countries with GDELT coverage but no current flashpoint records:** none
- **Countries with flashpoint records but no GDELT coverage:** Japan (217), Malaysia (70), China (31), West Papua (26), Papua New Guinea (13), United Arab Emirates (4), Thailand (3), Saudi Arabia (3), Myanmar (1), Qatar (1)

## 3. Data-quality deltas GDELT provides

Field presence across 80 sampled GDELT records (structured ACLED-style
fields the current keyword-scraped flashpoint feed does not carry):

| Structured field | GDELT samples populated | In flashpoint feed today? |
| --- | ---: | --- |
| precise lat/long | 80/80 | Partial — country centroid or curated city only |
| sub-national admin (state / place) | 80/80 | No — country level only for most rows |
| fatalities (count) | 80/80 | No — only a text severity tier |
| actors (actor pair) | 80/80 | No |
| event / sub-event type | 80/80 | No — single topic only (Protests vs Riots not split) |
| AI coding confidence | 80/80 | No |
| AI narrative (notes) | 80/80 | No |
| corroboration (mention / source count) | 80/80 | No |
| civilian-targeting flag | 1/80 (flag; null when N/A) | No |

Flashpoint side, same window: 668/838 rows have coordinates
(mostly country centroids), 259/838 have a named location.

## 4. Overlap vs unique (best-effort, country + date)

Approximate match by (country, calendar date) between 80 dated GDELT
sample records and the flashpoint window:

- GDELT sample (country,date) keys: 42
- Of those, also present in flashpoint: 23
- GDELT sample keys with no same-day flashpoint match: 19

> Exact event matching is not attempted — this is a coarse signal of how
> much GDELT sample activity lines up with days the flashpoint feed already
> covers vs days/countries it may be missing. The summary counts in §1–2 are
> the authoritative coverage measure.

## 5. Sample GDELT records

- **Drinking water protest halts highway traffic in Bhubaneswar for 4 hours**
  - country=India · date=2026-06-16 · type=Protests/Protest with intervention · place=Bhubaneswar · geo=20.2961,85.8245 · fatalities=0 · confidence=0.86
  - actors: Protesters
  - https://gdeltcloud.com/story/drinking-water-protest-halts-highway-traffic-in-bhubaneswar-f6a9ef7d
- **Outsourced workers strike at Jhabua District Hospital, Madhya Pradesh**
  - country=India · date=2026-06-16 · type=Protests/Protest with intervention · place=Jhabua District Hospital · geo=22.767,74.59 · fatalities=0 · confidence=0.78
  - actors: Outsourced workers at Jhabua District Hospital / Jhabua District Hospital management
  - https://gdeltcloud.com/story/outsourced-workers-strike-at-jhabua-district-hospital-madhya-23c42737
- **Punjab teachers protest Mawan Dheeyan scheme work in Chandigarh**
  - country=India · date=2026-06-16 · type=Protests/Peaceful protest · place=Chandigarh · geo=30.7333,76.7794 · fatalities=0 · confidence=0.79
  - actors: Teachers / AAP government
  - https://gdeltcloud.com/story/punjab-teachers-protest-mawan-dheeyan-scheme-work-in-chandig-fb92a46f
- **ABVP stage protest in Hyderabad against high private school fees; several detained**
  - country=India · date=2026-06-16 · type=Protests/Protest with intervention · place=Hyderabad · geo=17.385,78.4867 · fatalities=0 · confidence=0.97
  - actors: Akhil Bharatiya Vidyarthi Parishad / Telangana Police
  - https://gdeltcloud.com/story/abvp-stage-protest-in-hyderabad-against-high-private-school-4e7d824d
- **Matang community marches in Parbhani demanding Scheduled Caste sub-classification**
  - country=India · date=2026-06-16 · type=Protests/Peaceful protest · place=Parbhani · geo=19.2684,76.7708 · fatalities=0 · confidence=0.95
  - actors: Sakal Matang community
  - https://gdeltcloud.com/story/matang-community-marches-in-parbhani-demanding-scheduled-cas-3e064620
- **Protests erupt in Maharashtra after Shinde name omitted; BJP minister shown black flags**
  - country=India · date=2026-06-15 · type=Protests/Peaceful protest · place=Navi Mumbai · geo=19.033,73.0297 · fatalities=0 · confidence=0.78
  - actors: Shiv Sena workers
  - https://gdeltcloud.com/story/protests-erupt-in-maharashtra-after-shinde-name-omitted-bjp-ba010445
- **Mother and daughter self-immolation attempt foiled outside UP Assembly in Lucknow**
  - country=India · date=2026-06-15 · type=Protests/Protest with intervention · place=Lucknow · geo=26.8467,80.9462 · fatalities=0 · confidence=0.9
  - actors: Protesters / Police
  - https://gdeltcloud.com/story/mother-and-daughter-self-immolation-attempt-foiled-outside-u-fbf3081d
- **Egg thrown at Kunal Ghosh outside Mamata Banerjee’s residence in Kolkata**
  - country=India · date=2026-06-15 · type=Violence against civilians/Attack · place=Kolkata · geo=22.5726,88.3639 · fatalities=0 · confidence=0.71
  - actors: Local youth / Kunal Ghosh
  - https://gdeltcloud.com/story/egg-thrown-at-kunal-ghosh-outside-mamata-banerjees-residence-ab3437a3

## 6. Current flashpoint sample (for comparison)

- **‘I’ll certainly visit India again’: Bangladesh PM adviser on his ‘instant protest’ over Delhi airport incident - Firstpost** — Bangladesh · 2026-06-16 · severity=low
- **PH stocks slip 0.43% as investors lock in profits after rally - Manila Standard** — Philippines · 2026-06-16 · severity=low
- **‘Returning To Dhaka Was An Instant Act Of Protest’: Bangladesh PM's Advisor After Delhi Airport Episode - News18** — Bangladesh · 2026-06-16 · severity=low
- **Peso leads Asian currency rally on Trump-Iran peace deal - Manila Bulletin** — Philippines · 2026-06-16 · severity=low
- **Bangladesh PMs Adviser Says Delhi Airport Hold-up Required Instant Protest - TheWire.in** — Bangladesh · 2026-06-16 · severity=low
- **Watch This | Large protest held in Tokyo against govt military expansion policies - 點新聞** — Japan · 2026-06-16 · severity=low
- **Bitcoin’s Iran rally faces Japan rate test as it weighs 31-year high - CryptoSlate** — Japan · 2026-06-16 · severity=low
- **Magnitude 6.3 earthquake strikes Qinghai, northwest China** — China · 2026-06-16 · severity=low

> The flashpoint feed is keyword-scraped, so its higher raw count includes
> off-topic false-positives (e.g. market/finance/disaster headlines that
> merely contain "protest"/"rally"). GDELT events are AI-coded demonstrations,
> so the §1 volume gap overstates flashpoint's true protest coverage.

## 7. Recommendation

**Marginal.** GDELT volume is broadly comparable to the current feed; the case rests on data quality, not raw coverage. Its main value is STRUCTURED ACLED-style data the keyword scraper cannot produce (precise sub-national lat/long, fatality counts, actor pairs, event/sub-event coding, AI narrative + confidence) — useful for severity scoring, mapping and forecasting. Caveat on the volume gap: the flashpoint feed is keyword-scraped and its higher count includes off-topic false-positives (e.g. equities/crypto/disaster headlines), while GDELT rows are AI-coded demonstrations — so the raw count understates GDELT's relative precision. Note GDELT folds Indonesian West Papua into Indonesia, so the flashpoint feed's West Papua split is a coverage detail GDELT alone would lose. Given the free tier (100 QU/month), a low-cadence supplementary pull is affordable to trial before paying for a higher tier.

---

### Appendix A: GDELT request log (QU = 8)

```
  QU#1 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events/summary?disorder_type=Demonstrations&group_by=country&days=30&date=2026-06-16
  QU#2 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events/summary?disorder_type=Demonstrations&group_by=event_type&days=30&date=2026-06-16
  QU#3 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events?disorder_type=Demonstrations&country=IND&days=30&date=2026-06-16&limit=25
  QU#4 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events?disorder_type=Demonstrations&country=IDN&days=30&date=2026-06-16&limit=25
  QU#5 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events?disorder_type=Demonstrations&country=PAK&days=30&date=2026-06-16&limit=25
  QU#6 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events?disorder_type=Demonstrations&country=AUS&days=30&date=2026-06-16&limit=25
  QU#7 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events?disorder_type=Demonstrations&country=PHL&days=30&date=2026-06-16&limit=25
  QU#8 HTTP 200 — https://gdeltcloud.com/api/v1/conflict-events?disorder_type=Demonstrations&country=BGD&days=30&date=2026-06-16&limit=25
```

### Appendix B: raw summary bucket (field-name reference)

```json
{
  "country": "IND",
  "event_count": 164,
  "fatalities": 0,
  "avg_fatalities_per_event": 0,
  "max_fatalities": 0,
  "fatality_events": 0,
  "civilian_targeting_events": 6,
  "avg_confidence": 0.903,
  "centroid_lat": 21.5956,
  "centroid_lon": 80.442,
  "geo_attribution": "location",
  "country_name": "India",
  "region": "South Asia",
  "continent": "Asia"
}
```

### Appendix C: raw event record (field-name reference)

```json
{
  "event_id": "conflict_83ce93d6",
  "source_event_id": "83ce93d6",
  "display_title": "Drinking water protest halts highway traffic in Bhubaneswar for 4 hours",
  "cluster_id": "f6a9ef7d434f",
  "cluster_label": "Drinking water protest halts highway traffic in Bhubaneswar for 4 hours",
  "story_url": "https://gdeltcloud.com/story/drinking-water-protest-halts-highway-traffic-in-bhubaneswar-f6a9ef7d",
  "time_bucket": null,
  "event_date": "2026-06-16",
  "time_precision": 1,
  "disorder_type": "Demonstrations",
  "event_type": "Protests",
  "sub_event_type": "Protest with intervention",
  "actor1": "Protesters",
  "assoc_actor_1": "Residents; local demonstrators",
  "inter1": 6,
  "actor2": null,
  "assoc_actor_2": null,
  "inter2": 0,
  "actor1_country": null,
  "actor2_country": null,
  "interaction": "Protesters only",
  "civilian_targeting": null,
  "iso": "IND",
  "region": "Asia",
  "country": "IND",
  "admin1": "Odisha",
  "admin2": "Khurda",
  "admin3": null,
  "location": "Bhubaneswar",
  "latitude": 20.2961,
  "longitude": 85.8245,
  "geo_precision": 1,
  "source_scale": "local",
  "notes": "On 2026-06-16, residents/protesters blocked highway traffic in Bhubaneswar for about four hours to demand drinking water. The article describes a local demonstration that disrupted traffic, but does not report any violence or arrests. This is coded as a protest event because the core action was a public demonstration over water supply.",
  "fatalities": 0,
  "tags": [],
  "confidence": 0.86,
  "summary": null,
  "source_urls": [
    "https://timesofindia.indiatimes.com/city/bhubaneswar/drinking-water-protest-halts-highway-traffic-for-4-hrs/articleshow/131778658.cms"
  ],
  "source_titles": [
    "Drinking water protest halts highway traffic for 4 hrs | Bhubaneswar News"
  ],
  "duplicate_flag": 0,
  "duplicate_count": 0,
  "mention_count": 1,
  "coded_at": "2026-06-16 21:07:26",
  "model_version": "gpt-5.4-mini"
}
```