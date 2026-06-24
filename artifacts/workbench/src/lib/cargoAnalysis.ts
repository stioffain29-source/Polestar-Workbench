// Single source of truth for Cargo Watch classification + value parsing.
// Extracted from CargoWatch.tsx so the page, the shared "true incidents"
// resolver, and the Cargo Watch report all classify scope, category and
// USD loss identically and can never drift.

export interface CargoIncidentLike {
  title: string;
  summary?: string | null;
  source?: string | null;
  location?: string | null;
  country?: string | null;
  // Set true when an analyst explicitly resolved this row from the Needs Review
  // queue by assigning its country. Authoritative: promotes the row into the
  // in-scope lane past the heuristic cargo gates (see classifyScope).
  analystInScope?: boolean | null;
}

// Canonical in-scope countries (APAC then Middle East), used by the Needs
// Review queue's country picker. Curated literal — every entry is recognized by
// classifyRegion, so an analyst can only promote a row into recognized in-scope
// geography (the override below is gated on an APAC/Middle East region).
export const IN_SCOPE_COUNTRIES: string[] = [
  "Singapore", "Malaysia", "Indonesia", "Thailand", "Vietnam", "Philippines", "Cambodia", "Laos", "Myanmar",
  "India", "Pakistan", "Bangladesh", "Sri Lanka", "China", "Taiwan", "South Korea", "Japan",
  "Australia", "New Zealand", "Papua New Guinea",
  "Saudi Arabia", "UAE", "Oman", "Qatar", "Bahrain", "Kuwait", "Jordan", "Iran", "Iraq", "Yemen", "Israel", "Lebanon", "Syria",
];

// Cargo Watch scope: APAC + Middle East cargo / hijack / logistics crime only.
// Turkey is intentionally excluded per the current scope spec; Iran is included.
const MIDDLE_EAST = new Set([
  "Saudi Arabia","UAE","United Arab Emirates","Oman","Qatar","Bahrain","Kuwait",
  "Jordan","Iran","Iraq","Yemen","Israel","Lebanon","Syria",
]);

const APAC = new Set([
  "Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines","Cambodia","Laos","Myanmar",
  "India","Pakistan","Bangladesh","Sri Lanka","China","Taiwan","South Korea","Japan",
  "Australia","New Zealand","Papua New Guinea",
]);

export type Region = "Middle East" | "APAC" | "Out of scope" | "Country not identified";

// City / sub-region aliases per the scope spec. Mapped to canonical country
// names so a record tagged "Dubai" or "Hong Kong" is treated as UAE / China.
const COUNTRY_ALIASES: Record<string, string> = {
  // UAE
  "dubai": "UAE", "abu dhabi": "UAE", "jebel ali": "UAE", "sharjah": "UAE",
  // Saudi Arabia
  "riyadh": "Saudi Arabia", "jeddah": "Saudi Arabia", "dammam": "Saudi Arabia",
  // Other GCC
  "doha": "Qatar", "manama": "Bahrain", "muscat": "Oman",
  // Indonesia
  "soekarno-hatta": "Indonesia", "soekarno hatta": "Indonesia",
  "tanjung priok": "Indonesia", "west papua": "Indonesia",
  // China (Hong Kong is part of the China SAR, treated as China for APAC scope)
  "hong kong": "China",
};

export function normalizeCountry(name: string): string {
  return COUNTRY_ALIASES[name.toLowerCase()] ?? name;
}

export function identifyCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0].trim();
  if (!first) return null;
  if (/^unknown$/i.test(first)) return null;
  return normalizeCountry(first);
}

export function classifyRegion(country: string | null | undefined): Region {
  const first = identifyCountry(country);
  if (!first) return "Country not identified";
  if (MIDDLE_EAST.has(first)) return "Middle East";
  if (APAC.has(first)) return "APAC";
  return "Out of scope";
}

// Out-of-scope context: explicit foreign location words in the headline /
// summary override an APAC/ME country tag. Geography only — no brand or
// nationality tokens.
const OOS_CONTEXT_RE = /\b(in Canada|in the US|in the United States|in Italy|in Europe|in Africa|in Brazil|in Mexico|in the UK|in Britain|in Germany|in France|in Spain|US Northeast|Italian|Polish|Kenyan|Nigerian|Ghanaian|Moroccan|Egyptian|Mexican|Brazilian|Gauteng|Johannesburg|Pretoria|Cape Town|Musina|Vryburg|Gqeberha|Port Elizabeth|Philippi|Sowetan)\b/i;

// Nationality-only triggers (e.g. "Indian-origin men arrested in Canada").
const NATIONALITY_OFFSHORE_RE = /\b(Indian[- ]origin|Punjab[- ]origin|Pakistani[- ]origin|Filipino[- ]origin|Bangladeshi[- ]origin)\b/i;

// Records that are clearly NOT cargo / logistics theft incidents.
const NON_CARGO_RE = /\b(trailer.*film|heist film|movie review|HAM Berat|kekerasan|pemenuhan SDM|nakes|gubernur|pemprov|prioritaskan|infrastruktur|kabupaten|pemkot diminta|fasilitasi penyelesaian|consumer.*anti-theft|anti-theft feature|electricity theft|port congestion|freight rate|commercial partnership|payment dispute)\b/i;

