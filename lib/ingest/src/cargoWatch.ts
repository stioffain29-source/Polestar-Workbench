import Parser from "rss-parser";
import { fetchFeed } from "./feedFetch";
import { db, incidentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { classifySeverity } from "./severity";
import { geocode, type GeoResult } from "./geocode";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { isLlmAvailable, screenBatch } from "./translateScreen";
import { recordSourceHealth, categorizeFeedFailure } from "./sourceHealth";
import type { FeedStat, IngestOptions, IngestSummary } from "./types";

// Cargo Watch ingest core.
//
// Queries Google News RSS for cargo-crime terms across org/ME/APAC feeds,
// classifies items, dedupes, and inserts with topic='cargo_watch'.
// Mirrors flashpoint.ts in structure.

type Feed = {
  label: string;
  url: string;
  group: "org" | "me" | "apac" | "port";
};

const TERMS = [
  "cargo theft",
  "truck hijacking",
  "warehouse theft",
  "container theft",
  "freight theft",
  "depot theft",
  "pilferage",
  "seal tampering",
  // Port-related cargo security (widened scope). Country-anchored in the ME /
  // APAC / port feeds below, so these stay scoped to in-scope geography.
  "port robbery",
  "anchorage robbery",
  "stowaway",
  "vessel boarding",
  "container smuggling",
];

const TERM_QUERY = TERMS.map((t) => `"${t}"`).join(" OR ");

function gnews(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

// Local-language Google News editions. These surface genuine in-scope cargo
// incidents the English edition never carries. Items are translated + screened by
// the LLM stage (see translateScreen.ts) instead of the regex classifier.
function gnewsLocale(query: string, hl: string, gl: string, ceid: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

type LocalFeed = { label: string; lang: string; url: string };

// Each query is a broad (crime-verb) × (cargo-noun) AND-group rather than a
// short list of exact quoted phrases. Quoted phrases (`"pencurian kargo"`)
// starve the feed: the live editions returned 0 (Arabic), 0-recent (Thai) and
// only 3 in 30d (Bahasa). The broad form surfaces 13-77 genuine recent
// incidents per feed. Precision is NOT the query's job here — the LLM
// translate+screen stage (translateScreen.ts) plus SCOPE_CANON and the shared
// relevance gate reject anything that is not an in-scope cargo crime, so a
// wide net costs only (capped) screening, never page noise.
const LOCAL_FEEDS: LocalFeed[] = [
  {
    label: "Local · Bahasa",
    lang: "Indonesian",
    url: gnewsLocale(
      `(pencurian OR perampokan OR pembobolan OR dibobol OR dicuri OR rampok OR maling OR jarah) (truk OR gudang OR kargo OR kontainer OR barang OR muatan OR ekspedisi OR logistik)`,
      "id",
      "ID",
      "ID:id",
    ),
  },
  {
    label: "Local · Arabic",
    lang: "Arabic",
    url: gnewsLocale(
      `(سرقة OR سطو OR نهب OR اختلاس) (شحنة OR بضائع OR مستودع OR شاحنة OR حاوية OR مخزن)`,
      "ar",
      "AE",
      "AE:ar",
    ),
  },
  {
    label: "Local · Thai",
    lang: "Thai",
    url: gnewsLocale(
      `(ขโมย OR ปล้น OR โจรกรรม OR ลัก) (สินค้า OR รถบรรทุก OR ตู้คอนเทนเนอร์ OR คลังสินค้า OR พัสดุ)`,
      "th",
      "TH",
      "TH:th",
    ),
  },
  // Philippines Filipino/Tagalog edition. The English edition carries almost no
  // PH cargo theft (a handful of Philstar/Tribune hits a year); the Filipino
  // edition surfaces genuine truck/cargo/warehouse thefts the English feed never
  // does (diesel siphoned from trucks, copper stripped off a moving truck,
  // stolen consumer-goods/beauty-product loads, produce loads taken off farms).
  {
    label: "Local · Filipino",
    lang: "Filipino",
    url: gnewsLocale(
      `(nakaw OR pagnanakaw OR ninakaw OR holdap OR naholdap OR pinagnakawan) (kargamento OR karga OR trak OR bodega OR kontena OR kalakal OR padala)`,
      "fil",
      "PH",
      "PH:fil",
    ),
  },
  // Sri Lanka Sinhala edition. Sri Lankan cargo theft is very thinly indexed by
  // Google News in every edition (English hits are India "godown" noise; this
  // Sinhala net currently returns 0). Kept as a standing net like the Arabic
  // feed above — when an in-scope item does appear it is captured, at no
  // steady-state cost (an empty feed screens nothing).
  {
    label: "Local · Sinhala",
    lang: "Sinhala",
    url: gnewsLocale(
      `(සොරකම් OR කොල්ලය OR මංකොල්ල OR සොරාගැනීම OR සොරකම) (බහාලුම් OR ට්‍රක් OR ලොරි OR ගබඩාව OR භාණ්ඩ OR කන්ටේනර්)`,
      "si",
      "LK",
      "LK:si",
    ),
  },
  // Middle East — a second Arabic edition anchored on the Saudi/Gulf edition
  // (gl=SA). The existing UAE Arabic edition (gl=AE) returned 0; the Saudi
  // edition carries far more Gulf news volume, so genuine Gulf cargo-crime
  // items (truck/warehouse/container theft, port pilferage) surface here. This
  // is the region's Middle East feed the owner asked for — Cargo Watch is a
  // regional report, not an Indonesia-only one.
  {
    label: "Local · Arabic (Saudi/Gulf)",
    lang: "Arabic",
    url: gnewsLocale(
      `(سرقة OR سطو OR نهب OR اختلاس OR اختطاف) (شحنة OR بضائع OR مستودع OR شاحنة OR حاوية OR مخزن OR حمولة)`,
      "ar",
      "SA",
      "SA:ar",
    ),
  },
  // Vietnam. The English edition carries almost no VN cargo theft; the
  // Vietnamese edition surfaces genuine truck/container/warehouse thefts.
  {
    label: "Local · Vietnamese",
    lang: "Vietnamese",
    url: gnewsLocale(
      `(trộm OR cướp OR "trộm cắp" OR "mất trộm" OR "đánh cắp" OR "cướp giật") ("hàng hóa" OR container OR "xe tải" OR kho OR "kho hàng" OR "lô hàng")`,
      "vi",
      "VN",
      "VN:vi",
    ),
  },
  // Malaysia (Bahasa Melayu). Distinct from the Indonesian edition — surfaces
  // Malaysian outlets (lorry/container/warehouse theft) the English feed misses.
  {
    label: "Local · Malay",
    lang: "Malay",
    url: gnewsLocale(
      `(curi OR dicuri OR kecurian OR rompak OR dirompak OR rompakan OR samun) (kargo OR kontena OR lori OR trak OR gudang OR barang OR muatan)`,
      "ms",
      "MY",
      "MY:ms",
    ),
  },
  // India (Hindi). English "godown" hits dominate but miss most Hindi-language
  // truck/consignment/warehouse thefts across the northern states.
  {
    label: "Local · Hindi",
    lang: "Hindi",
    url: gnewsLocale(
      `(चोरी OR लूट OR डकैती OR चुराया OR लूटपाट OR लुटेरे) (माल OR कंटेनर OR ट्रक OR गोदाम OR खेप OR लॉरी)`,
      "hi",
      "IN",
      "IN:hi",
    ),
  },
  // Bangladesh (Bengali). Chittagong/Dhaka truck and container thefts are
  // almost entirely in Bengali-language outlets.
  {
    label: "Local · Bengali",
    lang: "Bengali",
    url: gnewsLocale(
      `(চুরি OR ডাকাতি OR ছিনতাই OR লুট OR লুটপাট) (পণ্য OR কন্টেইনার OR ট্রাক OR গুদাম OR চালান OR মালামাল)`,
      "bn",
      "BD",
      "BD:bn",
    ),
  },
  // Pakistan (Urdu). Karachi/Lahore truck and consignment thefts surface in
  // Urdu-language outlets the English edition never carries.
  {
    label: "Local · Urdu",
    lang: "Urdu",
    url: gnewsLocale(
      `(چوری OR ڈکیتی OR لوٹ OR "لوٹ مار" OR اغوا) (سامان OR کنٹینر OR ٹرک OR گودام OR مال OR کھیپ)`,
      "ur",
      "PK",
      "PK:ur",
    ),
  },
  // China (Simplified Chinese). Domestic truck/container/warehouse cargo theft
  // is reported almost exclusively in Chinese-language outlets.
  {
    label: "Local · Chinese",
    lang: "Chinese",
    url: gnewsLocale(
      `(盗窃 OR 偷窃 OR 抢劫 OR 失窃 OR 被盗 OR 劫持) (货物 OR 集装箱 OR 货车 OR 卡车 OR 仓库 OR 货柜)`,
      "zh-CN",
      "CN",
      "CN:zh-Hans",
    ),
  },
];

// Cap on the number of NEW (unseen) items screened per local feed per run. The LLM
// screen is the only paid step; deduping by URL before screening keeps steady-state
// runs cheap, and this caps the cost of the first cold run.
const MAX_SCREEN_PER_FEED = 50;

// Mirrors the in-scope Middle East set the workbench renders
// (artifacts/workbench/src/lib/cargoAnalysis.ts → MIDDLE_EAST). Turkey is
// intentionally excluded; Iran is included. Keep this aligned with both the
// frontend scope AND SCOPE_CANON below, or English feeds starve countries the
// page still counts as in-scope.
const ME_COUNTRIES = [
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Oman",
  "Bahrain",
  "Kuwait",
  "Jordan",
  "Iran",
  "Iraq",
  "Yemen",
  "Israel",
  "Lebanon",
  "Syria",
];

// Mirrors the in-scope APAC set the workbench renders
// (artifacts/workbench/src/lib/cargoAnalysis.ts → APAC). The feed list and the
// display scope MUST stay aligned: querying only a subset starves the report of
// genuine in-scope incidents (the original 8-country list left China, Japan,
// Korea, Australia, Bangladesh etc. with no feed even though they are in scope).
const APAC_COUNTRIES = [
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Cambodia",
  "Laos",
  "Myanmar",
  "India",
  "Pakistan",
  "Bangladesh",
  "Sri Lanka",
  "China",
  "Taiwan",
  "South Korea",
  "Japan",
  "Australia",
  "New Zealand",
  "Papua New Guinea",
];

const ORG_QUERIES: { label: string; q: string }[] = [
  { label: "TAPA EMEA", q: `TAPA (${TERM_QUERY})` },
  { label: "TT Club", q: `"TT Club" (${TERM_QUERY})` },
  { label: "BSI Supply Chain", q: `BSI supply chain (cargo theft OR pilferage)` },
  { label: "Safety4Sea cargo", q: `site:safety4sea.com (cargo theft OR pilferage)` },
  { label: "IUMI cargo crime", q: `IUMI cargo (theft OR crime OR pilferage)` },
];

// Global PORT cargo-security feeds (widened scope). Deliberately NOT
// country-anchored — they surface port / anchorage / vessel / container
// security events worldwide, then the country-in-title gate in classify()
// scopes them to APAC + Middle East. Kept to a small, bounded set so the
// full ingest does not blow its time budget (per the per-port FETCH cap note).
const PORT_SECURITY_QUERIES: { label: string; q: string }[] = [
  { label: "Port · armed robbery", q: `"port" ("armed robbery" OR "robbery at port" OR "theft at port")` },
  { label: "Port · anchorage robbery", q: `"anchorage" (robbery OR theft OR boarded)` },
  { label: "Port · stowaway", q: `stowaway (container OR port OR vessel OR ship OR cargo)` },
  { label: "Port · container smuggling", q: `(container OR cargo) (smuggling OR narcotics OR contraband OR "drugs seized")` },
  { label: "Port · vessel boarding", q: `(vessel OR ship OR tanker) ("robbery on board" OR "theft on board" OR "robbers boarded")` },
  { label: "Port · sabotage / intrusion", q: `"port" (sabotage OR arson OR intrusion OR trespass)` },
];

// Port-targeted feeds. A port-only headline ("Container theft ring busted at
// Port Klang") often never names the country, so the country-feed queries above
// miss it. These query the busiest APAC + ME container ports by name so those
// items surface. DELIBERATELY a curated MAJOR-port subset (~2 dozen): the cargo
// ingest has historically timed out, and one Google-News feed per port across
// the full ~80-port gazetteer would blow the budget. The alias map below covers
// the WHOLE gazetteer so any port-named headline (from any feed) still resolves
// to its country; only the per-port FETCH is capped.
const PORT_FEED_TERMS: { term: string; country: string }[] = [
  // APAC
  { term: "Port of Singapore", country: "Singapore" },
  { term: "Port Klang", country: "Malaysia" },
  { term: "Tanjung Pelepas", country: "Malaysia" },
  { term: "Tanjung Priok", country: "Indonesia" },
  { term: "Laem Chabang", country: "Thailand" },
  { term: "Cai Mep", country: "Vietnam" },
  { term: "Manila port", country: "Philippines" },
  { term: "Nhava Sheva", country: "India" },
  { term: "Mundra port", country: "India" },
  { term: "Karachi port", country: "Pakistan" },
  { term: "Chittagong port", country: "Bangladesh" },
  { term: "Colombo port", country: "Sri Lanka" },
  { term: "Port of Shanghai", country: "China" },
  { term: "Ningbo port", country: "China" },
  { term: "Yantian port", country: "China" },
  { term: "Hong Kong port", country: "China" },
  { term: "Kaohsiung port", country: "Taiwan" },
  { term: "Busan port", country: "South Korea" },
  { term: "Port of Yokohama", country: "Japan" },
  { term: "Port Botany", country: "Australia" },
  // Middle East
  { term: "Jebel Ali", country: "UAE" },
  { term: "Jeddah Islamic Port", country: "Saudi Arabia" },
  { term: "Hamad port", country: "Qatar" },
  { term: "Sohar port", country: "Oman" },
  { term: "Shahid Rajaee", country: "Iran" },
  { term: "Umm Qasr", country: "Iraq" },
];

const FEEDS: Feed[] = [
  ...ORG_QUERIES.map((o): Feed => ({ label: o.label, url: gnews(o.q), group: "org" })),
  ...PORT_SECURITY_QUERIES.map((p): Feed => ({ label: p.label, url: gnews(p.q), group: "port" })),
  ...ME_COUNTRIES.map((c): Feed => ({
    label: `ME · ${c}`,
    url: gnews(`(${TERM_QUERY}) "${c}"`),
    group: "me",
  })),
  ...APAC_COUNTRIES.map((c): Feed => ({
    label: `APAC · ${c}`,
    url: gnews(`(${TERM_QUERY}) "${c}"`),
    group: "apac",
  })),
  ...PORT_FEED_TERMS.map((p): Feed => ({
    label: `Port · ${p.term}`,
    url: gnews(`(${TERM_QUERY}) "${p.term}"`),
    group: "port",
  })),
];

// Country alias map → canonical country name stored in DB.
const COUNTRY_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "UAE", aliases: ["uae", "united arab emirates", "emirates", "dubai", "abu dhabi", "sharjah", "ajman"] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "ksa", "riyadh", "jeddah", "dammam"] },
  { canonical: "Qatar", aliases: ["qatar", "doha"] },
  { canonical: "Oman", aliases: ["oman", "muscat", "salalah"] },
  { canonical: "Bahrain", aliases: ["bahrain", "manama"] },
  { canonical: "Kuwait", aliases: ["kuwait"] },
  { canonical: "Jordan", aliases: ["jordan", "amman", "aqaba"] },
  { canonical: "Iran", aliases: ["iran", "tehran", "bandar abbas", "bushehr"] },
  { canonical: "Iraq", aliases: ["iraq", "baghdad", "basra", "umm qasr"] },
  { canonical: "Yemen", aliases: ["yemen", "sanaa", "aden", "hodeidah"] },
  { canonical: "Israel", aliases: ["israel", "tel aviv", "haifa", "ashdod"] },
  // "tripoli" deliberately omitted — it collides with Libya (out of scope).
  { canonical: "Lebanon", aliases: ["lebanon", "beirut"] },
  { canonical: "Syria", aliases: ["syria", "damascus", "aleppo", "latakia", "tartus"] },
  { canonical: "Singapore", aliases: ["singapore"] },
  { canonical: "Malaysia", aliases: ["malaysia", "kuala lumpur", "penang", "johor", "port klang"] },
  { canonical: "Indonesia", aliases: ["indonesia", "indonesian", "jakarta", "surabaya", "tanjung priok", "soekarno-hatta"] },
  { canonical: "Thailand", aliases: ["thailand", "bangkok", "laem chabang"] },
  { canonical: "Vietnam", aliases: ["vietnam", "viet nam", "hanoi", "ho chi minh", "haiphong", "cai mep"] },
  { canonical: "Philippines", aliases: ["philippines", "manila", "cebu"] },
  { canonical: "India", aliases: ["india", "mumbai", "delhi", "chennai", "kolkata", "bengaluru", "nhava sheva"] },
  { canonical: "Pakistan", aliases: ["pakistan", "karachi", "lahore", "port qasim"] },
  { canonical: "Bangladesh", aliases: ["bangladesh", "dhaka", "chittagong", "chattogram"] },
  { canonical: "Sri Lanka", aliases: ["sri lanka", "colombo"] },
  { canonical: "China", aliases: ["china", "beijing", "shanghai", "guangzhou", "shenzhen", "ningbo", "qingdao", "hong kong"] },
  { canonical: "Taiwan", aliases: ["taiwan", "taipei", "kaohsiung"] },
  { canonical: "South Korea", aliases: ["south korea", "korea", "seoul", "busan", "incheon"] },
  { canonical: "Japan", aliases: ["japan", "tokyo", "osaka", "yokohama", "nagoya", "kobe"] },
  { canonical: "Australia", aliases: ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide"] },
  { canonical: "New Zealand", aliases: ["new zealand", "auckland", "wellington", "christchurch"] },
  { canonical: "Cambodia", aliases: ["cambodia", "phnom penh", "sihanoukville"] },
  { canonical: "Laos", aliases: ["laos", "vientiane"] },
  { canonical: "Myanmar", aliases: ["myanmar", "burma", "yangon"] },
  { canonical: "Papua New Guinea", aliases: ["papua new guinea", "port moresby", "lae"] },
];

// Port-name → canonical country. Lets a port-only headline (no country named)
// still pass the title country gate. Every alias is a multi-word, word-bounded
// PORT phrase (never a bare city/country token) so it cannot mis-tag a generic
// "Mumbai burglary" story. MUST stay in sync with CARGO_PORT_GAZETTEER in
// artifacts/workbench/src/lib/cargoAnalysis.ts (display side) — add ports to
// BOTH or the monitor/report will name a port the ingest never gates on.
const CARGO_PORT_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  // --- APAC ---
  { canonical: "Singapore", aliases: ["port of singapore", "psa singapore", "tuas port", "pasir panjang terminal", "tanjong pagar terminal", "brani terminal", "keppel terminal"] },
  { canonical: "Malaysia", aliases: ["port klang", "klang port", "port of klang", "tanjung pelepas", "port of tanjung pelepas", "penang port", "port of penang"] },
  { canonical: "Indonesia", aliases: ["tanjung priok", "priok port", "port of tanjung priok", "tanjung perak", "port of tanjung perak", "belawan port", "port of belawan"] },
  { canonical: "Thailand", aliases: ["laem chabang", "port of laem chabang", "bangkok port", "klong toey port", "khlong toei port"] },
  { canonical: "Vietnam", aliases: ["cai mep", "port of cai mep", "cat lai port", "cat lai terminal", "hai phong port", "haiphong port", "port of haiphong", "port of hai phong"] },
  { canonical: "Philippines", aliases: ["manila port", "port of manila", "manila south harbor", "manila international container terminal", "subic port", "port of subic", "subic bay port", "cebu port", "port of cebu"] },
  { canonical: "Cambodia", aliases: ["sihanoukville port", "sihanoukville autonomous port", "port of sihanoukville"] },
  { canonical: "Myanmar", aliases: ["yangon port", "port of yangon", "thilawa port"] },
  { canonical: "India", aliases: ["nhava sheva", "jawaharlal nehru port", "jnpt", "mundra port", "port of mundra", "chennai port", "port of chennai", "visakhapatnam port", "vizag port", "port of visakhapatnam", "kolkata port", "port of kolkata", "haldia port", "mumbai port", "port of mumbai"] },
  { canonical: "Pakistan", aliases: ["karachi port", "port of karachi", "port qasim", "bin qasim port", "port muhammad bin qasim", "gwadar port", "port of gwadar"] },
  { canonical: "Bangladesh", aliases: ["chittagong port", "chattogram port", "port of chittagong", "port of chattogram", "mongla port", "port of mongla"] },
  { canonical: "Sri Lanka", aliases: ["colombo port", "port of colombo", "hambantota port", "port of hambantota"] },
  { canonical: "China", aliases: ["port of shanghai", "shanghai port", "yangshan port", "ningbo port", "ningbo-zhoushan", "port of ningbo", "zhoushan port", "shenzhen port", "yantian port", "port of shenzhen", "shekou port", "qingdao port", "port of qingdao", "guangzhou port", "nansha port", "port of guangzhou", "tianjin port", "port of tianjin", "xiamen port", "port of xiamen", "hong kong port", "kwai chung terminal", "kwai tsing terminal", "port of hong kong"] },
  { canonical: "Taiwan", aliases: ["kaohsiung port", "port of kaohsiung", "keelung port", "port of keelung", "taichung port", "port of taichung"] },
  { canonical: "South Korea", aliases: ["busan port", "port of busan", "pusan port", "incheon port", "port of incheon", "gwangyang port", "port of gwangyang"] },
  { canonical: "Japan", aliases: ["port of yokohama", "yokohama port", "port of kobe", "kobe port", "port of nagoya", "nagoya port", "port of tokyo", "tokyo port", "port of osaka", "osaka port"] },
  { canonical: "Australia", aliases: ["port botany", "port of melbourne", "melbourne port", "port of brisbane", "brisbane port", "fremantle port", "port of fremantle"] },
  { canonical: "New Zealand", aliases: ["port of auckland", "ports of auckland", "port of tauranga", "tauranga port"] },
  { canonical: "Papua New Guinea", aliases: ["lae port", "port of lae", "motukea"] },
  // --- Middle East ---
  { canonical: "UAE", aliases: ["jebel ali", "port of jebel ali", "jebel ali port", "khalifa port", "khalifa bin zayed port", "khor fakkan", "khorfakkan", "port rashid", "mina rashid"] },
  { canonical: "Saudi Arabia", aliases: ["jeddah islamic port", "jeddah port", "port of jeddah", "king abdullah port", "dammam port", "king abdulaziz port", "port of dammam"] },
  { canonical: "Qatar", aliases: ["hamad port", "port of hamad"] },
  { canonical: "Oman", aliases: ["sohar port", "port of sohar", "salalah port", "port of salalah", "duqm port", "port of duqm"] },
  { canonical: "Bahrain", aliases: ["khalifa bin salman port", "mina salman"] },
  { canonical: "Kuwait", aliases: ["shuwaikh port", "shuaiba port"] },
  { canonical: "Jordan", aliases: ["aqaba port", "port of aqaba"] },
  { canonical: "Iran", aliases: ["shahid rajaee", "shahid rajaei", "bandar abbas port", "port of bandar abbas", "bushehr port", "port of bushehr", "chabahar port", "port of chabahar", "shahid beheshti port"] },
  { canonical: "Iraq", aliases: ["umm qasr", "port of umm qasr", "khor al-zubair", "khor al zubair"] },
  { canonical: "Yemen", aliases: ["hodeidah port", "hudaydah port", "port of hodeidah", "al hudaydah port", "aden port", "port of aden"] },
  { canonical: "Israel", aliases: ["haifa port", "port of haifa", "ashdod port", "port of ashdod"] },
  { canonical: "Lebanon", aliases: ["beirut port", "port of beirut"] },
  { canonical: "Syria", aliases: ["latakia port", "port of latakia", "tartus port", "port of tartus"] },
];

