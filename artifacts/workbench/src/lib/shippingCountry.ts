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

const KNOWN_COUNTRIES = [
  // Middle East
  "Saudi Arabia", "United Arab Emirates", "UAE", "Oman", "Qatar", "Bahrain",
  "Kuwait", "Jordan", "Iraq", "Yemen", "Israel", "Lebanon", "Syria",
  "Turkey", "Turkiye", "Türkiye", "Iran",
  // APAC
  "Singapore", "Malaysia", "Indonesia", "Thailand", "Vietnam", "Philippines",
  "Cambodia", "Laos", "Myanmar", "India", "Pakistan", "Bangladesh",
  "Sri Lanka", "China", "Taiwan", "South Korea", "Japan", "Australia",
  "New Zealand", "Papua New Guinea", "West Papua",
];

const COUNTRY_ALIASES: Record<string, string> = {
  "UAE": "UAE",
  "United Arab Emirates": "UAE",
  "Turkiye": "Turkey",
  "Türkiye": "Turkey",
};

function canonical(country: string): string {
  return COUNTRY_ALIASES[country] ?? country;
}

function findCountryInText(text: string): string | null {
  if (!text) return null;
  // Match longest names first so "United Arab Emirates" wins over "Emirates".
  const ordered = [...KNOWN_COUNTRIES].sort((a, b) => b.length - a.length);
  for (const c of ordered) {
    const re = new RegExp(`\\b${c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) return canonical(c);
  }
  return null;
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
  const fromLocation = findCountryInText(i.location ?? "");
  if (fromLocation) return fromLocation;

  // 2. country field, only if corroborated by the event prose. Strip any
  //    "Unknown" placeholder so it never wins this check.
  const raw = (i.country ?? "").split(/[;,]/)[0].trim();
  if (raw && !/^unknown$/i.test(raw)) {
    const c = canonical(raw);
    const eventBlob = `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
    const re = new RegExp(`\\b${c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(eventBlob)) return c;
  }

  return null;
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