// Required cargo / logistics incident vocabulary.
const CARGO_INCIDENT_RE = /\b(cargo|freight|container|truck|lorry|hijack|warehouse|godown|depot|pilfer|seal[- ]?tamper|consignment|shipment|parcel|logistic|theft|stolen|stole|robbery|burglar|raid|loot|siphon|smuggl|fraud|busted)\b/i;

// Non-cargo "fish/lobster/oyster" pattern unless cargo framing is present.
const NON_CARGO_FISH_RE = /\b(lobster|oyster|fish theft)\b/i;

// Bahasa-Indonesia cargo-crime vocabulary. Many genuine APAC incidents are
// local-language reports the English CARGO_INCIDENT_RE never matched (gudang =
// warehouse, kargo = cargo, truk = truck), so they were wrongly dumped into
// "excluded_non_cargo". A Bahasa record only counts as cargo when it carries
// BOTH a cargo noun AND a theft verb — far stricter than the English gate — so
// generic Indonesian theft ("pencurian motor") never leaks in.
const CARGO_BAHASA_NOUN_RE = /\b(gudang|pergudangan|kargo|peti kemas|kontainer|truk|logistik|ekspedisi)\b/i;
const CRIME_BAHASA_RE = /\b(pencurian|dicuri|mencuri|maling|rampok|dirampok|perampokan|jarah|dijarah|penjarahan|bobol|dibobol|pembobolan|curanmor|gasak|digasak)\b/i;

function hasCargoVocab(text: string): boolean {
  if (CARGO_INCIDENT_RE.test(text)) return true;
  return CARGO_BAHASA_NOUN_RE.test(text) && CRIME_BAHASA_RE.test(text);
}

// Cargo-specific crime ACTIONS that imply cargo on their own.
const CARGO_ACTION_RE = /\b(hijack|pilfer|seal[- ]?tamper|siphon|smuggl)\w*/i;

// Generic crime verbs — only meaningful for scope when paired with a strong
// cargo noun or explicit load context.
const CRIME_VERB_RE = /\b(theft|thie(?:f|ves)|stolen|stole|steal\w*|rob|robbed|robbery|robbers|burglar\w*|break[- ]?in|broke into|broken into|raid\w*|loot\w*|seiz\w*|busted|heist)\b/i;

// Explicit cargo / LOAD context — a freight commodity, a quantity of goods, or
// a "carrying / laden" framing. When present, a record describing a stolen
// truck or an armoured vehicle is a genuine CARGO incident (the goods are the
// target), so the generic-crime exclusions below MUST stand down. Without it,
// the same words describe vehicle theft, a safe burglary or a cash-van robbery
// — a different risk picture that is not Cargo Watch.
const CARGO_LOAD_CONTEXT_RE =
  /\b(cargo|freight|container|containers|consignment|shipment|shipments|laden|loaded|carrying|haul|haulage|pallet|pallets|crate|crates|goods|tonnes?|tons?|kilograms?|\bkg\b|litres?|liters?|bars?|cartons?|boxes|sacks?|bales?|chocolate|electronics|garments?|textiles?|pharmaceutical)\b/i;

// STRONG cargo nouns — inherently supply-chain objects/nodes. A consignment,
// container, freight shipment, godown, depot or lorry is cargo by definition,
// so a crime verb alongside one is a genuine cargo incident. The generic
// premises/conveyance words "warehouse", "truck" and "parcel" are deliberately
// EXCLUDED here — a warehouse stores anything, a truck can be the stolen object,
// a parcel can be a doorstep package — so they qualify only with explicit load
// context (a named freight commodity or quantity of goods) below.
const STRONG_CARGO_NOUN_RE = /\b(cargo|freight|container|containers|consignment|consignments|shipment|shipments|godown|depot|logistics|lorry|lorries)\b/i;
const STRONG_CARGO_BAHASA_RE = /\b(kargo|peti kemas|kontainer|logistik|ekspedisi)\b/i;

// Named FREIGHT commodities — bulk/distribution goods that are the stolen TARGET.
// When one of these is taken the load itself is the target, so the record is a
// genuine cargo incident even without a premises word (e.g. "12 tonnes of KitKat
// stolen", "truck robbery of scrap iron", "cigarette distributor warehouse
// theft"). Deliberately omits petty-theft-prone consumer items (phones, laptops,
// jewellery) and bare vehicles, which are not Cargo Watch.
const CARGO_COMMODITY_RE =
  /\b(scrap|copper|steel|nickel|aluminium|aluminum|iron ore|coal|rice|wheat|grain|grains|sugar|flour|maize|corn|coffee|tea|cocoa|palm oil|cooking oil|edible oil|rubber|timber|logs|plywood|cement|fertili[sz]er|fuel|diesel|petrol|gasoline|kerosene|lpg|tobacco|cigarettes?|liquor|alcohol|beer|wine|spirits|clothing|apparel|garments?|footwear|milk powder|infant formula)\b/i;

