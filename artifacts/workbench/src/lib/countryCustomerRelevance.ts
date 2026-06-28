// Customer Relevance composer for the shared country-brief dataset builder.
//
// Pure (TYPE-only import of the theme keys, no runtime dependency) so it is safe
// to unit-test directly and to call from buildStructuredReportDataset for EVERY
// country report. Produces the short "Customer Relevance" section the renderer
// prints before Recommended Actions (spec §13): an audience line from the
// theatre config plus the period's main issues DERIVED FROM THE INCIDENT MIX,
// not hardcoded country prose.
//
// The same theme→phrase maps also feed the Polestar View (drivers, exposed
// business activities and the most-likely-disruption scenario) so the two
// sections stay consistent and there is one source of truth.
//
// House rules honoured: COUNT-FREE (no record/incident numbers), British
// English, no fabrication — a quiet window states that standing exposures apply
// rather than inventing issues.

import type { CountryIncidentTheme } from "./countryIncidentThemes";

// The period's main issue phrase per theme (Customer Relevance "Main issues …").
const THEME_ISSUE: Record<CountryIncidentTheme, string> = {
  protest: "protest disruption",
  crime: "violent and opportunistic crime exposure",
  natural: "flood and natural-hazard disruption",
  governance: "regulatory and policing follow-on",
  fire: "localised fire and continuity disruption",
  other: "transport, utility and connectivity disruption",
};

// The lead risk driver phrase per theme (Polestar View "driven by …").
const THEME_DRIVER: Record<CountryIncidentTheme, string> = {
  protest: "protest and civil unrest",
  crime: "crime and violent incidents",
  natural: "natural-hazard disruption",
  governance: "policing and regulatory activity",
  fire: "fire and explosion incidents",
  other: "transport and utility disruption",
};

// The most-exposed business activities per theme (Polestar View "main business
// exposure"). Drawn from the §15 vocabulary: movement / site access / staff
// safety / continuity / logistics.
const THEME_EXPOSURE: Record<CountryIncidentTheme, string[]> = {
  protest: ["staff movement", "site access"],
  crime: ["staff safety", "secure movement of cash and assets"],
  natural: ["business continuity", "logistics"],
  governance: ["regulatory compliance", "freedom of movement"],
  fire: ["business continuity", "site access"],
  other: ["logistics", "business continuity"],
};

// The most-likely-disruption scenario per theme (Polestar View "next seven
// days").
const THEME_SCENARIO: Record<CountryIncidentTheme, string> = {
  protest: "further protest activity and associated movement disruption",
  crime: "continued exposure to violent and opportunistic crime",
  natural: "further natural-hazard disruption to transport and site access",
  governance: "regulatory or policing follow-on affecting operations",
  fire: "further localised fires and continuity disruption around affected sites",
  other: "continued transport, utility or connectivity disruption",
};

function joinList(parts: string[]): string {
  const xs = parts.filter((p) => p.trim().length > 0);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0]!;
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// De-duplicate while preserving first-seen order, capped to `max`.
function dedupeCap(xs: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

export function issuePhrasesForThemes(
  keys: CountryIncidentTheme[],
  max = 5,
): string[] {
  return dedupeCap(
    keys.map((k) => THEME_ISSUE[k]),
    max,
  );
}

export function driverPhrasesForThemes(
  keys: CountryIncidentTheme[],
  max = 3,
): string[] {
  return dedupeCap(
    keys.map((k) => THEME_DRIVER[k]),
    max,
  );
}

export function exposureLabelsForThemes(
  keys: CountryIncidentTheme[],
  max = 3,
): string[] {
  return dedupeCap(
    keys.flatMap((k) => THEME_EXPOSURE[k]),
    max,
  );
}

export function scenarioForThemes(keys: CountryIncidentTheme[]): string {
  return keys.length ? THEME_SCENARIO[keys[0]!] : "";
}

export interface CustomerRelevanceInput {
  // Who the brief is written for — from the theatre audience profile.
  audience: string;
  // Present incident themes, most prominent first.
  presentThemeKeys: CountryIncidentTheme[];
  // True when no incidents fell in the window.
  empty: boolean;
}

// Build the Customer Relevance prose block: an audience line plus the period's
// main issues derived from the incident mix. Count-free; a quiet window states
// standing exposures apply rather than inventing issues.
export function buildCustomerRelevance(input: CustomerRelevanceInput): string {
  const audience = input.audience.trim() || "organisations operating in the country";
  const lead = `Most relevant to ${audience}.`;
  if (input.empty || input.presentThemeKeys.length === 0) {
    return `${lead} No fresh incident-driven issues were identified this period; standing exposures continue to apply.`;
  }
  const issues = joinList(issuePhrasesForThemes(input.presentThemeKeys));
  return `${lead} Main issues this period are ${issues}.`;
}
