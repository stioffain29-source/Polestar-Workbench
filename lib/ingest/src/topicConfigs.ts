import { runNewsTopicIngest, type CountryAlias, type NewsTopicConfig, type TopicFeed } from "./newsTopic";
import type { IngestOptions, IngestSummary } from "./types";

// Live feed configs for the previously import-only land topics: energy,
// fertiliser and fuel. Each config's allow/deny lists are kept aligned with the
// matching REQUIRED rule in @workspace/relevance so accepted items pass the
// central relevance gate and surface in their monitor.

// Shared South/SE/East-Asia + Middle East country alias map. Order matters:
// more specific actors precede broader regional names. Covers the APAC and
// South Asia footprint of the energy/fertiliser/fuel monitors.
// Exported so the one-time news-topic country backfill (backfillNewsCountry.ts)
// re-derives existing 'Unknown' rows through the SAME gazetteer the live ingest
// uses — no second, drift-prone copy of the alias list.
//
// Beyond bare country/capital names, in-region grid news routinely names ONLY a
// state, city, utility or regulator (e.g. "K-Electric", "NEPRA", "Gazipur",
// "NEA", "Kerala") with no country word, so the region feeds dropped them to
// 'Unknown'. The added aliases are deliberately UNAMBIGUOUS, single-country
// identifiers validated against the live Unknown set; generic electrical terms
// (e.g. "brownout") are intentionally excluded to stay precision-first.
export const COUNTRY_ALIASES: CountryAlias[] = [
  { canonical: "India", aliases: ["india", "indian", "delhi", "mumbai", "kolkata", "chennai", "bengaluru", "uttar pradesh", "maharashtra", "punjab", "bihar", "tamil nadu", "kerala", "gurugram", "gurgaon", "karnataka", "telangana", "gujarat", "rajasthan", "odisha", "kochi", "krishnankutty"] },
  { canonical: "Pakistan", aliases: ["pakistan", "pakistani", "karachi", "lahore", "islamabad", "punjab province", "sindh", "balochistan", "khyber", "k-electric", "k electric", "kelectric", "lesco", "hesco", "nepra", "peshawar", "quetta", "multan", "faisalabad", "rawalpindi", "gujranwala", "leghari", "shehbaz", "ufone"] },
  { canonical: "Bangladesh", aliases: ["bangladesh", "bangladeshi", "dhaka", "chittagong", "chattogram", "bkmea", "bpdb", "desco", "gazipur", "brahmanbaria", "sylhet", "khulna", "jessore", "narayanganj", "rajshahi", "barisal", "mymensingh", "ctg", "comilla", "cumilla", "bogura", "rmg", "nasrul"] },
  { canonical: "Sri Lanka", aliases: ["sri lanka", "sri lankan", "colombo", "ceylon", "ceb", "sajith", "kandy", "jaffna"] },
  { canonical: "Nepal", aliases: ["nepal", "nepali", "kathmandu", "nea", "ghising", "chitwan", "pokhara", "biratnagar"] },
  { canonical: "Myanmar", aliases: ["myanmar", "burma", "burmese", "yangon", "naypyidaw", "mandalay"] },
  { canonical: "Indonesia", aliases: ["indonesia", "indonesian", "jakarta", "java", "sumatra", "surabaya"] },
  { canonical: "Philippines", aliases: ["philippines", "filipino", "manila", "luzon", "mindanao", "cebu", "meralco", "napocor", "visayas", "davao", "iloilo"] },
  { canonical: "Vietnam", aliases: ["vietnam", "vietnamese", "hanoi", "ho chi minh"] },
  { canonical: "Thailand", aliases: ["thailand", "thai", "bangkok", "koh larn", "phuket", "chiang mai", "pattaya"] },
  { canonical: "Malaysia", aliases: ["malaysia", "malaysian", "kuala lumpur"] },
  { canonical: "China", aliases: ["china", "chinese", "beijing", "shanghai", "guangdong"] },
  { canonical: "Japan", aliases: ["japan", "japanese", "tokyo", "osaka", "tepco", "fukushima"] },
  { canonical: "South Korea", aliases: ["south korea", "korean", "seoul", "busan"] },
  { canonical: "Iran", aliases: ["iran", "iranian", "tehran"] },
  { canonical: "Iraq", aliases: ["iraq", "iraqi", "baghdad", "basra"] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "riyadh", "jeddah", "yanbu", "dammam", "dhahran", "mecca", "medina"] },
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
// Grid-stress footprint: South/SE Asia + East Asia + the Gulf + Oceania. The
// import-only feed had covered only SOUTH_APAC, so Middle East / Australia /
// New Zealand grid news never arrived; the US Google-News edition then flooded
// the country feeds with US-local outages (now fixed via per-country EDITIONS
// + ENERGY_EXCLUDE in @workspace/relevance).
const ENERGY_COUNTRIES = [
  ...SOUTH_APAC,
  "Malaysia",
  "China",
  "Japan",
  "South Korea",
  "Iran",
  "Iraq",
  "Saudi Arabia",
  "United Arab Emirates",
  "Qatar",
  "Kuwait",
  "Oman",
  "Bahrain",
  "Australia",
  "New Zealand",
];