// Genuine-cargo predicate: keep ONLY incidents involving real cargo / goods —
// freight in transit, containers, shipments, consignments, logistics-node
// (depot/godown) theft, or a named freight commodity/quantity as the target. A
// cargo-specific ACTION (hijack/pilfer/siphon/smuggle/seal-tamper) qualifies on
// its own. Otherwise a crime verb must pair with a STRONG cargo noun OR explicit
// load context. Generic warehouse/truck burglaries with no goods named (cash,
// unspecified loot, the vehicle itself) are intentionally dropped per the
// product owner's decision to confine Cargo Watch to real cargo/goods crime.
function hasGenuineCargo(text: string): boolean {
  if (CARGO_ACTION_RE.test(text)) return true;
  const hasLoad = CARGO_LOAD_CONTEXT_RE.test(text) || CARGO_COMMODITY_RE.test(text);
  if (CRIME_VERB_RE.test(text)) {
    if (STRONG_CARGO_NOUN_RE.test(text)) return true;
    if (hasLoad) return true;
  }
  if (CRIME_BAHASA_RE.test(text)) {
    if (STRONG_CARGO_BAHASA_RE.test(text)) return true;
    if (hasLoad) return true;
  }
  return false;
}

// Generic-crime NOISE classes that name a cargo-ish word (truck / warehouse /
// parcel) but are NOT cargo / logistics-node theft. Each fires only when no
// CARGO_LOAD_CONTEXT_RE is present, so a genuine load-bearing incident (a
// hijacked bullion truck, a stolen lorry carrying chocolate) is never dropped.
// These complement the country gate: an attributed APAC/ME row clears
// hasCargoVocab on a bare "truck"/"warehouse" token, so without this it would
// admit a stolen-vehicle, safe-burglary or cash-van-robbery story as cargo.
const NOISE_SAFE_RE = /\b(safe|vault|brankas)\b/i; // breaking into a safe / vault
const NOISE_MONEY_AMOUNT_RE =
  /\b(stole|stolen|theft of|robbed|made off with)\b[^.]{0,30}\b(rp\s?[\d.,]+|\d[\d.,]*\s*(?:million|billion)?\s*(?:baht|rupiah|rupees?|ringgit|peso|pesos|dong))\b/i;
const NOISE_CASH_IN_TRANSIT_RE =
  /\b(cash[- ]?in[- ]?transit|cash van|cash[- ]carrying (?:van|truck|vehicle)|armou?red (?:van|truck|car|vehicle|cash))\b/i;
const NOISE_ARMS_DEALER_RE =
  /\b(?:gun|firearm|firearms|weapon|weapons|arms|ammunition|pistol|rifle)\b[^.]{0,20}\b(?:supplier|dealer|trafficker|smuggler|seller|source|peddler)\b|\b(?:supplier|dealer|trafficker)\b[^.]{0,15}\b(?:gun|firearm|weapon|arms|ammunition)\b/i;
const NOISE_VEHICLE_TARGET_RE =
  /\b(steals?|stole|stolen|theft of|made off with|drives? off (?:with|in)|speeds? away (?:in|with))\b[^.]{0,25}\b(six[- ]wheel|ten[- ]wheel|truck|lorry|pickup|pick[- ]up|van|car|vehicle|motorcycle|motorbike|scooter|tuk[- ]tuk)\b/i;
const NOISE_RESIDENTIAL_PARCEL_RE =
  /\b(dormitory|dorm|boarding house|residential|apartment|housing (?:complex|estate)|condo)\b[^.]{0,40}\b(parcel|parcels|package|packages)\b|\bposes? as (?:a )?resident\b/i;

// True when a record is generic crime mislabelled cargo. Each class stands down
// when explicit cargo / load context is present (the goods, not the conveyance
// or the cash, are the target).
function isCargoNoise(text: string): boolean {
  // Same load definition as hasGenuineCargo: a named freight commodity counts as
  // load context too, so "diesel stolen from a truck" (a genuine fuel-cargo
  // theft) is not preemptively dropped as vehicle-theft noise.
  const hasLoad = CARGO_LOAD_CONTEXT_RE.test(text) || CARGO_COMMODITY_RE.test(text);
  if (NOISE_SAFE_RE.test(text) && !hasLoad) return true;
  if (NOISE_MONEY_AMOUNT_RE.test(text) && !hasLoad) return true;
  if (NOISE_CASH_IN_TRANSIT_RE.test(text) && !hasLoad) return true;
  if (NOISE_ARMS_DEALER_RE.test(text) && !hasLoad) return true;
  if (NOISE_VEHICLE_TARGET_RE.test(text) && !hasLoad) return true;
  if (NOISE_RESIDENTIAL_PARCEL_RE.test(text) && !hasLoad) return true;
  return false;
}

