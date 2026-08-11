import { runNewsTopicIngest, type CountryAlias, type NewsTopicConfig, type TopicFeed } from "./newsTopic";
import { classifyNewsConfidence } from "./newsConfidence";
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

// Out-of-region ("global market") gazetteer, appended AFTER COUNTRY_ALIASES so
// region attribution still wins (region-first) — a story naming both an in-scope
// theatre and a global one resolves to the in-scope theatre. Used ONLY by the
// energy / fuel / fertiliser configs (GLOBAL_TOPIC_ALIASES below), never by the
// region-locked topics (flashpoint / conflict / shipping / cargo).
//
// The energy/fuel/fertiliser monitors serve regionally-based clients operating
// in GLOBAL markets, so out-of-region grid/refinery/fertiliser events are
// surfaced rather than dropped. Tokens are deliberately UNAMBIGUOUS single-
// country identifiers with no in-scope collision: bare "georgia" (US state vs
// country) and "washington" (D.C. / surname) are omitted; every canonical has a
// matching COUNTRY_CENTROIDS entry AND a world-choropleth polygon so map==table
// parity holds. Blocs ("Europe", "Pacific", "EU") are omitted (no polygon).
export const GLOBAL_EXTRA_ALIASES: CountryAlias[] = [
  { canonical: "United States", aliases: ["united states", "u.s.", "u.s.a.", "usa", "america", "american", "americans", "texas", "california", "florida", "ohio", "michigan", "illinois", "pennsylvania", "new york", "new jersey", "virginia", "north carolina", "south carolina", "wisconsin", "minnesota", "nevada", "oregon", "colorado", "arizona", "maryland", "massachusetts", "tennessee", "kentucky", "indiana", "missouri", "houston", "dallas", "austin", "denver", "atlanta", "seattle", "sacramento", "baltimore", "annapolis", "amarillo", "chicago", "detroit", "milwaukee", "minneapolis", "ercot"] },
  { canonical: "Canada", aliases: ["canada", "canadian", "canadians", "ontario", "quebec", "québec", "alberta", "british columbia", "toronto", "vancouver", "montreal"] },
  { canonical: "South Africa", aliases: ["south africa", "south african", "eskom", "nersa", "johannesburg", "pretoria", "cape town", "durban"] },
  { canonical: "Nigeria", aliases: ["nigeria", "nigerian", "nigerians", "lagos", "abuja", "port harcourt"] },
  { canonical: "Niger", aliases: ["niger republic", "niamey"] },
  { canonical: "Kenya", aliases: ["kenya", "kenyan", "kenyans", "nairobi"] },
  { canonical: "Ghana", aliases: ["ghana", "ghanaian", "accra", "dumsor"] },
  { canonical: "Zimbabwe", aliases: ["zimbabwe", "zimbabwean", "harare", "zesa"] },
  { canonical: "Zambia", aliases: ["zambia", "zambian", "lusaka", "zesco"] },
  { canonical: "Spain", aliases: ["spain", "spanish", "madrid", "barcelona", "iberia", "iberian"] },
  { canonical: "Portugal", aliases: ["portugal", "portuguese", "lisbon"] },
  { canonical: "Ukraine", aliases: ["ukraine", "ukrainian", "ukrainians", "kyiv", "kiev", "zaporizhzhia", "kharkiv", "odesa", "odessa", "crimea", "crimean", "sevastopol", "simferopol", "balaklava", "kerch"] },
  { canonical: "Russia", aliases: ["russia", "russian", "russians", "moscow", "rosseti"] },
  { canonical: "Germany", aliases: ["germany", "german", "germans", "berlin", "hamburg", "munich"] },
  { canonical: "Cuba", aliases: ["cuba", "cuban", "cubans", "havana"] },
  { canonical: "Mongolia", aliases: ["mongolia", "mongolian", "ulaanbaatar"] },
  { canonical: "Turkey", aliases: ["turkey", "turkish", "turkiye", "istanbul", "ankara"] },
  { canonical: "United Kingdom", aliases: ["united kingdom", "britain", "british", "england", "scotland", "london"] },
  { canonical: "Venezuela", aliases: ["venezuela", "venezuelan", "caracas"] },
  { canonical: "France", aliases: ["france", "french", "paris"] },
  { canonical: "Poland", aliases: ["poland", "polish", "warsaw"] },
];

// Region + global gazetteer for the three global-market topics. Region-first.
export const GLOBAL_TOPIC_ALIASES: CountryAlias[] = [...COUNTRY_ALIASES, ...GLOBAL_EXTRA_ALIASES];

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

