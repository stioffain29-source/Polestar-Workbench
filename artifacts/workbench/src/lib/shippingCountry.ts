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
  [/\briyadh\b|\bjeddah\b|\bjazan\b|\byanbu\b|\bras tanura\b/i, "Saudi Arabia"],
  [/\bdoha\b/i, "Qatar"],
  [/\bsana'?a\b|\baden\b/i, "Yemen"],
  [/\bbaghdad\b|\bbasra\b|\bbaiji\b|\bkirkuk\b/i, "Iraq"],
  [/\babadan\b|\bbandar abbas\b/i, "Iran"],
  [/\bfujairah\b/i, "UAE"],
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

// Adjectival / demonym forms. "Iraqi authorities extinguished a refinery
// fire" names the country as clearly as "Iraq" does, but `\bIraq\b` cannot
// match "Iraqi". Deliberately excluded: "American" (Latin American, American
// Airlines), "Korean" (North/South ambiguity), "Congolese" (two Congos).
const COUNTRY_DEMONYMS: Array<[RegExp, string]> = [
  [/\bsaudi\b/i, "Saudi Arabia"],
  [/\bemirati\b/i, "UAE"],
  [/\bomani\b/i, "Oman"],
  [/\bqatari\b/i, "Qatar"],
  [/\bbahraini\b/i, "Bahrain"],
  [/\bkuwaiti\b/i, "Kuwait"],
  [/\bjordanian\b/i, "Jordan"],
  [/\biraqi\b/i, "Iraq"],
  [/\byemeni\b/i, "Yemen"],
  [/\bisraeli\b/i, "Israel"],
  [/\blebanese\b/i, "Lebanon"],
  [/\bsyrian\b/i, "Syria"],
  [/\bturkish\b/i, "Turkey"],
  [/\biranian\b/i, "Iran"],
  [/\bsingaporean\b/i, "Singapore"],
  [/\bmalaysian\b/i, "Malaysia"],
  [/\bindonesian\b/i, "Indonesia"],
  [/\bthai\b/i, "Thailand"],
  [/\bvietnamese\b/i, "Vietnam"],
  [/\bphilippine\b|\bfilipino\b/i, "Philippines"],
  [/\bcambodian\b/i, "Cambodia"],
  [/\bburmese\b/i, "Myanmar"],
  [/\bindian\b/i, "India"],
  [/\bpakistani\b/i, "Pakistan"],
  [/\bbangladeshi\b/i, "Bangladesh"],
  [/\bsri lankan\b/i, "Sri Lanka"],
  [/\bchinese\b/i, "China"],
  [/\btaiwanese\b/i, "Taiwan"],
  [/\bjapanese\b/i, "Japan"],
  [/\baustralian\b/i, "Australia"],
  [/\bafghan\b/i, "Afghanistan"],
  [/\balgerian\b/i, "Algeria"],
  [/\bbrazilian\b/i, "Brazil"],
  [/\begyptian\b/i, "Egypt"],
  [/\bethiopian\b/i, "Ethiopia"],
  [/\bfrench\b/i, "France"],
  [/\bgerman\b/i, "Germany"],
  [/\bgreek\b/i, "Greece"],
  [/\bitalian\b/i, "Italy"],
  [/\bkenyan\b/i, "Kenya"],
  [/\blibyan\b/i, "Libya"],
  [/\bmexican\b/i, "Mexico"],
  [/\bmoroccan\b/i, "Morocco"],
  [/\bnigerian\b/i, "Nigeria"],
  [/\bpalestinian\b/i, "Palestine"],
  [/\brussian\b/i, "Russia"],
  [/\bsomali\b/i, "Somalia"],
  [/\bsouth african\b/i, "South Africa"],
  [/\bspanish\b/i, "Spain"],
  [/\bsudanese\b/i, "Sudan"],
  [/\bukrainian\b/i, "Ukraine"],
  [/\bbritish\b/i, "United Kingdom"],
  [/\bvenezuelan\b/i, "Venezuela"],
];

// A demonym attached to a vessel or flag descriptor ("Saudi-flagged oil
// carriers", "Saudi oil tanker", "Panama-registered vessel") describes the
// ship, not where the event happened. Mask those spans before scanning for
// demonyms so flag states never leak into the incident-country bucket.
const FLAG_DESCRIPTOR_RE =
  /\b[\w'’]+[- ](?:flagged|registered|owned|operated)\b|\b[\w'’]+\s+(?:oil\s+|lng\s+|crude\s+|gas\s+)?(?:tankers?|vessels?|ships?|carriers?|freighters?|bulkers?|boats?)\b/gi;

function maskFlagDescriptors(text: string): string {
  return text.replace(FLAG_DESCRIPTOR_RE, " ");
}

function findCountryDemonym(text: string): string | null {
  if (!text) return null;
  const masked = maskFlagDescriptors(text);
  return COUNTRY_DEMONYMS.find(([re]) => re.test(masked))?.[1] ?? null;
}

// Vessel context is the only situation in which the raw `country` field can
// plausibly carry a flag state rather than the event location. Land incidents
// (refinery halts, depot fires, policy moves) have no flag to leak.
const VESSEL_CONTEXT_RE =
  /\b(?:tankers?|vessels?|ships?|carriers?|freighters?|bulkers?|boats?|cargo(?:es)?|flagged|registered)\b/i;

export function hasVesselContext(text: string): boolean {
  return VESSEL_CONTEXT_RE.test(text);
}

function findCountryCue(text: string): string | null {
  return (
    findCountryInText(text) ??
    CITY_COUNTRY_CUES.find(([re]) => re.test(text))?.[1] ??
    findCountryDemonym(text)
  );
}

function countryNamedInText(country: string, text: string): boolean {
  const aliases = Object.entries(COUNTRY_ALIASES)
    .filter(([, value]) => value.toLowerCase() === country.toLowerCase())
    .map(([key]) => key)
    .concat(country);
  return aliases.some((candidate) => {
    const escaped = candidate.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

function countryContextCueInText(country: string, text: string): boolean {
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
  // 3. country field. Strip "Unknown" so it never wins this check.
  const raw = (i.country ?? "").split(/[;,]/)[0].trim();
  if (raw && !/^unknown$/i.test(raw)) {
    const c = canonical(raw);
    if (fromProse && fromProse.toLowerCase() === c.toLowerCase()) return c;
    // Named directly in the event prose: strongest corroboration.
    if (countryNamedInText(c, eventBlob)) return c;
    if (!fromProse) {
      // Ambiguous geographic context (e.g. Hormuz) can only validate the raw
      // field when the prose names no other country. A country named in the
      // title ("Kuwait discusses oil pipeline ... bypass Strait of Hormuz")
      // must outrank a raw field that only a context cue supports.
      if (countryContextCueInText(c, eventBlob)) return c;
      // No vessel in the story means the raw field cannot be a flag state —
      // a refinery halt or depot fire has no flag to leak. Trust it. This is
      // what keeps "Jazan Refinery halted, 400,000 bpd offline" attributed
      // to Saudi Arabia when the prose never repeats the country name.
      if (!hasVesselContext(eventBlob)) return c;
    }
  }
  return fromProse;
}

// Armed / militant groups whose ORIGIN country the ingest sometimes stamps
// into the raw `country` field of a story about an attack. When such a group
// is named in the prose and the raw field is its home country, the field is
// describing the ATTACKER's origin — never the vessel's flag. ("Houthis
// attacked Saudi oil tanker" + country=Yemen must not read "Yemen-flagged".)
const ACTOR_ORIGIN_GROUPS: Array<[RegExp, string]> = [
  [/\bhouthis?\b|\bansar\s+allah\b/i, "Yemen"],
  [/\bhezbollah\b/i, "Lebanon"],
  [/\bhamas\b/i, "Palestine"],
  [/\birgc\b|\brevolutionary\s+guard\b/i, "Iran"],
  [/\bal[- ]shabaab\b/i, "Somalia"],
  [/\btaliban\b/i, "Afghanistan"],
  [/\bpkk\b/i, "Turkey"],
];

// A flag stated IN the prose itself is the strongest possible flag evidence:
// "Saudi oil tanker", "Saudi-flagged carriers", "Panama-registered vessel".
// Reuses the same descriptor spans that maskFlagDescriptors strips when
// deriving the incident location — the two functions are exact complements:
// what the location pass throws away is precisely what the flag pass keeps.
function findFlagDescriptorCountry(text: string): string | null {
  if (!text) return null;
  const spans = text.match(FLAG_DESCRIPTOR_RE) ?? [];
  for (const span of spans) {
    const demonym = COUNTRY_DEMONYMS.find(([re]) => re.test(span))?.[1];
    if (demonym) return canonical(demonym);
    const named = findCountryInText(span);
    if (named) return named;
  }
  return null;
}

/**
 * Flag state of the vessel. Evidence order:
 *   1. A flag descriptor in the prose ("Saudi oil tanker") — outranks the raw
 *      field, which ingest sometimes stamps with an attacker's origin.
 *   2. The raw `country` field, ONLY when it is not an actor-origin echo,
 *      does not match the derived incident country, and is not mentioned in
 *      the text as a place. That mismatch is the signal the field is being
 *      used as a flag state, not as an event location.
 */
export function deriveFlagState(i: CountrySource): string | null {
  const eventBlob = `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
  const fromProse = findFlagDescriptorCountry(eventBlob);
  if (fromProse) return fromProse;
  const raw = (i.country ?? "").split(/[;,]/)[0].trim();
  if (!raw || /^unknown$/i.test(raw)) return null;
  const flag = canonical(raw);
  if (
    ACTOR_ORIGIN_GROUPS.some(
      ([re, origin]) =>
        origin.toLowerCase() === flag.toLowerCase() && re.test(eventBlob),
    )
  ) {
    return null;
  }
  const incident = deriveIncidentCountry(i);
  if (incident && incident.toLowerCase() === flag.toLowerCase()) return null;
  // Only surface the flag when the event text does NOT mention it as a place.
  const re = new RegExp(`\\b${flag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
  if (re.test(eventBlob)) return null;
  return flag;
}

export const LOCATION_NOT_IDENTIFIED = "Location not identified";