// Curated APAC / Middle East place gazetteer used ONLY to recover an in-scope
// country for a record the source left unattributed (country null / "Unknown").
// Word-bounded, observed sub-national place names plus unambiguous large cities.
// Consulted against title + summary only — never the source / feed label, which
// often carries a misleading region name ("Australia Freight & Truck Theft").
const RECOVERY_PLACES: Array<[string, RegExp]> = [
  ["Indonesia", /\b(tuban|sragen|ngrampal|singkawang|bengkulu|tapanuli|sumatera|sumatra|tanjung priok|priok|surabaya|bandung|semarang|makassar|bekasi|tangerang|medan|palembang|batam|bogor|depok)\b/i],
  ["Malaysia", /\b(penang|bintulu|kuching|johor|selangor|klang|sarawak|sabah|shah alam|petaling)\b/i],
  ["Philippines", /\b(bulacan|valenzuela|caloocan|quezon city|luzon|cebu|davao|cavite|laguna|pampanga|paranaque|parañaque)\b/i],
  ["China", /\b(fo tan|kwai chung|tsuen wan|kowloon|sha tin|kwun tong|tuen mun|yuen long)\b/i],
];

// Best-effort in-scope country recovered from incident text. Returns null when
// no curated place token is present (we recover only PROVABLE APAC/ME records;
// everything else honestly stays "needs review").
export function recoverCargoCountryFromText(i: CargoIncidentLike): string | null {
  const text = `${i.title} ${i.summary ?? ""}`;
  for (const [country, re] of RECOVERY_PLACES) {
    if (re.test(text)) return country;
  }
  return null;
}

