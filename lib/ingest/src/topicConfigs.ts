import { runNewsTopicIngest, type CountryAlias, type NewsTopicConfig, type TopicFeed } from "./newsTopic";
import type { IngestOptions, IngestSummary } from "./types";

// Live feed configs for the previously import-only land topics: energy,
// fertiliser and fuel. Each config's allow/deny lists are kept aligned with the
// matching REQUIRED rule in @workspace/relevance so accepted items pass the
// central relevance gate and surface in their monitor.

// Shared South/SE/East-Asia + Middle East country alias map. Order matters:
// more specific actors precede broader regional names. Covers the APAC and
// South Asia footprint of the energy/fertiliser/fuel monitors.
const COUNTRY_ALIASES: CountryAlias[] = [
  { canonical: "India", aliases: ["india", "indian", "delhi", "mumbai", "kolkata", "chennai", "bengaluru", "uttar pradesh", "maharashtra", "punjab", "bihar", "tamil nadu"] },
  { canonical: "Pakistan", aliases: ["pakistan", "pakistani", "karachi", "lahore", "islamabad", "punjab province", "sindh", "balochistan", "khyber"] },
  { canonical: "Bangladesh", aliases: ["bangladesh", "bangladeshi", "dhaka", "chittagong", "chattogram"] },
  { canonical: "Sri Lanka", aliases: ["sri lanka", "sri lankan", "colombo", "ceylon"] },
  { canonical: "Nepal", aliases: ["nepal", "nepali", "kathmandu"] },
  { canonical: "Myanmar", aliases: ["myanmar", "burma", "burmese", "yangon", "naypyidaw", "mandalay"] },
  { canonical: "Indonesia", aliases: ["indonesia", "indonesian", "jakarta", "java", "sumatra", "surabaya"] },
  { canonical: "Philippines", aliases: ["philippines", "filipino", "manila", "luzon", "mindanao", "cebu"] },
  { canonical: "Vietnam", aliases: ["vietnam", "vietnamese", "hanoi", "ho chi minh"] },
  { canonical: "Thailand", aliases: ["thailand", "thai", "bangkok"] },
  { canonical: "Malaysia", aliases: ["malaysia", "malaysian", "kuala lumpur"] },
  { canonical: "China", aliases: ["china", "chinese", "beijing", "shanghai", "guangdong"] },
  { canonical: "Japan", aliases: ["japan", "japanese", "tokyo", "osaka"] },
  { canonical: "South Korea", aliases: ["south korea", "korean", "seoul", "busan"] },
  { canonical: "Iran", aliases: ["iran", "iranian", "tehran"] },
  { canonical: "Iraq", aliases: ["iraq", "iraqi", "baghdad", "basra"] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "riyadh", "jeddah"] },
  { canonical: "United Arab Emirates", aliases: ["united arab emirates", "uae", "dubai", "abu dhabi"] },
  { canonical: "Qatar", aliases: ["qatar", "qatari", "doha"] },
  { canonical: "Kuwait", aliases: ["kuwait", "kuwaiti"] },
  { canonical: "Oman", aliases: ["oman", "omani", "muscat"] },
  { canonical: "Bahrain", aliases: ["bahrain", "bahraini", "manama"] },
  { canonical: "Australia", aliases: ["australia", "australian", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "queensland", "new south wales", "nsw"] },
  { canonical: "New Zealand", aliases: ["new zealand", "auckland", "wellington", "christchurch"] },
];