// Allowlist: at least one must hit in title+summary for the item to qualify.
const ALLOW = [
  "cargo theft",
  "cargo hijack",
  "cargo crime",
  "cargo pilferage",
  "cargo robbery",
  "truck hijack",
  "lorry hijack",
  "truck robbery",
  "lorry robbery",
  "warehouse theft",
  "warehouse robbery",
  "warehouse burglary",
  "warehouse break-in",
  "godown theft",
  "godown robbery",
  "godown pilferage",
  "depot theft",
  "depot robbery",
  "depot pilferage",
  "seal tamper",
  "tampered seal",
  "container theft",
  "container pilferage",
  "freight theft",
  "freight robbery",
  "freight pilferage",
  "shipment hijack",
  "shipment stolen",
  "shipment theft",
  "shipment pilferage",
  "consignment stolen",
  "consignment theft",
  "consignment pilferage",
  "supply chain theft",
  "supply chain pilferage",
  "logistics theft",
  "logistics crime",
  // --- Port / anchorage / vessel cargo-security (widened scope) ---
  "port robbery",
  "port theft",
  "robbery at port",
  "theft at port",
  "robbery at the port",
  "theft at the port",
  "anchorage robbery",
  "anchorage theft",
  "robbery at anchorage",
  "theft at anchorage",
  "robbers boarded",
  "pirates boarded",
  "boarded the vessel",
  "boarded the ship",
  "theft from vessel",
  "theft from ship",
  "theft on board",
  "robbery on board",
  "stowaway",
  "stowaways",
  "port intrusion",
  "port trespass",
  "trespass at port",
  "cargo smuggling",
  "container smuggling",
  "smuggling at port",
  "port smuggling",
  "narcotics in container",
  "drugs in container",
  "cocaine in container",
  "container seizure",
  "cargo seizure",
  "port sabotage",
  "sabotage at port",
  "dockworker strike",
  "dock workers strike",
  "stevedore strike",
  "port workers strike",
  "port blockade",
  "port access blockade",
  "blockade at port",
  "truck park robbery",
  "lorry park robbery",
];