// Curated APAC / Middle East seaport gazetteer used ONLY to recover a NAMED
// port from an incident's own text (title + summary + location) — never the
// source / feed label, which carries mastheads that would leak a city name
// (e.g. "Taipei Times" → "Taipei"). Each alias is a word-bounded FULL port name
// or an unambiguous port-area / facility name. Bare MAJOR-CITY and country
// tokens ("singapore", "haifa", "busan", "colombo", "bandar abbas") are
// DELIBERATELY excluded so a generic city story is never mis-attributed to a
// port; only port-qualified forms ("haifa port", "port of colombo") or
// port-specific place names ("tanjung priok", "jebel ali", "nhava sheva")
// admit a match. Every port maps to its one canonical in-scope country.
//
// KEEP IN SYNC with the ingest port list in lib/ingest/src/cargoWatch.ts
// (PORT_QUERIES feeds + the port aliases appended to COUNTRY_ALIASES). The
// single source of truth for user-visible port counts is buildCargoPortBreakdown
// in cargoNarratives.ts — the ingest feeds only widen what candidates arrive.
export const CARGO_PORT_GAZETTEER: Array<{ port: string; country: string; re: RegExp }> = [
  // --- APAC ---
  { port: "Port of Singapore", country: "Singapore", re: /\b(port of singapore|psa singapore|tuas port|pasir panjang terminal|tanjong pagar terminal|brani terminal|keppel terminal)\b/i },
  { port: "Port Klang", country: "Malaysia", re: /\b(port klang|klang port|port of klang)\b/i },
  { port: "Tanjung Pelepas", country: "Malaysia", re: /\b(tanjung pelepas|port of tanjung pelepas)\b/i },
  { port: "Penang Port", country: "Malaysia", re: /\b(penang port|port of penang)\b/i },
  { port: "Tanjung Priok", country: "Indonesia", re: /\b(tanjung priok|priok port|port of tanjung priok)\b/i },
  { port: "Tanjung Perak", country: "Indonesia", re: /\b(tanjung perak|port of tanjung perak)\b/i },
  { port: "Belawan Port", country: "Indonesia", re: /\b(belawan port|port of belawan)\b/i },
  { port: "Laem Chabang", country: "Thailand", re: /\b(laem chabang|port of laem chabang)\b/i },
  { port: "Bangkok Port", country: "Thailand", re: /\b(bangkok port|klong toey port|khlong toei port)\b/i },
  { port: "Cai Mep", country: "Vietnam", re: /\b(cai mep|port of cai mep)\b/i },
  { port: "Cat Lai", country: "Vietnam", re: /\b(cat lai port|cat lai terminal)\b/i },
  { port: "Hai Phong Port", country: "Vietnam", re: /\b(hai phong port|haiphong port|port of haiphong|port of hai phong)\b/i },
  { port: "Manila Port", country: "Philippines", re: /\b(manila port|port of manila|manila south harbor|manila international container terminal)\b/i },
  { port: "Subic Port", country: "Philippines", re: /\b(subic port|port of subic|subic bay port)\b/i },
  { port: "Cebu Port", country: "Philippines", re: /\b(cebu port|port of cebu)\b/i },
  { port: "Sihanoukville Port", country: "Cambodia", re: /\b(sihanoukville port|sihanoukville autonomous port|port of sihanoukville)\b/i },
  { port: "Yangon Port", country: "Myanmar", re: /\b(yangon port|port of yangon|thilawa port)\b/i },
  { port: "Nhava Sheva", country: "India", re: /\b(nhava sheva|jawaharlal nehru port|jnpt)\b/i },
  { port: "Mundra Port", country: "India", re: /\b(mundra port|port of mundra)\b/i },
  { port: "Chennai Port", country: "India", re: /\b(chennai port|port of chennai)\b/i },
  { port: "Visakhapatnam Port", country: "India", re: /\b(visakhapatnam port|vizag port|port of visakhapatnam)\b/i },
  { port: "Kolkata Port", country: "India", re: /\b(kolkata port|port of kolkata|haldia port)\b/i },
  { port: "Mumbai Port", country: "India", re: /\b(mumbai port|port of mumbai)\b/i },
  { port: "Karachi Port", country: "Pakistan", re: /\b(karachi port|port of karachi)\b/i },
  { port: "Port Qasim", country: "Pakistan", re: /\b(port qasim|bin qasim port|port muhammad bin qasim)\b/i },
  { port: "Gwadar Port", country: "Pakistan", re: /\b(gwadar port|port of gwadar)\b/i },
  { port: "Chittagong Port", country: "Bangladesh", re: /\b(chittagong port|chattogram port|port of chittagong|port of chattogram)\b/i },
  { port: "Mongla Port", country: "Bangladesh", re: /\b(mongla port|port of mongla)\b/i },
  { port: "Colombo Port", country: "Sri Lanka", re: /\b(colombo port|port of colombo)\b/i },
  { port: "Hambantota Port", country: "Sri Lanka", re: /\b(hambantota port|port of hambantota)\b/i },
  { port: "Port of Shanghai", country: "China", re: /\b(port of shanghai|shanghai port|yangshan port)\b/i },
  { port: "Ningbo-Zhoushan", country: "China", re: /\b(ningbo port|ningbo-zhoushan|port of ningbo|zhoushan port)\b/i },
  { port: "Shenzhen Port", country: "China", re: /\b(shenzhen port|yantian port|port of shenzhen|shekou port)\b/i },
  { port: "Qingdao Port", country: "China", re: /\b(qingdao port|port of qingdao)\b/i },
  { port: "Guangzhou Port", country: "China", re: /\b(guangzhou port|nansha port|port of guangzhou)\b/i },
  { port: "Tianjin Port", country: "China", re: /\b(tianjin port|port of tianjin)\b/i },
  { port: "Xiamen Port", country: "China", re: /\b(xiamen port|port of xiamen)\b/i },
  { port: "Hong Kong Port", country: "China", re: /\b(hong kong port|kwai chung terminal|kwai tsing terminal|port of hong kong)\b/i },
  { port: "Kaohsiung Port", country: "Taiwan", re: /\b(kaohsiung port|port of kaohsiung)\b/i },
  { port: "Keelung Port", country: "Taiwan", re: /\b(keelung port|port of keelung)\b/i },
  { port: "Taichung Port", country: "Taiwan", re: /\b(taichung port|port of taichung)\b/i },
  { port: "Busan Port", country: "South Korea", re: /\b(busan port|port of busan|pusan port)\b/i },
  { port: "Incheon Port", country: "South Korea", re: /\b(incheon port|port of incheon)\b/i },
  { port: "Gwangyang Port", country: "South Korea", re: /\b(gwangyang port|port of gwangyang)\b/i },
  { port: "Port of Yokohama", country: "Japan", re: /\b(port of yokohama|yokohama port)\b/i },
  { port: "Port of Kobe", country: "Japan", re: /\b(port of kobe|kobe port)\b/i },
  { port: "Port of Nagoya", country: "Japan", re: /\b(port of nagoya|nagoya port)\b/i },
  { port: "Port of Tokyo", country: "Japan", re: /\b(port of tokyo|tokyo port)\b/i },
  { port: "Port of Osaka", country: "Japan", re: /\b(port of osaka|osaka port)\b/i },
  { port: "Port Botany", country: "Australia", re: /\b(port botany)\b/i },
  { port: "Port of Melbourne", country: "Australia", re: /\b(port of melbourne|melbourne port)\b/i },
  { port: "Port of Brisbane", country: "Australia", re: /\b(port of brisbane|brisbane port)\b/i },
  { port: "Fremantle Port", country: "Australia", re: /\b(fremantle port|port of fremantle)\b/i },
  { port: "Port of Auckland", country: "New Zealand", re: /\b(port of auckland|ports of auckland)\b/i },
  { port: "Port of Tauranga", country: "New Zealand", re: /\b(port of tauranga|tauranga port)\b/i },
  { port: "Lae Port", country: "Papua New Guinea", re: /\b(lae port|port of lae|motukea)\b/i },
  // --- Middle East ---
  { port: "Jebel Ali", country: "UAE", re: /\b(jebel ali|port of jebel ali|jebel ali port)\b/i },
  { port: "Khalifa Port", country: "UAE", re: /\b(khalifa port|khalifa bin zayed port)\b/i },
  { port: "Khor Fakkan", country: "UAE", re: /\b(khor fakkan|khorfakkan)\b/i },
  { port: "Port Rashid", country: "UAE", re: /\b(port rashid|mina rashid)\b/i },
  { port: "Jeddah Islamic Port", country: "Saudi Arabia", re: /\b(jeddah islamic port|jeddah port|port of jeddah)\b/i },
  { port: "King Abdullah Port", country: "Saudi Arabia", re: /\b(king abdullah port)\b/i },
  { port: "Dammam Port", country: "Saudi Arabia", re: /\b(dammam port|king abdulaziz port|port of dammam)\b/i },
  { port: "Hamad Port", country: "Qatar", re: /\b(hamad port|port of hamad)\b/i },
  { port: "Sohar Port", country: "Oman", re: /\b(sohar port|port of sohar)\b/i },
  { port: "Salalah Port", country: "Oman", re: /\b(salalah port|port of salalah)\b/i },
  { port: "Duqm Port", country: "Oman", re: /\b(duqm port|port of duqm)\b/i },
  { port: "Khalifa Bin Salman Port", country: "Bahrain", re: /\b(khalifa bin salman port|mina salman)\b/i },
  { port: "Shuwaikh Port", country: "Kuwait", re: /\b(shuwaikh port|shuaiba port)\b/i },
  { port: "Aqaba Port", country: "Jordan", re: /\b(aqaba port|port of aqaba)\b/i },
  { port: "Shahid Rajaee", country: "Iran", re: /\b(shahid rajaee|shahid rajaei|bandar abbas port|port of bandar abbas)\b/i },
  { port: "Bushehr Port", country: "Iran", re: /\b(bushehr port|port of bushehr)\b/i },
  { port: "Chabahar Port", country: "Iran", re: /\b(chabahar port|port of chabahar|shahid beheshti port)\b/i },
  { port: "Umm Qasr", country: "Iraq", re: /\b(umm qasr|port of umm qasr)\b/i },
  { port: "Khor al-Zubair", country: "Iraq", re: /\b(khor al-zubair|khor al zubair)\b/i },
  { port: "Hodeidah Port", country: "Yemen", re: /\b(hodeidah port|hudaydah port|port of hodeidah|al hudaydah port)\b/i },
  { port: "Aden Port", country: "Yemen", re: /\b(aden port|port of aden)\b/i },
  { port: "Haifa Port", country: "Israel", re: /\b(haifa port|port of haifa)\b/i },
  { port: "Ashdod Port", country: "Israel", re: /\b(ashdod port|port of ashdod)\b/i },
  { port: "Beirut Port", country: "Lebanon", re: /\b(beirut port|port of beirut)\b/i },
  { port: "Latakia Port", country: "Syria", re: /\b(latakia port|port of latakia)\b/i },
  { port: "Tartus Port", country: "Syria", re: /\b(tartus port|port of tartus)\b/i },
];