// Per-country Google News edition. A country feed MUST pull that country's own
// edition or the default US edition floods it with US-local distribution faults
// (Duke/Dominion/Consumers Energy outages, county feeder trips, "outage
// tracker" SEO pages) that loosely match the quoted country name and then get
// mis-stamped with the feed's default country. Countries with no reliable
// English edition (Myanmar, China, Iran, Iraq) fall back to the US edition but
// rely on the quoted country name + relevance gate.
const EDITIONS: Record<string, { gl: string; hl: string; ceid: string }> = {
  India: { gl: "IN", hl: "en-IN", ceid: "IN:en" },
  Pakistan: { gl: "PK", hl: "en-PK", ceid: "PK:en" },
  Bangladesh: { gl: "BD", hl: "en-BD", ceid: "BD:en" },
  "Sri Lanka": { gl: "LK", hl: "en-LK", ceid: "LK:en" },
  Nepal: { gl: "NP", hl: "en-NP", ceid: "NP:en" },
  Indonesia: { gl: "ID", hl: "en-ID", ceid: "ID:en" },
  Philippines: { gl: "PH", hl: "en-PH", ceid: "PH:en" },
  Vietnam: { gl: "VN", hl: "en-VN", ceid: "VN:en" },
  Thailand: { gl: "TH", hl: "en-TH", ceid: "TH:en" },
  Malaysia: { gl: "MY", hl: "en-MY", ceid: "MY:en" },
  Japan: { gl: "JP", hl: "en-JP", ceid: "JP:en" },
  "South Korea": { gl: "KR", hl: "en-KR", ceid: "KR:en" },
  "Saudi Arabia": { gl: "SA", hl: "en-SA", ceid: "SA:en" },
  "United Arab Emirates": { gl: "AE", hl: "en-AE", ceid: "AE:en" },
  Qatar: { gl: "QA", hl: "en-QA", ceid: "QA:en" },
  Kuwait: { gl: "KW", hl: "en-KW", ceid: "KW:en" },
  Oman: { gl: "OM", hl: "en-OM", ceid: "OM:en" },
  Bahrain: { gl: "BH", hl: "en-BH", ceid: "BH:en" },
  Australia: { gl: "AU", hl: "en-AU", ceid: "AU:en" },
  "New Zealand": { gl: "NZ", hl: "en-NZ", ceid: "NZ:en" },
};

// Shared denylist of market/finance/PR/homonym noise common to all three
// land-commodity topics. Topic-specific extras are appended below.
const COMMON_DENY = [
  "share price",
  "stock price",
  "stocks to buy",
  "shares to buy",
  "earnings",
  "quarterly result",
  "quarterly results",
  "dividend",
  "buyback",
  "ipo",
  "merger",
  "acquisition of",
  "acquires",
  "joint venture",
  "analyst",
  "price target",
  "summit",
  "conference",
  "webinar",
  "expo 2026",
  "awards",
  "recipe",
];

function countryFeeds(
  countries: string[],
  termGroup: string,
): TopicFeed[] {
  return countries.map((c) => ({
    label: `${c}`,
    q: `${termGroup} "${c}"`,
    defaultCountry: c,
    ...(EDITIONS[c] ?? {}),
  }));
}

const SOUTH_APAC = [
  "India",
  "Pakistan",
  "Bangladesh",
  "Sri Lanka",
  "Nepal",
  "Myanmar",
  "Indonesia",
  "Philippines",
  "Vietnam",
  "Thailand",
];

// ---------------------------------------------------------------- energy ----
const ENERGY_TERMS = `("power outage" OR "power cut" OR "blackout" OR "load shedding" OR "load-shedding" OR "grid failure" OR "electricity crisis" OR "power shortage" OR "substation fire" OR "power tariff" OR "energy crisis")`;

const ENERGY_CONFIG: NewsTopicConfig = {
  topic: "energy",
  feeds: [
    ...countryFeeds(SOUTH_APAC, ENERGY_TERMS),
    { label: "Load shedding (region)", q: `"load shedding" (Pakistan OR Bangladesh OR "Sri Lanka" OR India OR Nepal)`, defaultCountry: "Unknown" },
    { label: "Grid attack/sabotage", q: `(substation OR "transmission line" OR pipeline OR grid) (attack OR sabotage OR blast OR explosion OR fire) (India OR Pakistan OR Myanmar OR Bangladesh OR Iran OR Iraq)`, defaultCountry: "Unknown" },
  ],
  allow: [
    "power outage",
    "power cut",
    "blackout",
    "load shedding",
    "load-shedding",
    "grid failure",
    "grid collapse",
    "electricity shortage",
    "electricity crisis",
    "power shortage",
    "power crisis",
    "power rationing",
    "substation fire",
    "substation attack",
    "transmission line",
    "pipeline attack",
    "pipeline sabotage",
    "power tariff",
    "electricity tariff",
    "energy crisis",
    "energy emergency",
    "generation shortfall",
    "capacity shortfall",
  ],
  deny: [
    ...COMMON_DENY,
    "energy drink",
    "renewable energy investment",
    "clean energy summit",
    "solar farm",
    "wind farm",
    "energy stocks",
    "energy sector stocks",
  ],
  countryAliases: COUNTRY_ALIASES,
};