// At-sea / anchorage / vessel-boarding ALLOW terms (the "widened scope" block
// above, minus the two truck-park entries which describe a real roadside lot,
// not open water). A story that only names a littoral COUNTRY for one of
// these — e.g. "Pirates board bulk carrier off Malaysia", with no port/city
// in the text — must never be plotted at that country's inland geographic
// centre: that reads as a bulk carrier boarded in the middle of the jungle.
// Mirrors the same safeguard already applied to shipping.ts's chokepoint /
// vessel groups, keyed here off the exact ALLOW term (`a.reason`) rather than
// feed group, since cargoWatch.ts's "port" feed group also carries genuine
// named-port stories that already geocode correctly and must be left alone.
const CARGO_MARITIME_ALLOW_TERMS = new Set([
  "port robbery",
  "port theft",
  "robbery at port",
  "theft at port",
  "robbery at the port",
  "theft at the port",
  "anchorage robbery",
  "anchorage theft",
  "robbery at anchorage",
  "theft at anchorage",
  "robbers boarded",
  "pirates boarded",
  "boarded the vessel",
  "boarded the ship",
  "theft from vessel",
  "theft from ship",
  "theft on board",
  "robbery on board",
  "stowaway",
  "stowaways",
  "port intrusion",
  "port trespass",
  "trespass at port",
  "cargo smuggling",
  "container smuggling",
  "smuggling at port",
  "port smuggling",
  "narcotics in container",
  "drugs in container",
  "cocaine in container",
  "container seizure",
  "cargo seizure",
  "port sabotage",
  "sabotage at port",
  "dockworker strike",
  "dock workers strike",
  "stevedore strike",
  "port workers strike",
  "port blockade",
  "port access blockade",
  "blockade at port",
]);