// All DISTINCT named ports referenced by an incident's own text (title +
// summary + location, never the source masthead). Deduped by port label so an
// article naming "Port Klang" and "Klang Port" counts the port once.
export function recoverCargoPortMatches(
  i: CargoIncidentLike,
): Array<{ port: string; country: string }> {
  const text = `${i.title} ${i.summary ?? ""} ${i.location ?? ""}`;
  const seen = new Set<string>();
  const out: Array<{ port: string; country: string }> = [];
  for (const g of CARGO_PORT_GAZETTEER) {
    if (g.re.test(text) && !seen.has(g.port)) {
      seen.add(g.port);
      out.push({ port: g.port, country: g.country });
    }
  }
  return out;
}

// The single named port for an incident, or null. STRICT: returns a port only
// when exactly ONE distinct port is named. Zero matches → null (no fabrication).
// Two or more distinct ports → null too: that is an origin→destination route
// story, and attributing the loss to either port would be a guess.
export function recoverCargoPortName(
  i: CargoIncidentLike,
): { port: string; country: string } | null {
  const matches = recoverCargoPortMatches(i);
  return matches.length === 1 ? matches[0] : null;
}

export type Scope = "in_scope" | "out_of_scope_geo" | "excluded_non_cargo" | "country_review";

export function classifyScope(i: CargoIncidentLike, region: Region): Scope {
  const text = `${i.title} ${i.summary ?? ""}`;
  // Reject non-cargo / civic / film / etc. content first.
  if (NON_CARGO_RE.test(text)) return "excluded_non_cargo";
  // Fish/lobster/oyster only counts as cargo if cargo verbs are also present.
  if (NON_CARGO_FISH_RE.test(text) && !/\b(cargo|freight|container|truck|warehouse|depot|consignment|shipment|logistic)\b/i.test(text)) {
    return "excluded_non_cargo";
  }
  // Analyst override: an explicit human "Add to lane" decision on a Needs Review
  // row is authoritative for a recognized in-scope country. It promotes the row
  // past the heuristic cargo-vocab / genuineness gates below (the analyst read
  // the source; the classifier only sees the headline), but NOT past the hard
  // non-cargo / fish rejects above, and never out of APAC/Middle East geography
  // (region is derived from the analyst-assigned country, so an out-of-scope or
  // unrecognized assignment cannot leak in here).
  if (i.analystInScope === true && (region === "APAC" || region === "Middle East")) {
    return "in_scope";
  }
  // Must reference cargo / logistics crime vocabulary at all (English or Bahasa).
  if (!hasCargoVocab(text)) return "excluded_non_cargo";
  // Foreign-location override: text says incident is in a non-scope country.
  if (OOS_CONTEXT_RE.test(text)) return "out_of_scope_geo";
  if (NATIONALITY_OFFSHORE_RE.test(text) && /\b(Canada|United States|USA|US|UK|Britain|Italy|Europe|Africa|Brazil|Mexico|Australia)\b/i.test(text) && region !== "APAC" && region !== "Middle East") {
    return "out_of_scope_geo";
  }
  // Country-driven classification.
  if (region === "Out of scope") return "out_of_scope_geo";
  if (region === "Country not identified") {
    // Recover only records that NAME an in-scope APAC/ME place in their text AND
    // carry cargo-NOUN-anchored crime vocabulary (a bare "motorcycle theft in
    // Penang" is not enough). Unattributed US/global commentary and generic
    // local crime stay in the needs-review bucket.
    const recovered = recoverCargoCountryFromText(i);
    if (recovered && hasGenuineCargo(text) && !isCargoNoise(text)) {
      const recRegion = classifyRegion(recovered);
      if (recRegion === "APAC" || recRegion === "Middle East") return "in_scope";
    }
    return "country_review";
  }
  // Attributed APAC/ME row: clears the cargo-vocab gate on a bare cargo-ish
  // token, so drop generic-crime noise (safe burglary, cash-van robbery,
  // vehicle theft, arms dealing, doorstep parcel theft) that lacks any cargo /
  // load context before admitting it as a cargo incident.
  if (isCargoNoise(text)) return "excluded_non_cargo";
  // Final gate: keep ONLY genuine cargo / goods incidents. A bare warehouse or
  // truck burglary with no freight, shipment or named commodity (cash thefts,
  // unspecified loot, the vehicle itself) is dropped here — the bulk of the
  // generic Indonesian warehouse/truck noise the product owner asked to remove.
  if (!hasGenuineCargo(text)) return "excluded_non_cargo";
  return "in_scope";
}