// ------------------------------------------------------------ fertiliser ----
const FERT_TERMS = `("fertiliser shortage" OR "fertilizer shortage" OR "fertiliser price" OR "fertilizer price" OR "urea shortage" OR "urea price" OR "fertiliser subsidy" OR "fertilizer subsidy" OR "potash" OR "DAP shortage" OR "farmers protest")`;

const FERT_CONFIG: NewsTopicConfig = {
  topic: "fertiliser",
  feeds: [
    ...countryFeeds(SOUTH_APAC, FERT_TERMS),
    { label: "Urea supply (region)", q: `("urea" OR "DAP" OR "potash" OR "ammonia") (shortage OR "supply crisis" OR "export ban" OR "import") (India OR Pakistan OR Bangladesh OR "Sri Lanka" OR Nepal)`, defaultCountry: "Unknown" },
  ],
  allow: [
    "fertiliser shortage",
    "fertilizer shortage",
    "fertiliser price",
    "fertilizer price",
    "fertiliser supply",
    "fertilizer supply",
    "fertiliser subsidy",
    "fertilizer subsidy",
    "fertiliser export",
    "fertiliser import",
    "fertiliser stockout",
    "fertiliser plant",
    "urea shortage",
    "urea price",
    "urea supply",
    "potash",
    "dap shortage",
    "dap price",
    "nitrogen fertiliser",
    "phosphate",
    "ammonia",
    "farmer protest",
    "farmers protest",
    "farmers' protest",
    "food security",
  ],
  deny: [
    ...COMMON_DENY,
    "gardening",
    "compost tips",
    "organic fertiliser tips",
  ],
  countryAliases: COUNTRY_ALIASES,
};

// ------------------------------------------------------------------ fuel ----
const FUEL_TERMS = `("fuel shortage" OR "fuel crisis" OR "fuel rationing" OR "petrol shortage" OR "diesel shortage" OR "fuel price hike" OR "refinery fire" OR "refinery outage" OR "fuel subsidy" OR "LPG shortage" OR "pump price")`;

const FUEL_CONFIG: NewsTopicConfig = {
  topic: "fuel",
  feeds: [
    ...countryFeeds(SOUTH_APAC, FUEL_TERMS),
    { label: "Refinery disruption (region)", q: `(refinery OR "fuel depot" OR pipeline) (fire OR outage OR shutdown OR attack OR explosion OR blast OR maintenance OR halt) (India OR Pakistan OR Iran OR Iraq OR "Saudi Arabia" OR UAE)`, defaultCountry: "Unknown" },
  ],
  allow: [
    "fuel shortage",
    "fuel crisis",
    "fuel rationing",
    "fuel queue",
    "fuel stockout",
    "fuel supply",
    "petrol shortage",
    "petrol price",
    "diesel shortage",
    "diesel price",
    "kerosene shortage",
    "refinery fire",
    "refinery outage",
    "refinery shutdown",
    "refinery attack",
    "refinery maintenance",
    "refinery halt",
    "fuel depot",
    "fuel subsidy",
    "pump price",
    "petrol pump",
    "forecourt",
    "lpg shortage",
    "cng shortage",
    "tanker driver",
    "oil supply cut",
    "crude supply",
  ],
  deny: [
    ...COMMON_DENY,
    "futures",
    "per barrel",
    "per bbl",
    "brent crude to",
    "wti to",
    "hedge fund",
    "speculat",
    "ev sales",
    "electric vehicle",
    "oil futures",
    "price forecast",
    "price outlook",
  ],
  countryAliases: COUNTRY_ALIASES,
};

export function runEnergyIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(ENERGY_CONFIG, opts);
}

export function runFertiliserIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(FERT_CONFIG, opts);
}

export function runFuelIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(FUEL_CONFIG, opts);
}
