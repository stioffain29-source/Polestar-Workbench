// Country attribution by PHYSICAL location (owner brief §5).
//
// §5: the report is based primarily on where the event physically happened, NOT
// on any country merely mentioned. A protest in Taipei concerning Indonesia is a
// TAIWAN event with Indonesia as related_country. A conference in Cairns
// attended by PNG officials is an AUSTRALIA event. Venue cues ("in <place>",
// "outside the embassy in <city>") outrank subject mentions.
//
// Pure — no runtime dependencies.

import type { CountryEngineConfig, EngineSourceInput } from "./types";

export interface CountryAttribution {
  physicalCountry: string;
  relatedCountry: string | null;
  isForeignVenue: boolean;
  locationText: string | null;
}

// A compact gazetteer of foreign capitals / major cities -> country name. This
// lets the engine recognise a foreign VENUE ("protest in Taipei", "conference in
// Cairns") and attribute the event to the country where it physically occurred.
// Deliberately proper-noun heavy so ambiguous short words never match.
const FOREIGN_CITY_COUNTRY: Record<string, string> = {
  // Taiwan
  taipei: "Taiwan",
  kaohsiung: "Taiwan",
  taichung: "Taiwan",
  // Australia
  canberra: "Australia",
  sydney: "Australia",
  melbourne: "Australia",
  brisbane: "Australia",
  cairns: "Australia",
  perth: "Australia",
  darwin: "Australia",
  townsville: "Australia",
  // Singapore / Malaysia
  singapore: "Singapore",
  "kuala lumpur": "Malaysia",
  putrajaya: "Malaysia",
  // China / Hong Kong
  beijing: "China",
  shanghai: "China",
  guangzhou: "China",
  "hong kong": "Hong Kong",
  // Japan / Korea
  tokyo: "Japan",
  osaka: "Japan",
  seoul: "South Korea",
  busan: "South Korea",
  pyongyang: "North Korea",
  // South / Southeast Asia
  bangkok: "Thailand",
  "new delhi": "India",
  delhi: "India",
  mumbai: "India",
  dhaka: "Bangladesh",
  islamabad: "Pakistan",
  karachi: "Pakistan",
  kathmandu: "Nepal",
  colombo: "Sri Lanka",
  hanoi: "Vietnam",
  "ho chi minh": "Vietnam",
  "phnom penh": "Cambodia",
  vientiane: "Laos",
  yangon: "Myanmar",
  naypyidaw: "Myanmar",
  "bandar seri begawan": "Brunei",
  // Pacific / NZ
  suva: "Fiji",
  "port vila": "Vanuatu",
  honiara: "Solomon Islands",
  nuku: "Tonga",
  apia: "Samoa",
  wellington: "New Zealand",
  auckland: "New Zealand",
  // Wider world (kept small)
  london: "United Kingdom",
  washington: "United States",
  "new york": "United States",
  geneva: "Switzerland",
  brussels: "Belgium",
  jakarta: "Indonesia",
  "port moresby": "Papua New Guinea",
  manila: "Philippines",
};

// Country names / demonyms -> canonical country name, for RELATED-country
// detection (subject mentions). Kept compact and proper-noun heavy.
const COUNTRY_NAME_PATTERNS: Array<[string, RegExp]> = [
  ["Taiwan", /\b(taiwan|taiwanese)\b/i],
  ["Australia", /\b(australia|australian)\b/i],
  ["Indonesia", /\b(indonesia|indonesian)\b/i],
  ["Papua New Guinea", /\b(papua new guinea|\bpng\b)\b/i],
  ["Philippines", /\b(philippines|philippine|filipino)\b/i],
  ["Thailand", /\b(thailand|thai)\b/i],
  ["Malaysia", /\b(malaysia|malaysian)\b/i],
  ["Singapore", /\b(singapore|singaporean)\b/i],
  ["China", /\b(china|chinese)\b/i],
  ["Japan", /\b(japan|japanese)\b/i],
  ["South Korea", /\b(south korea|korean)\b/i],
  ["India", /\b(\bindia\b|indian)\b/i],
  ["Bangladesh", /\b(bangladesh|bangladeshi)\b/i],
  ["Pakistan", /\b(pakistan|pakistani)\b/i],
  ["Nepal", /\b(nepal|nepali|nepalese)\b/i],
  ["Sri Lanka", /\b(sri lanka|sri lankan)\b/i],
  ["Vietnam", /\b(vietnam|vietnamese)\b/i],
  ["Myanmar", /\b(myanmar|burma|burmese)\b/i],
  ["United Kingdom", /\b(united kingdom|britain|british)\b/i],
  ["United States", /\b(united states|u\.?s\.?a?\b|american)\b/i],
  ["New Zealand", /\b(new zealand)\b/i],
  ["Fiji", /\b(fiji|fijian)\b/i],
];