// Small coastal/island states whose bare country centroid IS a coastal point
// — no city match needed for these to be a safe maritime location.
const CARGO_MARITIME_SAFE_COUNTRIES = new Set(["singapore", "bahrain"]);

// Canonical country -> a real coastal port city to use as the maritime
// fallback when a country-only match (no port/city text) would otherwise
// plot a boarding/anchorage/stowaway/smuggling item at a bare (often inland)
// country centroid. Picks the busiest/most cited port already named
// elsewhere in this file (CARGO_PORT_ALIASES / PORT_FEED_TERMS) so the
// fallback point matches what a human analyst would expect. Deliberately has
// NO entry for Laos — it is landlocked, so a maritime-context match there is
// almost certainly a misclassification and there is no honest coastal point
// to substitute; the bare centroid is left as-is rather than guessing.
const CARGO_PORT_FALLBACK: Record<string, { lat: number; lng: number; label: string }> = {
  UAE: { lat: 25.2, lng: 55.27, label: "Dubai" },
  "Saudi Arabia": { lat: 21.49, lng: 39.19, label: "Jeddah" },
  Qatar: { lat: 25.29, lng: 51.53, label: "Doha" },
  Oman: { lat: 23.59, lng: 58.41, label: "Muscat" },
  Kuwait: { lat: 29.37, lng: 47.98, label: "Kuwait City" },
  Jordan: { lat: 29.53, lng: 35.0, label: "Aqaba" },
  Iran: { lat: 27.18, lng: 56.28, label: "Bandar Abbas" },
  Iraq: { lat: 30.51, lng: 47.78, label: "Basra" },
  Yemen: { lat: 12.79, lng: 45.02, label: "Aden" },
  Israel: { lat: 32.08, lng: 34.78, label: "Tel Aviv" },
  Lebanon: { lat: 33.89, lng: 35.5, label: "Beirut" },
  Syria: { lat: 35.52, lng: 35.79, label: "Latakia" },
  Malaysia: { lat: 3.0, lng: 101.39, label: "Port Klang" },
  Indonesia: { lat: -6.1, lng: 106.88, label: "Tanjung Priok" },
  Thailand: { lat: 13.08, lng: 100.88, label: "Laem Chabang" },
  Vietnam: { lat: 10.52, lng: 107.02, label: "Cai Mep" },
  Philippines: { lat: 14.6, lng: 120.98, label: "Manila" },
  India: { lat: 19.08, lng: 72.88, label: "Mumbai" },
  Pakistan: { lat: 24.86, lng: 67.0, label: "Karachi" },
  Bangladesh: { lat: 22.36, lng: 91.78, label: "Chittagong" },
  "Sri Lanka": { lat: 6.93, lng: 79.85, label: "Colombo" },
  China: { lat: 31.23, lng: 121.47, label: "Shanghai" },
  Taiwan: { lat: 22.63, lng: 120.3, label: "Kaohsiung" },
  "South Korea": { lat: 35.18, lng: 129.08, label: "Busan" },
  Japan: { lat: 35.44, lng: 139.64, label: "Yokohama" },
  Australia: { lat: -33.87, lng: 151.21, label: "Sydney" },
  "New Zealand": { lat: -36.85, lng: 174.76, label: "Auckland" },
  Cambodia: { lat: 10.62, lng: 103.5, label: "Sihanoukville" },
  Myanmar: { lat: 16.84, lng: 96.17, label: "Yangon" },
  "Papua New Guinea": { lat: -9.44, lng: 147.18, label: "Port Moresby" },
};