export const ENERGY_CONFIG: NewsTopicConfig = {
  topic: "energy",
  feeds: [
    ...countryFeeds(ENERGY_COUNTRIES, ENERGY_TERMS),
    { label: "Load shedding (region)", q: `"load shedding" (Pakistan OR Bangladesh OR "Sri Lanka" OR India OR Nepal)`, defaultCountry: "Unknown" },
    { label: "Brownout/tariff (region)", q: `(brownout OR "rolling blackout" OR "electricity tariff" OR "power tariff" OR "tariff hike" OR "electricity price") (India OR Pakistan OR Philippines OR Indonesia OR Australia OR "New Zealand" OR "Saudi Arabia" OR "United Arab Emirates")`, defaultCountry: "Unknown" },
    // Philippines grid alerts are issued and reported sub-nationally (NGCP
    // yellow/red alerts, rotating brownouts per region/city). The broad national
    // energy query is rank-capped by Google News and these local items rarely
    // make the cut, so a place-anchored PH-edition feed surfaces them.
    { label: "Philippines grid alerts (sub-national)", q: `(Visayas OR Luzon OR Mindanao OR Cebu OR Negros OR Panay OR Iloilo OR Bacolod OR "Metro Cebu") (brownout OR "rotating brownout" OR "rotational brownout" OR "yellow alert" OR "red alert" OR "power outage" OR "power interruption" OR "power supply")`, defaultCountry: "Philippines", ...(EDITIONS["Philippines"] ?? {}) },
    // Indonesia's mid-2026 grid stress (Java/Sumatra rolling power outages tied
    // to a PLN medium-calorie coal-supply shortfall) is reported sub-nationally
    // and via the state utility (PLN); the broad national energy query is
    // rank-capped by Google News and these local items rarely make the cut, so a
    // place/utility-anchored ID-edition feed surfaces the cluster. Coal-policy /
    // energy-transition noise it also pulls is dropped by the deny list +
    // ENERGY_EXCLUDE.
    { label: "Indonesia grid/coal stress (sub-national)", q: `(Java OR Sumatra OR Sulawesi OR Kalimantan OR Jakarta OR PLN) (blackout OR "power outage" OR "power outages" OR "rolling outage" OR "rolling blackout" OR "power cut" OR "power shortage" OR "coal supply" OR "coal shortage")`, defaultCountry: "Indonesia", ...(EDITIONS["Indonesia"] ?? {}) },
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
    // Coal-as-grid-fuel stress (Indonesia PLN medium-calorie coal shortfall).
    // Precision-bound to a shortage word so coal-mining / coal-export business
    // does not slip through; coal-policy noise is dropped by the deny list.
    "coal shortage",
    "coal supply shortage",
    "coal supply crunch",
    "coal supply concern",
    "coal supply concerns",
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
    // NB: geography-only denies (canada / canadian / nersa / eskom /
    // ferrochrome) were REMOVED — the monitors now surface out-of-region grid
    // events, so a South Africa (Eskom/NERSA) or Canada national grid story is
    // KEPT and attributed via GLOBAL_TOPIC_ALIASES. Distribution-level noise
    // (investor-owned utilities, county feeders, outage-tracker SEO) stays
    // denied because it carries no market signal at any geography.
    // Coal-policy / energy-transition / climate-finance commentary that shares
    // the coal / power-plant vocabulary but is not an operational grid event.
    "coal transition",
    "coal exit",
    "coal phase-out",
    "coal pact",
    "coal production",
    "coal dependence",
    "transition finance",
    "decarbon",
    "early retirement",
    "clean energy opportunit",
  ],
  countryAliases: GLOBAL_TOPIC_ALIASES,
  globalExtraAliases: GLOBAL_EXTRA_ALIASES,
};

// ------------------------------------------------------------ fertiliser ----
const FERT_TERMS = `("fertiliser shortage" OR "fertilizer shortage" OR "fertiliser price" OR "fertilizer price" OR "urea shortage" OR "urea price" OR "fertiliser subsidy" OR "fertilizer subsidy" OR "potash" OR "DAP shortage" OR "farmers protest")`;

export const FERTILISER_CONFIG: NewsTopicConfig = {
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
  countryAliases: GLOBAL_TOPIC_ALIASES,
  globalExtraAliases: GLOBAL_EXTRA_ALIASES,
};

// ------------------------------------------------------------------ fuel ----
const FUEL_TERMS = `("fuel shortage" OR "fuel crisis" OR "fuel rationing" OR "fuel conservation" OR "diesel rationing" OR "diesel restriction" OR "petrol shortage" OR "diesel shortage" OR "fuel price hike" OR "refinery fire" OR "refinery outage" OR "fuel subsidy" OR "LPG shortage" OR "pump price" OR "aviation turbine fuel" OR "jet fuel shortage" OR "fuel pass" OR "fuel queue" OR "fuel protest" OR "aviation fuel" OR "fuel export")`;