const ENERGY_TERMS = `("power outage" OR "power cut" OR "blackout" OR "brownout" OR "rolling blackout" OR "load shedding" OR "load-shedding" OR "grid failure" OR "power grid" OR "electricity crisis" OR "power shortage" OR "electricity shortage" OR "power rationing" OR "electricity price" OR "electricity tariff" OR "power tariff" OR "energy crisis" OR "energy shortage" OR "gas shortage" OR "substation fire")`;

const ENERGY_CONFIG: NewsTopicConfig = {
  topic: "energy",
  feeds: [
    ...countryFeeds(ENERGY_COUNTRIES, ENERGY_TERMS),
    { label: "Load shedding (region)", q: `"load shedding" (Pakistan OR Bangladesh OR "Sri Lanka" OR India OR Nepal)`, defaultCountry: "Unknown" },
    { label: "Brownout/tariff (region)", q: `(brownout OR "rolling blackout" OR "electricity tariff" OR "power tariff" OR "tariff hike" OR "electricity price") (India OR Pakistan OR Philippines OR Indonesia OR Australia OR "New Zealand" OR "Saudi Arabia" OR "United Arab Emirates")`, defaultCountry: "Unknown" },
    { label: "Grid attack/sabotage", q: `(substation OR "transmission line" OR pipeline OR grid) (attack OR sabotage OR blast OR explosion OR fire) (India OR Pakistan OR Myanmar OR Bangladesh OR Iran OR Iraq OR "Saudi Arabia")`, defaultCountry: "Unknown" },
  ],
  allow: [
    "power outage",
    "power cut",
    "blackout",
    "brownout",
    "rolling blackout",
    "load shedding",
    "load-shedding",
    "grid failure",
    "grid collapse",
    "grid strain",
    "electricity shortage",
    "electricity crisis",
    "power shortage",
    "power crisis",
    "power rationing",
    "electricity rationing",
    "substation fire",
    "substation attack",
    "transmission line",
    "pipeline attack",
    "pipeline sabotage",
    "power tariff",
    "electricity tariff",
    "tariff hike",
    "electricity price",
    "power price",
    "energy price",
    "energy crisis",
    "energy emergency",
    "energy shortage",
    "gas shortage",
    "peak demand",
    "generation shortfall",
    "capacity shortfall",
    "supply shortfall",
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
    // Out-of-region US / Canadian / African utilities + local distribution
    // faults the old US Google-News edition injected into the country feeds.
    "duke energy",
    "dominion energy",
    "consumers energy",
    "nv energy",
    "pg&e",
    "con edison",
    "georgia power",
    "florida power",
    "outage tracker",
    "outage map",
    "in your area",
    "downed tree",
    "tree crew",
    "county",
    "canada",
    "canadian",
    "nersa",
    "ferrochrome",
    "eskom",
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
const FUEL_TERMS = `("fuel shortage" OR "fuel crisis" OR "fuel rationing" OR "fuel conservation" OR "diesel rationing" OR "diesel restriction" OR "petrol shortage" OR "diesel shortage" OR "fuel price hike" OR "refinery fire" OR "refinery outage" OR "fuel subsidy" OR "LPG shortage" OR "pump price" OR "aviation turbine fuel" OR "jet fuel shortage" OR "fuel pass" OR "fuel queue" OR "fuel protest" OR "aviation fuel" OR "fuel export")`;

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
    "fuel conservation",
    "diesel rationing",
    "petrol rationing",
    "diesel restriction",
    "fuel queue",
    "fuel protest",
    "fuel pass",
    "national fuel pass",
    "aviation turbine fuel",
    "jet fuel",
    "aviation fuel",
    "fuel export",
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

// -------------------------------------------------------------- conflict ----
// War / armed conflict / insurgency / armed crime. This is a SEPARATE topic
// from `flashpoint` (which stays strictly activism / protests / strikes / civil
// disorder). Conflict feeds the COUNTRY and SPOT reports with kinetic, armed
// events: insurgencies, firefights, bombings, ambushes, named armed groups and
// serious armed crime. It must never write protest/demonstration rows.
//
// Country attribution uses a Papua-first alias map so a Freeport / Grasberg /
// Timika mine-security story resolves to "West Papua" (its own country report)
// rather than being swallowed by the broad "Indonesia" alias.
const CONFLICT_ALIASES: CountryAlias[] = [
  { canonical: "West Papua", aliases: ["west papua", "papua barat", "tembagapura", "grasberg", "freeport", "pt freeport", "timika", "mimika", "kuala kencana", "intan jaya", "puncak jaya", "nduga", "ilaga", "sugapa", "paniai", "enarotali", "yahukimo", "dekai", "oksibil", "beoga", "kenyam", "wamena", "nabire", "jayapura", "merauke", "manokwari", "sorong", "biak", "tpnpb"] },
  { canonical: "Papua New Guinea", aliases: ["papua new guinea", "port moresby", "bougainville", "enga", "hela", "mount hagen", "goroka", "wewak", "raskol"] },
  { canonical: "India", aliases: ["india", "indian", "delhi", "mumbai", "kashmir", "jammu", "srinagar", "manipur", "imphal", "chhattisgarh", "jharkhand", "bastar", "naxal", "maoist", "assam", "nagaland"] },
  { canonical: "Pakistan", aliases: ["pakistan", "pakistani", "balochistan", "quetta", "waziristan", "khyber", "peshawar", "karachi", "lahore", "islamabad"] },
  { canonical: "Bangladesh", aliases: ["bangladesh", "bangladeshi", "dhaka", "chittagong", "chattogram"] },
  { canonical: "Sri Lanka", aliases: ["sri lanka", "sri lankan", "colombo"] },
  { canonical: "Nepal", aliases: ["nepal", "nepali", "kathmandu"] },
  { canonical: "Myanmar", aliases: ["myanmar", "burma", "burmese", "yangon", "naypyidaw", "mandalay", "rakhine", "arakan", "shan state", "kachin", "chin state", "sagaing", "karen state", "kayah", "magway", "rohingya"] },
  { canonical: "Indonesia", aliases: ["indonesia", "indonesian", "jakarta", "java", "sumatra", "sulawesi", "poso", "aceh"] },
  { canonical: "Philippines", aliases: ["philippines", "filipino", "manila", "mindanao", "sulu", "jolo", "basilan", "maguindanao", "cotabato", "marawi", "zamboanga", "abu sayyaf", "bangsamoro"] },
  { canonical: "Vietnam", aliases: ["vietnam", "vietnamese", "hanoi", "ho chi minh"] },
  { canonical: "Thailand", aliases: ["thailand", "thai", "bangkok", "pattani", "yala", "narathiwat", "songkhla"] },
  { canonical: "Malaysia", aliases: ["malaysia", "malaysian", "kuala lumpur", "sabah", "sarawak"] },
  { canonical: "China", aliases: ["china", "chinese", "xinjiang", "beijing"] },
];

const CONFLICT_COUNTRIES = [...SOUTH_APAC, "Malaysia"];

const CONFLICT_TERMS = `("armed clash" OR "gun battle" OR firefight OR shootout OR insurgent OR insurgency OR militant OR rebel OR separatist OR ambush OR "roadside bomb" OR "armed group" OR "armed attack" OR gunmen OR "armed robbery" OR kidnapping OR abduction OR "shot dead")`;

const CONFLICT_CONFIG: NewsTopicConfig = {
  topic: "conflict",
  feeds: [
    ...countryFeeds(CONFLICT_COUNTRIES, CONFLICT_TERMS),
    // Dedicated insurgency / armed-group feeds for the active APAC theatres.
    { label: "Papua mine security (Freeport/Grasberg)", q: `("Freeport" OR "Grasberg" OR "Tembagapura" OR "Timika" OR Mimika OR "PT Freeport") (shooting OR shot OR killed OR clash OR attack OR ambush OR gunmen OR TPNPB OR "armed group" OR rebel OR security OR blockade OR kidnap)`, defaultCountry: "West Papua" },
    { label: "Papua insurgency (TPNPB/OPM)", q: `(Papua OR "West Papua") (TPNPB OR "free papua" OR "armed group" OR rebel OR separatist OR shooting OR ambush OR "shot dead" OR gunmen OR insurgent OR "security forces")`, defaultCountry: "West Papua" },
    { label: "Papua New Guinea tribal conflict", q: `("Papua New Guinea" OR Enga OR Hela OR Highlands) ("tribal fight" OR "tribal clash" OR "tribal war" OR ambush OR massacre OR "armed men" OR raskol OR gunmen OR killed)`, defaultCountry: "Papua New Guinea" },
    { label: "Myanmar civil war", q: `(Myanmar OR Burma) (junta OR airstrike OR "air strike" OR offensive OR "armed clash" OR clash OR resistance OR insurgent OR militia OR "ethnic armed" OR "Arakan Army" OR fighting)`, defaultCountry: "Myanmar" },
    { label: "Philippines insurgency", q: `(Philippines OR Mindanao OR Sulu) ("New People's Army" OR NPA OR "Abu Sayyaf" OR BIFF OR "armed encounter" OR clash OR ambush OR insurgent OR firefight)`, defaultCountry: "Philippines", ...(EDITIONS["Philippines"] ?? {}) },
    { label: "Thailand deep south", q: `(Thailand OR Pattani OR Yala OR Narathiwat OR Songkhla) (insurgent OR bombing OR "roadside bomb" OR shooting OR ambush OR militant OR "armed attack")`, defaultCountry: "Thailand", ...(EDITIONS["Thailand"] ?? {}) },
    { label: "India insurgency", q: `(India OR Manipur OR Kashmir OR Chhattisgarh OR Jharkhand) (Naxal OR Maoist OR militant OR insurgent OR "security forces" OR encounter OR ambush OR "gun battle" OR firefight)`, defaultCountry: "India", ...(EDITIONS["India"] ?? {}) },
    { label: "Pakistan militancy", q: `(Pakistan OR Balochistan OR Waziristan OR "Khyber Pakhtunkhwa") ("Pakistani Taliban" OR militant OR insurgent OR "bomb blast" OR ambush OR "security forces" OR "armed attack")`, defaultCountry: "Pakistan", ...(EDITIONS["Pakistan"] ?? {}) },
  ],
  allow: [
    "armed clash",
    "armed clashes",
    "armed conflict",
    "armed attack",
    "armed assault",
    "armed group",
    "armed men",
    "armed gang",
    "armed robbery",
    "armed hold-up",
    "gun battle",
    "gunbattle",
    "gun fight",
    "gunfight",
    "firefight",
    "shootout",
    "shoot-out",
    "crossfire",
    "cross-fire",
    "exchange of fire",
    "opened fire",
    "insurgent",
    "insurgency",
    "militant",
    "rebel",
    "separatist",
    "guerrilla",
    "paramilitary",
    "militia",
    "warlord",
    "junta",
    "ambush",
    "incursion",
    "skirmish",
    "improvised explosive",
    "roadside bomb",
    "landmine",
    "land mine",
    "car bomb",
    "truck bomb",
    "grenade attack",
    "bomb blast",
    "suicide bomb",
    "drone strike",
    "airstrike",
    "air strike",
    "abduction",
    "abducted",
    "kidnap",
    "kidnapped",
    "kidnapping",
    "hostage",
    "gunmen",
    "gunman",
    "shot dead",
    "gunned down",
    "mass shooting",
    "massacre",
    "tpnpb",
    "free papua",
    "new people's army",
    "abu sayyaf",
    "bangsamoro",
    "tehrik",
    "pakistani taliban",
    "baloch",
    "naxal",
    "maoist",
    "arakan army",
    "ethnic armed",
  ],
  deny: [
    ...COMMON_DENY,
    "box office",
    "movie",
    "film review",
    "trailer",
    "video game",
    "gameplay",
    "match report",
    "match preview",
    "full match",
    "highlights",
    "boxing",
    "wrestling",
    "ufc",
    "esports",
    "military exercise",
    "joint exercise",
    "war game",
    "war games",
    "book review",
  ],
  countryAliases: CONFLICT_ALIASES,
};

export function runEnergyIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(ENERGY_CONFIG, opts);
}

export function runConflictIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(CONFLICT_CONFIG, opts);
}

export function runFertiliserIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(FERT_CONFIG, opts);
}

export function runFuelIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(FUEL_CONFIG, opts);
}