// At-sea/anchorage/vessel items (per CARGO_MARITIME_ALLOW_TERMS) must resolve
// to a real coastal point, never a country's raw inland centroid. Genuine
// named-port matches (geo.location already set by geocode()'s city lookup)
// are left untouched — those are real events at a real, already-resolved
// place.
function sanitizeCargoMaritimeGeo(geo: GeoResult | null, country: string, reason: string): GeoResult | null {
  const allowTerm = reason.startsWith("allow:") ? reason.slice("allow:".length) : null;
  if (!allowTerm || !CARGO_MARITIME_ALLOW_TERMS.has(allowTerm)) return geo;
  if (!geo || geo.location != null) return geo;
  const key = country.trim();
  if (CARGO_MARITIME_SAFE_COUNTRIES.has(key.toLowerCase())) return geo;
  const fallback = CARGO_PORT_FALLBACK[key];
  if (!fallback) return geo;
  return { latitude: fallback.lat, longitude: fallback.lng, location: fallback.label };
}

// Hard denylist: ALWAYS reject, even with cargo/port context. These are
// non-cargo "theft"/"pilferage" homonyms or finance/corruption framing — none
// describe a cargo-security incident, so a cargo/port word nearby must not
// rescue them. Pure shipping-ops / commercial noise is gated separately
// (OPS_COMMERCIAL_DENY) so a real theft that merely mentions "throughput" or a
// "tariff" row is still kept.
const HARD_DENY = [
  // Non-cargo "pilferage"/"theft" contexts that derail the India/Pakistan signal.
  "power pilferage",
  "power theft",
  "electricity pilferage",
  "electricity theft",
  "coal pilferage",
  "coal theft",
  "fuel pilferage",
  "oil pilferage",
  "water pilferage",
  "water theft",
  "spectrum pilferage",
  "pilferage of resources",
  "pilferage of funds",
  "pilferage of public",
  "data pilferage",
  // Political / corruption framing, not logistics crime.
  "corruption case",
  "embezzlement",
  "ponzi",
  "money laundering",
];

// Maritime / kinetic denylist: reject ONLY when the headline carries NO
// cargo/port-security context (see PORT_CARGO_CONTEXT). A pure under-way attack
// (a Houthi missile on a tanker at sea) belongs in Shipping / Strikes; but a
// port / anchorage robbery, a theft from a vessel, a container seizure, or a
// stowaway found in a box is a Cargo Watch event and must NOT be blanket-dropped.
const MARITIME_DENY = [
  "houthi",
  "missile",
  "drone attack",
  "ballistic",
  "naval",
  "warship",
  "vessel attack",
  "ship attack",
  "tanker attack",
  "tanker seizure",
  "vessel seizure",
];

// Shipping-ops / commercial-business noise. Unlike HARD_DENY these are dropped
// ONLY when the headline carries no cargo/port-security context, so a genuine
// theft, robbery or seizure that merely mentions congestion, a freight rate, a
// tariff row or an M&A deal is still kept (security wins). With cargo/port
// context present we trust the ALLOW gate (security phrases only) instead.
const OPS_COMMERCIAL_DENY = [
  "port congestion",
  "port delay",
  "freight rate",
  "shipping rate",
  "container rate",
  "throughput",
  "joint venture",
  "acquires",
  "acquired by",
  "tariff",
  "trade deal",
];

// Cargo / port-security context. Its presence lets a MARITIME_DENY headline stay
// in Cargo Watch (the event is a port/cargo-security incident, not an under-way
// naval attack). It does NOT bypass HARD_DENY, and an ALLOW phrase is still
// required afterwards, so this only widens — it never admits non-cargo noise.
const PORT_CARGO_CONTEXT = [
  "cargo",
  "container",
  "consignment",
  "shipment",
  "freight",
  "warehouse",
  "godown",
  "depot",
  "anchorage",
  "stowaway",
  "smuggl",
  "contraband",
  "narcotics",
  "pilferage",
  "bulk carrier",
  "on board",
  "aboard",
  "stevedore",
  "longshore",
  "dockworker",
  "seaport",
];

// Word-bounded port/vessel context. These tokens are matched on word boundaries
// (NOT substring) so "port" can't fire on "reported"/"transport", "ship" can't
// fire on "championship", and "dock"/"terminal" stay precise. Their presence —
// e.g. "...at Singapore port" or "theft from a vessel" — is enough cargo/port
// context to keep a MARITIME_DENY or OPS_COMMERCIAL_DENY headline for the ALLOW
// gate to adjudicate.
const PORT_CARGO_CONTEXT_WORDS = [
  "port", "ports", "harbour", "harbor", "wharf", "dock", "docks",
  "quay", "jetty", "berth", "terminal", "terminals",
  "vessel", "vessels", "ship", "ships", "tanker", "tankers", "boat",
];

type Classified = {
  kept: boolean;
  reason: string;
  country: string | null;
};

