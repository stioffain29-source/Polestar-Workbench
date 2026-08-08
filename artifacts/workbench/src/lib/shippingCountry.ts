// Derive the *incident location* country for a shipping record, and keep any
// vessel flag-state value separate. The raw `country` field in the dataset is
// inconsistent — sometimes it carries the country where the event happened,
// sometimes it carries the vessel flag state. Charts must reflect WHERE the
// event happened, never the flag state.
//
// Rules:
//   1. If the `location` text mentions a known APAC / Middle East country,
//      use that. Location is authored from the incident itself, so it is the
//      most reliable signal of where the event occurred.
//   2. Otherwise, fall back to the `country` field ONLY when that country
//      name also appears in the title, summary or location text. That cross
//      check is what stops a vessel flag state (which never echoes into the
//      event prose) from leaking into the incident-country bucket.
//   3. Otherwise return null — surfaced as "Location not identified".

export const KNOWN_COUNTRIES = [
  // Middle East
  "Saudi Arabia", "United Arab Emirates", "UAE", "Oman", "Qatar", "Bahrain",
  "Kuwait", "Jordan", "Iraq", "Yemen", "Israel", "Lebanon", "Syria",
  "Turkey", "Turkiye", "Türkiye", "Iran",
  // APAC
  "Singapore", "Malaysia", "Indonesia", "Thailand", "Vietnam", "Philippines",
  "Cambodia", "Laos", "Myanmar", "India", "Pakistan", "Bangladesh",
  "Sri Lanka", "China", "Taiwan", "South Korea", "Japan", "Australia",
  "New Zealand", "Papua New Guinea", "West Papua",
  // Wider report coverage
  "Afghanistan", "Algeria", "Argentina", "Brazil", "Canada", "Chile",
  "Colombia", "Democratic Republic of the Congo", "Egypt", "Ethiopia",
  "France", "Germany", "Greece", "Italy", "Kenya", "Libya", "Mexico",
  "Morocco", "Nigeria", "Palestine", "Peru", "Russia", "Somalia",
  "South Africa", "Spain", "Sudan", "Ukraine", "United Kingdom",
  "United States", "Venezuela",
];

const COUNTRY_ALIASES: Record<string, string> = {
  "UAE": "UAE",
  "United Arab Emirates": "UAE",
  "Turkiye": "Turkey",
  "Türkiye": "Turkey",
  "United States": "United States",
  "US": "United States",
  "U.S.": "United States",
  "United Kingdom": "United Kingdom",
  "UK": "United Kingdom",
  "DR Congo": "Democratic Republic of the Congo",
};

function canonical(country: string): string {
  return COUNTRY_ALIASES[country] ?? country;
}

export function findCountryInText(text: string): string | null {
  if (!text) return null;
  // Match longest names first so "United Arab Emirates" wins over "Emirates".
  const ordered = [...KNOWN_COUNTRIES].sort((a, b) => b.length - a.length);
  for (const c of ordered) {
    const re = new RegExp(`\\b${c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) return canonical(c);
  }
  return null;
}

// Country names are often omitted where an unambiguous capital or operating
// city is named. These are event-location cues, unlike a vessel flag field.
const CITY_COUNTRY_CUES: Array<[RegExp, string]> = [
  [/\bjakarta\b/i, "Indonesia"],
  [/\btehran\b/i, "Iran"],
  [/\bmuscat\b/i, "Oman"],
  [/\babu dhabi\b|\bdubai\b/i, "UAE"],
  [/\briyadh\b|\bjeddah\b/i, "Saudi Arabia"],
  [/\bdoha\b/i, "Qatar"],
  [/\bsana'?a\b|\baden\b/i, "Yemen"],
  [/\bbaghdad\b|\bbasra\b/i, "Iraq"],
  [/\bnew delhi\b|\bmumbai\b|\bjamnagar\b/i, "India"],
  [/\bislamabad\b|\bkarachi\b/i, "Pakistan"],
  [/\bmanila\b/i, "Philippines"],
  [/\bbangkok\b/i, "Thailand"],
  [/\bsingapore\b/i, "Singapore"],
  [/\bport moresby\b/i, "Papua New Guinea"],
  [/\bkyiv\b|\bkiev\b/i, "Ukraine"],
  [/\blagos\b|\babuja\b/i, "Nigeria"],
];

// Geographic context that is sufficiently specific to corroborate a matching
// raw country, but not sufficiently exclusive to derive the country by itself.
// Hormuz borders both Iran and Oman, so a Hormuz mention must never turn a
// Panama-flagged vessel into an Iranian incident; it can only validate an
// already supplied Iranian location field.
const COUNTRY_CONTEXT_CUES: Array<[RegExp, string]> = [
  [/\b(?:strait of )?hormuz\b/i, "Iran"],
];

function findCountryCue(text: string): string | null {
  return findCountryInText(text) ?? CITY_COUNTRY_CUES.find(([re]) => re.test(text))?.[1] ?? null;
}

function countryMatchesText(country: string, text: string): boolean {
  const aliases = Object.entries(COUNTRY_ALIASES)
    .filter(([, value]) => value.toLowerCase() === country.toLowerCase())
    .map(([key]) => key)
    .concat(country);
  if (aliases.some((candidate) => {
    const escaped = candidate.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  })) return true;
  return COUNTRY_CONTEXT_CUES.some(
    ([re, cueCountry]) =>
      cueCountry.toLowerCase() === country.toLowerCase() && re.test(text),
  );
}

export interface CountrySource {
  country?: string | null;
  location?: string | null;
  title?: string | null;
  summary?: string | null;
}

/**
 * Country where the incident happened. Returns null when no event-location
 * country can be identified — callers should surface "Location not identified".
 */
export function deriveIncidentCountry(i: CountrySource): string | null {
  // 1. Location text is authored from the event itself.
  const fromLocation = findCountryCue(i.location ?? "");
  if (fromLocation) return fromLocation;

  const eventBlob = `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
  // 2. A country named directly in title/summary is an event-location signal
  // even when the source row leaves `country` blank.
  const fromProse = findCountryCue(eventBlob);
  // 3. country field, only if corroborated by event prose or an unambiguous
  // city cue. Strip "Unknown" so it never wins this check.
  const raw = (i.country ?? "").split(/[;,]/)[0].trim();
  if (raw && !/^unknown$/i.test(raw)) {
    const c = canonical(raw);
    if (fromProse && fromProse.toLowerCase() === c.toLowerCase()) return c;
    if (countryMatchesText(c, eventBlob)) return c;
  }
  return fromProse;
}

/**
 * Flag state of the vessel, if one is recorded separately from the incident
 * country. Returns the raw `country` value when it does NOT match the derived
 * incident country — that mismatch is the signal that the `country` field is
 * being used as a flag state, not as an event location.
 */
export function deriveFlagState(i: CountrySource): string | null {
  const raw = (i.country ?? "").split(/[;,]/)[0].trim();
  if (!raw || /^unknown$/i.test(raw)) return null;
  const flag = canonical(raw);
  const incident = deriveIncidentCountry(i);
  if (incident && incident.toLowerCase() === flag.toLowerCase()) return null;
  // Only surface the flag when the event text does NOT mention it as a place.
  const eventBlob = `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
  const re = new RegExp(`\\b${flag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
  if (re.test(eventBlob)) return null;
  return flag;
}

export const LOCATION_NOT_IDENTIFIED = "Location not identified";
