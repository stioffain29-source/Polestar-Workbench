import { db, incidentsTable, reportsTable, countryReportsTable, countryBaselinesTable, sourcesTable, strikesTable, cardTemplatesTable, brandSettingsTable } from "@workspace/db";
import type { CardContent, InsertBrandSettings } from "@workspace/db";
import { sql, eq, or, ne, isNull, inArray, and, like, not } from "drizzle-orm";
import { evaluateIncidentRelevance, RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import {
  runStrikesBackfill,
  runNewsCountryBackfill,
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
  isMaritimeVesselAttack,
  severityFromFatalities,
  maxSeverity,
  SEVERITY_RANK,
  isReliefWebConfigured,
  isGdeltConfigured,
  PROMOTE_MARKER_PREFIX,
  GDELT_NOT_CONFIGURED_MESSAGE,
  RELIEFWEB_NOT_CONFIGURED_MESSAGE,
  type Severity,
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
  { name: "Benar News",              url: "https://www.benarnews.org/english/rss2.xml",                                     sourceType: "rss",  reliability: 4, notes: "Owner: Asia desk. SE Asia regional desk — Philippines, Indonesia, Bangladesh." },
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
  { name: "Loop PNG",                url: "https://news.google.com/rss/search?q=site:looppng.com+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security+OR+airport+OR+road)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. Loop PNG — high-volume PNG news portal. Collected via Google-News site-scope (no reachable direct feed). Security/crime/operational cues, last 14 days." },
  { name: "EMTV (PNG)",              url: "https://news.google.com/rss/search?q=site:emtv.com.pg+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security+OR+airport+OR+road)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. EMTV — national broadcaster (Port Moresby). Collected via Google-News site-scope (direct feed redirects/blocks our egress IP). Security/crime/operational cues, last 14 days." },
  { name: "PNG Haus Bung",          url: "https://news.google.com/rss/search?q=site:pnghausbung.com+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 2, notes: "Owner: Pacific desk. PNG Haus Bung — popular PNG news blog (tabloid register; corroborate before use). Collected via Google-News site-scope. Security/crime cues, last 14 days." },
  { name: "One PNG",                url: "https://news.google.com/rss/search?q=site:onepng.com+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 2, notes: "Owner: Pacific desk. One PNG — community news aggregator. Collected via Google-News site-scope. Security/crime cues, last 14 days." },
  // NBC PNG (National Broadcasting Corporation) — PNG's state broadcaster. The
  // direct feed (nbc.com.pg) blocks our egress IP, so collected via Google-News
  // site-scope like the other mastheads. Broadens NCD crime/security coverage.
  { name: "NBC PNG",                url: "https://news.google.com/rss/search?q=site:nbc.com.pg+(police+OR+raid+OR+robbery+OR+killed+OR+crime+OR+violence+OR+protest+OR+arrest+OR+court+OR+security+OR+airport+OR+road)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. NBC PNG — National Broadcasting Corporation (state broadcaster, Port Moresby). Collected via Google-News site-scope (direct feed blocks our egress IP). Security/crime/operational cues, last 14 days." },
  // TVWAN News (Digicel) — no standalone news site; its digital output is
  // carried by Loop PNG (already collected above). Name-anchored Google-News
  // query so TVWAN-branded reporting still surfaces when syndicated elsewhere.
  { name: "TVWAN News",             url: "https://news.google.com/rss/search?q=%22TVWAN%22+(%22Papua+New+Guinea%22+OR+PNG+OR+%22Port+Moresby%22)+(police+OR+robbery+OR+crime+OR+killed+OR+arrest+OR+violence)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 2, notes: "Owner: Pacific desk. TVWAN News (Digicel broadcaster) — no standalone news website; digital output carried by Loop PNG (separate feed). Name-anchored query for TVWAN-branded reporting. Last 14 days." },
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
  { name: "Daily Mirror Sri Lanka",  url: "http://www.dailymirror.lk/RSS_Feeds/news",                                       sourceType: "rss",  reliability: 4, notes: "Owner: South Asia desk. Sri Lanka — Colombo national daily." },
  { name: "Nepal Republica",         url: "https://myrepublica.nagariknetwork.com/feed/",                                   sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Secondary Nepal national — corroborates Kathmandu Post." },
  { name: "New Age Bangladesh",      url: "https://www.newagebd.net/rss.xml",                                               sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Bangladesh — labour and student coverage." },
  { name: "Sunday Times Sri Lanka",  url: "https://www.sundaytimes.lk/feed",                                                sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Sri Lanka — Colombo weekly, political coverage." },
  { name: "The Kathmandu Post",      url: "https://kathmandupost.com/rss",                                                  sourceType: "rss",  reliability: 4, notes: "Owner: South Asia desk. Kathmandu — political mobilisation, student unions, transport strikes." },
  { name: "Philippine Daily Inquirer", url: "https://www.inquirer.net/fullfeed",                                            sourceType: "rss",  reliability: 4, notes: "Owner: PH desk. National daily — city-disruption and protest calendaring across Metro Manila." },
  { name: "Rappler",                 url: "https://www.rappler.com/feed/",                                                  sourceType: "rss",  reliability: 4, notes: "Owner: PH desk. Manila protest activity, union calls, student mobilisation." },
  { name: "Prachatai English",       url: "https://prachatai.com/english/rss.xml",                                          sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Thailand — civic-space, student mobilisation." },
  { name: "Tempo English",           url: "https://en.tempo.co/rss",                                                        sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Indonesia — investigative weekly, civic-space coverage." },
  { name: "The Jakarta Post",        url: "https://www.thejakartapost.com/feed",                                            sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Indonesia — Jakarta-Java national daily." },
  { name: "Kyodo News (English)",    url: "https://english.kyodonews.net/rss/news.xml",                                     sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. Tokyo wire — labour disputes, civic protest and policing." },
  { name: "NHK World Japan",         url: "https://www3.nhk.or.jp/nhkworld/en/news/feeds/",                                 sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. Japan — national broadcaster English wire." },
  { name: "The Japan Times",         url: "https://www.japantimes.co.jp/feed/",                                             sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. National daily — Tokyo and Osaka mobilisation, union action." },
  // Thematic / cross-regional desks (civic-space, labour, education) and
  // wires. Several are non-RSS catalogue entries that fail to parse from the
  // container — retained so Source Health mirrors the verified development
  // catalogue and coverage warnings count the full source set.
  { name: "AFP Asia-Pacific",        url: "https://www.afp.com/en/news-hub",                                                sourceType: "news", reliability: 5, notes: "Owner: Asia desk. Secondary wire — corroborates Reuters and adds French-language coverage." },
  { name: "Reuters Asia Pacific Wire", url: "https://www.reuters.com/world/asia-pacific/",                                  sourceType: "news", reliability: 5, notes: "Owner: Asia desk. Primary wire for breaking protest, strike and security-force activity." },
  { name: "CIVICUS Monitor",         url: "https://monitor.civicus.org/api/",                                               sourceType: "api",  reliability: 5, notes: "Owner: Civic-space desk. Live tracker of assembly bans, detentions, internet shutdowns." },
  { name: "Human Rights Watch Asia", url: "https://www.hrw.org/asia",                                                       sourceType: "rss",  reliability: 4, notes: "Owner: Civic-space desk. Crackdown reporting, mass arrests, security-force conduct." },
  { name: "ITUC Global Rights Index", url: "https://www.ituc-csi.org/spip.php?page=backend",                                sourceType: "rss",  reliability: 4, notes: "Owner: Labour desk. International Trade Union Confederation — strike calls and labour-rights restrictions." },
  { name: "IndustriALL Global Union", url: "https://www.industriall-union.org/rss.xml",                                     sourceType: "rss",  reliability: 4, notes: "Owner: Labour desk. Sectoral union action (manufacturing, mining, energy)." },
  { name: "Education International APAC", url: "https://www.ei-ie.org/en/region/asia-pacific",                               sourceType: "rss",  reliability: 3, notes: "Owner: Education desk. Teacher and faculty mobilisation across APAC." },
  { name: "University World News Asia", url: "https://www.universityworldnews.com/region.php?region=Asia&format=rss",       sourceType: "rss",  reliability: 3, notes: "Owner: Education desk. Campus protests, student union activity, faculty walkouts." },
];

// Self-heal seed URLs on every startup. The seed loop below only inserts
// rows whose `name` is new; it never updates an existing row's URL. This
// block applies any URL corrections to already-inserted seed rows so the
// scraper picks up the fix without manual DB surgery. Idempotent — if the
// URL is already correct the UPDATE is a no-op.
async function repairFlashpointSeedUrls(): Promise<void> {
  for (const seed of FLASHPOINT_REGIONAL_SOURCES) {
    await db
      .update(sourcesTable)
      .set({ url: seed.url, sourceType: seed.sourceType, notes: seed.notes })
      .where(sql`${sourcesTable.name} = ${seed.name} AND ${sourcesTable.topic} = 'flashpoint' AND (${sourcesTable.url} IS DISTINCT FROM ${seed.url})`);
  }
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
    // Schema: analyst-overridable stored risk rating on reports. drizzle-kit
    // push only reaches the dev database; production schema changes must be
    // applied here so the deployment runtime (the only place with a writable
    // prod primary) gains the column on boot. Idempotent — IF NOT EXISTS.
    await db.execute(
      sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS risk_rating text`,
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
    } catch (srcErr) {
      logger.error({ err: srcErr }, "Flashpoint regional source seed failed");
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
    //   non-PNG country. Marker-gated → runs once per environment; the v2 key
    //   re-runs the now-broadened scope once over the rows the earlier
    //   flashpoint-only v1 left untouched. Reaches the writable prod DB only
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
      const markerKey = "png_extract_backfill_v2";
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
      const markerKey = "west_papua_structured_extract_backfill_v1";
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
      const markerKey = "severity_rerate_2026_06_25_v1";
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

    try {
      await backfillRelevance();
    } catch (relErr) {
      logger.error({ err: relErr }, "Relevance backfill failed");
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
        // NEVER re-score GDELT-promoted rows through the text relevance engine.
        // Their relevance is fixed by GDELT's own lane coding (see gdeltPromote):
        // Crime/Transport are deliberately stored 'irrelevant' (geography-only
        // context), Protests/Security 'relevant'. The text rules know nothing
        // about lanes, so a routine RELEVANCE_RULE_VERSION bump would otherwise
        // flip these verdicts and destroy the promote semantics. NULL notes (the
        // vast majority of rows) still evaluate normally.
        or(
          isNull(incidentsTable.analystNotes),
          not(like(incidentsTable.analystNotes, `${PROMOTE_MARKER_PREFIX}%`)),
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