function englishText(input: EngineSourceInput): string {
  const title = (input.displayTitle && input.displayTitle.trim()) || input.title || "";
  return `${title} ${input.summary ?? ""}`;
}

// Escape a literal for use inside a RegExp.
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Detect a foreign VENUE from an explicit venue cue: "in <city>", "at <city>",
// "outside the embassy in <city>". Returns the country + the matched city text.
function detectForeignVenue(
  text: string,
  homeCountry: string,
): { country: string; city: string } | null {
  const lower = ` ${text.toLowerCase()} `;
  for (const [city, country] of Object.entries(FOREIGN_CITY_COUNTRY)) {
    if (country === homeCountry) continue;
    // Require a venue preposition IMMEDIATELY before the city (allowing only an
    // article / "embassy in") so a mere subject mention never fires.
    const re = new RegExp(
      `\\b(?:in|at|outside|near|from)\\s+(?:the\\s+)?(?:embassy\\s+in\\s+|consulate\\s+in\\s+)?${esc(city)}\\b`,
      "i",
    );
    if (re.test(lower)) return { country, city };
    // Bare leading city ("Taipei protest ...") also counts as a venue.
    const bare = new RegExp(`(^|[^a-z])${esc(city)}\\b`, "i");
    if (bare.test(lower)) return { country, city };
  }
  return null;
}

// Detect a related country (subject mention) other than the physical country.
function detectRelatedCountry(text: string, exclude: string): string | null {
  for (const [country, re] of COUNTRY_NAME_PATTERNS) {
    if (country === exclude) continue;
    if (re.test(text)) return country;
  }
  return null;
}

// True when the record's own home gazetteer / accepted tokens are present in the
// text — a positive home anchor that outranks a foreign subject mention.
function hasHomeAnchor(text: string, config: CountryEngineConfig): boolean {
  const lower = text.toLowerCase();
  for (const token of config.acceptedTokens) {
    const re = new RegExp(`\\b${esc(token.toLowerCase())}\\b`, "i");
    if (re.test(lower)) return true;
  }
  for (const place of Object.keys(config.gazetteer)) {
    const re = new RegExp(`\\b${esc(place.toLowerCase())}\\b`, "i");
    if (re.test(lower)) return true;
  }
  return false;
}

// Attribute the physical country of an event per §5. Physical location wins:
// a foreign VENUE overrides any home-country subject mention.
export function attributeCountry(
  input: EngineSourceInput,
  config: CountryEngineConfig,
): CountryAttribution {
  const text = englishText(input);
  const home = config.countryName;

  // 1. A HOME venue cue ("in Jakarta", "in Port Moresby") is the strongest
  //    signal: the event physically happened at home.
  if (homeAnchorIsVenue(text, config)) {
    const related = detectRelatedCountry(text, home);
    return {
      physicalCountry: home,
      relatedCountry: related,
      isForeignVenue: false,
      locationText: input.location ?? null,
    };
  }

  // 2. A FOREIGN venue cue ("protest in Taipei", "conference in Cairns") wins
  //    over a mere home-country subject mention (§5's Taipei example).
  const foreignVenue = detectForeignVenue(text, home);
  if (foreignVenue) {
    // The related country is whatever the article is ABOUT. Prefer the home
    // country when it is the subject (Taipei protest ABOUT Indonesia); else the
    // next named country other than the venue's own.
    const homeMentioned =
      detectRelatedCountry(text, foreignVenue.country) === home ||
      new RegExp(`\\b${esc(home.toLowerCase())}\\b`, "i").test(text.toLowerCase()) ||
      hasHomeAnchor(text, config);
    const related = homeMentioned
      ? home
      : detectRelatedCountry(text, foreignVenue.country);
    return {
      physicalCountry: foreignVenue.country,
      relatedCountry: related && related !== foreignVenue.country ? related : null,
      isForeignVenue: true,
      locationText: foreignVenue.city,
    };
  }

  // 3. Default: physically the home country.
  const related = detectRelatedCountry(text, home);
  return {
    physicalCountry: home,
    relatedCountry: related,
    isForeignVenue: false,
    locationText: input.location ?? null,
  };
}

// A HOME venue cue ("in Jakarta", "in Port Moresby") beats a foreign subject:
// when the text carries an explicit venue preposition before a home gazetteer
// place, the event is physically at home.
function homeAnchorIsVenue(text: string, config: CountryEngineConfig): boolean {
  const lower = ` ${text.toLowerCase()} `;
  const homePlaces = [
    ...Object.keys(config.gazetteer).map((p) => p.toLowerCase()),
    config.countryName.toLowerCase(),
  ];
  for (const place of homePlaces) {
    const re = new RegExp(
      `\\b(?:in|at|outside|near)\\s+(?:the\\s+)?(?:embassy\\s+in\\s+|consulate\\s+in\\s+)?${esc(place)}\\b`,
      "i",
    );
    if (re.test(lower)) return true;
  }
  return false;
}