// Convenience: full scope decision straight from a record.
export function cargoScope(i: CargoIncidentLike): Scope {
  return classifyScope(i, classifyRegion(i.country));
}

// Effective in-scope country for display: the stored country when present,
// otherwise a text-recovered one. Used by every cargo surface so a recovered
// record shows its country on the map, country chart and tables.
export function cargoCountry(i: CargoIncidentLike): string | null {
  const stored = identifyCountry(i.country);
  if (stored) return stored;
  return recoverCargoCountryFromText(i);
}

export function isCargoInScope(i: CargoIncidentLike): boolean {
  return cargoScope(i) === "in_scope";
}

// Specific cargo type rules run first; the General Cargo fallback catches
// generic freight/container/truck wording so that "Other" is reserved for
// genuinely unclear records. Order matters — more specific rules first.
const CATEGORY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Cash / High Value Goods", pattern: /\b(cash|currency|bullion|gold|silver|jewell?ery|diamond|atm|valuables|high[- ]value)\b/i },
  { label: "Electronics", pattern: /\b(electronic|electronics|smartphone|smartphones|mobile phone|mobile phones|cellphone|laptop|laptops|semiconductor|semiconductors|chip|chips|tv|television|tablet|tablets|gadget|consumer electronics|appliance|appliances)\b/i },
  { label: "Pharmaceuticals", pattern: /\b(pharma|pharmaceutical|pharmaceuticals|medicine|medicines|medical supplies|medical supply|vaccine|vaccines|drug|drugs)\b/i },
  { label: "Tobacco", pattern: /\b(tobacco|cigarette|cigarettes|cigar|cigars|vape|vapes|e-cigarette|e-cigarettes)\b/i },
  { label: "Alcohol", pattern: /\b(alcohol|liquor|whisky|whiskey|wine|wines|beer|beers|spirits|rum|vodka|gin)\b/i },
  { label: "Fuel", pattern: /\b(fuel|petrol|diesel|gasoline|lpg|cng|kerosene|jet fuel|aviation fuel)\b/i },
  { label: "Vehicles / Auto Parts", pattern: /\b(vehicle|vehicles|auto parts|car parts|motorcycle|motorcycles|motorbike|tyres?|tires|automobile|automobiles|spare parts|car|cars|truck part|truck parts)\b/i },
  { label: "Textiles / Apparel", pattern: /\b(garment|garments|textile|textiles|apparel|clothing|fabric|fabrics|cotton|denim)\b/i },
  { label: "Chemicals", pattern: /\b(chemical|chemicals|fertili[sz]er|fertili[sz]ers|solvent|solvents|ammonia|acid|hazmat|industrial chemical)\b/i },
  { label: "Food", pattern: /\b(food|foods|grain|grains|rice|wheat|sugar|edible oil|produce|frozen|meat|poultry|dairy|seafood|fish|coffee|tea|beef|chicken)\b/i },
  { label: "FMCG", pattern: /\b(fmcg|consumer goods|household goods|household|personal care|toiletries|fast[- ]moving)\b/i },
  // General Cargo — generic freight/container/truck wording with no specific cargo type detail.
  { label: "General Cargo", pattern: /\b(cargo|freight|container|containers|shipment|shipments|consignment|consignments|truck|trucks|lorry|lorries|warehouse|godown|depot|parcel|parcels|goods)\b/i },
];

export function classifyCategory(i: CargoIncidentLike): string {
  // Per spec: parse from title + summary + source text.
  const text = `${i.title} ${i.summary ?? ""} ${i.source ?? ""}`;
  for (const r of CATEGORY_RULES) {
    if (r.pattern.test(text)) return r.label;
  }
  return "Other";
}