export const FUEL_CONFIG: NewsTopicConfig = {
  topic: "fuel",
  feeds: [
    ...countryFeeds(SOUTH_APAC, FUEL_TERMS),
    { label: "Refinery disruption (region)", q: `(refinery OR "fuel depot" OR pipeline) (fire OR outage OR shutdown OR attack OR explosion OR blast OR maintenance OR halt) (India OR Pakistan OR Iran OR Iraq OR "Saudi Arabia" OR UAE)`, defaultCountry: "Unknown" },
    // Crude EXPORT disruption — loading terminals, blockades, floating
    // storage. The refinery feed above never fetched stories like the Kharg
    // Island export halt (Aug 2026): a terminal going idle is neither a
    // refinery nor a depot event, so the whole class was invisible.
    { label: "Crude export disruption (Gulf)", q: `("crude exports" OR "oil exports" OR "export terminal" OR "oil terminal" OR Kharg) (halt OR halted OR stall OR stalled OR suspended OR idle OR blockade OR disrupted OR resume) (Iran OR Iraq OR "Saudi Arabia" OR UAE OR Kuwait OR Qatar OR Oman)`, defaultCountry: "Unknown" },
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
    // Crude EXPORT disruption class (Kharg gap, Aug 2026)
    "crude export",
    "oil export",
    "export terminal",
    "oil terminal",
    "loading terminal",
    "kharg",
    "floating storage",
    "tanker loading",
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
  countryAliases: GLOBAL_TOPIC_ALIASES,
  globalExtraAliases: GLOBAL_EXTRA_ALIASES,
};

// ----------------------------------------------------------- data_centres ----
// Data-centre coverage: operational disruption AND build-out / planning risk.
// A world-scope market topic (like energy/fertiliser/fuel) — the choropleth
// paints countries globally — but the news feed leans on the major DC markets.
// Two signal families: (1) operational incidents (outage, cooling/power
// failure, fire, flood, downtime, cyber disruption) and (2) planning / build-
// out risk (planning refused, moratorium, water/power constraint, community
// opposition, grid-connection block). Business M&A / earnings noise is denied.
const DATA_CENTRE_COUNTRIES = [
  ...SOUTH_APAC,
  "Malaysia",
  "Singapore",
  "China",
  "Japan",
  "South Korea",
  "Taiwan",
  "Australia",
  "New Zealand",
  "United States",
  "United Kingdom",
  "Ireland",
  "Netherlands",
  "Germany",
  "France",
  "Saudi Arabia",
  "United Arab Emirates",
];

const DATA_CENTRE_TERMS = `("data centre" OR "data center" OR "data centres" OR "data centers" OR "server farm" OR "hyperscale" OR "colocation" OR "cloud region") (outage OR "power failure" OR "cooling failure" OR fire OR flood OR downtime OR disruption OR "planning refused" OR moratorium OR "grid connection" OR "water use" OR opposition OR blackout OR cyberattack OR "power constraint")`;

const DATA_CENTRE_CONFIG: NewsTopicConfig = {
  topic: "data_centres",
  feeds: [
    ...countryFeeds(DATA_CENTRE_COUNTRIES, DATA_CENTRE_TERMS),
    { label: "DC outage (region)", q: `("data centre" OR "data center" OR hyperscale OR colocation) (outage OR "cooling failure" OR "power failure" OR downtime OR fire OR flood) (Singapore OR Malaysia OR Indonesia OR India OR Japan OR Australia)`, defaultCountry: "Unknown" },
    { label: "DC planning risk (region)", q: `("data centre" OR "data center" OR hyperscale) ("planning refused" OR moratorium OR "grid connection" OR "water constraint" OR "power constraint" OR opposition OR "environmental review")`, defaultCountry: "Unknown" },
  ],
  allow: [
    "data centre",
    "data center",
    "data centres",
    "data centers",
    "server farm",
    "hyperscale",
    "colocation",
    "cloud region",
    "cloud facility",
    "hosting provider",
  ],
  deny: [
    ...COMMON_DENY,
    "data center market",
    "data centre market",
    "market size",
    "market report",
    "cagr",
    "forecast to 20",
    "research report",
    "job openings",
    "hiring",
    "career",
  ],
  countryAliases: GLOBAL_TOPIC_ALIASES,
  globalExtraAliases: GLOBAL_EXTRA_ALIASES,
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

export const CONFLICT_CONFIG: NewsTopicConfig = {
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

// ---------------------------------------------------------------------------
// indonesia_local — broad Bahasa-first local coverage for the Indonesia Weekly
// and Jakarta Weekly country reports. Unlike the commodity topics this feed is
// deliberately wide (unrest, crime, natural hazard, fire, haze, transport,
// government stability, labour, terrorism). The country reports already read by
// COUNTRY, so rows stamped country="Indonesia" flow into the Indonesia report
// and Jakarta-scoped rows into the Jakarta report automatically; flashpoint is
// left untouched (unrest-only).
//
// Feeds use the Indonesian-language Google News edition (gl=ID, hl=id,
// ceid=ID:id) so the breadth of local reporting is captured; the title-
// translation pass renders display_title in English for the reports. A separate
// English ID-edition feed picks up Indonesia's English-language outlets.
// ---------------------------------------------------------------------------

// Indonesian-language Google News edition.
const ID_BAHASA = { gl: "ID", hl: "id", ceid: "ID:id" } as const;
// English Indonesia edition (Jakarta Post / Jakarta Globe etc.).
const ID_ENGLISH = { gl: "ID", hl: "en-ID", ceid: "ID:en" } as const;

// Country routing for indonesia_local. West Papua is listed FIRST (with the
// bare "papua" token and the full Papua-provinces gazetteer) so any Papua story
// is diverted to its own "West Papua" report and NEVER mis-stamped "Indonesia"
// — preserving the standing West Papua separation invariant. SE-Asian
// neighbours are listed before the broad Indonesia gazetteer so a cross-
// syndicated neighbour story resolves to the neighbour (and falls out of the
// Indonesia report) rather than being blind-stamped Indonesia by the per-feed
// default. Indonesia is the broad catch-all, checked last.
// West Papua gazetteer (bare "papua" token + the full Papua-provinces list).
// Shared by indonesia_local AND apac_local so any Papua story is diverted to
// its own "West Papua" report and NEVER mis-stamped "Indonesia".
const WEST_PAPUA_ALIASES = [
  "papua", "west papua", "papua barat", "papua tengah", "papua pegunungan",
  "papua selatan", "papua barat daya", "tembagapura", "grasberg", "freeport",
  "timika", "mimika", "intan jaya", "puncak jaya", "nduga", "ilaga", "sugapa",
  "paniai", "enarotali", "yahukimo", "dekai", "oksibil", "beoga", "kenyam",
  "wamena", "jayawijaya", "nabire", "jayapura", "merauke", "manokwari",
  "sorong", "biak", "fakfak", "kaimana", "asmat", "keerom", "sarmi",
  "waropen", "raja ampat", "maybrat", "tpnpb",
];

// Broad Indonesia gazetteer (country, demonyms, islands, provinces, cities).
// Shared by indonesia_local AND apac_local; always the LAST (catch-all) entry.
const INDONESIA_BROAD_ALIASES = [
  "indonesia", "indonesian", "jakarta", "jabodetabek", "java", "jawa",
  "jawa barat", "jawa timur", "jawa tengah", "sumatra", "sumatera",
  "sumatera utara", "sumatera barat", "sumatera selatan", "sulawesi",
  "sulawesi selatan", "sulawesi utara", "sulawesi tengah", "sulawesi tenggara",
  "sulawesi barat", "kalimantan", "kalimantan timur", "kalimantan barat",
  "kalimantan selatan", "kalimantan tengah", "kalimantan utara", "borneo",
  "bali", "lombok", "nusa tenggara", "ntt", "ntb", "maluku", "aceh", "medan",
  "surabaya", "bandung", "semarang", "makassar", "palembang", "yogyakarta",
  "jogja", "solo", "bekasi", "depok", "tangerang", "bogor", "batam",
  "pekanbaru", "padang", "banjarmasin", "pontianak", "samarinda", "balikpapan",
  "manado", "denpasar", "mataram", "kupang", "ambon", "jambi", "lampung",
  "bengkulu", "banten", "cirebon", "malang", "kediri", "tegal", "sukabumi",
  "garut", "tasikmalaya", "banyuwangi", "jember", "gresik", "sidoarjo", "riau",
  "gorontalo", "kepulauan riau", "bangka belitung", "ternate", "palu",
  "kendari", "mamuju", "sorong selatan",
];

const INDONESIA_LOCAL_ALIASES: CountryAlias[] = [
  { canonical: "West Papua", aliases: WEST_PAPUA_ALIASES },
  { canonical: "Papua New Guinea", aliases: ["papua new guinea", "port moresby", "bougainville"] },
  { canonical: "Malaysia", aliases: ["malaysia", "malaysian", "kuala lumpur", "sabah", "sarawak", "johor"] },
  { canonical: "Singapore", aliases: ["singapore", "singapura"] },
  { canonical: "Philippines", aliases: ["philippines", "filipina", "manila", "mindanao"] },
  { canonical: "Thailand", aliases: ["thailand", "bangkok"] },
  { canonical: "Timor-Leste", aliases: ["timor-leste", "timor leste", "east timor", "timor timur", "dili"] },
  { canonical: "Brunei", aliases: ["brunei"] },
  { canonical: "Indonesia", aliases: INDONESIA_BROAD_ALIASES },
];

// Bahasa-first per-family feeds. defaultCountry="Indonesia" so an unmatched
// hyperlocal regency story resolves to Indonesia; the Papua-first aliases above
// divert genuine Papua items to West Papua before that fallback applies.
const INDONESIA_LOCAL_FEEDS: TopicFeed[] = [
  { label: "Unrest / protest (ID)", q: `(demonstrasi OR "unjuk rasa" OR "aksi unjuk rasa" OR kerusuhan OR rusuh OR bentrok OR bentrokan OR "aksi massa")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Crime (ID)", q: `(pembunuhan OR penembakan OR perampokan OR begal OR pencurian OR penikaman OR penculikan OR "tindak kriminal")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Natural hazard (ID)", q: `(banjir OR "banjir bandang" OR "tanah longsor" OR longsor OR "gempa bumi" OR gempa OR tsunami OR "gunung meletus" OR erupsi OR "letusan gunung")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Fire (ID)", q: `(kebakaran OR "kebakaran hutan" OR karhutla OR "kebakaran pabrik" OR "kebakaran pasar" OR "kebakaran permukiman")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Haze / environment (ID)", q: `("kabut asap" OR karhutla OR "polusi udara" OR "pencemaran lingkungan" OR "limbah beracun")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Transport / aviation / port (ID)", q: `("kecelakaan lalu lintas" OR "kecelakaan pesawat" OR "pesawat jatuh" OR "kapal tenggelam" OR "kapal karam" OR "kecelakaan kapal" OR "kecelakaan bus" OR "kecelakaan kereta")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Government stability (ID)", q: `("krisis politik" OR pemakzulan OR "mosi tidak percaya" OR "reshuffle kabinet" OR "demo mahasiswa" OR "unjuk rasa mahasiswa" OR korupsi)`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Labour action (ID)", q: `("mogok kerja" OR "aksi buruh" OR "demo buruh" OR "unjuk rasa buruh" OR "serikat buruh" OR "pemutusan hubungan kerja" OR PHK OR "upah minimum")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Terrorism / militancy (ID)", q: `(teroris OR terorisme OR "bom bunuh diri" OR "serangan bom" OR "ledakan bom" OR "densus 88" OR "jaringan teroris")`, defaultCountry: "Indonesia", ...ID_BAHASA },
  { label: "Indonesia security (EN)", q: `Indonesia (protest OR unrest OR riot OR clash OR shooting OR stabbing OR robbery OR flood OR earthquake OR landslide OR eruption OR wildfire OR haze OR "plane crash" OR "boat sinks" OR ferry OR terror OR bomb OR strike OR layoffs OR corruption)`, defaultCountry: "Indonesia", ...ID_ENGLISH },
];

export const INDONESIA_LOCAL_CONFIG: NewsTopicConfig = {
  topic: "indonesia_local",
  feeds: INDONESIA_LOCAL_FEEDS,
  // Bilingual allow-list. The ingest gate substring-matches the RAW (Bahasa)
  // title+summary, so the Bahasa terms are required for Bahasa-edition items to
  // survive; the English terms keep the English ID-edition feed and any already-
  // English wire copy. Multi-word Bahasa phrases are preferred to avoid the
  // substring false positives a bare short token (e.g. "demo" inside
  // "demokrasi", "protes" inside "protestan") would cause.
  allow: [
    // unrest / protest
    "demonstrasi", "unjuk rasa", "kerusuhan", "bentrok", "rusuh", "aksi massa",
    "protest", "riot", "unrest", "clash", "demonstration", "rally",
    // unrest / protest — informal slang + abbreviations. "demo" alone is NOT
    // listed (it is a substring of "demokrasi"/"demografi" and of the denied
    // "demo produk"); instead bind it to protest actors/verbs, and add the
    // "unjuk rasa" abbreviation "unras" plus the youth-brawl term "tawuran".
    "unras", "tawuran",
    "demo mahasiswa", "demo buruh", "demo warga", "demo tolak", "demo ricuh",
    "aksi demo", "gelar demo",
    // crime
    "pembunuhan", "penembakan", "perampokan", "begal", "pencurian", "penikaman",
    "penculikan", "tindak kriminal", "kriminal",
    "murder", "shooting", "robbery", "theft", "stabbing", "kidnap", "homicide", "assault",
    // crime / security — informal slang + abbreviations: "curanmor" (motor-
    // vehicle theft), "geng motor" (violent bike gangs), "kkb" (armed criminal
    // group, used for Papua security incidents).
    "curanmor", "geng motor", "kkb",
    // natural hazard
    "banjir", "longsor", "gempa", "tsunami", "erupsi", "gunung meletus", "letusan",
    "flood", "landslide", "earthquake", "quake", "eruption", "volcano",
    // fire
    "kebakaran", "karhutla",
    "fire", "blaze", "wildfire", "forest fire",
    // haze / environment
    "kabut asap", "polusi udara", "pencemaran", "limbah",
    "haze", "smog", "pollution", "air quality",
    // transport / aviation / port
    "kecelakaan", "kapal tenggelam", "kapal karam", "pesawat jatuh", "tabrakan",
    "bandara", "pelabuhan",
    "accident", "plane crash", "boat sinks", "ferry", "capsize", "airport", "collision", "derail",
    // transport — informal abbreviation: "laka lantas" (traffic accident).
    "laka lantas",
    // government stability
    "korupsi", "pemakzulan", "mosi tidak percaya", "krisis politik", "reshuffle",
    "corruption", "impeachment", "no-confidence", "political crisis", "cabinet reshuffle",
    // labour
    "mogok kerja", "aksi buruh", "serikat buruh", "buruh", "upah minimum",
    "pemutusan hubungan kerja",
    "strike", "walkout", "layoffs", "labour union", "labor union", "minimum wage",
    // terrorism
    "teroris", "terorisme", "bom bunuh diri", "serangan bom", "ledakan bom",
    "densus 88", "jaringan teroris", "ledakan",
    "terror", "terrorist", "suicide bomb", "bomb blast", "explosion",
  ],
  deny: [
    ...COMMON_DENY,
    // sport
    "sepak bola", "pertandingan", "klasemen", "timnas", "piala dunia", "liga 1",
    "skor akhir", "esports", "mobile legends", "badminton", "motogp",
    // entertainment / lifestyle
    "sinetron", "konser", "selebriti", "box office", "trailer", "drakor",
    "resep", "wisata", "kuliner", "zodiak", "ramalan bintang", "horoskop",
    "giveaway", "diskon", "promo",
    // markets / finance / jobs
    "saham", "ihsg", "bursa", "kripto", "emiten", "dividen", "lowongan kerja",
    "harga emas", "harga hp",
    // product demos (the "demo" homonym)
    "demo produk", "demo masak", "demo memasak",
  ],
  countryAliases: INDONESIA_LOCAL_ALIASES,
  // Broad local feed spanning official agencies, major wires and small regional
  // outlets, so a source-based confidence tier is meaningful here (opt-in).
  classifyConfidence: classifyNewsConfidence,
};

// ---------------------------------------------------------------------------
// apac_local — curated DIRECT-outlet RSS (NOT Google News) across the six
// tracked APAC territories (Indonesia, Jakarta, Philippines, Thailand, Papua
// New Guinea, West Papua). Each feed reads the outlet's own RSS via `directUrl`
// with a fixed `sourceName`, so processFeed skips the Google-News masthead
// split. West Papua is the FIRST alias so any Papua story diverts to its own
// tag and is NEVER mis-stamped Indonesia. Mirrors indonesia_local's engine and
// reuses the existing FP_APAC_ANCHOR_RE relevance branch — NO version bump.
// ---------------------------------------------------------------------------

const APAC_LOCAL_ALIASES: CountryAlias[] = [
  { canonical: "West Papua", aliases: WEST_PAPUA_ALIASES },
  {
    canonical: "Papua New Guinea",
    aliases: [
      "papua new guinea", "png", "port moresby", "bougainville", "lae",
      "mount hagen", "mt hagen", "enga", "hela", "madang", "morobe", "goroka",
      "wewak", "kokopo", "kimbe", "kavieng", "wabag", "tari",
    ],
  },
  {
    canonical: "Philippines",
    aliases: [
      "philippines", "philippine", "filipino", "filipina", "manila",
      "quezon city", "mindanao", "cebu", "davao", "iloilo", "zamboanga",
      "baguio", "cotabato", "sulu", "basilan", "maguindanao", "marawi",
      "cagayan", "tacloban", "bangsamoro", "bacolod", "general santos",
    ],
  },
  {
    canonical: "Thailand",
    aliases: [
      "thailand", "thai", "bangkok", "chiang mai", "phuket", "pattani",
      "yala", "narathiwat", "songkhla", "hat yai", "chiang rai", "korat",
      "nakhon", "udon thani", "khon kaen", "surat thani", "pattaya",
    ],
  },
  { canonical: "Malaysia", aliases: ["malaysia", "malaysian", "kuala lumpur", "sabah", "sarawak", "johor"] },
  { canonical: "Singapore", aliases: ["singapore", "singapura"] },
  { canonical: "Timor-Leste", aliases: ["timor-leste", "timor leste", "east timor", "timor timur", "dili"] },
  { canonical: "Brunei", aliases: ["brunei"] },
  { canonical: "Indonesia", aliases: INDONESIA_BROAD_ALIASES },
];

// Curated direct-outlet RSS. defaultCountry names each outlet's home nation so
// an unmatched local story resolves correctly; multi-country desks (RNZ
// Pacific, BenarNews) default to "Unknown" rather than blind-stamping a nation.
// q is unused for direct feeds (directUrl bypasses the Google-News builder).
const APAC_LOCAL_FEEDS: TopicFeed[] = [
  // Indonesia
  { q: "", label: "Antara News", directUrl: "https://en.antaranews.com/rss/news", sourceName: "Antara News", defaultCountry: "Indonesia" },
  { q: "", label: "CNN Indonesia", directUrl: "https://www.cnnindonesia.com/nasional/rss", sourceName: "CNN Indonesia", defaultCountry: "Indonesia" },
  { q: "", label: "Tempo", directUrl: "https://rss.tempo.co/nasional", sourceName: "Tempo", defaultCountry: "Indonesia" },
  // West Papua
  { q: "", label: "Jubi", directUrl: "https://en.jubi.id/feed/", sourceName: "Jubi", defaultCountry: "West Papua" },
  // Papua New Guinea + Pacific (multi-country desk → Unknown default)
  { q: "", label: "PNG Post-Courier", directUrl: "https://www.postcourier.com.pg/feed/", sourceName: "Post-Courier", defaultCountry: "Papua New Guinea" },
  { q: "", label: "RNZ Pacific", directUrl: "https://www.rnz.co.nz/rss/pacific.xml", sourceName: "RNZ Pacific", defaultCountry: "Unknown" },
  // Philippines
  { q: "", label: "Inquirer", directUrl: "https://www.inquirer.net/fullfeed", sourceName: "Philippine Daily Inquirer", defaultCountry: "Philippines" },
  { q: "", label: "Rappler", directUrl: "https://www.rappler.com/feed/", sourceName: "Rappler", defaultCountry: "Philippines" },
  { q: "", label: "GMA News", directUrl: "https://data.gmanetwork.com/gno/rss/news/feed.xml", sourceName: "GMA News", defaultCountry: "Philippines" },
  // Thailand
  { q: "", label: "Bangkok Post", directUrl: "https://www.bangkokpost.com/rss/data/most-recent.xml", sourceName: "Bangkok Post", defaultCountry: "Thailand" },
  { q: "", label: "Khaosod English", directUrl: "https://www.khaosodenglish.com/feed/", sourceName: "Khaosod English", defaultCountry: "Thailand" },
  // Regional security / terrorism desk (multi-country → Unknown default)
  { q: "", label: "BenarNews", directUrl: "https://www.benarnews.org/english/rss", sourceName: "BenarNews", defaultCountry: "Unknown" },
];

export const APAC_LOCAL_CONFIG: NewsTopicConfig = {
  topic: "apac_local",
  feeds: APAC_LOCAL_FEEDS,
  // Bilingual allow-list scoped to the tracked categories: protest / civil
  // unrest, crime, terrorism, security incidents, transport disruption, and
  // natural hazards (typhoon / earthquake / flood / volcano / landslide).
  // The ingest gate substring-matches the RAW (Bahasa or English) title +
  // summary, so both languages are listed. Multi-word phrases are preferred and
  // fragile short tokens (e.g. bare "raid", "armed", "port", "npa", "ied") are
  // avoided because hay.includes() would false-positive on "afraid", "unarmed",
  // "report", "unpaid", "buried".
  allow: [
    // protest / civil unrest
    "protest", "rally", "demonstration", "riot", "unrest", "clash", "strike",
    "walkout", "picket", "blockade", "curfew", "martial law",
    "state of emergency", "crackdown", "student protest",
    "demonstrasi", "unjuk rasa", "kerusuhan", "bentrok", "rusuh", "aksi massa",
    "mogok kerja", "aksi buruh",
    // protest / civil unrest — informal Bahasa slang + abbreviations. Bare
    // "demo" is avoided (substring of "demokrasi" and the denied "demo produk");
    // bind it to protest actors/verbs. "unras" abbreviates "unjuk rasa";
    // "tawuran" is the youth-brawl term.
    "unras", "tawuran",
    "demo mahasiswa", "demo buruh", "demo warga", "demo tolak", "demo ricuh",
    "aksi demo", "gelar demo",
    // protest / civil unrest — Tagalog (Philippine English outlets code-switch).
    // "rali" is the Tagalog spelling of "rally" (one l, so the English "rally"
    // token above does NOT cover it); it is bound to a following participle
    // ("ng"/"laban"/"kontra") to avoid the substring trap in "aust-rali-a".
    // "welga" is the Tagalog labour-strike term.
    "rali ng", "rali laban", "rali kontra", "welga", "welgang bayan",
    // Thai outlets (Bangkok Post, Khaosod English) report incidents in English,
    // so the English protest/crime/security cues above already cover them; no
    // safe romanized-Thai slang token was identified (the sole candidate "mob"
    // is a substring of "mobile"/"mobility" and is deliberately avoided). Thai
    // wording is asserted via fixtures in apacLocalRelevance.test.ts.
    // crime
    "murder", "shooting", "shot dead", "robbery", "theft", "stabbing",
    "kidnap", "kidnapping", "abduction", "homicide", "assault", "extortion",
    "drug bust", "human trafficking", "gang war", "gang violence",
    "pembunuhan", "penembakan", "perampokan", "begal", "pencurian",
    "penikaman", "penculikan", "kriminal", "narkoba",
    // crime — informal slang + abbreviations: "curanmor" (motor-vehicle theft),
    // "geng motor" (violent bike gangs).
    "curanmor", "geng motor",
    // crime — Tagalog: "barilan" (shootout), "pamamaril" (shooting), "nakawan"
    // (robbery), "holdap" (hold-up), "saksak" (stab/stabbing — matches the
    // "saksakan"/"sinaksak" forms), "patayan" (killings), "pagpatay" (murder).
    // The "-an"/"pag-" forms are used, not the bare "patay" (=dead), so a
    // non-incident "patay na baterya" (dead battery) does not leak in.
    "barilan", "pamamaril", "nakawan", "holdap", "saksak", "patayan", "pagpatay",
    // terrorism
    "terror", "terrorist", "terrorism", "suicide bomb", "bomb blast",
    "bombing", "explosion", "improvised explosive", "insurgent", "insurgency",
    "militant", "extremist", "abu sayyaf", "jemaah islamiyah",
    "jamaah islamiyah", "new people's army", "separatist",
    "teroris", "terorisme", "bom bunuh diri", "serangan bom", "ledakan bom",
    "densus 88", "ledakan",
    // terrorism / blast — Tagalog: "pagsabog" (explosion/blast).
    "pagsabog",
    // security incidents (armed / conflict)
    "gunmen", "gunfire", "ambush", "shootout", "firefight", "hostage",
    "arson", "grenade", "landmine", "checkpoint", "security forces",
    "military operation", "police operation", "manhunt", "armed men",
    "armed group", "raid on", "attack",
    "penyerangan", "penyanderaan", "baku tembak", "aparat keamanan",
    "operasi keamanan",
    // security — abbreviation: "kkb" (armed criminal group, used for Papua).
    "kkb",
    // security — Tagalog: "pananambang" (ambush).
    "pananambang",
    // PNG / Pacific local security vocabulary. The generic crime/security terms
    // above miss the way PNG (English + Tok Pisin) headlines report violence, so
    // its own direct outlet (Post-Courier) accepted 0 of its items. "clash"
    // above already catches "tribal clash" / "highlands clash", so these fill
    // only the remaining gaps. Multi-word phrases preferred; the single tokens
    // ("raskol", "sorcery", "sanguma", "machete") are distinctive PNG terms with
    // no benign substring collision.
    "raskol", "tribal fight", "tribal fighting", "tribal war",
    "tribal violence", "tribal conflict", "tribal tension", "tribal clash",
    "ethnic violence", "communal violence", "election violence", "mob violence",
    "highlands clash", "sorcery", "sanguma", "witchcraft accusation",
    "payback killing", "payback attack", "payback violence",
    "pack rape", "gang rape", "machete", "bush knife",
    "hacked to death", "beaten to death", "burnt alive",
    // transport disruption
    "plane crash", "boat sinks", "ferry", "capsize", "airport", "collision",
    "derail", "train crash", "road accident", "bus crash", "flight cancel",
    "airport closure", "port closure", "shipwreck", "runway",
    "kecelakaan", "kapal tenggelam", "kapal karam", "pesawat jatuh",
    "tabrakan", "bandara", "pelabuhan",
    // transport — informal abbreviation: "laka lantas" (traffic accident).
    "laka lantas",
    // transport — Tagalog: "aksidente" (accident), "banggaan" (collision/crash).
    "aksidente", "banggaan",
    // natural hazard — Philippine (Inquirer/Rappler/GMA) and Thai (Bangkok
    // Post/Khaosod) outlets lead with typhoons, earthquakes and floods, but the
    // gate previously had no hazard vocabulary so these were silently dropped
    // despite passing the geographic relevance gate. Mirrors indonesia_local's
    // hazard coverage. English cues cover Thai + Philippine English desks;
    // Bahasa cues cover the Indonesian direct outlets.
    "typhoon", "cyclone", "tropical storm", "storm surge", "earthquake",
    "quake", "aftershock", "tsunami", "volcano", "volcanic", "eruption",
    "landslide", "mudslide", "flood",
    // natural hazard — Bahasa: "banjir" (flood), "longsor" (landslide),
    // "gempa" (earthquake), "erupsi"/"letusan"/"gunung meletus" (eruption).
    "banjir", "longsor", "gempa", "erupsi", "letusan", "gunung meletus",
    // natural hazard — Tagalog (Philippine English outlets code-switch).
    // "bagyo" (typhoon), "lindol" (earthquake), "bulkan" (volcano), "pagguho"
    // (landslide). Flood is the bound forms "pagbaha"/"bumaha"/"binaha" — the
    // bare Tagalog "baha" is a substring of "bahasa"/"bahay" (house)/"bahagi"
    // (part) and would false-positive, so it is deliberately avoided.
    "bagyo", "lindol", "bulkan", "pagguho", "pagbaha", "bumaha", "binaha",
    // drought & water-utility disruption — PNG (Post-Courier/RNZ Pacific) and
    // wider APAC drought / water-supply stories previously had NO vocabulary
    // here so they were silently dropped despite passing the geographic gate.
    // Multi-word English phrases keep precision; Bahasa "kekeringan" (drought)
    // and "krisis air" (water crisis) cover the Indonesian direct outlets.
    "drought", "dry spell", "water shortage", "water crisis", "water supply",
    "water rationing", "water restriction", "water cut", "water outage",
    "water contamination", "el nino", "el niño",
    "kekeringan", "krisis air",
  ],
  deny: [
    ...COMMON_DENY,
    // sport
    "football", "basketball", "volleyball", "sea games", "olympics", "match",
    "league", "tournament", "world cup", "esports", "badminton", "motogp",
    "sepak bola", "pertandingan", "timnas", "liga 1",
    // entertainment / lifestyle
    "concert", "box office", "trailer", "celebrity", "showbiz", "beauty pageant",
    "horoscope", "giveaway", "sinetron", "selebriti", "wisata", "kuliner",
    // markets / finance / jobs
    "stock market", "crypto", "bitcoin", "saham", "ihsg", "bursa", "kripto",
    "lowongan kerja",
    // product demos (the "demo" homonym)
    "demo produk", "demo masak", "demo memasak",
  ],
  countryAliases: APAC_LOCAL_ALIASES,
  // Direct outlets span national agencies, major dailies and small regional
  // desks, so the source-confidence tier is meaningful (opt-in).
  classifyConfidence: classifyNewsConfidence,
};

export function runEnergyIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(ENERGY_CONFIG, opts);
}

export function runConflictIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(CONFLICT_CONFIG, opts);
}

export function runFertiliserIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(FERTILISER_CONFIG, opts);
}

export function runFuelIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(FUEL_CONFIG, opts);
}

export function runDataCentresIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(DATA_CENTRE_CONFIG, opts);
}

export function runIndonesiaLocalIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(INDONESIA_LOCAL_CONFIG, opts);
}

export function runApacLocalIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  return runNewsTopicIngest(APAC_LOCAL_CONFIG, opts);
}
