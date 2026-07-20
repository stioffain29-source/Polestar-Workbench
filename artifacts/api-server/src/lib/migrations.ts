import { db, incidentsTable, reportsTable, countryReportsTable, countryBaselinesTable, sourcesTable, strikesTable, cardTemplatesTable, brandSettingsTable, socialRawTable } from "@workspace/db";
import type { CardContent, InsertBrandSettings } from "@workspace/db";
import { sql, eq, or, ne, isNull, inArray, and, like, not } from "drizzle-orm";
import { evaluateIncidentRelevance, hitsSlopExclude, RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import {
  runStrikesBackfill,
  runNewsCountryBackfill,
  runGlobalCountryReattribution,
  runPngExtractBackfill,
  runWestPapuaExtractBackfill,
  runFlashpointMastheadRelocate,
  runFlashpointUnknownReattribute,
  classifySeverity,
  isReactionLed,
  isPresentTenseFatalOrPluralStrike,
  isNaturalCauseDeath,
  isFatalKineticAttack,
  isJudicialDeath,
  isBiographicalOrIllnessDeath,
  hasIndonesianViolenceSignal,
  hasConfirmedKillingSignal,
  hasMassCasualtyToll,
  isMaritimeVesselAttack,
  severityFromFatalities,
  maxSeverity,
  SEVERITY_RANK,
  detectStaleEventDate,
  geocode,
  isReliefWebConfigured,
  isGdeltConfigured,
  PROMOTE_MARKER_PREFIX,
  TAPA_PROMOTE_MARKER_PREFIX,
  SOCIAL_PROMOTE_MARKER_PREFIX,
  decideSocialPromotion,
  markerSocialRawId,
  GDELT_NOT_CONFIGURED_MESSAGE,
  RELIEFWEB_NOT_CONFIGURED_MESSAGE,
  FACEBOOK_OSINT_HEALTH_NAME,
  CENTCOM_HEALTH_NAME,
  UKMTO_HEALTH_NAME,
  type Severity,
  type IncidentCandidate,
} from "@workspace/ingest";
import { logger } from "./logger";
import { COUNTRY_BASELINE_SEEDS } from "./countryBaselineSeed";
import { APAC_FLASHPOINT_BACKFILL } from "./seed/apacFlashpointBackfill";

// Catalogued Flashpoint regional sources that the audit identified as
// missing. Inserted idempotently on startup; existing rows are not
// touched. Keep the names stable — the scrape:flashpoint script joins on
// `name` to attribute records to a source row and to update
// last_success_at / last_failure_at.
const FLASHPOINT_REGIONAL_SOURCES: Array<{
  name: string;
  url: string;
  sourceType: string;
  reliability: number;
  notes: string;
}> = [
  // Direct publisher RSS, verified live from the Replit container.
  { name: "Malaysiakini",           url: "https://www.malaysiakini.com/rss/en/news.rss",            sourceType: "rss", reliability: 4, notes: "Owner: SE Asia desk. Malaysia — independent national, protest and labour coverage." },
  { name: "Free Malaysia Today",    url: "https://www.freemalaysiatoday.com/feed/",                 sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Malaysia — secondary national." },
  { name: "Khaosod English",        url: "https://www.khaosodenglish.com/feed/",                    sourceType: "rss", reliability: 4, notes: "Owner: SE Asia desk. Thailand — Bangkok protest and labour activity." },
  { name: "Prothom Alo English",    url: "https://en.prothomalo.com/feed/",                         sourceType: "rss", reliability: 4, notes: "Owner: South Asia desk. Bangladesh — largest national daily." },
  { name: "GMA News Online",        url: "https://data.gmanetwork.com/gno/rss/news/feed.xml",       sourceType: "rss", reliability: 4, notes: "Owner: PH desk. Philippines — major broadcaster, Metro Manila coverage." },
  { name: "Online Khabar English",  url: "https://english.onlinekhabar.com/feed",                   sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Nepal — Kathmandu independent online." },
  // Google News country-targeted RSS. Used where direct publisher feeds
  // are gated, paywalled or return 404 from the Replit container. The
  // query string narrows to civil-unrest cues so the scraper's allowlist
  // can focus on relevance scoring. Reliable, stable URL pattern.
  { name: "Google News — Malaysia (Civil Unrest)",      url: "https://news.google.com/rss/search?q=(%22Malaysia%22+OR+%22Kuala+Lumpur%22+OR+%22Putrajaya%22+OR+%22Johor%22+OR+%22Penang%22)+(protest+OR+rally+OR+demonstration+OR+march+OR+strike+OR+picket+OR+%22land+rights%22+OR+%22Orang+Asli%22)+when:14d&hl=en-MY&gl=MY&ceid=MY:en",   sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Country-wide civil unrest aggregator, anchored on Kuala Lumpur, Putrajaya, Johor and Penang plus land-rights / Orang Asli cues so Indigenous land protests (e.g. the Orang Asli Putrajaya rally) surface, not just the country name. The bare-country query returned mostly Bursa stock-'rally' homonyms. Last 14 days." },
  { name: "Google News — Sri Lanka (Civil Unrest)",     url: "https://news.google.com/rss/search?q=%22Sri+Lanka%22+protest+OR+strike+OR+rally+OR+demonstration&hl=en-LK&gl=LK&ceid=LK:en", sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Thailand (Civil Unrest)",      url: "https://news.google.com/rss/search?q=%22Thailand%22+protest+OR+rally+OR+demonstration&hl=en-TH&gl=TH&ceid=TH:en",            sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Bangladesh (Civil Unrest)",    url: "https://news.google.com/rss/search?q=%22Bangladesh%22+protest+OR+strike+OR+rally+OR+hartal&hl=en-BD&gl=BD&ceid=BD:en",       sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Indonesia (Civil Unrest)",     url: "https://news.google.com/rss/search?q=%22Indonesia%22+OR+%22Jakarta%22+protest+OR+rally+OR+demonstration&hl=en-ID&gl=ID&ceid=ID:en", sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Country and Jakarta civil unrest aggregator." },
  { name: "Google News — Philippines (Civil Unrest)",   url: "https://news.google.com/rss/search?q=%22Philippines%22+OR+%22Manila%22+protest+OR+rally+OR+strike&hl=en-PH&gl=PH&ceid=PH:en", sourceType: "rss", reliability: 3, notes: "Owner: PH desk. Country and Manila civil unrest aggregator." },
  { name: "Google News — Japan (Civil Unrest)",         url: "https://news.google.com/rss/search?q=%22Japan%22+OR+%22Tokyo%22+protest+OR+rally+OR+demonstration&hl=en-JP&gl=JP&ceid=JP:en", sourceType: "rss", reliability: 3, notes: "Owner: JP desk. Country and Tokyo civil unrest aggregator." },
  { name: "Google News — Nepal (Civil Unrest)",         url: "https://news.google.com/rss/search?q=%22Nepal%22+OR+%22Kathmandu%22+protest+OR+strike+OR+rally&hl=en-NP&gl=NP&ceid=NP:en",   sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Country and Kathmandu civil unrest aggregator." },
  { name: "Google News — Australia (Civil Unrest)",     url: "https://news.google.com/rss/search?q=(%22Australia%22+OR+%22Sydney%22+OR+%22Melbourne%22+OR+%22Brisbane%22+OR+%22Canberra%22+OR+%22Perth%22+OR+%22Adelaide%22)+(protest+OR+rally+OR+demonstration+OR+unrest+OR+picket+OR+blockade+OR+%22industrial+action%22+OR+walkout+OR+strike)+when:14d&hl=en-AU&gl=AU&ceid=AU:en", sourceType: "rss", reliability: 3, notes: "Owner: ANZ desk. Country-wide civil unrest & industrial action aggregator, anchored on capitals (Sydney, Melbourne, Brisbane, Canberra, Perth, Adelaide) so events that omit the country name are still captured. Last 14 days." },
  { name: "Google News — South Korea (Civil Unrest)",   url: "https://news.google.com/rss/search?q=(%22South+Korea%22+OR+%22Seoul%22+OR+%22Busan%22+OR+%22Incheon%22)+(protest+OR+rally+OR+demonstration+OR+unrest+OR+strike+OR+walkout+OR+union+OR+march)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss", reliability: 3, notes: "Owner: NE Asia desk. Country-wide civil unrest & labour aggregator, anchored on Seoul, Busan and Incheon. Uses the global-English Google News edition (en-US/US) because Korea has no English edition — the localised en-KR feed returns empty. Last 14 days." },
  { name: "Google News — New Zealand (Civil Unrest)",   url: "https://news.google.com/rss/search?q=(%22New+Zealand%22+OR+%22Auckland%22+OR+%22Wellington%22+OR+%22Christchurch%22)+(protest+OR+rally+OR+demonstration+OR+strike+OR+march+OR+hikoi+OR+picket+OR+walkout)+when:14d&hl=en-NZ&gl=NZ&ceid=NZ:en", sourceType: "rss", reliability: 3, notes: "Owner: ANZ desk. Country-wide civil unrest aggregator, anchored on Auckland, Wellington and Christchurch plus the te-reo term 'hikoi' (protest march) so events that omit the country name are still captured. Last 14 days." },
  // when:14d constrains Google News to the last 14 days. Without it Google
  // returns a relevance-sorted mix spanning years, so genuine PNG incidents
  // arrive but never fall inside the report's rolling 7-day window. 14d (not
  // 7d) gives the scheduler a buffer between runs.
  // Anchored on PNG urban-crime hubs (Lae, Morobe, Taraka, Port Moresby,
  // Mount Hagen, Madang) NOT the literal country name, so incidents that
  // omit "Papua New Guinea" in the headline (e.g. "West Taraka police raid")
  // are captured. Kept deliberately SMALL (6 places x 9 terms): Google News
  // silently drops the when:14d recency filter on large grouped queries and
  // returns a year-spanning relevance mix, so widening the OR lists here
  // re-breaks recency. Verified empirically — this set honours when:14d.
  { name: "Google News — Papua New Guinea (Crime & Security)", url: "https://news.google.com/rss/search?q=(Lae+OR+Morobe+OR+Taraka+OR+%22Port+Moresby%22+OR+%22Mount+Hagen%22+OR+Madang)+(police+OR+raid+OR+robbery+OR+shooting+OR+killed+OR+crime+OR+violence+OR+wanted+OR+mob)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. PNG violent-crime & communal-violence aggregator, anchored on urban-crime hubs (Lae, Morobe, Taraka, Port Moresby, Mount Hagen, Madang) so headline incidents that omit the country name are still captured. Last 14 days." },
  { name: "Google News — Papua New Guinea (Civil Unrest)",    url: "https://news.google.com/rss/search?q=%22Papua+New+Guinea%22+(protest+OR+riot+OR+strike+OR+rally+OR+unrest+OR+looting+OR+roadblock)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. PNG country-wide civil unrest aggregator. Last 14 days." },
  // Indonesian West Papua insurgency & violence. The Indonesia (Civil Unrest)
  // feed above queries ONLY protest/rally/demonstration, so it never surfaces
  // the TPNPB/OPM rebel-vs-military violence that dominates the West Papua
  // theatre (e.g. "8 civilians killed by West Papua rebels", "rebels behind
  // killing of 8 goldminers"). Without this feed the Papua country report has
  // NO live insurgency data and rewinds to its last stale record. Mirrors the
  // PNG pair: insurgency + violence cues, when:14d for recency. Kept compact
  // (2 country tokens x 8 cues) so Google News honours the when:14d filter
  // (verified empirically — large grouped OR queries silently drop it).
  { name: "Google News — West Papua (Insurgency & Violence)", url: "https://news.google.com/rss/search?q=(%22West+Papua%22+OR+Papua)+(TPNPB+OR+OPM+OR+rebels+OR+separatist+OR+shooting+OR+killed+OR+clash+OR+ambush)+when:14d&hl=en-ID&gl=ID&ceid=ID:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. Indonesian West Papua insurgency & violence aggregator (TPNPB/OPM rebel activity, security-force operations). Last 14 days." },
  // Indonesian Papua PEACEFUL civil-unrest & land-rights. The insurgency feed
  // above queries ONLY TPNPB/OPM violence, so it never surfaces the land,
  // displacement and strategic-project protest that dominates the non-kinetic
  // Papua picture (Biak spaceport opposition, Merauke food-estate, Sorong
  // palm-oil land disputes). Anchored on the Papua place names (also West-Papua
  // markers, so resolvePapuaPng attributes them) + protest/land-rights cues.
  { name: "Google News — Papua (Civil Unrest & Land Rights)", url: "https://news.google.com/rss/search?q=(%22Papua%22+OR+%22Biak%22+OR+%22Merauke%22+OR+%22Sorong%22+OR+%22Jayapura%22)+(protest+OR+rally+OR+demonstration+OR+%22land+rights%22+OR+spaceport+OR+eviction+OR+%22customary+land%22)+when:14d&hl=en-ID&gl=ID&ceid=ID:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. Indonesian Papua civil-unrest & land-rights aggregator (Biak spaceport opposition, Merauke food-estate, Sorong palm-oil land disputes). Complements the insurgency feed, which only queries TPNPB/OPM violence and never surfaces peaceful land/displacement protest. Last 14 days." },
  // Pacific desk — Papua New Guinea and Indonesian West Papua wires. These
  // are the ONLY collection sources that feed the PNG and Papua country
  // reports; without them those reports have no live data on this
  // environment. Catalogued in the audit but previously only present in the
  // development database, so prod produced empty PNG/Papua reports until
  // seeded here.
  { name: "ABC News Australia",      url: "https://www.abc.net.au/news/feed/45910/rss.xml",                                 sourceType: "rss",  reliability: 4, notes: "Owner: ANZ desk. National broadcaster — protest, industrial action and policing across capitals." },
  // Benar News RETIRED (Task: empty-feed masking): its direct RSS and every
  // Google-News site-scope query return zero items from our egress IP — it
  // fetched "successfully" but never yielded an in-scope APAC unrest item, so it
  // read permanently green. Removed from the seed and deleted below. Its SE Asia
  // coverage is already carried by the per-country civil-unrest aggregators.
  { name: "Jubi.id (West Papua)",    url: "https://jubi.id/feed/",                                                          sourceType: "rss",  reliability: 3, notes: "Owner: Pacific desk. Jayapura / Indonesian Papua — community protest and security operations. Manual translation review required." },
  // Suara Papua — Indonesian-language West Papua outlet (direct WordPress feed,
  // like Jubi). Strong on highland security operations, displacement and
  // land-rights coverage the PNG-anchored feeds miss. Bahasa headlines route
  // through the Indonesian-marker translation gate. Broadens the Papua country
  // brief's source base beyond Jubi.
  { name: "Suara Papua",             url: "https://suarapapua.com/feed/",                                                   sourceType: "rss",  reliability: 3, notes: "Owner: Pacific desk. Indonesian West Papua — highland security operations, displacement, land-rights. Bahasa; manual translation review required." },
  // ANTARA Papua bureau — the state newswire's regional desk. Collected via
  // Google-News site-scope (the direct regional feed is unreliable from our
  // egress IP) anchored on Papua place names + security/operational cues, last
  // 14 days. Authoritative confirmation source for named operations and official
  // statements across the six Papua provinces.
  { name: "ANTARA Papua",            url: "https://news.google.com/rss/search?q=site:papua.antaranews.com+(polisi+OR+TNI+OR+keamanan+OR+KKB+OR+OPM+OR+penembakan+OR+tewas+OR+demo+OR+konflik+OR+bandara)+when:14d&hl=id-ID&gl=ID&ceid=ID:id", sourceType: "rss", reliability: 4, notes: "Owner: Pacific desk. ANTARA Papua bureau (state newswire) — named security operations and official statements across the six Papua provinces. Google-News site-scope (direct regional feed unreliable from our egress IP). Bahasa; manual translation review required. Last 14 days." },
  { name: "Post-Courier (PNG)",      url: "https://www.postcourier.com.pg/feed/",                                           sourceType: "rss",  reliability: 3, notes: "Owner: Pacific desk. Port Moresby — political demonstrations, sectoral strike action." },
  // Named PNG mastheads for the Papua New Guinea country brief. The direct
  // publisher RSS feeds (thenational.com.pg, emtv.com.pg, looppng.com,
  // onepng.com, pnghausbung.com) 403/redirect/refuse from the Replit egress IP,
  // so each is collected via a Google-News site-scoped feed instead, narrowed
  // to security/crime/operational cues and when:14d for recency (cue lists kept
  // small so Google News honours the recency filter). These broaden PNG source
  // coverage beyond Post-Courier; the classify PNG gate still scopes relevance.
  { name: "The National (PNG)",      url: "https://news.google.com/rss/search?q=site:thenational.com.pg+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security+OR+airport+OR+road)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. The National — PNG's largest-circulation daily (Port Moresby). Collected via Google-News site-scope (direct feed 403s our egress IP). Security/crime/operational cues, last 14 days." },
  // Loop PNG RETIRED (Task: empty-feed masking): no reachable direct feed AND
  // its site-scope query (site:looppng.com and every domain variant) returns
  // zero items — it fetched fine but never yielded an in-scope item, so it read
  // permanently green. Removed from the seed and deleted below. PNG crime/
  // security coverage is carried by The National, Post-Courier, NBC and the
  // Port-Moresby/NCD aggregators.
  { name: "EMTV (PNG)",              url: "https://news.google.com/rss/search?q=site:emtv.com.pg+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security+OR+airport+OR+road)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. EMTV — national broadcaster (Port Moresby). Collected via Google-News site-scope (direct feed redirects/blocks our egress IP). Security/crime/operational cues, last 14 days." },
  { name: "PNG Haus Bung",          url: "https://news.google.com/rss/search?q=site:pnghausbung.com+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 2, notes: "Owner: Pacific desk. PNG Haus Bung — popular PNG news blog (tabloid register; corroborate before use). Collected via Google-News site-scope. Security/crime cues, last 14 days." },
  { name: "One PNG",                url: "https://news.google.com/rss/search?q=site:onepng.com+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 2, notes: "Owner: Pacific desk. One PNG — community news aggregator. Collected via Google-News site-scope. Security/crime cues, last 14 days." },
  // NBC PNG (National Broadcasting Corporation) — PNG's state broadcaster. The
  // direct feed (nbc.com.pg) blocks our egress IP, so collected via Google-News
  // site-scope like the other mastheads. Broadens NCD crime/security coverage.
  { name: "NBC PNG",                url: "https://news.google.com/rss/search?q=site:nbc.com.pg+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security+OR+airport+OR+road)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. NBC PNG — National Broadcasting Corporation (state broadcaster, Port Moresby). Collected via Google-News site-scope (direct feed blocks our egress IP). Security/crime/operational cues, last 14 days." },
  // TVWAN News RETIRED (Task: empty-feed masking): Digicel broadcaster with no
  // standalone news site; its name-anchored query returns only sports/telecom
  // noise and zero in-scope security items, so it read permanently green.
  // Removed from the seed and deleted below.
  // Port Moresby / National Capital District crime FALLBACK. The country-wide
  // crime feed above under-captures NCD because most Port Moresby crime stories
  // name a suburb, not the city/country. This feed anchors on POM + the major
  // NCD suburbs (Gerehu, Gordons, Waigani, Boroko, Nine Mile, Bomana) plus a
  // wide crime-term set (raskol, armed robbery, carjacking, vehicle theft,
  // hold-up, firearm) so suburb-named NCD incidents surface and bucket to NCD.
  { name: "Google News — Papua New Guinea (Port Moresby / NCD Crime)", url: "https://news.google.com/rss/search?q=(%22Port+Moresby%22+OR+Gerehu+OR+Gordons+OR+Waigani+OR+Boroko+OR+%22Nine+Mile%22+OR+Bomana)+(raskol+OR+%22armed+robbery%22+OR+carjacking+OR+%22vehicle+theft%22+OR+robbery+OR+shooting+OR+hold-up+OR+firearm)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. Port Moresby / NCD crime aggregator, anchored on POM + major NCD suburbs (Gerehu, Gordons, Waigani, Boroko, Nine Mile, Bomana) + wide crime cues so suburb-named NCD incidents that omit the city/country name are captured and bucket to NCD. Last 14 days." },
  // RPNGC (Royal Papua New Guinea Constabulary) — official police statements.
  // CONFIRMATION source, not a discovery feed: used to corroborate incidents
  // surfaced by the mastheads above (named operations, arrests, casualty
  // confirmations), not as a sole basis for inclusion. High reliability when it
  // speaks; sparse cadence. Collected via Google-News scoped to RPNGC/police
  // commissioner statements.
  { name: "RPNGC (PNG Police, confirmation)", url: "https://news.google.com/rss/search?q=(%22Royal+Papua+New+Guinea+Constabulary%22+OR+RPNGC+OR+%22Police+Commissioner%22+OR+%22Acting+Commissioner%22)+(Papua+OR+PNG+OR+Moresby+OR+Lae+OR+Hagen)+when:21d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 4, notes: "Owner: Pacific desk. Royal PNG Constabulary official statements — CONFIRMATION-ONLY (corroborates masthead incidents; not a sole discovery basis). Sparse cadence, last 21 days." },
  { name: "RNZ Pacific",             url: "https://www.rnz.co.nz/rss/pacific.xml",                                          sourceType: "rss",  reliability: 4, notes: "Owner: Pacific desk. Regional coverage for PNG, Solomons, Fiji and Indonesian Papua." },
  // Direct publisher RSS — regional national dailies and broadcasters.
  { name: "Daily Mirror Sri Lanka",  url: "https://news.google.com/rss/search?q=site:dailymirror.lk+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-LK&gl=LK&ceid=LK:en", sourceType: "rss",  reliability: 4, notes: "Owner: South Asia desk. Sri Lanka — Colombo national daily. Google-News site-scope: the direct RSS serves HTML to our egress IP. Last 14 days." },
  { name: "Nepal Republica",         url: "https://news.google.com/rss/search?q=site:myrepublica.nagariknetwork.com+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-NP&gl=NP&ceid=NP:en", sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Secondary Nepal national — corroborates Kathmandu Post. Google-News site-scope: the direct feed 404s. Last 14 days." },
  { name: "New Age Bangladesh",      url: "https://news.google.com/rss/search?q=site:newagebd.net+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-BD&gl=BD&ceid=BD:en", sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Bangladesh — labour and student coverage. Google-News site-scope: the direct feed 403s (Cloudflare) our egress IP. Last 14 days." },
  { name: "Sunday Times Sri Lanka",  url: "https://news.google.com/rss/search?q=site:sundaytimes.lk+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-LK&gl=LK&ceid=LK:en", sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Sri Lanka — Colombo weekly, political coverage. Google-News site-scope: the direct feed 404s. Last 14 days." },
  { name: "The Kathmandu Post",      url: "https://news.google.com/rss/search?q=site:kathmandupost.com+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-NP&gl=NP&ceid=NP:en", sourceType: "rss",  reliability: 4, notes: "Owner: South Asia desk. Kathmandu — political mobilisation, student unions, transport strikes. Google-News site-scope: the direct kathmandupost.com/rss feed serves malformed XML entities from our egress IP. Last 14 days." },
  { name: "Philippine Daily Inquirer", url: "https://www.inquirer.net/fullfeed",                                            sourceType: "rss",  reliability: 4, notes: "Owner: PH desk. National daily — city-disruption and protest calendaring across Metro Manila." },
  { name: "Rappler",                 url: "https://www.rappler.com/feed/",                                                  sourceType: "rss",  reliability: 4, notes: "Owner: PH desk. Manila protest activity, union calls, student mobilisation." },
  { name: "Tempo English",           url: "https://rss.tempo.co/en",                                                        sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Indonesia — investigative weekly, civic-space coverage. Direct RSS (the old en.tempo.co/rss path 404s)." },
  { name: "The Jakarta Post",        url: "https://news.google.com/rss/search?q=site:thejakartapost.com+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-ID&gl=ID&ceid=ID:en", sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Indonesia — Jakarta-Java national daily. Google-News site-scope: the direct feed 404s. Last 14 days." },
  { name: "Kyodo News (English)",    url: "https://news.google.com/rss/search?q=site:english.kyodonews.net+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. Tokyo wire — labour disputes, civic protest and policing. Google-News site-scope: the direct feed 404s. Last 14 days." },
  { name: "NHK World Japan",         url: "https://news.google.com/rss/search?q=site:www3.nhk.or.jp/nhkworld+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-JP&gl=JP&ceid=JP:en", sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. Japan — national broadcaster English wire. Google-News site-scope: the direct feed path 404s. Last 14 days." },
  { name: "The Japan Times",         url: "https://www.japantimes.co.jp/feed/",                                             sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. National daily — Tokyo and Osaka mobilisation, union action." },
  // Thematic / cross-regional desks (civic-space, labour, education) and
  // wires. Several are non-RSS catalogue entries that fail to parse from the
  // container — retained so Source Health mirrors the verified development
  // catalogue and coverage warnings count the full source set.
  { name: "AFP Asia-Pacific",        url: "https://news.google.com/rss/search?q=site:afp.com+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 5, notes: "Owner: Asia desk. Secondary wire — corroborates Reuters. Google-News site-scope: the afp.com hub is not an RSS feed. Last 14 days." },
  { name: "Reuters Asia Pacific Wire", url: "https://news.google.com/rss/search?q=site:reuters.com/world/asia-pacific+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 5, notes: "Owner: Asia desk. Primary wire for breaking protest, strike and security-force activity. Google-News site-scope: reuters.com 401s our egress IP. Last 14 days." },
  { name: "Human Rights Watch Asia", url: "https://news.google.com/rss/search?q=site:hrw.org+Asia+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+crackdown)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 4, notes: "Owner: Civic-space desk. Crackdown reporting, mass arrests, security-force conduct. Google-News site-scope: the /asia page is not an RSS feed. Last 14 days." },
  { name: "ITUC Global Rights Index", url: "https://news.google.com/rss/search?q=site:ituc-csi.org+(strike+OR+union+OR+%22labour+rights%22+OR+walkout+OR+protest+OR+workers)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 4, notes: "Owner: Labour desk. International Trade Union Confederation — strike calls and labour-rights restrictions. Google-News site-scope: the direct feed 403s (Cloudflare) our egress IP. Last 14 days." },
  { name: "IndustriALL Global Union", url: "https://news.google.com/rss/search?q=site:industriall-union.org+(strike+OR+union+OR+%22labour+rights%22+OR+walkout+OR+protest+OR+workers)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 4, notes: "Owner: Labour desk. Sectoral union action (manufacturing, mining, energy). Google-News site-scope: the direct rss.xml now serves HTML. Last 14 days." },
  { name: "Education International APAC", url: "https://news.google.com/rss/search?q=site:ei-ie.org+(teacher+OR+strike+OR+protest+OR+union+OR+walkout)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 3, notes: "Owner: Education desk. Teacher and faculty mobilisation across APAC. Google-News site-scope: the /region page is not an RSS feed. Last 14 days." },
  { name: "University World News Asia", url: "https://news.google.com/rss/search?q=site:universityworldnews.com+(student+OR+campus+OR+protest+OR+faculty+OR+strike+OR+walkout)+when:14d&hl=en-US&gl=US&ceid=US:en", sourceType: "rss",  reliability: 3, notes: "Owner: Education desk. Campus protests, student union activity, faculty walkouts. Google-News site-scope: the region.php RSS 404s. Last 14 days." },
];

// Self-heal seed URLs on every startup. The seed loop below only inserts
// rows whose `name` is new; it never updates an existing row's URL. This
// block applies any URL corrections to already-inserted seed rows so the
// scraper picks up the fix without manual DB surgery. When the URL changes,
// stale failure telemetry is cleared so the feed gets a fair retry. Idempotent.
async function repairFlashpointSeedUrls(): Promise<void> {
  for (const seed of FLASHPOINT_REGIONAL_SOURCES) {
    await db
      .update(sourcesTable)
      .set({
        url: seed.url,
        sourceType: seed.sourceType,
        notes: seed.notes,
        status: "operational",
        errorMessage: null,
        consecutiveFailures: 0,
        lastFailureAt: null,
        failureReason: null,
      })
      .where(
        sql`${sourcesTable.name} = ${seed.name} AND ${sourcesTable.topic} = 'flashpoint' AND (${sourcesTable.url} IS DISTINCT FROM ${seed.url})`,
      );
  }
}

// Idempotent repairs for dashboard source-health noise. Runs every boot so a
// deployment picks up fixes without waiting for the next ingest cycle.
async function repairSourceHealthDashboardNoise(): Promise<void> {
  // Facebook OSINT without an API key is intentionally off — never alarm red.
  if (!(process.env.FACEBOOK_API_KEY?.trim())) {
    await db
      .update(sourcesTable)
      .set({
        status: "not_configured",
        errorMessage: "Integration not configured",
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        failureReason: null,
      })
      .where(eq(sourcesTable.name, FACEBOOK_OSINT_HEALTH_NAME));
  }
  // Legacy rows that read "Integration not configured" but were escalated to failing.
  await db
    .update(sourcesTable)
    .set({
      status: "not_configured",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      failureReason: null,
    })
    .where(
      and(
        eq(sourcesTable.name, FACEBOOK_OSINT_HEALTH_NAME),
        sql`${sourcesTable.status} <> 'not_configured'`,
        sql`${sourcesTable.errorMessage} ilike '%integration not configured%'`,
      ),
    );

  // Kathmandu Post direct RSS serves malformed XML — clear stale parse failures
  // once the Google-News site-scope URL is in place (repairFlashpointSeedUrls).
  await db
    .update(sourcesTable)
    .set({
      status: "operational",
      errorMessage: null,
      consecutiveFailures: 0,
      lastFailureAt: null,
      failureReason: null,
    })
    .where(
      and(
        eq(sourcesTable.topic, "flashpoint"),
        eq(sourcesTable.name, "The Kathmandu Post"),
        sql`${sourcesTable.status} in ('failing', 'blocked')`,
        sql`(
          ${sourcesTable.errorMessage} ilike '%invalid character%'
          or ${sourcesTable.errorMessage} ilike '%malformed%'
          or ${sourcesTable.failureReason} = 'parse_error'
        )`,
      ),
    );

  // CENTCOM/UKMTO 403 from datacenter egress — pending, not a hard outage.
  await db
    .update(sourcesTable)
    .set({
      status: "pending",
      consecutiveFailures: 0,
      failureReason: "blocked_upstream",
    })
    .where(
      and(
        eq(sourcesTable.topic, "official_military_maritime"),
        inArray(sourcesTable.name, [CENTCOM_HEALTH_NAME, UKMTO_HEALTH_NAME]),
        sql`${sourcesTable.status} in ('failing', 'blocked')`,
        sql`(
          ${sourcesTable.errorMessage} ilike '%403%'
          or ${sourcesTable.failureReason} = 'blocked_upstream'
        )`,
      ),
    );
}

// Topics that must each have at least one report card in the Report Builder.
// Kept in sync with TOPIC_LABELS on the client.
const REQUIRED_TOPIC_REPORTS: Array<{
  topic: string;
  title: string;
}> = [
  { topic: "energy",      title: "APAC Energy Watch" },
  { topic: "fuel",        title: "APAC Fuel Watch" },
  { topic: "fertiliser",  title: "South Asia Fertiliser Watch" },
  { topic: "cargo_watch", title: "APAC Cargo Watch" },
  { topic: "shipping",    title: "Hormuz Maritime Watch" },
  { topic: "protests",    title: "APAC Flashpoint" },
  { topic: "conflict",    title: "Conflict Watch" },
];

// Reports that were previously auto-seeded but have since been retired.
// Removed on startup so they disappear from every environment without
// requiring manual deletion in the UI.
const RETIRED_REPORT_TITLES: string[] = [
  "Indo-Pacific Flashpoint Tracker",
  "APAC Fuel Theft & Diversion Outlook",
  "South Asia Fertiliser Supply Risk Brief",
  "APAC Cargo Theft & Hijack Monthly",
  "Weekly Energy Brief - GCC Grid Pressure",
  "Hormuz Maritime Threat Update",
  "PNG Election Cycle Risk Brief",
];

/**
 * Idempotent data migrations applied at startup.
 *
 * Each block detects an "old-data" marker and only runs if the migration has
 * not been applied yet, so it is safe to run repeatedly across deploys.
 */
export async function runDataMigrations(): Promise<void> {
  logger.info("runDataMigrations: starting");
  try {
    // Repair known dashboard noise before heavier migrations so the first
    // /dashboard/overview after boot is already clean.
    try {
      await repairFlashpointSeedUrls();
      await repairSourceHealthDashboardNoise();
    } catch (noiseErr) {
      logger.error({ err: noiseErr }, "Source health dashboard noise repair failed");
    }

    // Schema: analyst-overridable stored risk rating on reports. drizzle-kit
    // push only reaches the dev database; production schema changes must be
    // applied here so the deployment runtime (the only place with a writable
    // prod primary) gains the column on boot. Idempotent — IF NOT EXISTS.
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS risk_rating text`,
    );

    // Schema: English translation of a non-English KAMMI social-watch caption.
    // Filled by the caption-translate pass; NULL until translated (UI falls back
    // to the original caption). drizzle push only reaches dev, so the writable
    // prod primary gains the column here on boot. Idempotent — IF NOT EXISTS.
    await db.execute(
      sql`ALTER TABLE social_watch_items ADD COLUMN IF NOT EXISTS caption_en text`,
    );

    // Schema: English translation of a non-English Facebook OSINT caption
    // (Bahasa / Tok Pisin). Filled by the reclassify pass; NULL until translated
    // (UI falls back to the original caption). drizzle push only reaches dev, so
    // the writable prod primary gains the column here on boot. Idempotent.
    await db.execute(
      sql`ALTER TABLE social_raw ADD COLUMN IF NOT EXISTS caption_en text`,
    );

    // Schema: persisted executive summary on topic reports. Previously
    // browser-local only (localStorage); analysts lost summaries across
    // browsers/sessions. Idempotent — IF NOT EXISTS.
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS executive_summary text`,
    );

    // Schema: flashpoint/protests editable data-driven "reads" (Activism &
    // Protest, Civil Unrest & Public Order, Forecast, Regional & Country View).
    // Blank/NULL falls back to the dataset-generated read. drizzle push only
    // reaches dev, so the writable prod primary gains the columns here on boot.
    // Idempotent — IF NOT EXISTS.
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS activism_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS civil_unrest_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS forecast_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS regional_country_read text`,
    );

    // Schema: topic-specific editable data-driven "reads" for shipping, cargo,
    // fuel and conflict (same blank/NULL → generated-read fallback semantics as
    // the flashpoint reads above). regional_country_read (added above) is reused
    // for shipping + cargo regional sections. drizzle push only reaches dev, so
    // the writable prod primary gains these on boot. Idempotent — IF NOT EXISTS.
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS chokepoint_route_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS vessel_piracy_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS commercial_impact_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS maritime_security_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS cargo_security_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS logistics_hub_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS fuel_market_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS fuel_operational_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS fuel_regional_highlights text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS conflict_other_watched_read text`,
    );
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS conflict_area_reads jsonb`,
    );

    // Schema: analyst-attached photographs on spot reports (resized data URLs +
    // optional captions), rendered after Incident Details on screen and in the
    // DOM-rasterised PDF. drizzle push only reaches dev, so the writable prod
    // primary gains the column here on boot. Idempotent — IF NOT EXISTS; the
    // NOT NULL DEFAULT '[]' backfills any pre-existing rows.
    await db.execute(
      sql`ALTER TABLE spot_reports ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );

    // Schema: durable analyst layout controls on country reports — map/photo
    // placement slots and analyst-attached photographs (resized data URLs +
    // optional caption/source/credit/context). These persist per-report and are
    // deliberately OUTSIDE the AI prose fingerprint cache, so changing layout
    // never invalidates or regenerates the narrative. drizzle push only reaches
    // dev; the writable prod primary gains the columns here on boot. Idempotent.
    await db.execute(
      sql`ALTER TABLE country_reports ADD COLUMN IF NOT EXISTS map_placement text`,
    );
    await db.execute(
      sql`ALTER TABLE country_reports ADD COLUMN IF NOT EXISTS photo_placement text`,
    );
    await db.execute(
      sql`ALTER TABLE country_reports ADD COLUMN IF NOT EXISTS report_photos jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    // Schema: durable analyst curation of the rendered brief — hidden canonical
    // sections, excluded relevance-passing window incidents, and demote-only
    // Fast Facts severity corrections. Nullable/additive; OUTSIDE the prose
    // fingerprint cache. drizzle push only reaches dev; prod gains it here on
    // boot. Idempotent.
    await db.execute(
      sql`ALTER TABLE country_reports ADD COLUMN IF NOT EXISTS section_overrides jsonb`,
    );
    // Schema: durable analyst curation of TOPIC reports (flashpoint, shipping,
    // cargo, conflict, fuel, etc.) — same shape/semantics as the country brief's
    // section_overrides (hidden canonical sections, excluded relevance-passing
    // window incidents, demote-only severity corrections). Nullable/additive.
    // drizzle push only reaches dev; the writable prod primary gains it here on
    // boot. Idempotent.
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS section_overrides jsonb`,
    );

    // Schema: `edited_fingerprint` on the prose caches. An analyst prose edit is
    // now KEPT across a data-basis regenerate (instead of being dropped); this
    // column records the fingerprint the edit was written against so the client
    // can flag a retained-but-stale edit rather than silently overwriting it.
    // drizzle push only reaches dev; the writable prod primary gains it on boot.
    // Nullable/additive — idempotent (IF NOT EXISTS).
    await db.execute(
      sql`ALTER TABLE country_report_prose ADD COLUMN IF NOT EXISTS edited_fingerprint text`,
    );
    await db.execute(
      sql`ALTER TABLE report_prose ADD COLUMN IF NOT EXISTS edited_fingerprint text`,
    );

    // 0a) Schema: per-feed consecutive-failure counter on `sources`.
    //     drizzle `push` adds this in dev, but the writable prod DB is reached
    //     only from the deployment runtime, so add it idempotently on boot too.
    //     Source Health uses it to require several consecutive failed ingest
    //     runs before a feed escalates to "failing", so a transient Google-News
    //     timeout no longer false-alarms the Action Required panel.
    await db.execute(sql`
      ALTER TABLE sources
      ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0
    `);

    // 0b) Schema: source registry + scrape-health telemetry on `sources`.
    //     Same read-only-prod rationale as above — drizzle push only reaches dev,
    //     so the writable prod primary gains these on boot. All nullable/additive:
    //       - registry: scrape_method / scrape_frequency / language /
    //         location_covered (analyst-classifiable descriptive metadata).
    //       - telemetry: last_relevant_item_at + items_collected / items_retained /
    //         items_rejected (LAST-RUN funnel snapshots, machine-written) +
    //         failure_reason (coarse failure category, distinct from error_message).
    //     A row with none set reads "—" on the Source Health registry; the
    //     pipeline never fabricates coverage or counts it cannot verify. All
    //     idempotent (IF NOT EXISTS).
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS scrape_method text`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS scrape_frequency text`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS language text`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS location_covered text`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_relevant_item_at timestamptz`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS items_collected integer`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS items_retained integer`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS items_rejected integer`,
    );
    await db.execute(
      sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS failure_reason text`,
    );

    // Schema: ReliefWeb (UN OCHA) incident corroboration. Same rationale as
    // above — drizzle push only reaches dev, so the prod primary gains the
    // column + child table here on boot. All idempotent (IF NOT EXISTS).
    //   - incidents.corroboration_checked_at: drives the bounded back-match
    //     (which rows the corroboration pass still owes a look).
    //   - incident_corroborations: child table of attached OFFICIAL references
    //     (a separate signal — never overwrites confidence).
    await db.execute(
      sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS corroboration_checked_at timestamptz`,
    );

    // Schema: PNG country-report enrichment columns (additive, nullable). The
    // structured per-item extraction the flashpoint scraper derives for Papua
    // New Guinea records so the PNG brief can break the picture down by province
    // and category and carry a per-item business-impact line, plus the
    // occurred-vs-reported date distinction (incident_date = when the event
    // actually happened when the article states a date distinct from the RSS
    // pubDate). Null for non-PNG / not-yet-extracted rows; every consumer falls
    // back to location/topic/occurred_at. drizzle push only reaches dev, so the
    // prod primary gains these here on boot. All idempotent (IF NOT EXISTS).
    await db.execute(
      sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_date timestamptz`,
    );
    await db.execute(
      sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS province text`,
    );
    await db.execute(
      sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS category text`,
    );
    await db.execute(
      sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS business_impact text`,
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS incident_corroborations (
        id serial PRIMARY KEY,
        incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        provider text NOT NULL,
        external_id text NOT NULL,
        report_title text NOT NULL,
        source_agency text,
        report_date timestamptz,
        url text NOT NULL,
        match_score double precision NOT NULL,
        matched_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS incident_corroborations_unique
        ON incident_corroborations (incident_id, provider, external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS incident_corroborations_incident_idx
        ON incident_corroborations (incident_id)
    `);

    // Schema: maritime vessel-MOVEMENT context (AIS-derived traffic snapshots).
    // CONTEXT only — never an incident and can never create one; AIS dark/gap is
    // an indicator, not hostile intent. Populated via an admin-token-gated manual
    // upload (no AIS API configured); an empty table reads as "movement data
    // unavailable". drizzle push only reaches dev, so the prod primary gains the
    // table here on boot. All idempotent (IF NOT EXISTS).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS maritime_movement (
        id serial PRIMARY KEY,
        theatre text NOT NULL,
        chokepoint text,
        data_as_of timestamptz NOT NULL,
        total_vessels integer,
        inbound_count integer,
        outbound_count integer,
        tankers_count integer,
        bulk_carriers_count integer,
        container_count integer,
        lng_lpg_count integer,
        anchored_or_waiting_count integer,
        ais_visible_count integer,
        ais_dark_or_gap_count integer,
        change_vs_7_day_baseline text,
        notes text,
        confidence text NOT NULL DEFAULT 'medium',
        source_name text NOT NULL,
        source_url text,
        raw_payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS maritime_movement_theatre_asof_idx
        ON maritime_movement (theatre, data_as_of DESC)
    `);

    // Schema: analyst-maintained Data Centre facility REGISTRY. A curated
    // catalogue of tracked data-centre facilities — DELIBERATELY separate from
    // the incidents pipeline. CRITICAL PRODUCT RULE: a registry facility is
    // NEVER an incident and can never inflate any incident count; its only link
    // to the stream is an OPTIONAL analyst-drawn `linked_incident_id`. status /
    // planning_risk are constrained to fixed vocabularies at the API layer (not
    // the DB) so a vocab extension is a code change, not a migration. drizzle
    // push only reaches dev, so the prod primary gains the table here on boot.
    // All idempotent (IF NOT EXISTS).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS data_centre_facilities (
        id serial PRIMARY KEY,
        name text NOT NULL,
        operator text,
        country text NOT NULL,
        region text,
        city text,
        latitude double precision,
        longitude double precision,
        status text NOT NULL DEFAULT 'Unknown',
        planning_risk text NOT NULL DEFAULT 'Unknown',
        facility_type text NOT NULL DEFAULT 'Unknown / not reported',
        capacity_mw double precision,
        it_load_mw double precision,
        announced_date timestamptz,
        expected_online_date timestamptz,
        commissioned_date timestamptz,
        notes text,
        source_url text,
        linked_incident_id integer,
        status_changed boolean NOT NULL DEFAULT false,
        previous_status text,
        status_changed_at timestamptz,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS data_centre_facilities_country_idx
        ON data_centre_facilities (country)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS data_centre_facilities_status_idx
        ON data_centre_facilities (status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS data_centre_facilities_linked_incident_idx
        ON data_centre_facilities (linked_incident_id)
    `);
    // Additive: constrained facility type (see DATA_CENTRE_TYPES). Existing prod
    // rows (where the CREATE TABLE IF NOT EXISTS above no-ops) gain it here.
    // NOT NULL DEFAULT backfills every pre-existing row to "Unknown / not
    // reported" — never inferred. Idempotent (IF NOT EXISTS).
    await db.execute(sql`
      ALTER TABLE data_centre_facilities
      ADD COLUMN IF NOT EXISTS facility_type text NOT NULL DEFAULT 'Unknown / not reported'
    `);

    // Additive: per-field enrichment provenance (see EnrichmentSources). Nullable
    // jsonb keyed by enriched field name -> { provider, sourceRef, asOf, value }.
    // Written ONLY by the supervised provider-agnostic enrichment run; a blank
    // column reads as "no external field ever imported". Idempotent (IF NOT
    // EXISTS); no backfill (all pre-existing rows correctly start NULL).
    await db.execute(sql`
      ALTER TABLE data_centre_facilities
      ADD COLUMN IF NOT EXISTS enrichment_sources jsonb
    `);

    // Additive: per-field analyst LOCK (see EnrichmentLocks). Nullable jsonb
    // keyed by enrichable field name -> { lockedAt }. Set ONLY by the owner-
    // gated PATCH route when an analyst manually corrects a field, so a later
    // enrichment import can never overwrite the correction (the engine's differ
    // skips locked fields). No backfill — pre-existing rows correctly start
    // NULL (nothing locked). Idempotent (IF NOT EXISTS).
    await db.execute(sql`
      ALTER TABLE data_centre_facilities
      ADD COLUMN IF NOT EXISTS enrichment_locks jsonb
    `);

    // Schema: per-country DATA-CENTRE RISK FRAMEWORK — one row per country with a
    // 16-dimension analyst-maintained assessment (jsonb `dimensions`). Ratings
    // may be auto-seeded from cited public indices then analyst-overridden; a
    // missing dimension reads "not reported" (never invented). Isolated context:
    // never touches incidents. Fixed vocabularies (ratings, dimension keys) live
    // in the Drizzle schema, so vocab changes are code, not migrations. drizzle
    // push only reaches dev, so the prod primary gains the table here on boot.
    // Country uniqueness is case-insensitive via the lower(country) unique index.
    // All idempotent (IF NOT EXISTS).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS data_centre_country_risk (
        id serial PRIMARY KEY,
        country text NOT NULL,
        dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
        overall_note text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS data_centre_country_risk_country_lower_idx
        ON data_centre_country_risk (lower(country))
    `);

    // Schema: per-vessel AIS sighting state, kept ACROSS sample windows so a
    // vessel's transmission GAP can be measured (the live receive stream only
    // shows vessels that ARE transmitting, so an "AIS-dark" vessel is detectable
    // only by remembering where it was last seen and noticing it stopped). One
    // row per MMSI; CONTEXT scaffolding only — never an incident. drizzle push
    // only reaches dev, so the prod primary gains the table here on boot.
    // Idempotent (IF NOT EXISTS).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS maritime_vessel_sighting (
        mmsi integer PRIMARY KEY,
        theatre text NOT NULL,
        last_seen_at timestamptz NOT NULL,
        last_sog real,
        last_nav_status integer,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS maritime_vessel_sighting_theatre_seen_idx
        ON maritime_vessel_sighting (theatre, last_seen_at DESC)
    `);
    // Additive: last-known POSITION + identity for the live vessel map. The base
    // table predates these columns, so the prod primary gains them here on boot
    // (drizzle push only reaches dev). All nullable — a row with no latitude is
    // simply not plotted. Movement stays CONTEXT only; these never feed a count.
    await db.execute(
      sql`ALTER TABLE maritime_vessel_sighting ADD COLUMN IF NOT EXISTS latitude real`,
    );
    await db.execute(
      sql`ALTER TABLE maritime_vessel_sighting ADD COLUMN IF NOT EXISTS longitude real`,
    );
    await db.execute(
      sql`ALTER TABLE maritime_vessel_sighting ADD COLUMN IF NOT EXISTS last_cog real`,
    );
    await db.execute(
      sql`ALTER TABLE maritime_vessel_sighting ADD COLUMN IF NOT EXISTS name text`,
    );
    await db.execute(
      sql`ALTER TABLE maritime_vessel_sighting ADD COLUMN IF NOT EXISTS ship_type integer`,
    );

    // Schema: ReliefWeb (UN OCHA) situational/context reports. A SEPARATE table
    // from incident_corroborations — it stores ReliefWeb reports as standalone
    // supporting context (never as incidents), so it can NEVER inflate incident
    // counts. drizzle push only reaches dev, so the prod primary gains the table
    // here on boot. All idempotent (IF NOT EXISTS).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reliefweb_reports (
        id serial PRIMARY KEY,
        source_name text NOT NULL DEFAULT 'reliefweb',
        external_id text NOT NULL,
        title text NOT NULL,
        summary text,
        body text,
        url text NOT NULL,
        source_org text,
        country text,
        countries jsonb NOT NULL DEFAULT '[]'::jsonb,
        published_at timestamptz,
        original_date timestamptz,
        category_raw text,
        source_type text NOT NULL DEFAULT 'humanitarian_report',
        classification text NOT NULL DEFAULT 'context',
        confidence text NOT NULL DEFAULT 'medium',
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS reliefweb_reports_source_external_unique
        ON reliefweb_reports (source_name, external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reliefweb_reports_url_idx
        ON reliefweb_reports (source_name, url)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reliefweb_reports_country_idx
        ON reliefweb_reports (country)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reliefweb_reports_published_idx
        ON reliefweb_reports (published_at)
    `);

    // Schema: GDELT Cloud structured event layer. A pilot ADDITIVE structured
    // source modelled on reliefweb_reports — GDELT Cloud v2 events + stories are
    // stored as standalone structured CONTEXT in their OWN table, NEVER as
    // incidents, so a GDELT event can never inflate any incident count, never
    // reach a report/PDF, and never touch the report editor. `kind` discriminates
    // 'event' (drives lanes) from 'story' (lane always NULL — GDELT does not
    // lane-code stories, so we never fabricate one). Dedup per
    // (source_name, kind, external_id). drizzle push only reaches dev, so the
    // prod primary gains the table here on boot. All idempotent (IF NOT EXISTS).
    // Mirrors lib/db/src/schema/gdeltStructuredItems.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gdelt_structured_items (
        id serial PRIMARY KEY,
        source_name text NOT NULL DEFAULT 'gdelt_cloud',
        kind text NOT NULL,
        external_id text NOT NULL,
        title text NOT NULL,
        summary text,
        url text,
        primary_story_url text,
        source_date timestamptz,
        coded_at timestamptz,
        upstream_updated_at timestamptz,
        country text,
        region text,
        continent text,
        admin1 text,
        location text,
        latitude double precision,
        longitude double precision,
        family text,
        category text,
        subcategory text,
        domain text,
        event_code text,
        lane text,
        sub_bucket text,
        has_fatalities boolean,
        fatalities integer,
        image_url text,
        top_language text,
        actors jsonb NOT NULL DEFAULT '[]'::jsonb,
        metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
        top_articles jsonb NOT NULL DEFAULT '[]'::jsonb,
        linked_events jsonb NOT NULL DEFAULT '[]'::jsonb,
        story_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        extras jsonb NOT NULL DEFAULT '{}'::jsonb,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS gdelt_structured_items_source_kind_external_unique
        ON gdelt_structured_items (source_name, kind, external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gdelt_structured_items_source_date_idx
        ON gdelt_structured_items (source_date)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gdelt_structured_items_country_idx
        ON gdelt_structured_items (country)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gdelt_structured_items_lane_idx
        ON gdelt_structured_items (lane)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gdelt_structured_items_sub_bucket_idx
        ON gdelt_structured_items (sub_bucket)
    `);

    // Schema: KAMMI Pusat Instagram public social-media protest WATCH
    // items. A CONTEXT source modelled on reliefweb_reports / maritime_movement:
    // a social item is NEVER an incident and lives in its OWN table precisely so
    // a mobilisation / "planned protest" post can never inflate any incident
    // count. The only path into `incidents` is the explicit, gated promote
    // action. PRIVACY: only public posts; captions sanitised; no phone numbers /
    // personal accounts / WhatsApp / member data are ever stored. drizzle push
    // only reaches dev, so the prod primary gains the table here on boot. All
    // idempotent (IF NOT EXISTS). Mirrors lib/db/src/schema/socialWatchItems.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS social_watch_items (
        id serial PRIMARY KEY,
        source_name text NOT NULL DEFAULT 'social_watch',
        platform text NOT NULL,
        channel text NOT NULL,
        actor text,
        external_id text NOT NULL,
        posted_at timestamptz,
        event_date timestamptz,
        event_time_text text,
        caption text,
        image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
        location text,
        city text NOT NULL DEFAULT 'Jakarta',
        province text,
        issue text,
        status text NOT NULL DEFAULT 'planned',
        confidence text NOT NULL DEFAULT 'medium',
        url text NOT NULL,
        country text NOT NULL DEFAULT 'Indonesia',
        topic text NOT NULL DEFAULT 'flashpoint',
        classification text NOT NULL DEFAULT 'context',
        dedup_key text NOT NULL,
        alert_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
        promotable boolean NOT NULL DEFAULT false,
        promoted_incident_id integer,
        promoted_at timestamptz,
        last_checked_at timestamptz NOT NULL DEFAULT now(),
        fetched_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS social_watch_items_dedup_unique
        ON social_watch_items (dedup_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_watch_items_external_idx
        ON social_watch_items (source_name, external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_watch_items_status_idx
        ON social_watch_items (status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_watch_items_platform_idx
        ON social_watch_items (platform)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_watch_items_posted_idx
        ON social_watch_items (posted_at)
    `);

    // Schema: Facebook OSINT monitoring for the Papua New Guinea + Indonesian
    // Papua theatres. A CONTEXT source modelled on social_watch_items — a
    // Facebook post is NEVER an incident and lives in its OWN table precisely so
    // it can never inflate any incident count. The ONLY path into `incidents` is
    // the explicit, gated PROMOTE action, with the server re-deriving eligibility.
    // PRIVACY: only public page posts; captions sanitised; comments / author
    // profiles / phone / email / token-bearing URLs are never stored. drizzle
    // push only reaches dev, so the prod primary gains the table here on boot.
    // All idempotent (IF NOT EXISTS). Mirrors lib/db/src/schema/socialRaw.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS social_raw (
        id serial PRIMARY KEY,
        source_name text NOT NULL DEFAULT 'facebook_osint',
        platform text NOT NULL DEFAULT 'facebook',
        page_handle text NOT NULL,
        page_name text,
        source_tier text NOT NULL DEFAULT 'osint',
        external_id text NOT NULL,
        posted_at timestamptz,
        incident_date timestamptz,
        caption text,
        image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
        links jsonb NOT NULL DEFAULT '[]'::jsonb,
        detected_credible_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
        country text NOT NULL DEFAULT 'Unknown',
        province text,
        location text,
        category text NOT NULL DEFAULT 'Other security',
        business_impact text,
        security_relevant boolean NOT NULL DEFAULT false,
        credible boolean NOT NULL DEFAULT false,
        credibility_reason text,
        corroborated boolean NOT NULL DEFAULT false,
        corroboration_reason text,
        corroborating_incident_id integer,
        promotion_topic text NOT NULL DEFAULT 'flashpoint',
        url text NOT NULL,
        classification text NOT NULL DEFAULT 'context',
        dedup_key text NOT NULL,
        raw_payload jsonb,
        promotable boolean NOT NULL DEFAULT false,
        promoted_incident_id integer,
        promoted_at timestamptz,
        last_checked_at timestamptz NOT NULL DEFAULT now(),
        fetched_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS social_raw_dedup_unique
        ON social_raw (dedup_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_external_idx
        ON social_raw (source_name, external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_country_idx
        ON social_raw (country)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_category_idx
        ON social_raw (category)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_promotable_idx
        ON social_raw (promotable)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_posted_idx
        ON social_raw (posted_at)
    `);
    // Triage/transparency columns added after the table's first ship. All
    // idempotent so the prod primary gains them on boot (drizzle push only
    // reaches dev). Mirrors lib/db/src/schema/socialRaw.ts.
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS engagement jsonb
    `);
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS detected_keywords jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS confidence integer NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS review_flag boolean NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS review_reason text
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_review_idx
        ON social_raw (review_flag)
    `);
    // Analyst review-decision state + source page/group URL. Idempotent so the
    // prod primary gains them on boot. Mirrors lib/db/src/schema/socialRaw.ts.
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS page_url text
    `);
    await db.execute(sql`
      ALTER TABLE social_raw
        ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review'
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS social_raw_review_status_idx
        ON social_raw (review_status)
    `);
    // Backfill: already-promoted rows reflect the 'promoted' decision (the column
    // defaults new rows to 'pending_review'). Idempotent — only flips promoted
    // rows still left at the default.
    await db.execute(sql`
      UPDATE social_raw
        SET review_status = 'promoted'
        WHERE promoted_incident_id IS NOT NULL
          AND review_status = 'pending_review'
    `);

    // Schema: ICC CCS / IMB maritime piracy & armed-robbery events. A STANDALONE
    // maritime-security source — SEPARATE from both the news-scraped `incidents`
    // table and the AIS `maritime_movement` context table — so it can NEVER
    // inflate any incident / crime / protest / conflict count. drizzle push only
    // reaches dev, so the prod primary gains the table here on boot. All
    // idempotent (IF NOT EXISTS). Mirrors lib/db/src/schema/maritimeSecurityEvents.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS maritime_security_events (
        id serial PRIMARY KEY,
        source_name text NOT NULL DEFAULT 'icc_imb',
        event_key text NOT NULL,
        incident_number text,
        incident_type text NOT NULL DEFAULT 'Unknown Maritime Security Incident',
        category_raw text,
        title text NOT NULL,
        narrative text,
        raw_sitrep text,
        location_name text,
        country text,
        latitude double precision,
        longitude double precision,
        raw_position_text text,
        coordinate_quality text NOT NULL DEFAULT 'missing',
        incident_date timestamptz,
        year integer,
        source_url text,
        classification text NOT NULL DEFAULT 'maritime_security',
        content_hash text,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS maritime_security_events_source_key_unique
        ON maritime_security_events (source_name, event_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS maritime_security_events_date_idx
        ON maritime_security_events (incident_date)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS maritime_security_events_country_idx
        ON maritime_security_events (country)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS maritime_security_events_year_idx
        ON maritime_security_events (year)
    `);

    // Schema: M1.5 primary military & maritime official sources (CENTCOM, UKMTO,
    // JMIC, CMF, …). A STANDALONE official-source table — NEVER incidents — so
    // it can NEVER inflate any incident count. Carries P1-D2 analyst flags and
    // P1-D3 watch-routing columns. drizzle push only reaches dev, so the prod
    // primary gains the table here on boot. All idempotent (IF NOT EXISTS).
    // Mirrors lib/db/src/schema/officialMilitaryMaritimeSources.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS official_military_maritime_sources (
        id serial PRIMARY KEY,
        source_name text NOT NULL,
        external_id text NOT NULL,
        title text NOT NULL,
        published_at timestamptz,
        source_url text NOT NULL,
        body_text text,
        classification text NOT NULL DEFAULT 'official_military_maritime',
        flag_significant_incident boolean NOT NULL DEFAULT false,
        flag_escalation_indicator boolean NOT NULL DEFAULT false,
        flag_maritime_disruption boolean NOT NULL DEFAULT false,
        flag_evidence_available boolean NOT NULL DEFAULT false,
        flag_possible_spot_report boolean NOT NULL DEFAULT false,
        primary_watch text,
        watch_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        ingested_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS official_military_maritime_sources_source_external_unique
        ON official_military_maritime_sources (source_name, external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS official_military_maritime_sources_url_idx
        ON official_military_maritime_sources (source_name, source_url)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS official_military_maritime_sources_published_idx
        ON official_military_maritime_sources (published_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS official_military_maritime_sources_primary_watch_idx
        ON official_military_maritime_sources (primary_watch)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS official_military_maritime_sources_possible_spot_report_idx
        ON official_military_maritime_sources (flag_possible_spot_report)
    `);

    // Schema: Special Reports — a lean, analyst-led, multi-domain one-off product
    // built on the Spot Report foundation but kept in its OWN table, with a chosen
    // front cover, manually-entered charts, and the same photos/map. The Drizzle
    // schema (lib/db/src/schema/specialReports.ts) drives dev via `push`; this is
    // the ONLY path that reaches the writable production primary, so a fresh prod
    // database self-provisions the table on boot. All IF NOT EXISTS — safe to
    // re-run. Columns mirror the Drizzle schema column-for-column.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS special_reports (
        id serial PRIMARY KEY,
        title text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        report_date timestamptz NOT NULL DEFAULT now(),
        incident_date timestamptz,
        country text,
        province text,
        city text,
        latitude double precision,
        longitude double precision,
        category text,
        severity text,
        cover_image_key text,
        cover_image_data_url text,
        bluf text,
        incident_details text,
        current_situation text,
        operational_impact text,
        assessment text,
        outlook text,
        recommended_actions text,
        analyst_notes text,
        confidence_level text,
        internal_source_notes text,
        show_sources_in_export boolean NOT NULL DEFAULT false,
        linked_incident_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        map_enabled boolean NOT NULL DEFAULT false,
        affected_radius_km double precision,
        map_points jsonb NOT NULL DEFAULT '[]'::jsonb,
        charts jsonb NOT NULL DEFAULT '[]'::jsonb,
        photos jsonb NOT NULL DEFAULT '[]'::jsonb,
        blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_by text,
        export_history jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_edited_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // The free-form BODY `blocks` column arrived AFTER special_reports was first
    // published, so on the already-existing prod table the CREATE TABLE IF NOT
    // EXISTS above is a no-op and never adds it. Add it explicitly. Idempotent —
    // safe to re-run; fresh installs get it from the CREATE and skip here.
    await db.execute(sql`
      ALTER TABLE special_reports
        ADD COLUMN IF NOT EXISTS blocks jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    // Schema: AI-generated country-report narratives + sibling tables that the
    // country/PNG report builder relies on. These were previously created only by
    // the dev-only drizzle `push`, so a fresh production database never had them.
    // Without country_report_prose the prose route degrades to the deterministic
    // template and analyst edits / AI narratives never persist in the published
    // app. Create them idempotently here so the deployment runtime (the only place
    // with a writable prod primary) self-provisions them on boot. All IF NOT
    // EXISTS — safe to re-run. Mirrors lib/db/src/schema/{countryReportProse,
    // countryReports,countryBaselines,cards}.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS country_reports (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        region text NOT NULL,
        overview text,
        trend_summary text,
        implications text,
        key_numbers jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS country_report_prose (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        fingerprint text NOT NULL,
        sections jsonb NOT NULL,
        edited jsonb,
        model text NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_incident_summaries (
        id serial PRIMARY KEY,
        report_id integer NOT NULL UNIQUE,
        fingerprint text NOT NULL,
        summaries jsonb NOT NULL,
        edited jsonb,
        model text NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // AI-generated narrative sections for TOPIC reports (shipping, conflict,
    // fuel, cargo, energy, fertiliser, flashpoint/protests/strikes), keyed by
    // report id. Without it the topic prose route degrades to the deterministic
    // template and AI narratives / analyst edits never persist in the published
    // app. Mirrors lib/db/src/schema/reportProse.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_prose (
        id serial PRIMARY KEY,
        report_id integer NOT NULL UNIQUE,
        topic text NOT NULL,
        fingerprint text NOT NULL,
        sections jsonb NOT NULL,
        edited jsonb,
        model text NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS country_baselines (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        operating_environment text NOT NULL DEFAULT '',
        security_context text NOT NULL DEFAULT '',
        known_risk_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
        key_cities_provinces jsonb NOT NULL DEFAULT '[]'::jsonb,
        movement_constraints text NOT NULL DEFAULT '',
        infrastructure_limits text NOT NULL DEFAULT '',
        medical_evac text NOT NULL DEFAULT '',
        resource_sector_exposure text NOT NULL DEFAULT '',
        location_watchlist jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS card_templates (
        id serial PRIMARY KEY,
        name text NOT NULL,
        template_key text NOT NULL DEFAULT 'country_risk',
        is_built_in boolean NOT NULL DEFAULT false,
        content jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_edited_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS card_drafts (
        id serial PRIMARY KEY,
        title text NOT NULL,
        template_key text NOT NULL DEFAULT 'country_risk',
        content jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_edited_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS brand_settings (
        id integer PRIMARY KEY DEFAULT 1,
        color_midnight text NOT NULL DEFAULT '#0B0B3D',
        color_electric text NOT NULL DEFAULT '#4655FF',
        color_dusk text NOT NULL DEFAULT '#303030',
        color_polar text NOT NULL DEFAULT '#E2E2E2',
        color_extreme text NOT NULL DEFAULT '#A33232',
        logo_image text,
        font_heading text NOT NULL DEFAULT 'Roboto Condensed',
        font_body text NOT NULL DEFAULT 'Roboto',
        footer_text text NOT NULL DEFAULT 'Polestar Advisory',
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Schema: Replit Auth (OIDC) session + user store. The workbench is private
    // to a single owner; these tables back the login session and the owner claim
    // (users.is_owner). drizzle push only reaches dev, so the prod primary gains
    // them here on boot. All idempotent (IF NOT EXISTS). is_owner is added via a
    // separate ALTER so an existing users table (without the column) is upgraded.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        sid varchar PRIMARY KEY,
        sess jsonb NOT NULL,
        expire timestamptz NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar UNIQUE,
        first_name varchar,
        last_name varchar,
        profile_image_url varchar,
        is_owner boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false`,
    );

    // Relabel: when ReliefWeb has no APPROVED appname, its Source Health rows must
    // not read as "operational". Earlier builds registered the corroboration pass
    // as operational regardless of configuration, so existing prod rows can carry
    // a misleading green status even though the v2 API only ever returns 403 for
    // an unapproved appname. Correct them to "not_configured" (a distinct,
    // non-alarming state) and clear the success/failure timestamps + streak so the
    // UI shows neither "recovered" nor an escalating outage.
    //
    // NOT marker-gated: the condition depends on the CURRENT env, so it re-checks
    // every boot. Idempotent — the WHERE clause only touches rows that disagree.
    // If an approved appname is later configured, the next ingest run flips the
    // row back to operational and this block stops matching.
    if (!isReliefWebConfigured()) {
      const relabel = await db.execute(sql`
        UPDATE sources
        SET status = 'not_configured',
            error_message = ${RELIEFWEB_NOT_CONFIGURED_MESSAGE},
            consecutive_failures = 0,
            last_success_at = NULL,
            last_failure_at = NULL
        WHERE name IN ('ReliefWeb (UN OCHA)', 'ReliefWeb Situational Reports (UN OCHA)')
          AND status <> 'not_configured'
      `);
      if ((relabel.rowCount ?? 0) > 0) {
        logger.info(
          { rows: relabel.rowCount ?? 0 },
          "runDataMigrations: relabelled unconfigured ReliefWeb source rows to not_configured",
        );
      }
    }

    if (!isGdeltConfigured()) {
      const relabel = await db.execute(sql`
        UPDATE sources
        SET status = 'not_configured',
            error_message = ${GDELT_NOT_CONFIGURED_MESSAGE},
            consecutive_failures = 0,
            last_success_at = NULL,
            last_failure_at = NULL
        WHERE name = 'GDELT Conflict Events' AND status <> 'not_configured'
      `);
      if ((relabel.rowCount ?? 0) > 0) {
        logger.info(
          { rows: relabel.rowCount ?? 0 },
          "runDataMigrations: relabelled unconfigured GDELT source rows to not_configured",
        );
      }
    }

    // Schema: GDELT precision-enrichment layer (additive). Same rationale as the
    // corroboration columns above — drizzle push only reaches dev, so the prod
    // primary gains these nullable columns here on boot. All IF NOT EXISTS /
    // idempotent. They hold the structured ACLED-style fields GDELT attaches to
    // matched flashpoint rows (precise geo lives in latitude/longitude/location
    // which already exist); every column is nullable so un-matched rows are
    // unaffected and every surface falls back to the base fields.
    //   - fatalities          : confirmed death count from the AI-coded event.
    //   - actors              : named actor pair ("Protesters / Police").
    //   - gdelt_event_type    : ACLED event_type (Protests / Riots).
    //   - gdelt_sub_event_type: finer ACLED sub_event_type.
    //   - gdelt_confidence    : AI coding confidence 0..1.
    //   - gdelt_enriched_at   : last time the enrichment pass examined the row
    //     (drives the bounded, low-cadence back-match / QU throttle).
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS fatalities integer`);
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS actors text`);
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS gdelt_event_type text`);
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS gdelt_sub_event_type text`);
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS gdelt_confidence double precision`);
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS gdelt_enriched_at timestamptz`);

    // Schema: analyst review override (additive, nullable boolean). Set true
    // when an analyst resolves a Cargo Watch "needs review" incident by
    // assigning its country from the queue — the row then promotes into the
    // in-scope main lane regardless of the heuristic cargo-genuineness gates.
    // drizzle push only reaches dev, so add it on boot (idempotent) for prod.
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS analyst_in_scope boolean`);

    // Schema: same-event cluster key (additive, nullable — see @workspace/ingest
    // conflictEventCluster.ts). A server-side LLM adjudication pass at ingest
    // stamps conflict incidents that report THE SAME real-world event with a
    // shared conflict_evt:<min id> key; the monitor + report dedupe by it. NULL
    // for non-conflict / not-yet-clustered rows (consumers fall back to the
    // deterministic collapse passes). drizzle push only reaches dev, so add it
    // on boot (idempotent) for prod. The partial index speeds the display-side
    // group-by (only stamped rows carry a key).
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS event_cluster_key text`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS incidents_event_cluster_key_idx
        ON incidents (event_cluster_key)
        WHERE event_cluster_key IS NOT NULL
    `);

    // Schema: resolved publisher URL for Google News RSS redirect links
    // (additive — see @workspace/ingest googleNewsUrl.ts). Most flashpoint feeds
    // are Google News aggregators, so source_url is an opaque
    // news.google.com/rss/articles/... redirect that can never equal GDELT's
    // resolved source_urls[]; this nullable column holds the underlying article
    // URL so the GDELT enrichment URL-match can fire. Same drizzle-push-only-
    // reaches-dev rationale as the columns above — add it on boot, idempotent.
    await db.execute(sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_url text`);

    // 0) Country report narrative is now fully data-driven: the Situation,
    //    What Happened and Implications sections are generated from the live
    //    7-day window at render time and the stored overview / trend_summary
    //    / implications columns are no longer read anywhere. Legacy rows
    //    still hold pre-written prose that implied fresh weekly activity even
    //    when the window was empty, which would resurface in any older or
    //    cached build that still rendered the stored text. Wipe them at the
    //    source so no environment can ever serve the stale narrative again.
    //    Idempotent: only touches rows that still hold non-empty values.
    {
      const res = await db.execute(sql`
        UPDATE country_reports
        SET overview = '', trend_summary = '', implications = ''
        WHERE COALESCE(overview, '') <> ''
           OR COALESCE(trend_summary, '') <> ''
           OR COALESCE(implications, '') <> ''
      `);
      if (res.rowCount && res.rowCount > 0) {
        logger.info(
          { rows: res.rowCount },
          "Cleared stale stored country report narrative (overview/trend_summary/implications)",
        );
      }
    }

    // 1) Severity vocabulary: critical/elevated/moderate/low  →
    //    insignificant/low/moderate/high/extreme.
    //
    //    Detected by the presence of any row using the old terms
    //    'critical' or 'elevated', which do not exist in the new vocabulary.
    const [oldSev] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(
        or(
          eq(incidentsTable.severity, "critical"),
          eq(incidentsTable.severity, "elevated"),
        ),
      );

    if ((oldSev?.n ?? 0) > 0) {
      logger.info({ rows: oldSev?.n }, "Migrating severity vocabulary");
      await db.execute(sql`
        UPDATE incidents SET severity = CASE severity
          WHEN 'critical' THEN 'extreme'
          WHEN 'elevated' THEN 'moderate'
          WHEN 'moderate' THEN 'low'
          WHEN 'low'      THEN 'insignificant'
          ELSE severity
        END
      `);
    }

    // 2) Fertiliser content was originally seeded under topic='flashpoint'.
    //    Move it to its own topic. Detected by absence of any fertiliser rows
    //    combined with the presence of the original fertiliser-themed titles
    //    still sitting under flashpoint.
    const [fertCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(eq(incidentsTable.topic, "fertiliser"));

    if ((fertCount?.n ?? 0) === 0) {
      const res = await db.execute(sql`
        UPDATE incidents
        SET topic = 'fertiliser'
        WHERE topic = 'flashpoint'
          AND (
            title ILIKE '%urea%'
            OR title ILIKE '%phosphate%'
            OR title ILIKE '%fertiliser%'
            OR title ILIKE '%fertilizer%'
            OR title ILIKE '%potash%'
            OR title ILIKE '%DAP %'
          )
      `);
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ rows: res.rowCount }, "Reclassified fertiliser incidents");
      }
    }
    // 3) Ensure every topic has at least one report card in the Report
    //    Builder. Idempotent: only inserts when no report exists for the
    //    topic, so re-runs and new environments self-heal without
    //    duplicating cards.
    // 3a) Remove any reports retired from the seed list, in every env.
    for (const retiredTitle of RETIRED_REPORT_TITLES) {
      try {
        const res = await db
          .delete(reportsTable)
          .where(eq(reportsTable.title, retiredTitle));
        if (res.rowCount && res.rowCount > 0) {
          logger.info({ title: retiredTitle, rows: res.rowCount }, "Removed retired report");
        }
      } catch (delErr) {
        logger.error({ err: delErr, title: retiredTitle }, "Failed to remove retired report");
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    logger.info({ count: REQUIRED_TOPIC_REPORTS.length }, "runDataMigrations: entering report seed loop");
    for (const seed of REQUIRED_TOPIC_REPORTS) {
      try {
        const [existing] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(reportsTable)
          .where(eq(reportsTable.title, seed.title));
        const n = existing?.n ?? 0;
        logger.info({ topic: seed.topic, title: seed.title, existing: n }, "runDataMigrations: report seed check");
        if (n === 0) {
          const inserted = await db
            .insert(reportsTable)
            .values({
              title: seed.title,
              topic: seed.topic,
              status: "draft",
              issueDate: today,
              author: "J. Sterling",
            })
            .returning({ id: reportsTable.id });
          logger.info({ topic: seed.topic, title: seed.title, id: inserted[0]?.id }, "Seeded missing topic report");
        }
      } catch (seedErr) {
        logger.error({ err: seedErr, topic: seed.topic }, "Failed to seed topic report");
      }
    }
    // 3b) ONE-TIME reset of legacy shipping report prose.
    //
    //     The Shipping preview/PDF render What Matters, Implications, Watch
    //     Next and Polestar View through the editor's pick(): saved prose is
    //     shown verbatim when present and not flagged stale, otherwise it
    //     falls back to the live Shipping dataset (buildShippingReportDataset
    //     → countryRows / chokepoint / vessel reads). Legacy rows still hold
    //     pre-written prose (e.g. a Polestar View naming "China and South
    //     Korea" while the live country chart shows Iran / Singapore), which
    //     made the Executive Summary, chart and Polestar View disagree.
    //
    //     Blank those four stored sections ONCE so the report falls back to
    //     the single live dataset and the three surfaces reconcile. This is
    //     marker-gated (NOT an every-boot wipe) so deliberate analyst edits
    //     made AFTER this reset are preserved across restarts. Bump the
    //     marker key if a future change ever requires re-resetting. We do
    //     NOT touch situation / what_happened — the shipping preview/PDF do
    //     not render them, so clearing them would be destructive for no gain.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "shipping_prose_reset_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          UPDATE reports
          SET what_matters = '', implications = '', polestar_view = '', watch_next = ''
          WHERE topic = 'shipping'
            AND (
                 COALESCE(what_matters, '')  <> ''
              OR COALESCE(implications, '')   <> ''
              OR COALESCE(polestar_view, '')  <> ''
              OR COALESCE(watch_next, '')     <> ''
            )
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time shipping report prose reset (now rendered from live dataset)",
        );
      }
    }
    // 3b-ii) ONE-TIME removal of byte-identical TAPA cargo-crime duplicates.
    //
    //     Overlapping-date TAPA exports promoted the same incident more than
    //     once: every byte-identical copy (same nine fields, date included) was
    //     stamped tapa_offline:<hash>:<n> with n>0. The owner confirmed these
    //     are import artifacts, not genuine repeat events, so collapse each
    //     hash group to its occurrence-0 row and delete the rest. markTapaRows
    //     now emits only occurrence 0, so no new n>0 rows can be created; this
    //     repairs rows promoted before that change. Marker-gated one-time (safe
    //     no-op in prod if the admin promote route was never run there).
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "tapa_byte_identical_dedupe_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          DELETE FROM incidents
          WHERE topic = 'cargo_watch'
            AND analyst_notes LIKE 'tapa_offline:%'
            AND split_part(analyst_notes, ':', 3) <> '0'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time TAPA byte-identical duplicate cleanup (kept occurrence 0)",
        );
      }
    }
    // 3c) ONE-TIME relocation of out-of-theatre strike rows.
    //
    //     Both Missile Strike Tracker theatres (maritime_hormuz, land_gcc) are
    //     firmly Middle East / Gulf. A historical geocode bug let a foreign
    //     place named only in a source masthead set a strike's location — e.g.
    //     a genuine Strait of Hormuz seizure reported by the "Taipei Times"
    //     resolved to "Taipei" (lat ~25, lng ~121.6), polluting the "Strikes by
    //     Port/Chokepoint" chart. The geocode now hard-clamps to the Gulf box,
    //     but existing rows must be repaired in place. These are REAL strikes,
    //     so RELOCATE rather than delete: maritime rows fall back to the Strait
    //     of Hormuz centroid; land rows drop the bogus city (location/coords
    //     nulled) but keep the record. Detected by coordinates outside the Gulf
    //     bounding box (lat 8..42, lng 30..66). Marker-gated so analyst-set
    //     locations made afterwards are never overwritten.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "strikes_out_of_theatre_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const maritime = await db.execute(sql`
          UPDATE strikes
          SET latitude = 26.57, longitude = 56.25, location = 'Strait of Hormuz'
          WHERE theatre = 'maritime_hormuz'
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND NOT (latitude BETWEEN 8 AND 42 AND longitude BETWEEN 30 AND 66)
        `);
        const land = await db.execute(sql`
          UPDATE strikes
          SET latitude = NULL, longitude = NULL, location = NULL
          WHERE theatre <> 'maritime_hormuz'
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND NOT (latitude BETWEEN 8 AND 42 AND longitude BETWEEN 30 AND 66)
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            maritime: maritime.rowCount ?? 0,
            land: land.rowCount ?? 0,
            marker: markerKey,
          },
          "One-time relocation of out-of-theatre strike rows (bad geocode cleanup)",
        );
      }
    }
    // 3c-ii) ONE-TIME relocation of cross-border conflict rows mis-tagged to
    //     India by source-masthead pollution. A Pakistan-located event reported
    //     by an Indian outlet ("Afghanistan claims strikes on militant hideouts
    //     inside Pakistan — The Times of India") had "India" detected from the
    //     trailing masthead, inflating India's conflict count and deflating
    //     Pakistan's. The ingest now strips the source masthead before country
    //     detection (stripSourceMasthead); this repairs rows already stored.
    //     These are REAL Pakistan events, so RELOCATE (not delete). Bound to a
    //     "<verb> Pakistan" location phrase with NO India-location token, so a
    //     genuine India event that merely cites Pakistan ("India charges
    //     Pakistan-based militant groups in Kashmir killings") is never moved.
    //     Marker-gated so analyst edits afterwards are never overwritten.
    //     NOTE: backslashes are DOUBLED (\\y) because this is a JS template
    //     literal first — a single \y would reach Postgres as a bare "y".
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "conflict_india_to_pakistan_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          UPDATE incidents
          SET country = 'Pakistan'
          WHERE topic = 'conflict' AND country = 'India'
            AND title ~* '\\y(in|inside|on|across|within)[[:space:]]+pakistan\\y'
            AND title !~* '\\y(india|indian|kashmir|jammu|manipur|delhi|mumbai|chhattisgarh|naxal|maoist|assam|nagaland|imphal|srinagar|pahalgam)\\y'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time relocation of India-mislabelled Pakistan conflict rows (masthead pollution cleanup)",
        );
      }
    }
    // 3d) ONE-TIME purge of out-of-region mis-stamped commodity rows.
    //
    //     The fuel / energy / fertiliser monitors are scoped to Asia / Gulf /
    //     Oceania, but a country-edition Google-News feed cross-syndicates
    //     foreign stories that name no in-region country. The old ingest blind-
    //     stamped them with the feed's defaultCountry and dropped them on that
    //     centroid — a Libyan "libyaupdate.com" fuel crisis tagged Pakistan, a
    //     Cuba blackout tagged Indonesia, a Texas/Europe outage tagged Myanmar/
    //     Philippines. The ingest classifier now rejects these at the source;
    //     this clears the rows already in the DB. Delete (not relocate) — they
    //     are out of every monitor's scope. Mirrors the ingest guard: a foreign
    //     signal in title/summary/source AND no in-region country named. Marker-
    //     gated so it runs once and never touches legitimate rows that merely
    //     cite a foreign country alongside an in-region one.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // NOTE: backslashes are DOUBLED (\\y, \\.) because this string is a JS
      // template literal first — a single \y reaches Postgres as a bare "y" and
      // silently mangles the regex (a previous pass deleted the wrong rows that
      // way). Word boundaries (\\y) gate the TEXT; the SOURCE is matched as a
      // SUBSTRING (no boundary) so a masthead like "libyaupdate.com" still
      // resolves to Libya — exactly mirroring the ingest classifier's
      // hasWord(text) || source.includes(token) logic.
      const FOREIGN =
        "libya|egypt|nigeria|niger|sudan|algeria|morocco|tunisia|ethiopia|kenya|ghana|somalia|angola|zambia|zimbabwe|uganda|tanzania|cameroon|senegal|mozambique|cuba|venezuela|colombia|brazil|argentina|mexico|texas|france|germany|spain|italy|britain|british|england|ireland|europe|european";
      // INREGION is deliberately WIDE — it is the protective guard: any row that
      // mentions one of these is kept. It must err toward over-matching so a
      // legitimate in-region story is never purged. Includes subnational/state
      // aliases (punjab, sindh, queensland, …) and demonyms beyond the runtime
      // country list, because a valid story may name only a province or city.
      const INREGION =
        "india|indian|delhi|mumbai|kolkata|chennai|bengaluru|hyderabad|pune|ahmedabad|punjab|sindh|gujarat|maharashtra|kerala|tamil nadu|assam|bihar|rajasthan|pakistan|pakistani|karachi|lahore|islamabad|peshawar|quetta|rawalpindi|bangladesh|bangladeshi|dhaka|chittagong|sri lanka|sri lankan|colombo|nepal|nepali|kathmandu|bhutan|maldives|afghanistan|afghan|kabul|myanmar|burma|burmese|yangon|mandalay|naypyidaw|indonesia|indonesian|jakarta|java|sumatra|surabaya|bali|borneo|kalimantan|sulawesi|philippines|filipino|manila|luzon|mindanao|cebu|davao|vietnam|vietnamese|hanoi|ho chi minh|saigon|thailand|thai|bangkok|phuket|malaysia|malaysian|kuala lumpur|penang|sabah|sarawak|singapore|brunei|cambodia|cambodian|phnom penh|laos|lao|vientiane|timor|china|chinese|beijing|shanghai|guangzhou|shenzhen|hong kong|macau|japan|japanese|tokyo|osaka|nagoya|yokohama|korea|korean|seoul|busan|incheon|taiwan|taiwanese|taipei|kaohsiung|iran|iranian|tehran|isfahan|iraq|iraqi|baghdad|basra|mosul|syria|syrian|saudi|riyadh|jeddah|dammam|uae|emirati|dubai|abu dhabi|sharjah|qatar|qatari|doha|kuwait|kuwaiti|oman|omani|muscat|bahrain|bahraini|manama|yemen|yemeni|sanaa|jordan|jordanian|amman|lebanon|lebanese|beirut|israel|israeli|jerusalem|tel aviv|gaza|turkey|turkish|ankara|istanbul|australia|australian|sydney|melbourne|brisbane|perth|adelaide|canberra|queensland|victoria|new south wales|tasmania|new zealand|kiwi|auckland|wellington|christchurch|papua|pacific|fiji|solomon|vanuatu";
      const markerKey = "commodity_out_of_region_purge_v3";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          DELETE FROM incidents
          WHERE topic IN ('fuel', 'energy', 'fertiliser')
            AND (
              (COALESCE(title,'') || ' ' || COALESCE(summary,'')) ~* ('\\y(' || ${FOREIGN} || ')\\y')
              OR COALESCE(source,'') ~* ('(' || ${FOREIGN} || ')')
            )
            AND (COALESCE(title,'') || ' ' || COALESCE(summary,'') || ' ' || COALESCE(source,'')) !~* ('\\y(' || ${INREGION} || ')\\y')
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time purge of out-of-region mis-stamped fuel/energy/fertiliser rows",
        );
      }
    }

    // 3d-1) ONE-TIME relocation of Crimea energy incidents mis-stamped onto a
    //     feed default country. Energy is a WORLD-scope monitor, so a Crimea
    //     power-plant strike is a legitimate global-market incident — but
    //     "Crimea"/"Balaklava" were absent from the gazetteer, so a Crimea story
    //     cross-syndicated into a country-edition feed (e.g. the Pakistan energy
    //     edition) had no country detected and was stamped with the feed default
    //     (Pakistan) and dropped on that centroid. The gazetteer now resolves
    //     these to Ukraine; this repairs rows already stored. RELOCATE (never
    //     delete) — the incident is real and in-scope. Re-stamp country =
    //     'Ukraine' and re-geocode to Balaklava/Crimea coordinates. Bound to a
    //     Crimea/Balaklava/Sevastopol title/summary token AND country != Ukraine
    //     so an already-correct row is untouched. Marker-gated so analyst edits
    //     afterwards are never overwritten. NOTE: backslashes are DOUBLED (\\y)
    //     because this is a JS template literal first.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "energy_crimea_to_ukraine_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          UPDATE incidents
          SET country = 'Ukraine',
              location = 'Balaklava',
              latitude = 44.5,
              longitude = 33.6
          WHERE topic = 'energy'
            AND country <> 'Ukraine'
            AND (COALESCE(title,'') || ' ' || COALESCE(summary,'')) ~* '\\y(crimea|crimean|balaklava|sevastopol|simferopol|kerch)\\y'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time relocation of Crimea energy incidents mis-stamped onto a feed default country",
        );
      }
    }

    // 3d-1a) ONE-TIME relocation of OTHER cross-syndicated foreign energy
    //     stories mis-stamped onto a feed default country. Same defect as the
    //     Crimea case (3d-1): Energy is a WORLD-scope monitor, but Turkey /
    //     United Kingdom / Venezuela were absent from the gazetteer, so a story
    //     naming ONLY one of them (e.g. "Power restored in Turkey after
    //     blackout" carried in the Bangladesh energy edition, a Scotland power
    //     tariff item in the Sri Lanka edition, a Venezuela outage from "Times
    //     of Oman") had no country detected and was stamped with the feed
    //     default and dropped on that centroid. The gazetteer now resolves these
    //     three; this repairs rows already stored. RELOCATE (never delete) — the
    //     incidents are real and in-scope. Each row is re-stamped to the named
    //     country and re-geocoded to its centroid. Match the foreign token in the
    //     TITLE only (the summary repeats the publisher masthead — "Times of
    //     Oman" — so a summary match would false-negative via the region guard)
    //     AND require that NO in-region country name appears in the title, so a
    //     genuinely in-region story that merely mentions a foreign place (e.g.
    //     "Iraq-Turkey Pipeline sabotage", stored Iraq) is never moved. Bound to
    //     country <> the target so an already-correct row is untouched.
    //     Marker-gated so analyst edits afterwards are never overwritten. NOTE:
    //     backslashes are DOUBLED (\\y) because this is a JS template literal.
    {
      const markerKey = "energy_foreign_syndication_relocate_v2";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const regionGuard =
          "\\y(pakistan|india|indian|bangladesh|sri lanka|ceylon|nepal|myanmar|burma|indonesia|philippine|thai|thailand|vietnam|malaysia|china|chinese|iran|iranian|iraq|iraqi|saudi|emirates|dubai|abu dhabi|qatar|kuwait|oman|omani|bahrain|yemen|israel|israeli|australia|australian|new zealand|japan|japanese|korea|korean|cambodia|laos|ukraine|russia|russian|germany|german|spain|spanish|iberia|portugal|cuba|mongolia|south africa|eskom|nigeria|kenya|ghana|zimbabwe|zambia|niger|united states|america|american|texas|california|canada|canadian)\\y";
        const targets: { country: string; token: string; lat: number; lng: number }[] = [
          { country: "Turkey", token: "\\y(turkey|turkish|turkiye|istanbul|ankara)\\y", lat: 38.96, lng: 35.24 },
          { country: "United Kingdom", token: "\\y(united kingdom|britain|british|england|scotland|london)\\y", lat: 54.0, lng: -2.5 },
          { country: "Venezuela", token: "\\y(venezuela|venezuelan|caracas)\\y", lat: 6.42, lng: -66.59 },
        ];
        let total = 0;
        for (const t of targets) {
          // Single-target attribution: a title that also names ANOTHER target
          // country is ambiguous, so skip it (never guess which one to stamp).
          const otherTokens = targets
            .filter((o) => o.country !== t.country)
            .map((o) => o.token.slice(2, -2)) // strip the shared \y…\y wrapper
            .join("|");
          const otherGuard = `\\y(${otherTokens})\\y`;
          const res = await db.execute(sql`
            UPDATE incidents
            SET country = ${t.country},
                location = NULL,
                latitude = ${t.lat},
                longitude = ${t.lng}
            WHERE topic = 'energy'
              AND country <> ${t.country}
              AND COALESCE(title,'') ~* ${t.token}
              AND COALESCE(title,'') !~* ${regionGuard}
              AND COALESCE(title,'') !~* ${otherGuard}
          `);
          total += res.rowCount ?? 0;
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: total, marker: markerKey },
          "One-time relocation of cross-syndicated foreign (Turkey/UK/Venezuela) energy incidents mis-stamped onto a feed default country",
        );
      }
    }

    // 3d-1c) ONE-TIME re-geocode of Papua New Guinea incidents that fell back to
    //     the bare country centroid (location IS NULL) before the geocoder learned
    //     the country's provinces and district towns. The Operational Map plots a
    //     marker only where a record resolved to a real sub-national place, so
    //     every centroid-fallback row stacked invisibly on the one national point
    //     and the map "stayed on the same spot each week". The gazetteer now
    //     covers PNG's provinces / districts; this repairs rows already stored by
    //     re-running the SAME geocoder over the record's title + summary. RELOCATE
    //     (never delete): a row whose text still names no known place keeps its
    //     centroid coordinates and stays honestly unplotted (counted, not shown).
    //     Bound to location IS NULL so an analyst-placed or already-resolved point
    //     is never overwritten; marker-gated so it runs once.
    {
      const markerKey = "png_centroid_regeocode_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const rows = await db.execute(sql`
          SELECT id, title, summary
          FROM incidents
          WHERE country = 'Papua New Guinea'
            AND location IS NULL
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
        `);
        let moved = 0;
        for (const r of rows.rows as Array<{
          id: number;
          title: string | null;
          summary: string | null;
        }>) {
          const text = `${r.title ?? ""} ${r.summary ?? ""}`.trim();
          const geo = geocode("Papua New Guinea", text);
          // Only relocate when the geocoder resolved a real sub-national place
          // (location non-null); a bare-centroid result is left untouched.
          if (!geo || geo.location == null) continue;
          const res = await db.execute(sql`
            UPDATE incidents
            SET latitude = ${geo.latitude},
                longitude = ${geo.longitude},
                location = ${geo.location}
            WHERE id = ${r.id} AND location IS NULL
          `);
          moved += res.rowCount ?? 0;
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: rows.rows.length, moved, marker: markerKey },
          "One-time re-geocode of Papua New Guinea centroid-fallback incidents onto their named province/town",
        );
      }
    }

    // 3d-1b) ONE-TIME relocation of cross-syndicated foreign FUEL / FERTILISER
    //     stories mis-stamped onto a feed default country — the SAME defect as
    //     the energy case (3d-1a), now audited for the other two world-scope
    //     commodity monitors. Fuel and fertiliser share energy's world gazetteer
    //     (GLOBAL_TOPIC_ALIASES), so a story naming ONLY a foreign country was
    //     stamped with the country-edition feed's defaultCountry and dropped on
    //     that centroid (e.g. "Fuel shortage in French gas stations" stored
    //     Vietnam; "Scotland vulnerable after Grangemouth closure" stored India;
    //     "Australia fuel crisis" stored Myanmar/Philippines; "Fuel shortage
    //     grows in Crimea" stored Bangladesh/India; "Kerala Assembly ... fuel
    //     crisis" stored Philippines). The gazetteer now adds France + Poland;
    //     the earlier reattribution pass could not fix these because it never
    //     fires on an in-region -> in-region change (Australia/India mis-stamps)
    //     and the marker-gated one-time run had already passed for later rows.
    //     RELOCATE (never delete) — the incidents are real and in-scope. Each row
    //     is re-stamped to the named country and re-geocoded to its centroid.
    //     Match the target token in the TITLE only (the summary repeats the
    //     publisher masthead, which the region guard would false-negative on) AND
    //     require that NO OTHER tracked country name appears in the title, so a
    //     multi-country story is never guessed at. Bound to country <> the target
    //     so an already-correct row is untouched. Marker-gated so analyst edits
    //     afterwards are never overwritten. NOTE: backslashes are DOUBLED (\\y)
    //     because this is a JS template literal.
    {
      const markerKey = "fuel_fertiliser_foreign_syndication_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        // Full tracked-country token map (region + global gazetteer). The "others"
        // guard for a given target is every OTHER country's tokens joined, so a
        // title naming a second country is left untouched (ambiguous).
        const COUNTRY_TOKENS: Record<string, string> = {
          India: "india|indian|delhi|mumbai|kolkata|chennai|bengaluru|uttar pradesh|maharashtra|tamil nadu|kerala|karnataka|telangana|gujarat|rajasthan|odisha|kochi|hyderabad",
          Pakistan: "pakistan|pakistani|karachi|lahore|islamabad|sindh|balochistan|k-electric|nepra|peshawar|quetta|multan|faisalabad|rawalpindi",
          Bangladesh: "bangladesh|bangladeshi|dhaka|chittagong|chattogram|bpdb|desco|gazipur|sylhet|khulna",
          "Sri Lanka": "sri lanka|sri lankan|colombo|ceylon|ceb",
          Nepal: "nepal|nepali|kathmandu|nea",
          Myanmar: "myanmar|burma|burmese|yangon|naypyidaw|mandalay",
          Indonesia: "indonesia|indonesian|jakarta|java|sumatra|surabaya",
          Philippines: "philippines|filipino|manila|luzon|mindanao|cebu|meralco|napocor|visayas|davao",
          Vietnam: "vietnam|vietnamese|hanoi|ho chi minh",
          Thailand: "thailand|thai|bangkok|phuket|chiang mai|pattaya",
          Malaysia: "malaysia|malaysian|kuala lumpur",
          China: "china|chinese|beijing|shanghai|guangdong",
          Japan: "japan|japanese|tokyo|osaka|tepco|fukushima",
          "South Korea": "south korea|korean|seoul|busan",
          Iran: "iran|iranian|tehran",
          Iraq: "iraq|iraqi|baghdad|basra",
          "Saudi Arabia": "saudi arabia|saudi|riyadh|jeddah|yanbu|dammam|mecca|medina",
          "United Arab Emirates": "united arab emirates|uae|dubai|abu dhabi|fujairah",
          Qatar: "qatar|qatari|doha",
          Kuwait: "kuwait|kuwaiti",
          Oman: "oman|omani|muscat",
          Bahrain: "bahrain|bahraini|manama",
          Australia: "australia|australian|sydney|melbourne|brisbane|perth|adelaide|canberra|queensland",
          "New Zealand": "new zealand|auckland|wellington|christchurch",
          "United States": "united states|u\\.s\\.|u\\.s\\.a\\.|usa|america|american|texas|california|florida|ohio|new york|houston|dallas|chicago|ercot",
          Canada: "canada|canadian|ontario|quebec|alberta|toronto|vancouver",
          "South Africa": "south africa|south african|eskom|johannesburg|pretoria|cape town|durban",
          Nigeria: "nigeria|nigerian|lagos|abuja|port harcourt",
          Kenya: "kenya|kenyan|nairobi",
          Ghana: "ghana|ghanaian|accra|dumsor",
          Zimbabwe: "zimbabwe|zimbabwean|harare|zesa",
          Zambia: "zambia|zambian|lusaka|zesco",
          Spain: "spain|spanish|madrid|barcelona|iberia",
          Portugal: "portugal|portuguese|lisbon",
          Ukraine: "ukraine|ukrainian|kyiv|kiev|crimea|crimean|sevastopol|simferopol|balaklava|kerch|zaporizhzhia|kharkiv|odesa|odessa",
          Russia: "russia|russian|moscow|rosseti",
          Germany: "germany|german|berlin|hamburg|munich",
          Cuba: "cuba|cuban|havana",
          Mongolia: "mongolia|mongolian|ulaanbaatar",
          Turkey: "turkey|turkish|turkiye|istanbul|ankara",
          "United Kingdom": "united kingdom|britain|british|england|scotland|london|grangemouth",
          Venezuela: "venezuela|venezuelan|caracas",
          France: "france|french|paris",
          Poland: "poland|polish|warsaw",
        };
        // Targets to relocate to. `token` matches the target in the title (curated
        // to unambiguous identifiers — India uses distinctly-Indian states/cities,
        // never the India/Pakistan-shared "punjab").
        const targets: { country: string; token: string; lat: number; lng: number }[] = [
          { country: "France", token: "france|french|paris", lat: 46.23, lng: 2.21 },
          { country: "Poland", token: "poland|polish|warsaw", lat: 51.92, lng: 19.13 },
          { country: "Australia", token: COUNTRY_TOKENS.Australia, lat: -25.27, lng: 133.78 },
          { country: "United Kingdom", token: COUNTRY_TOKENS["United Kingdom"], lat: 54.0, lng: -2.5 },
          { country: "Ukraine", token: COUNTRY_TOKENS.Ukraine, lat: 48.38, lng: 31.17 },
          { country: "India", token: "kerala|karnataka|tamil nadu|mumbai|delhi|kolkata|chennai|bengaluru|maharashtra|uttar pradesh|gujarat|rajasthan|odisha|kochi|hyderabad", lat: 22.59, lng: 78.96 },
        ];
        let total = 0;
        for (const t of targets) {
          const others = Object.entries(COUNTRY_TOKENS)
            .filter(([c]) => c !== t.country)
            .map(([, tok]) => tok)
            .join("|");
          const targetGuard = `\\y(${t.token})\\y`;
          const otherGuard = `\\y(${others})\\y`;
          const res = await db.execute(sql`
            UPDATE incidents
            SET country = ${t.country},
                location = NULL,
                latitude = ${t.lat},
                longitude = ${t.lng}
            WHERE topic IN ('fuel', 'fertiliser')
              AND country <> ${t.country}
              AND COALESCE(title,'') ~* ${targetGuard}
              AND COALESCE(title,'') !~* ${otherGuard}
          `);
          total += res.rowCount ?? 0;
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: total, marker: markerKey },
          "One-time relocation of cross-syndicated foreign fuel/fertiliser incidents mis-stamped onto a feed default country",
        );
      }
    }

    // 3d-1c) ONE-TIME relocation of cross-syndicated CONFLICT incidents mis-stamped
    //     onto a feed default country — the SAME foreign-syndication defect audited
    //     for energy (3d-1a) and fuel/fertiliser (3d-1b), now checked for the
    //     region-locked topics that also carry cross-syndicated stories (shipping,
    //     conflict, cargo_watch). Audit finding: cargo_watch had NO genuine
    //     stored-country mis-stamps (its cross-country flags were masthead-only or a
    //     foreign SUBJECT of an in-region event, e.g. a Thai robbery of a "Chinese
    //     man"); shipping's cross-country flags were maritime-CHOKEPOINT context
    //     (Suez/Hormuz/Bab el-Mandeb named but the incident is at the chokepoint, not
    //     that littoral) or commerce port-congestion noise the relevance gate already
    //     drops — neither is a feed-default mis-stamp, so relocating them would be
    //     wrong. Conflict, however, had genuine in-region -> in-region mis-stamps: a
    //     Thai school shooting stored India, Cebu City shootouts stored Pakistan (at
    //     the Pakistan centroid), a Negros army clash stored India, a Baloch
    //     insurgency piece stored Sri Lanka, a Myanmar politics story stored
    //     Bangladesh. These are real, in-scope APAC incidents dropped on the WRONG
    //     country centroid (map != table). RELOCATE (never delete) to the named
    //     country + its centroid. Match a DISTINCTLY-national token in the TITLE only
    //     and require NO OTHER tracked country token in the title, so a multi-country
    //     story is never guessed. Pakistan is scoped to distinctly-Pakistani tokens
    //     (baloch/balochistan) ONLY — the sensitive India<->Pakistan cross-border
    //     attribution is owned by conflict_india_to_pakistan_relocate_v1 and must not
    //     be re-opened here. No gazetteer/choropleth additions: every target is an
    //     already-tracked in-region country with a centroid and a region polygon
    //     (region-locked topics never surface out-of-region countries on the map).
    //     Marker-gated so analyst edits are never overwritten. Backslashes are
    //     DOUBLED (\\y) because this is a JS template literal.
    {
      const markerKey = "conflict_foreign_syndication_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        // Full tracked-country token map for the "others" guard (a title naming a
        // second tracked country is ambiguous and left untouched).
        const COUNTRY_TOKENS: Record<string, string> = {
          India: "india|indian|delhi|mumbai|kolkata|chennai|bengaluru|uttar pradesh|maharashtra|tamil nadu|kerala|karnataka|telangana|gujarat|rajasthan|odisha|kochi|hyderabad|manipur|assam|kashmir|punjab",
          Pakistan: "pakistan|pakistani|karachi|lahore|islamabad|sindh|balochistan|baloch|peshawar|quetta|multan|faisalabad|rawalpindi|waziristan|khyber",
          Bangladesh: "bangladesh|bangladeshi|dhaka|chittagong|chattogram",
          "Sri Lanka": "sri lanka|sri lankan|colombo|ceylon",
          Nepal: "nepal|nepali|kathmandu",
          Myanmar: "myanmar|burma|burmese|yangon|naypyidaw|mandalay|rakhine|rohingya",
          Indonesia: "indonesia|indonesian|jakarta|java|sumatra|surabaya|sulawesi",
          Philippines: "philippines|filipino|philippine|manila|luzon|mindanao|cebu|visayas|davao|negros|quezon|zamboanga",
          Vietnam: "vietnam|vietnamese|hanoi|ho chi minh",
          Thailand: "thailand|thai|bangkok|phuket|chiang mai|pattaya",
          Malaysia: "malaysia|malaysian|kuala lumpur|sabah|sarawak",
          China: "china|chinese|beijing|shanghai|guangdong",
          Japan: "japan|japanese|tokyo|osaka",
          "South Korea": "south korea|korean|seoul|busan",
          Iran: "iran|iranian|tehran",
          Iraq: "iraq|iraqi|baghdad|basra",
          "Saudi Arabia": "saudi arabia|saudi|riyadh|jeddah|yanbu|dammam",
          "United Arab Emirates": "united arab emirates|uae|dubai|abu dhabi|fujairah",
          Qatar: "qatar|qatari|doha",
          Kuwait: "kuwait|kuwaiti",
          Oman: "oman|omani|muscat",
          Bahrain: "bahrain|bahraini|manama",
          Yemen: "yemen|yemeni|houthi|sanaa|hodeidah|aden",
          Australia: "australia|australian|sydney|melbourne|brisbane|perth|adelaide|canberra|queensland",
          "New Zealand": "new zealand|auckland|wellington|christchurch",
          Cambodia: "cambodia|cambodian|phnom penh",
          Laos: "laos|laotian|vientiane",
          "Papua New Guinea": "papua new guinea|bougainville|port moresby",
          "West Papua": "west papua",
          Israel: "israel|israeli|tel aviv|gaza|jerusalem",
          Lebanon: "lebanon|lebanese|beirut|hezbollah",
          Syria: "syria|syrian|damascus|aleppo",
          Ukraine: "ukraine|ukrainian|kyiv|kiev|crimea",
          Russia: "russia|russian|moscow",
          Nigeria: "nigeria|nigerian|lagos|abuja",
        };
        // Curated relocate targets: distinctly-national title tokens + centroid.
        const targets: { country: string; token: string; lat: number; lng: number }[] = [
          { country: "Thailand", token: "thailand|thai|bangkok|phuket|chiang mai|pattaya", lat: 15.87, lng: 100.99 },
          { country: "Philippines", token: "philippines|filipino|philippine|manila|cebu|negros|luzon|mindanao|visayas|davao|zamboanga", lat: 12.88, lng: 121.77 },
          { country: "Myanmar", token: "myanmar|burma|burmese|yangon|naypyidaw|mandalay|rakhine|rohingya", lat: 21.91, lng: 95.96 },
          { country: "Pakistan", token: "balochistan|baloch", lat: 30.38, lng: 69.35 },
        ];
        let total = 0;
        for (const t of targets) {
          const others = Object.entries(COUNTRY_TOKENS)
            .filter(([c]) => c !== t.country)
            .map(([, tok]) => tok)
            .join("|");
          const targetGuard = `\\y(${t.token})\\y`;
          const otherGuard = `\\y(${others})\\y`;
          const res = await db.execute(sql`
            UPDATE incidents
            SET country = ${t.country},
                location = NULL,
                latitude = ${t.lat},
                longitude = ${t.lng}
            WHERE topic = 'conflict'
              AND country <> ${t.country}
              AND COALESCE(title,'') ~* ${targetGuard}
              AND COALESCE(title,'') !~* ${otherGuard}
          `);
          total += res.rowCount ?? 0;
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: total, marker: markerKey },
          "One-time relocation of cross-syndicated conflict incidents mis-stamped onto a feed default country",
        );
      }
    }

    // 3d-1a-i1b) ONE-TIME purge of scraped Google-News SECTION / topic-page
    //     headings that leaked in as incidents — an aggregator feed LABEL, not
    //     a dated event ("Papua New Guinea Massacre News", "<Place> Crime
    //     News"). Feed queries containing a category word (e.g. the PNG
    //     conflict feed's "massacre") make Google return the section label as
    //     an item; it kept re-ingesting with a fresh date, evading the
    //     stale-syndication guard. The ingest classifiers + relevance gates now
    //     reject it (isGenericSectionTitle), but that only stops NEW inserts and
    //     the RELEVANCE_RULE_VERSION backfill only DEMOTES to irrelevant — this
    //     removes the rows already in the table. DELETE (not demote): these are
    //     junk labels, never real incidents. The SQL regex MIRRORS the JS
    //     GENERIC_SECTION_TITLE_RE (anchored end-to-end, optional place prefix,
    //     a category word, then "news"), passed as a BOUND parameter so the
    //     apostrophe in the char class needs no escaping and no backslashes are
    //     required (POSIX [[:space:]] instead of \s). Marker-gated so it runs
    //     once; bump the suffix if the section-title rule widens later.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const SECTION_TITLE_RE =
        "^([a-z][a-z .'&-]*[[:space:]])?(massacre|crime|violence|unrest|conflict|security|breaking|latest|daily|weekly|world|top|trending|headlines?)[[:space:]]+news$";
      const markerKey = "generic_section_title_purge_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          DELETE FROM incidents
          WHERE COALESCE(title, '') ~* ${SECTION_TITLE_RE}
            AND COALESCE(title, '') NOT LIKE '% - %'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time purge of scraped Google-News section-title labels mis-ingested as incidents",
        );
      }
    }

    // 3d-1a-i2) ONE-TIME re-clean of GDELT-promoted incidents against the new
    //     Option-A slop gate. The RELEVANCE_RULE_VERSION backfill deliberately
    //     SKIPS gdelt_cloud:/tapa_offline: rows (the lane/marker already vouched
    //     them), so a rules bump can never re-score these lane-derived rows by
    //     text — which means the new op-ed / metaphor / homonym slop excludes
    //     would NOT otherwise reach the GDELT rows already in the table. This
    //     pass applies hitsSlopExclude (the SAME predicate the promote pass now
    //     runs) to existing gdelt_cloud flashpoint/conflict rows and DEMOTES a
    //     slop hit to relevance='irrelevant' (kept as geography-only context,
    //     hidden from the monitors) — it never deletes. Uses the JS predicate,
    //     not SQL, so parity with the runtime rule is exact. Marker-gated: bump
    //     the marker suffix if the slop rules change again and need re-applying.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "gdelt_cloud_slop_reclean_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const rows = await db
          .select({
            id: incidentsTable.id,
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            source: incidentsTable.source,
            sourceUrl: incidentsTable.sourceUrl,
            location: incidentsTable.location,
          })
          .from(incidentsTable)
          .where(
            and(
              like(incidentsTable.analystNotes, `${PROMOTE_MARKER_PREFIX}%`),
              eq(incidentsTable.relevanceStatus, "relevant"),
              inArray(incidentsTable.topic, ["flashpoint", "conflict"]),
            ),
          );
        let demoted = 0;
        for (const r of rows) {
          const verdict = hitsSlopExclude(r.topic, {
            topic: r.topic,
            title: r.title ?? "",
            summary: r.summary,
            source: r.source,
            sourceUrl: r.sourceUrl,
            location: r.location,
          });
          if (!verdict.relevant) {
            await db
              .update(incidentsTable)
              .set({
                relevanceStatus: "irrelevant",
                relevanceScore: 0,
                relevanceReason: `slop-reclean: ${verdict.reason}`,
                relevanceEvaluatedAt: new Date(),
              })
              .where(eq(incidentsTable.id, r.id));
            demoted++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: rows.length, demoted, marker: markerKey },
          "One-time slop re-clean of GDELT-promoted flashpoint/conflict incidents",
        );
      }
    }

    // 3d-1a-ii) ONE-TIME relocation of vietnam.vn rows mis-tagged Indonesia.
    //     The Vietnamese state portal (source "Vietnam.vn") cross-syndicates
    //     Bahasa world / forest-fire stories into the indonesia_local feed; the
    //     old gate blind-stamped them with the feed defaultCountry='Indonesia',
    //     polluting the client-facing Indonesia brief with Vietnamese and world
    //     news. The ingest now rejects ".vn" sources (OUT_OF_REGION_DOMAIN); this
    //     repairs rows already stored. SOURCE-scoped so a genuine Indonesia story
    //     that merely MENTIONS Vietnam (a different outlet) is never moved. These
    //     are real records, so RELOCATE to 'Vietnam' (a non-reported country, so
    //     they drop out of the Indonesia report) rather than delete. Marker-gated.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "indonesia_vietnam_source_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          UPDATE incidents
          SET country = 'Vietnam'
          WHERE topic = 'indonesia_local'
            AND country = 'Indonesia'
            AND source = 'Vietnam.vn'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time relocation of vietnam.vn rows mis-tagged Indonesia (cross-syndication cleanup)",
        );
      }
    }

    // 3d-1b) ONE-TIME backfill of 'Unknown'-country energy rows.
    //
    //        The region energy feeds (load-shedding / brownout / grid-attack)
    //        search several countries at once and fall back to country='Unknown'
    //        for any headline naming no in-region COUNTRY word — even when it
    //        names a state, city, utility or regulator that unambiguously
    //        identifies the country (Gazipur, K-Electric, NEPRA, NEA, Kerala…).
    //        The gazetteer now recognises those, so the monitor's COUNTRY column
    //        showed "—" for ~130 otherwise-placeable rows. This re-runs the SAME
    //        detectCountry over the already-stored Unknown rows and fills the
    //        country (+ country-centroid coordinates only when the row has none).
    //        Unknown-ONLY: it never overwrites an attributed row, and rows that
    //        still name no place stay 'Unknown' (rendered "—"), which is honest.
    //        Runs AFTER the 3d out-of-region purge so deleted rows are not
    //        re-placed. Marker-gated → runs once.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "energy_unknown_country_backfill_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await runNewsCountryBackfill({ commit: true, topics: ["energy"] });
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            candidates: res.candidates,
            resolved: res.resolved,
            stillUnknown: res.stillUnknown,
            perCountry: res.perCountry,
            marker: markerKey,
          },
          "One-time backfill of Unknown-country energy rows",
        );
      }
    }

    // 3d-2) ONE-TIME purge of out-of-region (UK / Ireland) flashpoint rows.
    //
    //       The Protests & Civil Unrest tracker is scoped to APAC-LOCATED
    //       incidents, but two cross-syndication paths mis-stamped UK events
    //       onto an APAC country: (a) a leaked source masthead — a Belfast riot
    //       from "Japan Today" stamped Japan, the publisher name surviving into
    //       BOTH title and summary so a title-only strip could not catch it; and
    //       (b) diaspora protests that name an APAC country as their SUBJECT
    //       while physically taking place abroad ("Sri Lankan Tamil groups
    //       protest in London", "...Bangladesh High Commission in London").
    //       These are not APAC-located incidents. The ingest classifier now
    //       rejects them at the source (FOREIGN_LOCATION); this clears the rows
    //       already stored. Delete (not relocate) — they belong to no APAC
    //       country report.
    //
    //       Unlike the commodity purge above, this canNOT use an in-region
    //       protective guard: these rows DO legitimately name an in-region
    //       country (Sri Lanka / Bangladesh / Japan) — the defect is the foreign
    //       LOCATION, not a foreign subject. So the predicate keys off the same
    //       two-tier foreign-location signal the ingest guard uses: BARE tokens
    //       with no APAC namesake, plus VENUE-gated cities (preposition + city)
    //       so football-club homonyms ("season with Liverpool") that collide
    //       with sports wires about APAC athletes are NOT swept. Marker-gated.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // Backslashes DOUBLED (\\y) — JS template literal first (see 3d note).
      // Mirrors lib/ingest FOREIGN_LOCATION exactly: bare CITY tokens, plus a
      // venue-preposition-gated tier (with the optional the/central/greater/
      // downtown modifiers the runtime regex allows) for football-club homonyms
      // and actor-reference country/region names.
      const FOREIGN_BARE =
        "belfast|glasgow|edinburgh|cardiff|dublin|londonderry|derry";
      const FOREIGN_VENUE =
        "london|manchester|birmingham|liverpool|leeds|sheffield|bristol|nottingham|newcastle|united kingdom|northern ireland|great britain";
      const markerKey = "flashpoint_out_of_region_uk_purge_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          DELETE FROM incidents
          WHERE topic = 'flashpoint'
            AND (
              (COALESCE(title,'') || ' ' || COALESCE(summary,'')) ~* ('\\y(' || ${FOREIGN_BARE} || ')\\y')
              OR (COALESCE(title,'') || ' ' || COALESCE(summary,'')) ~* ('\\y(in|at|outside|near|across|to)[[:space:]]+(the[[:space:]]+|central[[:space:]]+|greater[[:space:]]+|downtown[[:space:]]+)?(' || ${FOREIGN_VENUE} || ')\\y')
            )
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time purge of out-of-region (UK/Ireland) mis-stamped flashpoint rows",
        );
      }
    }

    // 3d-3) ONE-TIME purge of out-of-region (US / continental-Europe)
    //        flashpoint rows.
    //
    //       Same defect class as 3d-2 (UK/Ireland) for the OTHER big
    //       cross-syndication source: a US "mass rally" (Trump / MAGA) or an
    //       EU domestic protest is topically a political rally — the relevance
    //       lib keeps it on purpose (geography is not its job) — but a leaked
    //       masthead or a passing actor reference ("...against China tariffs")
    //       stamped the row onto an APAC country even though it is physically
    //       in Washington / Berlin / Paris. The ingest classifier now rejects
    //       these (FOREIGN_LOCATION_WEST); this clears rows already stored.
    //       Delete (not relocate) — they belong to no APAC country report.
    //       Mirrors lib/ingest FOREIGN_LOCATION_WEST exactly: BARE distinctive
    //       city tokens, plus a venue-preposition-gated tier (NO "to" — so an
    //       APAC protest that merely appeals to a Western state is untouched).
    //       Marker-gated. Backslashes DOUBLED (\\y) — JS template literal first.
    {
      const FOREIGN_BARE_WEST =
        "los angeles|san francisco|philadelphia|chicago|houston|seattle|minneapolis|frankfurt|hamburg|stuttgart|dusseldorf|rotterdam|marseille";
      const FOREIGN_VENUE_WEST =
        "washington|new york|brooklyn|boston|atlanta|dallas|denver|phoenix|miami|detroit|las vegas|portland|sacramento|california|texas|florida|arizona|georgia|michigan|ohio|pennsylvania|wisconsin|minnesota|nevada|oregon|colorado|united states|america|usa|paris|berlin|madrid|barcelona|rome|milan|naples|munich|cologne|brussels|amsterdam|hague|vienna|warsaw|athens|lisbon|stockholm|copenhagen|oslo|helsinki|budapest|prague|zurich|geneva|france|germany|spain|italy|netherlands|belgium|portugal|greece|poland|austria|sweden|denmark|norway|finland|switzerland";
      const markerKey = "flashpoint_out_of_region_us_eu_purge_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          DELETE FROM incidents
          WHERE topic = 'flashpoint'
            AND (
              (COALESCE(title,'') || ' ' || COALESCE(summary,'')) ~* ('\\y(' || ${FOREIGN_BARE_WEST} || ')\\y')
              OR (COALESCE(title,'') || ' ' || COALESCE(summary,'')) ~* ('\\y(in|at|outside|near|across)[[:space:]]+(the[[:space:]]+|central[[:space:]]+|greater[[:space:]]+|downtown[[:space:]]+)?(' || ${FOREIGN_VENUE_WEST} || ')\\y')
            )
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time purge of out-of-region (US/EU) mis-stamped flashpoint rows",
        );
      }
    }

    // 3d-4) ONE-TIME relocation of masthead-leaked flashpoint rows.
    //
    //       A third cross-syndication defect: when a flashpoint headline names
    //       NO location at all (an overseas "G7 protest turns from carnival to
    //       violent stand-off"), the Google-News source masthead — appended to
    //       both the title and the summary — was the only country signal, so the
    //       publisher's CITY ("The Manila Times" -> Manila) mis-stamped the row
    //       to the publisher's APAC country, which could then be crowned the
    //       highest-severity country. Unlike 3d-2 / 3d-3 there is NO foreign
    //       token to key off, so this re-runs the ingest's now masthead-stripped
    //       country resolution (resolveFlashpointCountry) over every stored
    //       flashpoint row and RELOCATES to country='Unknown' (coords nulled)
    //       any row that now resolves to null — i.e. the masthead was the sole
    //       signal. Relocate (not delete): the protest is real, only its
    //       location is unknowable from the data. Durable across relevance
    //       backfills (they never touch country). Marker-gated → runs once.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "flashpoint_masthead_country_relocate_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await runFlashpointMastheadRelocate({ commit: true });
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            candidates: res.candidates,
            relocated: res.relocated,
            fromCountry: res.fromCountry,
            marker: markerKey,
          },
          "One-time relocation of masthead-leaked flashpoint rows",
        );
      }
    }

    // 3d-5) ONE-TIME re-attribution of Unknown flashpoint rows (inverse of
    //        3d-4). The country resolver's gazetteer gained plural demonyms
    //        ("Malaysians", "Nepalis", "Indonesians", ...). Rows whose ONLY
    //        country signal was such a demonym pre-date that and were stranded at
    //        country='Unknown' (or NULL). This re-runs the IDENTICAL masthead-
    //        stripped resolution over every Unknown/NULL flashpoint row and, where
    //        it now resolves, moves the row to that country (coords stay NULL — the
    //        resolver yields a country, not a point). Only touches Unknown/NULL
    //        rows, so an already-attributed row is never clobbered; durable across
    //        relevance backfills (they never touch country). Marker-gated → once.
    //        Bump the key if the gazetteer gains more demonyms and stranded rows
    //        should be re-swept.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "flashpoint_unknown_reattribute_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await runFlashpointUnknownReattribute({ commit: true });
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            candidates: res.candidates,
            reattributed: res.reattributed,
            toCountry: res.toCountry,
            marker: markerKey,
          },
          "One-time re-attribution of Unknown flashpoint rows (expanded demonym gazetteer)",
        );
      }
    }

    // 3d-6) ONE-TIME targeted removal of a specific misdated PNG massacre row.
    //        A genuine Feb-2024 "64 killed in Papua New Guinea tribal violence"
    //        (Enga/Wapenamanda massacre) resurfaced as a CURRENT Extreme incident
    //        because Google News re-syndicated the old article with a fresh 2026
    //        publish date and ingest copied that date verbatim into occurred_at.
    //        The stored row's summary merely repeats the title with NO explicit
    //        in-text date, so the general stale-syndication guard/backfill below
    //        cannot catch it. The DURABLE fix is the ingest-layer
    //        `isKnownStaleSyndication` skip (structuredExtract) that stops the
    //        scraper re-storing it; a one-time delete alone lost against
    //        re-ingestion, which is why the row kept reappearing. This delete now
    //        only clears any copy already stored, keyed on title + source.
    //        Scoped to auto-scraped rows only, so an analyst-edited row is never
    //        removed. Marker bumped to v2 (date clause dropped) to clear the
    //        re-ingested copy.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "delete_misdated_png_massacre_v2";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          DELETE FROM incidents
          WHERE title = '64 killed in Papua New Guinea tribal violence - The Eastleigh Voice'
            AND source = 'Google News — Papua New Guinea (Crime & Security)'
            AND analyst_notes LIKE 'auto-scraped:%'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { deleted: res.rowCount ?? 0, marker: markerKey },
          "One-time removal of misdated re-syndicated PNG massacre incident",
        );
      }
    }

    // 3d-7) ONE-TIME stale-syndication backfill over stored auto-scraped rows.
    //        Applies the SAME guard the ingest now enforces (detectStaleEventDate)
    //        to already-stored incidents: a row whose own text/headline carries an
    //        explicit day-month-YEAR date substantially older than its reported
    //        occurred_at is re-syndicated old news re-published with a fresh feed
    //        date, so it is removed (mirrors the ingest skip). Strict
    //        no-fabrication: acts ONLY on an explicit in-text date, and ONLY on
    //        auto-scraped rows (analyst_notes LIKE 'auto-scraped:%'), so
    //        analyst-edited rows are never touched. Marker-gated → runs once. Bump
    //        the key if the guard logic changes and stored rows should be re-swept.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "stale_syndication_backfill_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const rows = await db.execute(sql`
          SELECT id, title, summary, occurred_at
          FROM incidents
          WHERE analyst_notes LIKE 'auto-scraped:%'
        `);
        const staleIds: number[] = [];
        for (const r of rows.rows as Array<{
          id: number;
          title: string | null;
          summary: string | null;
          occurred_at: Date | string;
        }>) {
          const reported = new Date(r.occurred_at);
          const text = `${r.title ?? ""} ${r.summary ?? ""}`;
          if (detectStaleEventDate(text, reported)) staleIds.push(r.id);
        }
        if (staleIds.length > 0) {
          await db.execute(sql`
            DELETE FROM incidents
            WHERE ${inArray(incidentsTable.id, staleIds)}
              AND analyst_notes LIKE 'auto-scraped:%'
          `);
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: rows.rows.length, deleted: staleIds.length, marker: markerKey },
          "One-time stale-syndication backfill over stored auto-scraped incidents",
        );
      }
    }

    // 3e) ONE-TIME reclassification of stored strike columns.
    //
    //     The Missile Strike Tracker dashboard derives Target / Weapon /
    //     Casualties from the DB columns FIRST, falling back to text only when a
    //     column is "unknown" / null. Historical rows were classified by an
    //     earlier, narrower ruleset (trailing-\b stem traps that dropped refinery
    //     / petrochemical / energy targets; no interception->0 casualty rule), so
    //     they sat as "unknown" and pushed several charts past the >50% "mostly
    //     unattributed" caveat threshold. Re-run the SAME classifier the live
    //     scraper now uses over each row's stored summary, filling only genuine
    //     non-unknown improvements (never overwriting an analyst value or an
    //     existing casualty count). Marker-gated so it runs once per deploy
    //     generation; bump the key if the classifier changes materially and
    //     historical rows should be re-swept.
    //
    //     v2 broadens scope from auto-scraped-only to ALL rows so hand-entered
    //     SEED rows (the SAMREF / Mina al-Ahmadi refinery and Aluminium Bahrain /
    //     EGA smelter strikes, recorded as unknown/unknown before the rulebook
    //     learned those terms) also get their blank columns filled — fill-only-
    //     when-blank still protects any deliberately chosen analyst value.
    //
    //     v3 re-sweeps after the rulebook's VESSEL_TARGET_FRAME gained the
    //     ship/tanker/vessel "seized / sunk / boarded / disabled / redirected"
    //     framing (added with the role-aware vessel work AFTER v2 had already
    //     run in prod). Several genuine vessel events — "One ship seized, another
    //     sunk", "Ship seized off coast of UAE", "Ship seized near Hormuz"
    //     (prod ids 159/160/176/182/183) — were left stuck at target_category
    //     'unknown' because the classifier at v2-time did not recognise that
    //     wording. The classifier now returns 'vessel' for them; this fill-only-
    //     when-blank re-run picks them up without touching any non-blank value.
    //
    //     v4 re-sweeps after VESSEL_TARGET_FRAME learned PASSIVE vessel framing
    //     ("ship was seized", "vessel has been sunk", "tankers have been
    //     boarded"), plural nouns ("ships were sunk"), and the follow-on clause
    //     "another sunk / seized / boarded" when a vessel noun appears earlier in
    //     the sentence. Rows whose only attack wording was passive were still
    //     landing in 'unknown'; the fill-only-when-blank re-run recovers them.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "strikes_reclassify_columns_v4";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        try {
          const summary = await runStrikesBackfill({ commit: true });
          await db.execute(sql`
            INSERT INTO app_migration_markers (key) VALUES (${markerKey})
            ON CONFLICT (key) DO NOTHING
          `);
          logger.info(
            {
              scanned: summary.scanned,
              targetFilled: summary.targetFilled,
              infraFilled: summary.infraFilled,
              casualtiesFilled: summary.casualtiesFilled,
              marker: markerKey,
            },
            "One-time reclassification of auto-scraped strike columns",
          );
        } catch (strikeErr) {
          logger.error({ err: strikeErr }, "Strike column reclassification failed");
        }
      }
    }

    // 3f) ONE-TIME correction of two manually-reviewed mis-stored strike rows.
    //
    //     The fill-only-when-blank backfill (3e) deliberately never overwrites a
    //     target_category that is already set, to protect analyst-entered values.
    //     A manual review of every strike row whose stored target_category
    //     disagrees with the @workspace/strike-targets rulebook found that the
    //     vast majority are CORRECTLY stored and the rulebook would make them
    //     WORSE — it cannot tell attacker from target ("US Central Command" /
    //     "CENTCOM" is the striker, not a military target), aircraft from ship
    //     ("KC-135 tankers" are refuelling AIRCRAFT, not vessels), or responder
    //     from target ("HMS Lancaster first to respond" is not the thing hit).
    //     A blanket rulebook overwrite is therefore UNSAFE and is intentionally
    //     NOT applied.
    //
    //     Exactly two rows are genuine mis-stores and are corrected here by hand:
    //       - "UAE energy infrastructure as gas field set ablaze, tanker struck"
    //         leads with the energy target; it was stored as a vessel. Both the
    //         stored infrastructure (oil_gas) and the rulebook agree it is energy.
    //         vessel -> energy_infrastructure.
    //       - "HMS Lancaster first to respond after ... drone attack on tanker"
    //         was stored as military_site off the responding frigate's name; the
    //         struck TANKER is the target. military_site -> vessel.
    //
    //     Matched by distinctive summary text AND the specific wrong stored value
    //     so the UPDATE is idempotent (it cannot re-fire once corrected) and can
    //     never touch a correctly-stored row. Marker-gated like the blocks above.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "strikes_mis_stored_target_correct_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const energyFix = await db.execute(sql`
          UPDATE strikes
          SET target_category = 'energy_infrastructure'
          WHERE summary ILIKE '%UAE energy infrastructure as gas field set ablaze%'
            AND target_category = 'vessel'
        `);
        const vesselFix = await db.execute(sql`
          UPDATE strikes
          SET target_category = 'vessel'
          WHERE summary ILIKE '%HMS Lancaster%'
            AND summary ILIKE '%tanker%'
            AND target_category = 'military_site'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            energyFix: energyFix.rowCount ?? 0,
            vesselFix: vesselFix.rowCount ?? 0,
            marker: markerKey,
          },
          "One-time correction of manually-reviewed mis-stored strike target_category rows",
        );
      }
    }

    // 3g) ONE-TIME correction of four more manually-reviewed mis-stored rows.
    //
    //     The role-aware classifier fix (attacker / responder / aircraft vs the
    //     struck target — see @workspace/strike-targets) only changes FUTURE
    //     auto-scraped rows; it is deliberately never blanket re-run over stored
    //     data (the blank-only backfill in 3e protects analyst values, and a
    //     blanket rulebook overwrite is UNSAFE because the stored value is right
    //     far more often than not). A fresh read-only review of every prod strike
    //     whose stored target_category disagrees with the now role-aware rulebook
    //     found four genuine role-confusion mis-stores left from the OLD ruleset,
    //     all of the same shape: a US force / CENTCOM named as the ATTACKER was
    //     scored as a military target, when the thing actually struck is the ship
    //     or tanker. The role-aware rulebook now agrees these are vessels:
    //       - "US military fires missile on ... merchant vessel M/V Lian Star ..."
    //       - "US military says it boarded, redirected Iranian-flagged oil tanker"
    //       - "US military fires missile to disable ship in Gulf of Oman, CENTCOM ..."
    //       - "US forces fire Hellfire missile to disable ship trying to break ..."
    //     All four were stored military_site -> corrected to vessel.
    //
    //     Rows correctly stored despite a rulebook disagreement are LEFT ALONE
    //     (the rulebook is the one that is wrong there): radar bases the rulebook
    //     reads "civilian_area" off the word "housing"; an oil tanker the rulebook
    //     reads "energy_infrastructure" off the destination "Kharg Island".
    //
    //     Matched by distinctive summary text AND the specific wrong stored value
    //     (military_site) so each UPDATE is idempotent and can never touch a row
    //     that is already vessel or a correctly-stored military target. New marker
    //     key so it runs once even though 3f's marker is already applied elsewhere.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "strikes_mis_stored_target_correct_v2";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const lianStarFix = await db.execute(sql`
          UPDATE strikes
          SET target_category = 'vessel'
          WHERE summary ILIKE '%M/V Lian Star%'
            AND target_category = 'military_site'
        `);
        const redirectedTankerFix = await db.execute(sql`
          UPDATE strikes
          SET target_category = 'vessel'
          WHERE summary ILIKE '%boarded, redirected Iranian-flagged oil tanker%'
            AND target_category = 'military_site'
        `);
        const disableShipFix = await db.execute(sql`
          UPDATE strikes
          SET target_category = 'vessel'
          WHERE summary ILIKE '%fires missile to disable ship in Gulf of Oman%'
            AND target_category = 'military_site'
        `);
        const blockadeFix = await db.execute(sql`
          UPDATE strikes
          SET target_category = 'vessel'
          WHERE summary ILIKE '%Hellfire missile to disable ship trying to break its blockade%'
            AND target_category = 'military_site'
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            lianStarFix: lianStarFix.rowCount ?? 0,
            redirectedTankerFix: redirectedTankerFix.rowCount ?? 0,
            disableShipFix: disableShipFix.rowCount ?? 0,
            blockadeFix: blockadeFix.rowCount ?? 0,
            marker: markerKey,
          },
          "One-time correction of manually-reviewed attacker-as-target mis-stored strike rows",
        );
      }
    }

    // 3h) ONE-TIME downgrade of reaction / advocacy headlines mis-rated High/Extreme.
    //
    //     The civil-unrest / conflict severity classifier historically fired the
    //     reserved Extreme/High tiers off casualty words ("slain", "killed") even
    //     when the headline is an ADVOCACY / STATEMENT item that merely REFERENCES
    //     a past event — e.g. "<group> demands ban ... seeks justice for six slain
    //     Nagas". classifySeverity now guards this (isReactionLed / REACTION_LEAD_RE
    //     in @workspace/ingest), so NEW rows rate correctly, but the scrapers'
    //     read-then-insert dedupe never re-touches a stored row, so existing
    //     mis-rated rows keep their old chip.
    //
    //     This pass re-rates ONLY auto-scraped flashpoint/conflict rows that are
    //     (a) currently High/Extreme AND (b) reaction-led, setting each to the
    //     current reaction-guarded classifySeverity result — and ONLY when that is
    //     strictly LOWER than the stored tier (downgrade-only; it can never
    //     escalate). The reaction-led gate keeps it from touching rows that merely
    //     differ from the current classifier for unrelated reasons, so it cannot
    //     alter analyst severities, other topics, or correctly-rated fresh-attack
    //     rows. Marker-gated → runs once per environment.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "severity_reaction_downgrade_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const candidates = await db
          .select({
            id: incidentsTable.id,
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            severity: incidentsTable.severity,
            fatalities: incidentsTable.fatalities,
          })
          .from(incidentsTable)
          .where(
            and(
              inArray(incidentsTable.topic, ["flashpoint", "conflict"]),
              inArray(incidentsTable.severity, ["high", "extreme"]),
              like(incidentsTable.analystNotes, "auto-scraped:%"),
            ),
          );
        let changed = 0;
        for (const r of candidates) {
          if (!isReactionLed(r.title)) continue;
          const topic = r.topic === "conflict" ? "conflict" : "flashpoint";
          // Never downgrade below the floor implied by a structured GDELT
          // fatality count — a confirmed-fatality row stays Extreme even if its
          // headline reads as a reaction, mirroring runSeverityBackfill.
          const fromText = classifySeverity(r.title, r.summary ?? "", topic);
          const floor = severityFromFatalities(r.fatalities);
          const next = floor ? maxSeverity(fromText, floor) : fromText;
          if (SEVERITY_RANK[next] < SEVERITY_RANK[r.severity as Severity]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            changed++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: candidates.length, changed, marker: markerKey },
          "One-time downgrade of reaction-led mis-rated incident severities",
        );
      }
    }

    // 3g-2) One-time UPGRADE of incidents the classifier historically
    //       UNDER-rated because the EXTREME tier matched only past-tense
    //       casualty verbs ("killed") while news writes fatal attacks in the
    //       present tense ("airstrike kills seven civilians"), and the conflict
    //       HIGH tier matched only singular "airstrike" — so "Junta airstrikes
    //       kill 8 civilians" fell all the way to low while a security op that
    //       "killed" one militant read Extreme. classifySeverity now covers the
    //       present-tense fatal verb + plural strike forms, so NEW rows rate
    //       correctly, but stored auto-scraped rows keep their old chip.
    //
    //       This pass re-rates ONLY auto-scraped / legacy flashpoint / conflict
    //       / strikes rows (the legacy incidents.topic='strikes' rows share the
    //       generic Incidents list with conflict, so a fatal Myanmar airstrike
    //       must not read moderate there while extreme on the conflict monitor;
    //       the Missile Strike Tracker reads a SEPARATE strikesTable and is
    //       untouched). Two tightly-scoped corrections, both gated on a narrow
    //       predicate so the pass can never sweep up rows that differ from the
    //       classifier for unrelated historical reasons:
    //         (a) UPGRADE — rows escalated specifically by THIS change
    //             (isPresentTenseFatalOrPluralStrike: "airstrikes kill 8
    //             civilians", "airstrike … killing father and son"), set to the
    //             current classifySeverity result ONLY when strictly higher.
    //         (b) DOWNGRADE — natural / accidental deaths (isNaturalCauseDeath:
    //             "Lightning Strike Kills 14", "earthquake … 32 dead") that are
    //             NOT security events, set to the classifier result ONLY when
    //             strictly lower, so they vacate the reserved Extreme tier.
    //       Both directions skip analyst-curated rows (machine provenance only)
    //       and never touch other topics. Marker-gated → runs once per env.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "severity_present_tense_fatal_upgrade_v9";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const candidates = await db
          .select({
            id: incidentsTable.id,
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            severity: incidentsTable.severity,
            fatalities: incidentsTable.fatalities,
          })
          .from(incidentsTable)
          .where(
            and(
              inArray(incidentsTable.topic, ["flashpoint", "conflict", "strikes"]),
              // Machine-provenance rows only — auto-scraped feed rows AND legacy
              // bulk imports (legacy:db:%). Both are classifier-assigned, never
              // analyst-curated, so a re-rate cannot clobber a human severity.
              or(
                like(incidentsTable.analystNotes, "auto-scraped:%"),
                like(incidentsTable.analystNotes, "legacy:db:%"),
              ),
            ),
          );
        let upgraded = 0;
        let downgraded = 0;
        for (const r of candidates) {
          const isUpgradeCandidate =
            isPresentTenseFatalOrPluralStrike(r.title, r.summary ?? "") ||
            isFatalKineticAttack(r.title, r.summary ?? "");
          const isDowngradeCandidate =
            isNaturalCauseDeath(r.title, r.summary ?? "") ||
            isJudicialDeath(r.title, r.summary ?? "");
          if (!isUpgradeCandidate && !isDowngradeCandidate) continue;
          const topic = r.topic === "conflict" || r.topic === "strikes" ? "conflict" : "flashpoint";
          const fromText = classifySeverity(r.title, r.summary ?? "", topic);
          const floor = severityFromFatalities(r.fatalities);
          const next = floor ? maxSeverity(fromText, floor) : fromText;
          const stored = r.severity as Severity;
          if (isUpgradeCandidate && !isDowngradeCandidate && SEVERITY_RANK[next] > SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            upgraded++;
          } else if (isDowngradeCandidate && SEVERITY_RANK[next] < SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            downgraded++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: candidates.length, upgraded, downgraded, marker: markerKey },
          "One-time severity heal: present-tense fatal upgrade + natural-cause downgrade",
        );
      }
    }

    // 3g-3) One-time heal for two classifier corrections shipped together, each
    //       direction gated on the narrow predicate for exactly this change so
    //       the pass never sweeps unrelated rows:
    //         (a) UPGRADE — Bahasa-language incidents the English-only classifier
    //             could not read, so a real shooting ("Pelajar … ditembak saat
    //             operasi militer" — a student shot during a military operation)
    //             collapsed to LOW. classifySeverity now carries Indonesian
    //             violence/fatal markers, so NEW rows rate correctly while stored
    //             machine rows keep the stale LOW chip (hasIndonesianViolenceSignal).
    //         (b) DOWNGRADE — illness / biographical deaths (Covid, obituary,
    //             "the death of his father") the bare-death EXTREME regex wrongly
    //             rated EXTREME (reported case: an entertainer's Father's Day
    //             concert piece). isBiographicalOrIllnessDeath now suppresses
    //             these, so stored rows must vacate the reserved tier.
    //       Machine-provenance flashpoint/conflict/strikes rows only, never below
    //       a structured fatality floor, only when strictly stronger/weaker.
    //       Marker-gated → runs once per environment.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "severity_intl_violence_and_bio_death_heal_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const candidates = await db
          .select({
            id: incidentsTable.id,
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            severity: incidentsTable.severity,
            fatalities: incidentsTable.fatalities,
          })
          .from(incidentsTable)
          .where(
            and(
              inArray(incidentsTable.topic, ["flashpoint", "conflict", "strikes"]),
              or(
                like(incidentsTable.analystNotes, "auto-scraped:%"),
                like(incidentsTable.analystNotes, "legacy:db:%"),
              ),
            ),
          );
        let upgraded = 0;
        let downgraded = 0;
        for (const r of candidates) {
          const isUpgradeCandidate = hasIndonesianViolenceSignal(r.title, r.summary ?? "");
          const isDowngradeCandidate = isBiographicalOrIllnessDeath(r.title, r.summary ?? "");
          if (!isUpgradeCandidate && !isDowngradeCandidate) continue;
          const topic = r.topic === "conflict" || r.topic === "strikes" ? "conflict" : "flashpoint";
          const fromText = classifySeverity(r.title, r.summary ?? "", topic);
          const floor = severityFromFatalities(r.fatalities);
          const next = floor ? maxSeverity(fromText, floor) : fromText;
          const stored = r.severity as Severity;
          if (isUpgradeCandidate && !isDowngradeCandidate && SEVERITY_RANK[next] > SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            upgraded++;
          } else if (isDowngradeCandidate && SEVERITY_RANK[next] < SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            downgraded++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: candidates.length, upgraded, downgraded, marker: markerKey },
          "One-time severity heal: Bahasa violence upgrade + illness/biographical death downgrade",
        );
      }
    }

    // 3g-3b) One-time UPGRADE of machine rows the classifier historically
    //       UNDER-rated to LOW because a CONFIRMED KILLING carried no signal the
    //       old rules could read:
    //         (a) a Bahasa fatal term ("tembak mati" — shot dead, "dibunuh" —
    //             murdered) was defined but never wired into the HIGH tier, so a
    //             single Indonesian killing collapsed to LOW.
    //         (b) an English killing in victim→verb order with no separate
    //             security actor / weapon ("American Pilot Killed in Papua",
    //             "Catholic teacher shot dead") matched no HIGH keyword.
    //         (c) a bare "tewas" (died / killed) in a Bahasa security context
    //             ("Operasi Militer di Intan Jaya, Gembala GKII Tewas" — a pastor
    //             killed during a military operation) — bare "tewas" alone is a
    //             disaster-toll homonym, so it only escalates alongside a military
    //             operation / named armed group / security service.
    //       classifySeverity now floors all three at HIGH, but the scrapers'
    //       read-then-insert dedupe never re-touches a stored row, so existing
    //       machine rows keep their stale LOW chip (reported case: fatal West
    //       Papua events reading Low in the country brief).
    //
    //       This pass re-rates ONLY auto-scraped / legacy rows that match the
    //       narrow confirmed-killing predicate for exactly this change, setting
    //       each to the current classifySeverity result (never below a structured
    //       fatality floor) and ONLY when strictly higher (upgrade-only). GDELT
    //       lane-derived rows (analyst_notes gdelt_cloud:%) are deliberately
    //       EXCLUDED — their severity is owned by the GDELT layer, not text. The
    //       predicate gate keeps it from touching rows that differ from the
    //       classifier for unrelated reasons; it never alters analyst severities
    //       or DOWNGRADES anything. Marker-gated → runs once per environment.
    {
      const markerKey = "severity_confirmed_killing_heal_v2";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const candidates = await db
          .select({
            id: incidentsTable.id,
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            severity: incidentsTable.severity,
            fatalities: incidentsTable.fatalities,
          })
          .from(incidentsTable)
          .where(
            and(
              inArray(incidentsTable.topic, [
                "flashpoint",
                "conflict",
                "strikes",
                "indonesia_local",
                "apac_local",
              ]),
              or(
                like(incidentsTable.analystNotes, "auto-scraped:%"),
                like(incidentsTable.analystNotes, "legacy:db:%"),
              ),
            ),
          );
        let upgraded = 0;
        for (const r of candidates) {
          if (!hasConfirmedKillingSignal(r.title, r.summary ?? "")) continue;
          const topic =
            r.topic === "conflict" || r.topic === "strikes"
              ? "conflict"
              : r.topic === "indonesia_local"
                ? "indonesia_local"
                : r.topic === "apac_local"
                  ? "apac_local"
                  : "flashpoint";
          const fromText = classifySeverity(r.title, r.summary ?? "", topic);
          const floor = severityFromFatalities(r.fatalities);
          const next = floor ? maxSeverity(fromText, floor) : fromText;
          const stored = r.severity as Severity;
          if (SEVERITY_RANK[next] > SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            upgraded++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: candidates.length, upgraded, marker: markerKey },
          "One-time severity heal: confirmed-killing upgrade (Bahasa fatal + victim→verb English + tewas-in-security-context)",
        );
      }
    }

    // 3f-2) One-time UPGRADE of rows carrying a MASS-CASUALTY toll the pre-heal
    //       classifier under-rated. The reserved Extreme tier floors an English
    //       mass toll ("32 killed", "kills 28"), but there was NO Bahasa mirror:
    //       a bare "tewas" toll is homonym-gated (requires a security context),
    //       so an Indonesian-language mass-casualty headline — reported case: a
    //       Bangkok bar fire, "Korban Tewas ... Jadi 32 Orang" on
    //       indonesia_local — collapsed to LOW. classifySeverity now floors a
    //       Bahasa mass "tewas" toll at Extreme (ID_MASS_TOLL_RE), but the
    //       scrapers' read-then-insert dedupe never re-touches a stored row, so
    //       existing machine rows keep the stale chip.
    //
    //       This pass re-rates ONLY auto-scraped / legacy rows that match the
    //       narrow mass-casualty-toll predicate for exactly this change, setting
    //       each to the current classifySeverity result (never below a structured
    //       fatality floor) and ONLY when strictly higher (upgrade-only). The
    //       predicate gate keeps it from touching rows that differ from the
    //       classifier for unrelated reasons; it never alters analyst severities
    //       or DOWNGRADES anything. Marker-gated → runs once per environment.
    {
      const markerKey = "severity_mass_casualty_toll_heal_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const candidates = await db
          .select({
            id: incidentsTable.id,
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            severity: incidentsTable.severity,
            fatalities: incidentsTable.fatalities,
          })
          .from(incidentsTable)
          .where(
            and(
              inArray(incidentsTable.topic, [
                "flashpoint",
                "conflict",
                "strikes",
                "indonesia_local",
                "apac_local",
              ]),
              or(
                like(incidentsTable.analystNotes, "auto-scraped:%"),
                like(incidentsTable.analystNotes, "legacy:db:%"),
              ),
            ),
          );
        let upgraded = 0;
        for (const r of candidates) {
          if (!hasMassCasualtyToll(r.title, r.summary ?? "")) continue;
          const topic =
            r.topic === "conflict" || r.topic === "strikes"
              ? "conflict"
              : r.topic === "indonesia_local"
                ? "indonesia_local"
                : r.topic === "apac_local"
                  ? "apac_local"
                  : "flashpoint";
          const fromText = classifySeverity(r.title, r.summary ?? "", topic);
          const floor = severityFromFatalities(r.fatalities);
          const next = floor ? maxSeverity(fromText, floor) : fromText;
          const stored = r.severity as Severity;
          if (SEVERITY_RANK[next] > SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            upgraded++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: candidates.length, upgraded, marker: markerKey },
          "One-time severity heal: mass-casualty toll upgrade (Bahasa tewas toll + English mass toll)",
        );
      }
    }

    // 3g-4) One-time UPGRADE of shipping rows the classifier historically
    //       UNDER-rated because the shipping HIGH tier matched only WEAPON NOUNS
    //       (missile / drone / explosion / struck), so a plain "tanker attack" /
    //       "attack on vessel" / "US strikes Iran after tanker attack" carried no
    //       HIGH signal and fell all the way to the INSIGNIFICANT / low default —
    //       even reading Insignificant when the headline also used forward-looking
    //       framing. classifySeverity now escalates an attack VERB bound to a
    //       vessel / port OBJECT (isMaritimeVesselAttack), so NEW rows rate
    //       correctly, but the scrapers' read-then-insert dedupe never re-touches
    //       a stored row, so existing machine rows keep their old chip.
    //
    //       This pass re-rates ONLY auto-scraped / legacy shipping rows that match
    //       the narrow maritime-attack predicate for exactly this change, setting
    //       each to the current classifySeverity result (never below a structured
    //       fatality floor) and ONLY when strictly higher (upgrade-only). The
    //       predicate gate keeps it from touching rows that differ from the
    //       classifier for unrelated reasons; it never alters analyst severities
    //       or other topics. Marker-gated → runs once per environment.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "severity_maritime_attack_upgrade_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const candidates = await db
          .select({
            id: incidentsTable.id,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            severity: incidentsTable.severity,
            fatalities: incidentsTable.fatalities,
          })
          .from(incidentsTable)
          .where(
            and(
              eq(incidentsTable.topic, "shipping"),
              or(
                like(incidentsTable.analystNotes, "auto-scraped:%"),
                like(incidentsTable.analystNotes, "legacy:db:%"),
              ),
            ),
          );
        let upgraded = 0;
        for (const r of candidates) {
          if (!isMaritimeVesselAttack(r.title, r.summary ?? "")) continue;
          const fromText = classifySeverity(r.title, r.summary ?? "", "shipping");
          const floor = severityFromFatalities(r.fatalities);
          const next = floor ? maxSeverity(fromText, floor) : fromText;
          const stored = r.severity as Severity;
          if (SEVERITY_RANK[next] > SEVERITY_RANK[stored]) {
            await db
              .update(incidentsTable)
              .set({ severity: next })
              .where(eq(incidentsTable.id, r.id));
            upgraded++;
          }
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned: candidates.length, upgraded, marker: markerKey },
          "One-time severity heal: maritime vessel/port attack upgrade (shipping)",
        );
      }
    }

    // 3h) Delete a specific advocacy/demand headline the analyst removed
    //     repeatedly — not a security incident. Marker-gated so it runs once
    //     per environment (prod is writable only in the deployment runtime).
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "delete_zeliangrong_advocacy_incident_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const deleted = await db
          .delete(incidentsTable)
          .where(
            and(
              eq(
                incidentsTable.title,
                "Zeliangrong Intellectual Group Demands Ban on Kuki Militant Groups, Seeks Justice for Six Slain Nagas",
              ),
              like(incidentsTable.analystNotes, "auto-scraped:%"),
            ),
          );
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { deleted: deleted.rowCount ?? 0, marker: markerKey },
          "One-time deletion of advocacy/demand headline (not an incident)",
        );
      }
    }

    // 3i) Delete another PR/political headline the analyst removed — not a
    //     security incident. Marker-gated, runs once per environment.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "delete_nia_punjab_property_incident_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const deleted = await db
          .delete(incidentsTable)
          .where(
            and(
              like(incidentsTable.title, "%NIA Seizes Punjab Property%"),
              like(incidentsTable.analystNotes, "auto-scraped:%"),
            ),
          );
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { deleted: deleted.rowCount ?? 0, marker: markerKey },
          "One-time deletion of PR/political headline (not an incident)",
        );
      }
    }

    // 3z) Seed the structured country-report rows that the workbench renders
    //     as full nine-section briefs (Indonesia national + Jakarta city),
    //     alongside the pre-existing PNG / West Papua pair. These rows must
    //     exist before the baseline loop below, which resolves each baseline
    //     to a country report by case-insensitive name match. Idempotent:
    //     insert only when the slug is missing, so an analyst rename / edit
    //     is never overwritten on restart, and the rows are re-created if
    //     ever deleted. Reaches the read-only prod DB via the deployment boot.
    const STRUCTURED_COUNTRY_REPORTS: Array<{
      slug: string;
      name: string;
      region: string;
    }> = [
      { slug: "indonesia", name: "Indonesia", region: "APAC" },
      { slug: "thailand", name: "Thailand", region: "APAC" },
      { slug: "philippines", name: "Philippines", region: "APAC" },
      { slug: "jakarta", name: "Jakarta", region: "APAC" },
    ];
    for (const seed of STRUCTURED_COUNTRY_REPORTS) {
      try {
        const [existing] = await db
          .select({ id: countryReportsTable.id })
          .from(countryReportsTable)
          .where(eq(countryReportsTable.slug, seed.slug));
        if (existing) continue;
        await db
          .insert(countryReportsTable)
          .values({ slug: seed.slug, name: seed.name, region: seed.region })
          .onConflictDoNothing({ target: countryReportsTable.slug });
        logger.info({ slug: seed.slug }, "Seeded structured country report");
      } catch (crErr) {
        logger.error({ err: crErr, slug: seed.slug }, "Failed to seed structured country report");
      }
    }

    // 4) Seed country baselines once. Maps each seed to a country
    //    report by case-insensitive name match. Skips any seed whose
    //    target slug already has a baseline so editor edits are never
    //    overwritten on restart.
    try {
      const countries = await db
        .select({ slug: countryReportsTable.slug, name: countryReportsTable.name })
        .from(countryReportsTable);
      const byName = new Map<string, string>();
      for (const c of countries) byName.set(c.name.trim().toLowerCase(), c.slug);

      for (const seed of COUNTRY_BASELINE_SEEDS) {
        let slug: string | undefined;
        for (const n of seed.countryNames) {
          const hit = byName.get(n.trim().toLowerCase());
          if (hit) { slug = hit; break; }
        }
        if (!slug) {
          logger.info({ names: seed.countryNames }, "baseline seed: no country report found, skipping");
          continue;
        }
        const [existing] = await db
          .select({ id: countryBaselinesTable.id })
          .from(countryBaselinesTable)
          .where(eq(countryBaselinesTable.slug, slug));
        if (existing) continue;
        await db.insert(countryBaselinesTable).values({
          slug,
          operatingEnvironment: seed.operatingEnvironment,
          securityContext: seed.securityContext,
          knownRiskAreas: seed.knownRiskAreas,
          keyCitiesProvinces: seed.keyCitiesProvinces,
          movementConstraints: seed.movementConstraints,
          infrastructureLimits: seed.infrastructureLimits,
          medicalEvac: seed.medicalEvac,
          resourceSectorExposure: seed.resourceSectorExposure,
          locationWatchlist: seed.locationWatchlist,
        });
        logger.info({ slug }, "Seeded country baseline");
      }
    } catch (baseErr) {
      logger.error({ err: baseErr }, "Country baseline seed failed");
    }

    // 5) Flashpoint topic-pollution cleanup. Idempotent: each pass operates
    //    on a narrow predicate, so re-running is a no-op once the rows are
    //    out of the flashpoint / protests bucket.
    //
    //    Source: attached_assets/flashpoint_data_coverage_audit.md.
    //    Audit found that 252 of 687 records under topic in (flashpoint,
    //    protests) were either kinetic armed-conflict, cargo-theft Google
    //    News records misrouted to protests, syndicated UAE drone-strike
    //    duplicates, or country-baseline watchlist rows surfacing as live
    //    incidents. Reassign to the correct topic where one fits, delete
    //    where the row never belonged in incidents at all, and de-duplicate
    //    by source_url so one syndicated story does not become 50 rows.
    try {
      const uae = await db.execute(sql`
        UPDATE incidents SET topic = 'strikes'
        WHERE topic IN ('flashpoint', 'protests')
          AND source = 'UAE Air-Defense / Missile Activity (Google News)'
      `);
      if (uae.rowCount && uae.rowCount > 0) {
        logger.info({ rows: uae.rowCount }, "flashpoint cleanup: moved UAE air-defense records to strikes");
      }

      const cargo = await db.execute(sql`
        UPDATE incidents SET topic = 'cargo_watch'
        WHERE topic IN ('flashpoint', 'protests')
          AND (
            source ~* '(cargo theft|truck.*theft|freight.*theft|trucking & transport|tobacco.*cargo|truck hijack)'
          )
      `);
      if (cargo.rowCount && cargo.rowCount > 0) {
        logger.info({ rows: cargo.rowCount }, "flashpoint cleanup: moved cargo-theft Google News records to cargo_watch");
      }

      // Kinetic armed conflict without a protest cue → strikes topic.
      // Mirrors the kineticHit / protestCue logic in
      // artifacts/workbench/src/lib/incidentClassifier.ts:127-135 so
      // upstream (this migration) and downstream (the report classifier)
      // agree on what counts as armed conflict vs public order.
      const kinetic = await db.execute(sql`
        UPDATE incidents SET topic = 'strikes'
        WHERE topic IN ('flashpoint', 'protests')
          AND (title || ' ' || summary) ~* '(drone[- ]?strike|missile[- ]?strike|air[- ]?strike|airstrike|gun battle|gunbattle|\yied\y|bomb (attack|blast|kills|detonat)|suicide bomb|car bomb|gunmen (kill|attack)|militants? (kill|attack|target|ambush|raid|strike|fire)|insurgents? (kill|attack|target|ambush)|terror(ist)? attack|armed group (attack|kill|raid)|terrorists? killed|security forces? kill|wanted (commander|terrorist|ringleader)|quadcopter)'
          AND (title || ' ' || summary) !~* '(protest|demonstration|rally|march|sit[- ]?in|riot|crackdown|curfew|tear[- ]?gas|water cannon|baton charge|student union|opposition (call|rally|march)|\ypti\y|imran khan|section ?144|assembly ban|detention of (protesters|activists|students))'
      `);
      if (kinetic.rowCount && kinetic.rowCount > 0) {
        logger.info({ rows: kinetic.rowCount }, "flashpoint cleanup: moved kinetic armed-conflict records to strikes");
      }

      // Legacy operational-risk-zone seed rows: location watchlist
      // entries inserted as incidents. Belong in country_baselines, not
      // here. Delete.
      const baselineLeak = await db.execute(sql`
        DELETE FROM incidents
        WHERE analyst_notes LIKE 'legacy:db:operational_risk_zones%'
      `);
      if (baselineLeak.rowCount && baselineLeak.rowCount > 0) {
        logger.info({ rows: baselineLeak.rowCount }, "flashpoint cleanup: deleted operational-risk-zone watchlist rows");
      }

      // De-duplicate by source_url (one syndicated story should never
      // become 10+ incidents). Keep the lowest id per URL.
      const deduped = await db.execute(sql`
        DELETE FROM incidents a USING incidents b
        WHERE a.source_url = b.source_url
          AND a.source_url IS NOT NULL
          AND a.source_url <> ''
          AND a.id > b.id
      `);
      if (deduped.rowCount && deduped.rowCount > 0) {
        logger.info({ rows: deduped.rowCount }, "flashpoint cleanup: removed duplicate-by-source_url rows");
      }
    } catch (cleanupErr) {
      logger.error({ err: cleanupErr }, "flashpoint cleanup migration failed");
    }

    // 6) Seed missing regional flashpoint sources. Idempotent on `name`.
    try {
      for (const seed of FLASHPOINT_REGIONAL_SOURCES) {
        const [existing] = await db
          .select({ id: sourcesTable.id })
          .from(sourcesTable)
          .where(eq(sourcesTable.name, seed.name));
        if (existing) continue;
        await db.insert(sourcesTable).values({
          name: seed.name,
          topic: "flashpoint",
          sourceType: seed.sourceType,
          url: seed.url,
          status: "operational",
          reliability: seed.reliability,
          manualReviewRequired: false,
          notes: seed.notes,
        });
        logger.info({ name: seed.name }, "Seeded flashpoint regional source");
      }
      await repairFlashpointSeedUrls();
      await repairSourceHealthDashboardNoise();
    } catch (srcErr) {
      logger.error({ err: srcErr }, "Flashpoint regional source seed failed");
    }

    // 6b) Retire two genuinely-defunct flashpoint outlets. Prachatai's English
    //     section is dead (only the Thai feed still serves, which the
    //     English-only flashpoint classifier cannot read; Thailand unrest is
    //     already covered by the Thailand civil-unrest aggregator + Khaosod) and
    //     the CIVICUS Monitor api endpoint is dormant and not indexed by Google
    //     News, so neither can be repaired to a live feed. Removed from the seed
    //     array above and deleted here so no permanently-green dead row remains.
    //     Marker-gated: a source legitimately re-added later with the same name
    //     is never re-deleted.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "retired_dead_flashpoint_outlets_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const RETIRED_FLASHPOINT_SOURCES = ["Prachatai English", "CIVICUS Monitor"];
        const res = await db
          .delete(sourcesTable)
          .where(
            sql`${sourcesTable.topic} = 'flashpoint' AND ${inArray(sourcesTable.name, RETIRED_FLASHPOINT_SOURCES)}`,
          );
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "Retired dead flashpoint outlets (English section / api endpoint defunct, unrepairable)",
        );
      }
    } catch (retireErr) {
      logger.error({ err: retireErr }, "Flashpoint dead-outlet retirement failed");
    }

    // 6c) Retire three flashpoint outlets that FETCH successfully but return zero
    //     items — Benar News (direct RSS + every Google-News site-scope query
    //     yields nothing from our egress IP), Loop PNG (no reachable feed, empty
    //     site-scope) and TVWAN News (no standalone site; name-anchored query is
    //     sports/telecom noise, no in-scope security items). A zero-item fetch is
    //     not an error, so each read permanently "operational" (green) — the same
    //     masking pattern the hard-failure telemetry fixed, but for empty feeds.
    //     None can be repaired to a URL that yields in-scope items, and their
    //     coverage is already carried by other seeded feeds, so they are removed
    //     from the seed array above and deleted here. Marker-gated so a source
    //     legitimately re-added later with the same name is never re-deleted.
    try {
      const emptyMarkerKey = "retired_empty_flashpoint_outlets_v1";
      const existingEmptyMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${emptyMarkerKey}
      `);
      if ((existingEmptyMarker.rowCount ?? 0) === 0) {
        const RETIRED_EMPTY_FLASHPOINT_SOURCES = ["Benar News", "Loop PNG", "TVWAN News"];
        const res = await db
          .delete(sourcesTable)
          .where(
            sql`${sourcesTable.topic} = 'flashpoint' AND ${inArray(sourcesTable.name, RETIRED_EMPTY_FLASHPOINT_SOURCES)}`,
          );
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${emptyMarkerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: emptyMarkerKey },
          "Retired empty flashpoint outlets (fetch OK but zero in-scope items, unrepairable)",
        );
      }
    } catch (retireEmptyErr) {
      logger.error({ err: retireEmptyErr }, "Flashpoint empty-outlet retirement failed");
    }

    // 7) One-time removal of dead placeholder (never-monitored) source rows.
    //    These were seed-only catalogue entries that never had a live feed, so
    //    the Source Health page showed them permanently red/green without ever
    //    polling anything. The topic ingests now register the REAL Google-News
    //    / market feeds they genuinely poll (recordSourceHealth), so these are
    //    misleading and removed. Deleted BY NAME ONLY — none of these names
    //    collide with a real (live) feed, and at least one placeholder
    //    ("FAO Fertilizer Outlook") was mis-filed under topic 'flashpoint' in
    //    prod, so a topic-scoped delete would have stranded it. Marker-gated:
    //    a source legitimately re-added later with the same name is never
    //    re-deleted.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "dead_placeholder_sources_removed_v2";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const DEAD_PLACEHOLDER_SOURCES = [
          // cargo_watch
          "BSI Supply Chain Risk", "TAPA Incident Reports", "TT Club Cargo Theft",
          // energy
          "GCC Grid Operators", "IEA Real-time Power",
          // fertiliser (FAO row is mis-filed under flashpoint in prod)
          "FAO Fertilizer Outlook", "ICIS Fertilizer Daily",
          // fuel
          "Reuters Energy Wire", "S&P Global Platts",
          // protests
          "ACLED Conflict Data", "GDELT 2.0", "Local APAC Stringer Network",
          // shipping
          "JMSDF Press Releases", "Lloyd's List Intelligence", "Maritime Executive", "UKMTO Advisories",
        ];
        const res = await db
          .delete(sourcesTable)
          .where(inArray(sourcesTable.name, DEAD_PLACEHOLDER_SOURCES));
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "Removed dead placeholder source rows (real feeds now self-register via ingest)",
        );
      }
    } catch (delErr) {
      logger.error({ err: delErr }, "Dead placeholder source removal failed");
    }

    // 7b) One-time removal of orphaned jet-fuel Source Health rows left behind
    //     by a past source rename. The live jet feed now self-registers as
    //     "EIA U.S. Gulf Coast jet fuel (FRED DJFUELUSGULF)" (marketPrices.ts)
    //     and reads operational, but two earlier-named rows are never written
    //     by any current code, so they sit frozen at an old date and make the
    //     fuel feed list look stale. Deleted BY EXACT NAME ONLY — neither name
    //     collides with a live feed the current code writes. Marker-gated: a
    //     source legitimately re-added later with the same name is never
    //     re-deleted on a future boot.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "orphaned_jet_fuel_sources_removed_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const ORPHANED_JET_FUEL_SOURCES = [
          "US Gulf Coast Jet Fuel (EIA / FRED)",
          "NY Harbor ULSD jet proxy (Yahoo HO=F / FRED fallback)",
        ];
        const res = await db
          .delete(sourcesTable)
          .where(inArray(sourcesTable.name, ORPHANED_JET_FUEL_SOURCES));
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "Removed orphaned jet-fuel source rows (renamed feed self-registers under new name)",
        );
      }
    } catch (delErr) {
      logger.error({ err: delErr }, "Orphaned jet-fuel source removal failed");
    }

    // Card builder: seed the four built-in card templates and ensure the
    // singleton brand-settings row exists. Marker-gated so an analyst who later
    // edits a built-in's defaults is never overwritten on the next boot.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "card_builder_builtins_seeded_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const BUILT_IN_TEMPLATES: Array<{
          name: string;
          templateKey: string;
          content: CardContent;
        }> = [
          {
            name: "Country Risk Snapshot",
            templateKey: "country_risk",
            content: {
              topic: "Country Risk",
              rating: "moderate",
              keyPoints: ["", "", ""],
              outlook: "",
            },
          },
          {
            name: "Protest & Disruption Update",
            templateKey: "protest_disruption",
            content: {
              topic: "Protests & Civil Unrest",
              rating: "high",
              keyPoints: ["", "", ""],
              outlook: "",
            },
          },
          {
            name: "Incident Update",
            templateKey: "incident_update",
            content: {
              topic: "Incident",
              rating: "moderate",
              keyPoints: ["", "", ""],
              outlook: "",
            },
          },
          {
            name: "Market Entry Snapshot",
            templateKey: "market_entry",
            content: {
              topic: "Market Entry",
              rating: "low",
              keyPoints: ["", "", ""],
              outlook: "",
            },
          },
        ];
        for (const t of BUILT_IN_TEMPLATES) {
          await db.insert(cardTemplatesTable).values({
            name: t.name,
            templateKey: t.templateKey,
            isBuiltIn: true,
            content: t.content,
          });
        }
        await db
          .insert(brandSettingsTable)
          .values({ id: 1 } as InsertBrandSettings)
          .onConflictDoNothing();
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { count: BUILT_IN_TEMPLATES.length, marker: markerKey },
          "Seeded built-in card templates and brand settings",
        );
      }
    } catch (cardErr) {
      logger.error({ err: cardErr }, "Card builder seed failed");
    }

    // ONE-TIME backfill of the newly-added APAC civil-unrest feeds.
    //
    //   Production only ever ran a single boot ingest, which captured just the
    //   current ~14-day Google News window, and the New Zealand feed fetch
    //   failed transiently in that one run (it landed zero rows). Google News
    //   "when:14d" cannot re-fetch the older articles dev accumulated, so the
    //   only reliable way to bring prod to parity for Australia / New Zealand /
    //   South Korea / Malaysia / West Papua is to copy the exact verified
    //   relevant rows across rather than re-pull the feeds and hope. Inserts
    //   only rows not already present, deduped by source_url or
    //   (topic+title+occurred_at) — identical to the admin backfill route — so
    //   it is idempotent and safe to re-run. Marker-gated → runs once per env.
    //   Seeded rows carry the current relevance version + verdict so the
    //   relevance backfill below leaves them untouched.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "apac_flashpoint_backfill_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        let inserted = 0;
        let skipped = 0;
        for (const rec of APAC_FLASHPOINT_BACKFILL) {
          const occurredAt = new Date(rec.occurredAt);
          if (Number.isNaN(occurredAt.getTime())) {
            skipped++;
            continue;
          }
          // A record counts as already present if EITHER its source URL matches
          // an existing row OR the (topic, title, occurred_at) natural key does
          // — the same dual-key dedup the admin backfill route uses, so a row
          // the live feed already landed in prod is never duplicated.
          const naturalKey = and(
            eq(incidentsTable.topic, rec.topic),
            eq(incidentsTable.title, rec.title),
            eq(incidentsTable.occurredAt, occurredAt),
          );
          const matchCondition = rec.sourceUrl
            ? or(eq(incidentsTable.sourceUrl, rec.sourceUrl), naturalKey)
            : naturalKey;
          const existing = await db
            .select({ id: incidentsTable.id })
            .from(incidentsTable)
            .where(matchCondition)
            .limit(1);
          if (existing.length > 0) {
            skipped++;
            continue;
          }
          await db.insert(incidentsTable).values({
            topic: rec.topic,
            title: rec.title,
            displayTitle: rec.displayTitle,
            summary: rec.summary,
            country: rec.country,
            location: rec.location,
            latitude: rec.latitude,
            longitude: rec.longitude,
            occurredAt,
            severity: rec.severity,
            confidence: rec.confidence,
            source: rec.source,
            sourceUrl: rec.sourceUrl,
            resolvedUrl: rec.resolvedUrl,
            relevanceStatus: rec.relevanceStatus,
            relevanceScore: rec.relevanceScore,
            relevanceReason: rec.relevanceReason,
            relevanceVersion: RELEVANCE_RULE_VERSION,
            relevanceEvaluatedAt: new Date(),
          });
          inserted++;
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { inserted, skipped, marker: markerKey },
          "One-time backfill of APAC civil-unrest flashpoint rows (Australia / New Zealand / South Korea / Malaysia / West Papua)",
        );
      }
    } catch (apacErr) {
      logger.error({ err: apacErr }, "APAC flashpoint backfill failed");
    }

    // ONE-TIME backfill of the PNG per-incident structured extraction.
    //
    //   The four PNG columns (province / category / business_impact /
    //   incident_date) are populated at INGEST only for FLASHPOINT rows
    //   (lib/ingest flashpoint via extractPngItem + derivePngIncidentDate), but
    //   the PNG country brief aggregates EVERY topic tagged to Papua New Guinea
    //   (protests, conflict, cargo_watch, fuel, …). So non-flashpoint PNG rows —
    //   and every flashpoint PNG row ingested before those columns shipped — read
    //   null. This pass re-applies the IDENTICAL extraction to ALL rows whose
    //   country tag includes Papua New Guinea (any topic), so the report reads
    //   these fields straight from the API instead of recomputing them client-
    //   side. The extraction is a pure, deterministic function of each row's
    //   existing title/summary/location/occurredAt, so it is idempotent and can
    //   never invent data, and it is PNG-SCOPED so it never leaks onto any
    //   non-PNG country. Marker-gated → runs once per environment; each bump
    //   (v1 flashpoint-only → v2 broadened scope → v3 crime-vocab reclassify)
    //   re-runs the current rulebook over every PNG row, so an additive
    //   CATEGORY_RULES change reclassifies stored rows (e.g. "killing(s)" /
    //   SARV / GBV that used to fall into "Other security"). Reaches the writable prod DB only
    //   after a republish (the deployment runtime is the only writable-prod
    //   context); new PNG rows thereafter are kept filled by the live-ingest
    //   onlyNull enrichment pass in runIngestOnce.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "png_extract_backfill_v4";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const summary = await runPngExtractBackfill({ commit: true });
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            candidates: summary.candidates,
            updated: summary.updated,
            provinceFilled: summary.provinceFilled,
            incidentDateFilled: summary.incidentDateFilled,
            marker: markerKey,
          },
          "One-time backfill of PNG per-incident structured extraction (province / category / business_impact / incident_date)",
        );
      }
    } catch (pngErr) {
      logger.error({ err: pngErr }, "PNG extraction backfill failed");
    }

    // ---- One-time West Papua structured-extraction backfill --------------
    //   Mirrors the PNG backfill above for the Indonesian West Papua theatre
    //   (slug `papua`). Fills province / category / business_impact /
    //   incident_date on historical West-Papua-attributed rows so the Papua
    //   country brief reaches PNG parity. The backfill scope EXCLUDES
    //   cross-border PNG rows (those keep their PNG enrichment), so the two
    //   theatres never overwrite each other. Reaches the writable prod DB only
    //   after a republish (the deployment runtime is the only writable-prod
    //   context); new West-Papua rows thereafter are kept filled by the
    //   live-ingest onlyNull enrichment pass in runIngestOnce.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "west_papua_structured_extract_backfill_v3";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const summary = await runWestPapuaExtractBackfill({ commit: true });
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            candidates: summary.candidates,
            updated: summary.updated,
            provinceFilled: summary.provinceFilled,
            incidentDateFilled: summary.incidentDateFilled,
            marker: markerKey,
          },
          "One-time backfill of West Papua per-incident structured extraction (province / category / business_impact / incident_date)",
        );
      }
    } catch (wpErr) {
      logger.error({ err: wpErr }, "West Papua extraction backfill failed");
    }

    // 3j) ONE-TIME re-home of stranded West Papua / Papua legacy "protests" rows.
    //
    //     `protests` is a DEAD legacy topic: no feed writes it and the
    //     "Protests & Civil Unrest" monitor reads the `flashpoint` topic, so
    //     every topic='protests' row is invisible to the product. The migrated
    //     `legacy:db:regional_incidents` seed filed genuine West Papua armed-
    //     conflict events (TPNPB ambushes, the Tembagapura mining-area shooting,
    //     firefights, IED finds) AND genuine protests under it — and because the
    //     protests bucket is scored under the flashpoint public-order rule, the
    //     armed-conflict rows were marked irrelevant and dropped everywhere
    //     ("seeing nothing from the Freeport mining area"). Re-home each
    //     Papua-province row to the topic whose rule actually keeps it: conflict
    //     first (armed violence), else flashpoint (civil unrest), re-rating
    //     relevance with the shared engine so the verdict matches the new topic.
    //     Rows neither rule keeps (petty crime / labour disputes) are left on the
    //     inert protests bucket — moving them would mis-file them under a live
    //     topic while still hidden. Single-token country='Papua' is normalised to
    //     the canonical 'West Papua'. Marker-gated → runs once per environment
    //     (prod is writable only in the deployment runtime). Placed before
    //     backfillRelevance so the final relevance pass is a no-op for these.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "west_papua_legacy_protests_rehome_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        // COUNTRY_GROUPS['papua'] tokens (workbench countryMatch.ts) — the
        // Indonesian Papua provinces. Pure 'Papua New Guinea' / 'PNG' are
        // deliberately absent so this never touches the PNG theatre; a cross-
        // border 'West Papua; Papua New Guinea' row IS eligible (it carries a
        // Papua token) and is left cross-border.
        const PAPUA_TOKENS = new Set([
          "papua",
          "west papua",
          "papua barat",
          "highland papua",
          "papua pegunungan",
          "central papua",
          "papua tengah",
          "south papua",
          "papua selatan",
          "southwest papua",
          "papua barat daya",
        ]);
        const isPapuaSlice = (country: string | null): boolean =>
          (country ?? "")
            .split(";")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .some((t) => PAPUA_TOKENS.has(t));

        const candidates = await db
          .select({
            id: incidentsTable.id,
            country: incidentsTable.country,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            source: incidentsTable.source,
            sourceUrl: incidentsTable.sourceUrl,
            location: incidentsTable.location,
            occurredAt: incidentsTable.occurredAt,
          })
          .from(incidentsTable)
          .where(
            and(
              eq(incidentsTable.topic, "protests"),
              like(incidentsTable.analystNotes, "legacy:db:regional_incidents%"),
            ),
          );

        // Duplicate guard: never create a second copy of a row that already
        // lives on a target topic. Key on non-empty source_url, and on
        // (normalised title + calendar day) for seed rows without a URL.
        const existingTargets = await db
          .select({
            topic: incidentsTable.topic,
            title: incidentsTable.title,
            sourceUrl: incidentsTable.sourceUrl,
            occurredAt: incidentsTable.occurredAt,
          })
          .from(incidentsTable)
          .where(inArray(incidentsTable.topic, ["conflict", "flashpoint"]));
        const dayKey = (d: Date | null): string =>
          d ? new Date(d).toISOString().slice(0, 10) : "";
        const urlKeys = new Set<string>();
        const titleDayKeys = new Set<string>();
        for (const e of existingTargets) {
          if (e.sourceUrl) urlKeys.add(`${e.topic}\u0000${e.sourceUrl}`);
          titleDayKeys.add(
            `${e.topic}\u0000${(e.title ?? "").trim().toLowerCase()}\u0000${dayKey(e.occurredAt)}`,
          );
        }

        const now = new Date();
        let toConflict = 0;
        let toFlashpoint = 0;
        let skippedDup = 0;
        let leftInert = 0;
        for (const r of candidates) {
          if (!isPapuaSlice(r.country)) continue;
          const base = {
            title: r.title,
            summary: r.summary ?? "",
            source: r.source ?? "",
            sourceUrl: r.sourceUrl ?? "",
            location: r.location ?? null,
          };
          let target: "conflict" | "flashpoint" | null = null;
          let verdict = evaluateIncidentRelevance("conflict", {
            topic: "conflict",
            ...base,
          });
          if (verdict.relevant) {
            target = "conflict";
          } else {
            const flashpointVerdict = evaluateIncidentRelevance("flashpoint", {
              topic: "flashpoint",
              ...base,
            });
            if (flashpointVerdict.relevant) {
              target = "flashpoint";
              verdict = flashpointVerdict;
            }
          }
          // Neither rule keeps it (petty crime / labour dispute) — leave on the
          // inert protests bucket rather than mis-file it under a live topic.
          if (!target) {
            leftInert++;
            continue;
          }

          const titleDay = `${target}\u0000${(r.title ?? "").trim().toLowerCase()}\u0000${dayKey(r.occurredAt)}`;
          const isDup =
            (r.sourceUrl !== null &&
              r.sourceUrl !== "" &&
              urlKeys.has(`${target}\u0000${r.sourceUrl}`)) ||
            titleDayKeys.has(titleDay);
          if (isDup) {
            skippedDup++;
            continue;
          }

          const normalisedCountry =
            (r.country ?? "").trim().toLowerCase() === "papua"
              ? "West Papua"
              : r.country;
          await db
            .update(incidentsTable)
            .set({
              topic: target,
              country: normalisedCountry,
              relevanceStatus: verdict.status,
              relevanceScore: verdict.score,
              relevanceReason: verdict.reason,
              relevanceVersion: verdict.version,
              relevanceEvaluatedAt: now,
            })
            .where(eq(incidentsTable.id, r.id));
          // Record this just-moved row so a later duplicate candidate in the
          // same batch is caught by the guard above (the pre-loop snapshot only
          // saw rows already on the target topics).
          if (r.sourceUrl) urlKeys.add(`${target}\u0000${r.sourceUrl}`);
          titleDayKeys.add(titleDay);
          if (target === "conflict") toConflict++;
          else toFlashpoint++;
        }
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { toConflict, toFlashpoint, skippedDup, leftInert, marker: markerKey },
          "One-time re-home of stranded West Papua/Papua legacy protests rows to conflict/flashpoint",
        );
      }
    } catch (rehomeErr) {
      logger.error(
        { err: rehomeErr },
        "West Papua legacy protests re-home failed",
      );
    }

    // One-time re-rate of stored severity onto the CURRENT classifySeverity for
    // machine-provenance rows. Severity is otherwise written once at ingest, so
    // a classifier change (reserving Extreme for mass casualties; confirmed
    // killing => High) never reached historical rows — leaving routine single-
    // fatality items stuck on a stale Extreme. Marker-gated so it runs once per
    // rule revision (bump the key to re-run); the admin route runs it on demand
    // regardless, which is the reliable path on CPU-throttled autoscale boots.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "severity_rerate_2026_07_14_v2_judicial_emergency";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await backfillSeverity();
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { marker: markerKey, ...res },
          "One-time severity re-rate of machine-provenance incidents",
        );
      }
    } catch (sevErr) {
      logger.error({ err: sevErr }, "Severity re-rate failed");
    }

    // NOTE: an earlier boot migration (`delete_telegram_social_watch_v1`) purged
    // Telegram social-watch rows when the automated Telegram scraper was retired.
    // Telegram is now re-enabled as a MANUAL-ENTRY-ONLY platform (analyst paste,
    // no scraper), so that purge has been removed — manual Telegram rows are
    // legitimate CONTEXT and must survive redeploys. Its marker is left in place
    // (harmless) for environments where it already ran.

    // One-time re-attribution of the GLOBAL commodity topics (energy / fuel /
    // fertiliser). Runs BEFORE backfillRelevance so out-of-region rows are on
    // the correct country centroid before they are re-scored relevant. Rows
    // stored under a region feed's defaultCountry (e.g. a Spanish grid blackout
    // tagged Myanmar) are re-stamped to the country their headline actually
    // names + moved onto that country's centroid, preserving world-map/table
    // parity. Idempotent (self-terminating: detected === stored after a run),
    // but marker-gated so it only scans the whole table once per deploy.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "global_country_reattribution_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await runGlobalCountryReattribution({
          commit: true,
          topics: ["energy", "fuel", "fertiliser"],
        });
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            marker: markerKey,
            scanned: res.scanned,
            restamped: res.restamped,
            fromUnknown: res.fromUnknown,
            fromMisstamp: res.fromMisstamp,
            perCountry: res.perCountry,
          },
          "One-time global country re-attribution (energy/fuel/fertiliser)",
        );
      }
    } catch (reErr) {
      logger.error({ err: reErr }, "Global country re-attribution failed");
    }

    // 3d-1z) ONE-TIME purge of falsely-promoted social OSINT incidents.
    //   The social promote pass (runSocialPromote) runs inside the deployment
    //   runtime against the writable PROD DB, so prod may hold falsely-promoted
    //   `social_raw:%` incidents minted BEFORE the corroboration gate was
    //   tightened (a same-day PR / greeting post "corroborated" an unrelated
    //   earthquake / seminar on incidental token overlap). Prod is read-only
    //   from the workspace, so it can only be cleaned inside the runtime. This
    //   mirrors the one-off DEV cleanup: re-derive each already-promoted
    //   `social_raw` row under the CURRENT gate (decideSocialPromotion) and, for
    //   any row that no longer qualifies, DELETE the minted incident and reset
    //   the source back-link to context-only. The candidate pool EXCLUDES
    //   social-promoted incidents so a fake can never corroborate a fake.
    //   Marker-gated + idempotent (re-running is a no-op once applied).
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "social_promote_false_incident_purge_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        // Every incident minted by the social promote pass (marker social_raw:<id>).
        const promotedIncidents = await db
          .select({
            id: incidentsTable.id,
            analystNotes: incidentsTable.analystNotes,
          })
          .from(incidentsTable)
          .where(
            like(incidentsTable.analystNotes, `${SOCIAL_PROMOTE_MARKER_PREFIX}%`),
          );

        // Candidate pool: every incident EXCEPT the social-promoted ones,
        // grouped by country (the corroboration/duplicate scorers gate on
        // same-country). Excluding social-promoted rows is the crux — it ensures
        // a fake incident can never "corroborate" another fake during re-derive.
        const candidateRows = await db
          .select({
            id: incidentsTable.id,
            title: incidentsTable.title,
            summary: incidentsTable.summary,
            country: incidentsTable.country,
            province: incidentsTable.province,
            category: incidentsTable.category,
            occurredAt: incidentsTable.occurredAt,
            incidentDate: incidentsTable.incidentDate,
          })
          .from(incidentsTable)
          .where(
            not(
              like(incidentsTable.analystNotes, `${SOCIAL_PROMOTE_MARKER_PREFIX}%`),
            ),
          );

        const byCountry = new Map<string, IncidentCandidate[]>();
        for (const inc of candidateRows) {
          const key = inc.country.trim().toLowerCase();
          let bucket = byCountry.get(key);
          if (!bucket) {
            bucket = [];
            byCountry.set(key, bucket);
          }
          bucket.push({
            id: inc.id,
            title: inc.title,
            summary: inc.summary,
            country: inc.country,
            province: inc.province,
            category: inc.category,
            occurredAt: inc.occurredAt,
            incidentDate: inc.incidentDate,
          });
        }

        let scanned = 0;
        let deleted = 0;
        let missingSource = 0;
        for (const inc of promotedIncidents) {
          const sid = markerSocialRawId(inc.analystNotes);
          if (sid === null) continue;
          scanned++;
          const [item] = await db
            .select()
            .from(socialRawTable)
            .where(eq(socialRawTable.id, sid));
          // Source row gone — leave the incident untouched rather than guess.
          if (!item) {
            missingSource++;
            continue;
          }
          const key = item.country.trim().toLowerCase();
          const candidates = byCountry.get(key) ?? [];
          const decision = decideSocialPromotion(item, candidates);
          if (decision.promote) continue;
          // No longer qualifies under the tightened gate: delete the incident
          // and reset the source row back to context-only, atomically.
          await db.transaction(async (tx) => {
            await tx
              .delete(incidentsTable)
              .where(eq(incidentsTable.id, inc.id));
            await tx
              .update(socialRawTable)
              .set({
                promotedIncidentId: null,
                promotedAt: null,
                reviewStatus: "pending_review",
                updatedAt: new Date(),
              })
              .where(eq(socialRawTable.id, sid));
          });
          deleted++;
        }

        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { scanned, deleted, missingSource, marker: markerKey },
          "One-time purge of falsely-promoted social OSINT incidents",
        );
      }
    } catch (spErr) {
      logger.error({ err: spErr }, "Social false-incident purge failed");
    }

    try {
      await backfillRelevance();
    } catch (relErr) {
      logger.error({ err: relErr }, "Relevance backfill failed");
    }

    // 7c) Repair dashboard source-health noise: Kathmandu Post malformed direct
    //     RSS (switch to Google-News site-scope like other South Asia desks);
    //     relabel CENTCOM/UKMTO rows stuck at "failing" for datacenter 403s to
    //     "pending" (awaiting production network validation, not an outage).
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "dashboard_source_health_noise_repair_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const kathmanduGoogleNewsUrl =
          "https://news.google.com/rss/search?q=site:kathmandupost.com+(protest+OR+rally+OR+demonstration+OR+strike+OR+unrest+OR+riot+OR+clash+OR+police+OR+arrest+OR+march)+when:14d&hl=en-NP&gl=NP&ceid=NP:en";
        const kathmandu = await db
          .update(sourcesTable)
          .set({
            url: kathmanduGoogleNewsUrl,
            status: "operational",
            errorMessage: null,
            consecutiveFailures: 0,
            lastFailureAt: null,
            failureReason: null,
          })
          .where(
            and(
              eq(sourcesTable.topic, "flashpoint"),
              eq(sourcesTable.name, "The Kathmandu Post"),
            ),
          );
        const m15 = await db
          .update(sourcesTable)
          .set({
            status: "pending",
            consecutiveFailures: 0,
            failureReason: "blocked_upstream",
          })
          .where(
            and(
              eq(sourcesTable.topic, "official_military_maritime"),
              sql`${sourcesTable.name} in ('CENTCOM Press Releases', 'UKMTO Official Products')`,
              sql`${sourcesTable.status} in ('failing', 'blocked')`,
              sql`(
                ${sourcesTable.errorMessage} ilike '%403%'
                or ${sourcesTable.failureReason} = 'blocked_upstream'
              )`,
            ),
          );
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          {
            kathmanduRows: kathmandu.rowCount ?? 0,
            m15Rows: m15.rowCount ?? 0,
            marker: markerKey,
          },
          "Repaired dashboard source-health noise (Kathmandu Post feed + M1.5 403 relabel)",
        );
      }
    } catch (repairErr) {
      logger.error({ err: repairErr }, "Dashboard source-health noise repair failed");
    }

    logger.info("runDataMigrations: finished");
  } catch (err) {
    logger.error({ err }, "Data migration failed (continuing startup)");
  }
}

/**
 * Evaluate every incident whose stored relevance version is null or stale
 * against the shared @workspace/relevance engine and persist the verdict.
 * Runs on boot (dev + prod); re-runs only the rows that need it, so it is a
 * no-op once the DB is current. Bumping RELEVANCE_RULE_VERSION re-cleans the
 * whole table on the next boot. The API default-filter then hides the rows
 * marked 'irrelevant' across every read surface.
 */
export async function backfillRelevance(): Promise<{
  updated: number;
  version: string;
}> {
  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      source: incidentsTable.source,
      sourceUrl: incidentsTable.sourceUrl,
      location: incidentsTable.location,
    })
    .from(incidentsTable)
    .where(
      and(
        or(
          isNull(incidentsTable.relevanceVersion),
          ne(incidentsTable.relevanceVersion, RELEVANCE_RULE_VERSION),
        ),
        // NEVER re-score promoted rows through the text relevance engine.
        // GDELT-promoted rows have relevance fixed by GDELT's own lane coding
        // (see gdeltPromote): Crime/Transport are deliberately stored
        // 'irrelevant' (geography-only context), Protests/Security 'relevant'.
        // TAPA-promoted rows (offline cargo-crime import) are stored 'relevant'
        // by their own structured coding. The text rules know nothing about
        // either, so a routine RELEVANCE_RULE_VERSION bump would otherwise flip
        // these verdicts and destroy the promote semantics. NULL notes (the vast
        // majority of rows) still evaluate normally.
        or(
          isNull(incidentsTable.analystNotes),
          and(
            not(like(incidentsTable.analystNotes, `${PROMOTE_MARKER_PREFIX}%`)),
            not(like(incidentsTable.analystNotes, `${TAPA_PROMOTE_MARKER_PREFIX}%`)),
          ),
        ),
      ),
    );

  if (rows.length === 0) {
    logger.info("backfillRelevance: nothing to evaluate (DB current)");
    return { updated: 0, version: RELEVANCE_RULE_VERSION };
  }

  const now = new Date();
  const perTopic = new Map<string, { relevant: number; irrelevant: number }>();

  // Evaluate every stale row in memory first (pure CPU, no I/O), tallying per
  // topic as we go.
  const writes = rows.map((r) => {
    const v = evaluateIncidentRelevance(r.topic, {
      topic: r.topic,
      title: r.title,
      summary: r.summary ?? "",
      source: r.source ?? "",
      sourceUrl: r.sourceUrl ?? "",
      location: r.location ?? null,
    });
    const bucket = perTopic.get(r.topic) ?? { relevant: 0, irrelevant: 0 };
    if (v.relevant) bucket.relevant++;
    else bucket.irrelevant++;
    perTopic.set(r.topic, bucket);
    return { id: r.id, v };
  });

  // Write in POOL-BOUNDED concurrency chunks. The previous fully-sequential
  // loop (one awaited UPDATE per row) took minutes for ~10k rows — long enough
  // that the autoscale (cloudrun) instance was torn down mid-backfill, leaving
  // most rows on the OLD rule version (so off-scope incidents stayed flagged
  // relevant). Chunked Promise.all completes the same work in seconds. The
  // shared pg Pool defaults to max:10 connections; we cap the chunk at 8 so the
  // backfill can never monopolise the pool and starve concurrent request
  // handlers while this runs post-listen at boot. It still finishes inside the
  // cold-start warm window AND inside a single admin-trigger request.
  const CHUNK = 8;
  let updated = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((w) =>
        db
          .update(incidentsTable)
          .set({
            relevanceStatus: w.v.status,
            relevanceScore: w.v.score,
            relevanceReason: w.v.reason,
            relevanceVersion: w.v.version,
            relevanceEvaluatedAt: now,
          })
          .where(eq(incidentsTable.id, w.id)),
      ),
    );
    updated += chunk.length;
  }

  logger.info(
    { updated, version: RELEVANCE_RULE_VERSION, perTopic: Object.fromEntries(perTopic) },
    "backfillRelevance: evaluated rows",
  );
  return { updated, version: RELEVANCE_RULE_VERSION };
}

// Topics whose incidents are content-rated by classifySeverity. Legacy
// `protests` rows are rated with the flashpoint ruleset (the protests monitor
// resolves to the flashpoint data topic). Any topic not listed here is left
// untouched by the re-rate.
const SEVERITY_RERATE_TOPIC: Record<
  string,
  Parameters<typeof classifySeverity>[2]
> = {
  flashpoint: "flashpoint",
  protests: "flashpoint",
  conflict: "conflict",
  cargo_watch: "cargo_watch",
  shipping: "shipping",
  energy: "energy",
  fertiliser: "fertiliser",
  fuel: "fuel",
};

/**
 * Re-rate stored incident severity against the CURRENT classifySeverity, scoped
 * to MACHINE-PROVENANCE rows only (auto-scraped / legacy:db) so analyst-curated
 * severities are never overwritten. Severity is written once at ingest time and
 * is otherwise only touched by narrow one-time heals, so a classifier change —
 * e.g. reserving Extreme for genuine mass-casualty events, and wiring
 * confirmed-killing => High — does NOT reach historical rows on its own. That is
 * why the monitors kept showing routine single-fatality "encounter" items as
 * Extreme (stale stored value) while the live classifier already rated them
 * correctly. This brings the whole machine-rated backlog onto the current rules.
 *
 * Mirrors backfillRelevance: pure-CPU evaluation first, then POOL-BOUNDED chunked
 * writes; idempotent and safe to re-run (a row already on the current tier is
 * skipped, so a second pass updates nothing). The structured GDELT fatality floor
 * (severityFromFatalities) is still applied via maxSeverity, so a confirmed
 * mass-casualty count can never be downgraded below what the toll implies.
 */
export async function backfillSeverity(): Promise<{
  scanned: number;
  updated: number;
  upgraded: number;
  downgraded: number;
  perTopic: Record<string, { upgraded: number; downgraded: number }>;
}> {
  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      severity: incidentsTable.severity,
      fatalities: incidentsTable.fatalities,
    })
    .from(incidentsTable)
    .where(
      or(
        like(incidentsTable.analystNotes, "auto-scraped:%"),
        like(incidentsTable.analystNotes, "legacy:db:%"),
      ),
    );

  if (rows.length === 0) {
    logger.info("backfillSeverity: no machine-provenance rows to evaluate");
    return { scanned: 0, updated: 0, upgraded: 0, downgraded: 0, perTopic: {} };
  }

  const perTopic = new Map<string, { upgraded: number; downgraded: number }>();
  const writes = rows.flatMap((r) => {
    const st = SEVERITY_RERATE_TOPIC[r.topic];
    if (!st) return [];
    const fromText = classifySeverity(r.title, r.summary ?? "", st);
    const floor = severityFromFatalities(r.fatalities);
    const next = floor ? maxSeverity(fromText, floor) : fromText;
    if (next === r.severity) return [];
    const prevRank = SEVERITY_RANK[r.severity as Severity];
    const bucket = perTopic.get(r.topic) ?? { upgraded: 0, downgraded: 0 };
    if (prevRank === undefined || SEVERITY_RANK[next] > prevRank) bucket.upgraded++;
    else bucket.downgraded++;
    perTopic.set(r.topic, bucket);
    return [{ id: r.id, next }];
  });

  // POOL-BOUNDED chunked writes (same rationale as backfillRelevance: a fully
  // sequential per-row UPDATE took minutes for ~10k rows and could be torn down
  // mid-run on autoscale; the shared pg Pool is max:10 so cap the chunk at 8).
  const CHUNK = 8;
  let updated = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((w) =>
        db
          .update(incidentsTable)
          .set({ severity: w.next })
          .where(eq(incidentsTable.id, w.id)),
      ),
    );
    updated += chunk.length;
  }

  let upgraded = 0;
  let downgraded = 0;
  for (const b of perTopic.values()) {
    upgraded += b.upgraded;
    downgraded += b.downgraded;
  }

  logger.info(
    {
      scanned: rows.length,
      updated,
      upgraded,
      downgraded,
      perTopic: Object.fromEntries(perTopic),
    },
    "backfillSeverity: re-rated machine-provenance rows",
  );
  return {
    scanned: rows.length,
    updated,
    upgraded,
    downgraded,
    perTopic: Object.fromEntries(perTopic),
  };
}