// Where the loss happened — derived from incident text. Order matters: more
// specific premises first, transit last. Returns "—" when nothing concrete.
export function classifyLocationType(i: CargoIncidentLike): string {
  const text = `${i.title} ${i.summary ?? ""} ${i.location ?? ""}`;
  if (/\b(warehouse|godown|storage facility|industrial[- ]zone)\b/i.test(text)) return "Warehouse";
  if (/\b(depot|distribution cent(?:re|er)|freight depot|inland container depot|icd|terminal|yard)\b/i.test(text)) return "Depot";
  if (/\b(airport|air cargo|air freight)\b/i.test(text)) return "Airport";
  if (/\b(port|harbour|harbor|wharf|dock|quay)\b/i.test(text)) return "Port";
  if (/\b(highway|expressway|motorway|freeway|toll road|en route|in[- ]transit|convoy|roadside|on the road)\b/i.test(text)) return "Highway";
  return "—";
}

// What kind of cargo crime — derived from incident text. Order matters.
export function classifyIncidentType(i: CargoIncidentLike): string {
  const text = `${i.title} ${i.summary ?? ""}`;
  if (/\b(truck|lorry|consignment|cargo|freight)\b[^.]*\bhijack/i.test(text) || /\bhijack[^.]*\b(truck|lorry|cargo|freight|consignment)\b/i.test(text)) return "Truck hijacking";
  if (/\bhijack/i.test(text)) return "Hijacking";
  if (/\bwarehouse\b[^.]*\b(theft|burglar|robber|raid|stolen|loot|broke)\b/i.test(text) || /\b(theft|stolen|raid|burglar|loot)\b[^.]*\bwarehouse\b/i.test(text)) return "Warehouse theft";
  if (/\bcontainer\b[^.]*\b(theft|stolen|stole)\b/i.test(text) || /\b(theft|stolen|stole)\b[^.]*\bcontainer\b/i.test(text)) return "Container theft";
  if (/\bpilfer/i.test(text)) return "Pilferage";
  if (/\bseal[- ]?tamper/i.test(text)) return "Seal tampering";
  if (/\bsmuggl/i.test(text)) return "Smuggling";
  if (/\bfraud\b/i.test(text)) return "Cargo fraud";
  if (/\b(robbery|robbed|loot|burglar|raid|stolen|stole|theft)\b/i.test(text)) return "Other land-based cargo theft";
  return "Other";
}

// Explicit monetary loss in USD only. Rupee / local-currency figures are NOT
// converted (that would require a fabricated FX rate), so they do not inflate
// the confirmed-value total. Honest by design: only what the source states in
// dollars. We deliberately take the FIRST contextual figure, not the largest.
export function parseUsdLoss(i: CargoIncidentLike): number | null {
  const text = `${i.title} ${i.summary ?? ""}`;
  // Industry-wide cost/loss STATISTICS are not single-incident losses.
  if (/\b(a day|per day|\/day|a year|per year|per annum|annually|every year|daily)\b/i.test(text)) return null;
  if (/\blosses\s+(hit|exceed|reach|top|cost)/i.test(text)) return null;
  if (/\bcosts?\s+(trucking|supply|the industry|logistics|exceed|u\.?s\.?)/i.test(text)) return null;
  const m = text.match(/(?:US\$|USD\s*\$?|\$)\s?([\d][\d,]*(?:\.\d+)?)\s*(billion|million|bn|mn|m)?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const suf = (m[2] ?? "").toLowerCase();
  if (suf.startsWith("b")) n *= 1e9;
  else if (suf === "m" || suf === "mn" || suf === "million") n *= 1e6;
  // Sanity ceiling: a single cargo-theft incident is never $100M+.
  if (n >= 1e8) return null;
  // The figure must sit next to theft/value language.
  const at = text.indexOf(m[0]);
  const ctx = text.slice(Math.max(0, at - 45), at + m[0].length + 45);
  if (!/(stolen|theft|stole|loss|lost|robbed|robber|hijack|loot|burglar|pilfer|siphon|smuggl|seiz|recover|worth|valued|value|cargo|goods|consignment|shipment|haul|diesel|fuel)/i.test(ctx)) return null;
  return Math.round(n);
}

// Most-stolen commodity across a set of incidents. "Other" is never returned —
// it is dropped before ranking, and an empty/all-Other set falls back to the
// generic "General Cargo" label rather than the meaningless "Other".
export function mostStolenCommodity(incidents: CargoIncidentLike[]): string | null {
  if (incidents.length === 0) return null;
  const counts = new Map<string, number>();
  for (const i of incidents) {
    const cat = classifyCategory(i);
    if (cat === "Other") continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  if (counts.size === 0) return "General Cargo";
  let best = "";
  let bestN = -1;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

// Sum of source-stated USD losses across a set of incidents.
export function totalUsdLoss(incidents: CargoIncidentLike[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const i of incidents) {
    const v = parseUsdLoss(i);
    if (v != null) {
      total += v;
      count += 1;
    }
  }
  return { total, count };
}
