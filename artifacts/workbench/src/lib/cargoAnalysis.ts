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
}

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

// Cargo-specific NOUNS (objects / premises / conveyances) — excludes the bare
// generic-crime words (theft/robbery/raid) that CARGO_INCIDENT_RE also carries.
const CARGO_NOUN_RE = /\b(cargo|freight|container|containers|truck|trucks|lorry|lorries|warehouse|godown|depot|consignment|shipment|shipments|parcel|parcels|logistic|logistics)\b/i;

// Cargo-specific crime ACTIONS that imply cargo on their own.
const CARGO_ACTION_RE = /\b(hijack|pilfer|seal[- ]?tamper|siphon|smuggl)\w*/i;

// Generic crime verbs — only meaningful for scope when paired with a cargo noun.
const CRIME_VERB_RE = /\b(theft|thie(?:f|ves)|stolen|stole|steal\w*|rob|robbed|robbery|robbers|burglar\w*|break[- ]?in|broke into|broken into|raid\w*|loot\w*|seiz\w*|busted|heist)\b/i;

// Stricter cargo predicate used ONLY when recovering an in-scope country for an
// UNATTRIBUTED record. A bare generic-crime headline that merely names a
// recovered place ("Motorcycle theft in Penang") must NOT be admitted: it needs
// a cargo NOUN + crime verb, a cargo-specific action, or the Bahasa noun+verb
// pair. Attributed (stored-country) rows keep the broader hasCargoVocab gate.
function hasStrictCargoVocab(text: string): boolean {
  if (CARGO_ACTION_RE.test(text)) return true;
  if (CARGO_NOUN_RE.test(text) && CRIME_VERB_RE.test(text)) return true;
  return CARGO_BAHASA_NOUN_RE.test(text) && CRIME_BAHASA_RE.test(text);
}

// Explicit cargo / LOAD context — a freight commodity, a quantity of goods, or
// a "carrying / laden" framing. When present, a record describing a stolen
// truck or an armoured vehicle is a genuine CARGO incident (the goods are the
// target), so the generic-crime exclusions below MUST stand down. Without it,
// the same words describe vehicle theft, a safe burglary or a cash-van robbery
// — a different risk picture that is not Cargo Watch.
const CARGO_LOAD_CONTEXT_RE =
  /\b(cargo|freight|container|containers|consignment|shipment|shipments|laden|loaded|carrying|haul|haulage|pallet|pallets|crate|crates|goods|tonnes?|tons?|kilograms?|\bkg\b|litres?|liters?|bars?|cartons?|boxes|sacks?|bales?|chocolate|electronics|garments?|textiles?|pharmaceutical)\b/i;

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
  const hasLoad = CARGO_LOAD_CONTEXT_RE.test(text);
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

export type Scope = "in_scope" | "out_of_scope_geo" | "excluded_non_cargo" | "country_review";

export function classifyScope(i: CargoIncidentLike, region: Region): Scope {
  const text = `${i.title} ${i.summary ?? ""}`;
  // Reject non-cargo / civic / film / etc. content first.
  if (NON_CARGO_RE.test(text)) return "excluded_non_cargo";
  // Fish/lobster/oyster only counts as cargo if cargo verbs are also present.
  if (NON_CARGO_FISH_RE.test(text) && !/\b(cargo|freight|container|truck|warehouse|depot|consignment|shipment|logistic)\b/i.test(text)) {
    return "excluded_non_cargo";
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
    if (recovered && hasStrictCargoVocab(text) && !isCargoNoise(text)) {
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