// Foreign-context terms: if these appear in the TITLE alongside our
// country match, the story is likely diaspora/overseas coverage,
// not an in-country incident.
const FOREIGN_CONTEXT = [
  "california", "canada", "united states", "u.s.", "usa",
  "united kingdom", "britain", "europe", "european", "germany",
  "mexico", "brazil", "south africa",
  // North Korea is OUT of scope but the bare "korea" alias maps to South Korea,
  // so guard against a DPRK story being mis-tagged ROK.
  "north korea", "pyongyang", "dprk",
];

function classify(title: string, summary: string): Classified {
  const hay = `${title}\n${summary}`.toLowerCase();
  const titleLc = title.toLowerCase();

  const hardDenyHit = HARD_DENY.find((d) => hay.includes(d));
  if (hardDenyHit) return { kept: false, reason: `deny:${hardDenyHit}`, country: null };

  // Maritime / kinetic terms and shipping-ops / commercial noise only reject
  // when no cargo/port-security context is present, so a port/anchorage robbery,
  // a theft from a vessel, or a container seizure is NOT dropped to Shipping —
  // and a real theft that merely mentions "throughput" or a "tariff" row is NOT
  // dropped as ops noise — while a pure under-way attack or a bare freight-rate
  // story still is. Context is matched as substring stems OR word-bounded tokens.
  const portCargoCtx =
    PORT_CARGO_CONTEXT.some((c) => hay.includes(c)) ||
    PORT_CARGO_CONTEXT_WORDS.some((w) => hasWord(hay, w));
  if (!portCargoCtx) {
    const maritimeDenyHit = MARITIME_DENY.find((d) => hay.includes(d));
    if (maritimeDenyHit) return { kept: false, reason: `deny-maritime:${maritimeDenyHit}`, country: null };
    const opsDenyHit = OPS_COMMERCIAL_DENY.find((d) => hay.includes(d));
    if (opsDenyHit) return { kept: false, reason: `deny-ops:${opsDenyHit}`, country: null };
  }

  const allowHit = ALLOW.find((a) => hay.includes(a));
  if (!allowHit) return { kept: false, reason: "no-allowlist-match", country: null };

  // Country must appear in TITLE (word-bounded) to count as an in-country
  // incident. Summary-only matches produce too many diaspora/byline misfires.
  const countryMatch = [...COUNTRY_ALIASES, ...CARGO_PORT_ALIASES].find((c) =>
    c.aliases.some((a) => hasWord(titleLc, a)),
  );
  if (!countryMatch) return { kept: false, reason: "no-country-in-title", country: null };

  // Reject if the title also frames the incident as occurring in a
  // non-scope country (e.g. "Indians arrested in California").
  const foreign = FOREIGN_CONTEXT.find((f) => hasWord(titleLc, f));
  if (foreign) return { kept: false, reason: `foreign-context:${foreign}`, country: null };

  return { kept: true, reason: `allow:${allowHit}`, country: countryMatch.canonical };
}

// Strip the Google News " - Source Name" masthead, THEN classify. The country
// gate is title-only, so classifying the raw title would let a publisher
// masthead ("South China Morning Post", "Bangkok Post", "Japan Today") satisfy
// the in-scope-country requirement and mis-tag an out-of-country story to its
// publisher's country. Returns the cleaned headline + the extracted masthead.
function classifyFeedItem(
  rawTitle: string,
  summary: string,
): { cleanTitle: string; sourceName: string | null; result: Classified } {
  const dashIdx = rawTitle.lastIndexOf(" - ");
  const sourceName = dashIdx > 0 ? rawTitle.slice(dashIdx + 3).trim() : null;
  const cleanTitle = dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
  return { cleanTitle, sourceName, result: classify(cleanTitle, summary) };
}

// Test-only surface (mirrors flashpointTestHooks).
export const cargoTestHooks = { classify, classifyFeedItem, sanitizeCargoMaritimeGeo };

function dedupeKey(title: string, when: Date, country: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    "cargo_watch",
  ].join("||");
}

// Canonicalises an LLM-returned country name to the exact in-scope name used by
// the workbench scope sets (artifacts/workbench/src/lib/cargoAnalysis.ts) and the
// geocoder. Returns null for anything OUTSIDE the APAC + Middle East scope, which
// drops the item — so a translated incident can never widen the page's scope.
const SCOPE_CANON: Record<string, string> = {
  // Middle East
  uae: "UAE",
  "united arab emirates": "UAE",
  emirates: "UAE",
  "saudi arabia": "Saudi Arabia",
  saudi: "Saudi Arabia",
  ksa: "Saudi Arabia",
  qatar: "Qatar",
  oman: "Oman",
  bahrain: "Bahrain",
  kuwait: "Kuwait",
  jordan: "Jordan",
  iran: "Iran",
  iraq: "Iraq",
  yemen: "Yemen",
  israel: "Israel",
  lebanon: "Lebanon",
  syria: "Syria",
  // APAC
  singapore: "Singapore",
  malaysia: "Malaysia",
  indonesia: "Indonesia",
  thailand: "Thailand",
  vietnam: "Vietnam",
  "viet nam": "Vietnam",
  philippines: "Philippines",
  cambodia: "Cambodia",
  laos: "Laos",
  myanmar: "Myanmar",
  burma: "Myanmar",
  india: "India",
  pakistan: "Pakistan",
  bangladesh: "Bangladesh",
  "sri lanka": "Sri Lanka",
  china: "China",
  "hong kong": "China",
  taiwan: "Taiwan",
  "south korea": "South Korea",
  korea: "South Korea",
  "republic of korea": "South Korea",
  japan: "Japan",
  australia: "Australia",
  "new zealand": "New Zealand",
  "papua new guinea": "Papua New Guinea",
};

export function canonScopeCountry(raw: string | null): string | null {
  if (!raw) return null;
  return SCOPE_CANON[raw.trim().toLowerCase()] ?? null;
}

type Accepted = {
  title: string;
  summary: string;
  country: string;
  occurredAt: Date;
  source: string;
  sourceUrl: string;
  feedLabel: string;
  reason: string;
};

type Rejected = {
  title: string;
  reason: string;
  feedLabel: string;
};

async function topicStats(): Promise<{ totalAfter: number; latestRecord: string | null; lastUpdated: string | null }> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count,
           MAX(occurred_at) AS latest,
           MAX(created_at)  AS updated
    FROM incidents WHERE topic='cargo_watch'
  `);
  const row = res.rows[0] as { count: number; latest: Date | string | null; updated: Date | string | null } | undefined;
  const latest = row?.latest ? new Date(row.latest).toISOString().slice(0, 10) : null;
  const updated = row?.updated ? new Date(row.updated).toISOString() : null;
  return { totalAfter: row?.count ?? 0, latestRecord: latest, lastUpdated: updated };
}

/**
 * Run the Cargo Watch ingest. Returns a structured summary. Does NOT close
 * the shared DB pool — see runFlashpointIngest for the rationale.
 */
export async function runCargoWatchIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  const commit = opts.commit ?? false;
  const titleFilter = opts.titleFilter ? opts.titleFilter.toLowerCase() : null;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Cargo Watch scraper — ${FEEDS.length} feeds, mode=${commit ? "COMMIT" : "DRY-RUN"}${titleFilter ? `, title filter="${titleFilter}"` : ""}`);

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench CargoWatchScraper)" },
  });

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const feedErrors: { feed: string; error: string }[] = [];
  const perFeed: Record<string, FeedStat> = {};

  // DB dedupe set is built up-front: the local-language stage uses existingUrls to
  // skip already-ingested items BEFORE spending an LLM call on them.
  const existing = await db
    .select({
      title: incidentsTable.title,
      occurredAt: incidentsTable.occurredAt,
      country: incidentsTable.country,
      topic: incidentsTable.topic,
      sourceUrl: incidentsTable.sourceUrl,
    })
    .from(incidentsTable);

  const existingKeys = new Set<string>();
  const existingUrls = new Set<string>();
  for (const row of existing) {
    if (row.topic !== "cargo_watch") continue;
    existingKeys.add(dedupeKey(row.title, row.occurredAt, row.country));
    if (row.sourceUrl) existingUrls.add(row.sourceUrl);
  }

  // Bounded concurrency: sequential fetching at 20s-per-feed can exceed
  // two minutes. Processing is order-independent.
  const CONCURRENCY = 4;
  const processFeed = async (feed: (typeof FEEDS)[number]) => {
    perFeed[feed.label] = { name: feed.label, found: 0, accepted: 0, rejected: 0 };
    try {
      const parsed = await fetchFeed(parser, feed.url, { stagger: true });
      const items = parsed.items ?? [];
      perFeed[feed.label].found = items.length;
      for (const item of items) {
        const rawTitle = cleanText(item.title);
        const summary = cleanText(item.contentSnippet || item.content || "");
        const when = parseDate(item.isoDate || item.pubDate);
        const link = item.link?.trim();

        if (!rawTitle || !when || !link) {
          rejected.push({ title: rawTitle || "(no title)", reason: "missing-required-field", feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }

        // Strip the Google News masthead before classifying (see classifyFeedItem).
        const { cleanTitle, sourceName: masthead, result: c } = classifyFeedItem(rawTitle, summary);
        if (!c.kept || !c.country) {
          rejected.push({ title: cleanTitle, reason: c.reason, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const sourceName = masthead ?? parsed.title ?? feed.label;

        accepted.push({
          title: cleanTitle.slice(0, 500),
          summary: summary || cleanTitle,
          country: c.country,
          occurredAt: when,
          source: sourceName.slice(0, 200),
          sourceUrl: link,
          feedLabel: feed.label,
          reason: c.reason,
        });
        perFeed[feed.label].accepted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedErrors.push({ feed: feed.label, error: msg });
      perFeed[feed.label].error = msg;
    }
  };
  const dbg = (s: string) => {
    if (process.env.CARGO_DEBUG) process.stderr.write(`[cargo ${new Date().toISOString().slice(11, 19)}] ${s}\n`);
  };
  dbg(`existing cargo rows: urls=${existingUrls.size}`);
  dbg(`english feeds starting (${FEEDS.length})`);
  for (let i = 0; i < FEEDS.length; i += CONCURRENCY) {
    await Promise.allSettled(FEEDS.slice(i, i + CONCURRENCY).map(processFeed));
    dbg(`english batch done ${Math.min(i + CONCURRENCY, FEEDS.length)}/${FEEDS.length}`);
  }
  dbg(`english accepted=${accepted.length}`);

  // Local-language stage. Each candidate is translated + screened by the LLM, then
  // its country is canonicalised to the in-scope set. If the LLM integration is
  // unavailable the stage is skipped entirely — the English pipeline is unaffected.
  const llmReady = isLlmAvailable();
  if (!llmReady) {
    log("\nLocal-language feeds skipped: OpenAI integration not configured.");
  } else {
    const localSeen = new Set<string>();
    const processLocalFeed = async (feed: LocalFeed) => {
      perFeed[feed.label] = { name: feed.label, found: 0, accepted: 0, rejected: 0 };
      dbg(`local "${feed.label}" fetching`);
      let parsed;
      try {
        parsed = await fetchFeed(parser, feed.url, { stagger: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        feedErrors.push({ feed: feed.label, error: msg });
        perFeed[feed.label].error = msg;
        return;
      }
      const items = parsed.items ?? [];
      perFeed[feed.label].found = items.length;

      // Collect NEW (unseen) candidates only, so the LLM screen never pays to
      // re-read items already in the DB or already seen this run.
      type Candidate = { headline: string; summary: string; when: Date; link: string; sourceName: string };
      const candidates: Candidate[] = [];
      for (const item of items) {
        const rawTitle = cleanText(item.title);
        const summary = cleanText(item.contentSnippet || item.content || "");
        const when = parseDate(item.isoDate || item.pubDate);
        const link = item.link?.trim();
        if (!rawTitle || !when || !link) {
          rejected.push({ title: rawTitle || "(no title)", reason: "missing-required-field", feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        if (existingUrls.has(link) || localSeen.has(link)) {
          perFeed[feed.label].rejected++;
          continue;
        }
        localSeen.add(link);
        const dashIdx = rawTitle.lastIndexOf(" - ");
        const sourceName = dashIdx > 0 ? rawTitle.slice(dashIdx + 3).trim() : (parsed.title ?? feed.label);
        const headline = dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
        candidates.push({ headline, summary, when, link, sourceName });
        if (candidates.length >= MAX_SCREEN_PER_FEED) break;
      }

      dbg(`local "${feed.label}" found=${items.length} screening=${candidates.length}`);
      const verdicts = await screenBatch(
        candidates.map((c) => ({ title: c.headline, summary: c.summary })),
        { concurrency: 4 },
      );
      dbg(`local "${feed.label}" screened`);

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const v = verdicts[i];
        if (!v.ok) {
          rejected.push({ title: c.headline, reason: `llm-error:${v.error}`, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const ver = v.verdict;
        if (!ver.inScope) {
          rejected.push({ title: c.headline, reason: `slop:${ver.reason}`.slice(0, 140), feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const country = canonScopeCountry(ver.country);
        if (!country) {
          rejected.push({ title: c.headline, reason: `out-of-scope-country:${ver.country ?? "?"}`, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const titleEn = (ver.titleEn || c.headline).slice(0, 500);
        // Append the LLM-extracted city to the summary so the geocoder can place
        // the incident at city level rather than only the country centroid.
        const summaryEn = [ver.summaryEn || titleEn, ver.city ? `Location: ${ver.city}.` : ""].join(" ").trim();
        accepted.push({
          title: titleEn,
          summary: summaryEn,
          country,
          occurredAt: c.when,
          source: c.sourceName.slice(0, 200),
          sourceUrl: c.link,
          feedLabel: feed.label,
          reason: `llm:${ver.reason}`.slice(0, 200),
        });
        perFeed[feed.label].accepted++;
      }
    };
    // Sequential: each feed screens at its own internal concurrency. Running the
    // feeds one at a time keeps the combined request burst gentle on the LLM
    // proxy (the Retry-After backoff still covers transient throttling).
    for (const feed of LOCAL_FEEDS) {
      await processLocalFeed(feed);
    }
  }

  // In-batch dedupe (multiple feeds can return the same article).
  const seen = new Set<string>();
  const uniqueAccepted: Accepted[] = [];
  for (const a of accepted) {
    const k = dedupeKey(a.title, a.occurredAt, a.country);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueAccepted.push(a);
  }

  const toInsert: Accepted[] = [];
  let dupeInDb = 0;
  let filteredOut = 0;
  for (const a of uniqueAccepted) {
    if (titleFilter && !a.title.toLowerCase().includes(titleFilter)) {
      filteredOut++;
      continue;
    }
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(dedupeKey(a.title, a.occurredAt, a.country))) {
      dupeInDb++;
      continue;
    }
    toInsert.push(a);
  }

  // Report
  const allFeedLabels = [...FEEDS.map((f) => f.label), ...(llmReady ? LOCAL_FEEDS.map((f) => f.label) : [])];
  const totalFeeds = allFeedLabels.length;
  log("\n=== Per-feed ===");
  for (const label of allFeedLabels) {
    const s = perFeed[label];
    if (!s) continue;
    if (s.error) {
      log(`  ${label.padEnd(28)} ERROR: ${s.error}`);
    } else {
      log(`  ${label.padEnd(28)} found=${s.found.toString().padStart(3)}  accepted=${s.accepted.toString().padStart(3)}  rejected=${s.rejected.toString().padStart(3)}`);
    }
  }

  const countryCoverage = new Map<string, number>();
  for (const a of uniqueAccepted) {
    countryCoverage.set(a.country, (countryCoverage.get(a.country) ?? 0) + 1);
  }

  log("\n=== Totals ===");
  log(`  Feeds queried        : ${totalFeeds}`);
  log(`  Feed errors          : ${feedErrors.length}`);
  log(`  Items found          : ${accepted.length + rejected.length}`);
  log(`  Accepted (raw)       : ${accepted.length}`);
  log(`  Accepted (unique)    : ${uniqueAccepted.length}`);
  log(`  Duplicate in DB      : ${dupeInDb}`);
  if (titleFilter) log(`  Excluded by filter   : ${filteredOut}`);
  log(`  New to insert        : ${toInsert.length}`);
  log(`  Rejected             : ${rejected.length}`);

  log("\n=== Country coverage (unique accepted) ===");
  const sortedCov = [...countryCoverage.entries()].sort((a, b) => b[1] - a[1]);
  for (const [c, n] of sortedCov) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedCov.length === 0) log("  (none)");

  if (process.env.CARGO_DEBUG) {
    const localLabels = new Set(LOCAL_FEEDS.map((f) => f.label));
    const localAccepted = uniqueAccepted.filter((a) => localLabels.has(a.feedLabel));
    process.stderr.write(`\n[cargo] === ACCEPTED local samples (${localAccepted.length}) ===\n`);
    for (const a of localAccepted) {
      process.stderr.write(
        `[cargo] (${a.feedLabel.replace("Local · ", "")}) [${a.country}] ${a.title}\n        ${a.reason}\n`,
      );
    }
    const localRej = rejected.filter((r) => localLabels.has(r.feedLabel));
    process.stderr.write(`\n[cargo] === REJECTED local samples (first 20 of ${localRej.length}) ===\n`);
    for (const r of localRej.slice(0, 20)) {
      process.stderr.write(`[cargo] ${r.reason} — ${r.title.slice(0, 90)}\n`);
    }
  }

  if (commit) {
    // Registry cadence is derived from the REAL scheduler config, never invented:
    // when the boot scheduler is enabled the feeds are pulled every
    // INGEST_INTERVAL_HOURS (default 12); otherwise collection is manual/on-demand.
    const intervalHours = Number(process.env.INGEST_INTERVAL_HOURS) || 12;
    const scheduleEnabled = process.env.INGEST_SCHEDULE_ENABLED !== "false";
    const scrapeFrequency = scheduleEnabled
      ? `Every ${intervalHours}h (scheduled)`
      : "Manual / on-demand";

    // Per-feed health carries the LAST-RUN funnel this run actually observed
    // (found -> accepted -> rejected) plus the source language. English query
    // feeds are tagged "English"; local-language editions carry their own lang.
    // Counts come straight from the perFeed funnel — no fabrication.
    const healthFeeds = [
      ...FEEDS.map((f) => ({ name: f.label, url: f.url, language: "English" })),
      ...(llmReady
        ? LOCAL_FEEDS.map((f) => ({ name: f.label, url: f.url, language: f.lang }))
        : []),
    ].map((f) => {
      const stat = perFeed[f.name];
      return {
        ...f,
        ok: !stat?.error,
        error: stat?.error ?? null,
        collected: stat?.found,
        retained: stat?.accepted,
        rejected: stat?.rejected,
        failureReason: categorizeFeedFailure(stat?.error),
      };
    });
    await recordSourceHealth("cargo_watch", healthFeeds, {
      sourceType: "rss",
      reliability: 3,
      notes: "Live cargo-theft news feed — auto-monitored each ingest run.",
      scrapeMethod: "Google News RSS",
      scrapeFrequency,
    });
  }

  const summaryBase = {
    topic: "cargo_watch" as const,
    mode: (commit ? "commit" : "dry-run") as IngestSummary["mode"],
    sourcesFetched: totalFeeds,
    itemsConsidered: accepted.length + rejected.length,
    acceptedRaw: accepted.length,
    acceptedUnique: uniqueAccepted.length,
    duplicateInDb: dupeInDb,
    newToInsert: toInsert.length,
    rejected: rejected.length,
    perFeed: allFeedLabels.map((label) => perFeed[label]).filter(Boolean),
    countryCoverage: sortedCov,
  };

  if (!commit) {
    log("\nDRY-RUN — no rows written. Re-run with --commit to insert.");
    return { ...summaryBase, inserted: 0, totalAfter: null, latestRecord: null, lastUpdated: null, logLines };
  }

  if (toInsert.length === 0) {
    log("\nNothing to insert.");
    const stats = await topicStats();
    return { ...summaryBase, inserted: 0, ...stats, logLines };
  }

  let geocoded = 0;
  const ungeocoded: string[] = [];
  const rows: (typeof incidentsTable.$inferInsert)[] = toInsert.map((a) => {
    const rawGeo = geocode(a.country, `${a.title} ${a.summary}`);
    const geo = sanitizeCargoMaritimeGeo(rawGeo, a.country, a.reason);
    if (geo) geocoded++;
    else ungeocoded.push(`${a.country} — ${a.title.slice(0, 80)}`);
    const rel = evaluateIncidentRelevance("cargo_watch", {
      topic: "cargo_watch",
      title: a.title,
      summary: a.summary,
      source: a.source,
      sourceUrl: a.sourceUrl,
      location: geo?.location ?? null,
    });
    return {
      topic: "cargo_watch",
      title: a.title,
      summary: a.summary,
      country: a.country,
      location: geo?.location ?? null,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      occurredAt: a.occurredAt,
      severity: classifySeverity(a.title, a.summary, "cargo_watch"),
      confidence: "low",
      source: a.source,
      sourceUrl: a.sourceUrl,
      analystNotes: `auto-scraped:${a.feedLabel}`,
      relevanceStatus: rel.status,
      relevanceScore: rel.score,
      relevanceReason: rel.reason,
      relevanceVersion: rel.version,
      relevanceEvaluatedAt: new Date(),
    };
  });

  log(`\nGeocoded ${geocoded}/${rows.length} new rows.`);
  if (ungeocoded.length > 0) {
    log(`  WARNING: ${ungeocoded.length} row(s) could not be geocoded (inserted without coordinates):`);
    for (const u of ungeocoded) log(`    - ${u}`);
  }

  await db.insert(incidentsTable).values(rows);
  const stats = await topicStats();
  log(`\nInserted ${rows.length} rows. cargo_watch total now: ${stats.totalAfter}`);

  return { ...summaryBase, inserted: rows.length, ...stats, logLines };
}
