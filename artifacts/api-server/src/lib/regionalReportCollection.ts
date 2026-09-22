import type { RegionalForwardSource } from "@workspace/ingest";
import {
  isRegionalWeeklyTopic,
  regionalCountryQuery,
  regionalIntelligenceCategory,
  type RegionalIncident,
  type RegionalWeeklyTopic,
} from "../../../workbench/src/lib/regionalWeekly";

type RegionalIncidentSourceRow = RegionalIncident & { sourceUrl: string };

const DAY_MS = 86_400_000;

const COUNTRY_ALIASES: Record<string, readonly string[]> = {
  Australia: ["Australia", "Australian"],
  Bangladesh: ["Bangladesh", "Bangladeshi"],
  China: ["China", "Chinese"],
  India: ["India", "Indian"],
  Indonesia: ["Indonesia", "Indonesian"],
  Japan: ["Japan", "Japanese"],
  Malaysia: ["Malaysia", "Malaysian"],
  Myanmar: ["Myanmar", "Burmese"],
  Nepal: ["Nepal", "Nepali", "Nepalese"],
  "New Zealand": ["New Zealand", "New Zealander"],
  Pakistan: ["Pakistan", "Pakistani"],
  Philippines: ["Philippines", "Philippine", "Filipino"],
  Singapore: ["Singapore", "Singaporean"],
  "South Korea": ["South Korea", "South Korean"],
  "Sri Lanka": ["Sri Lanka", "Sri Lankan"],
  Taiwan: ["Taiwan", "Taiwanese"],
  Thailand: ["Thailand", "Thai"],
  Vietnam: ["Vietnam", "Vietnamese"],
  Bahrain: ["Bahrain", "Bahraini"],
  Egypt: ["Egypt", "Egyptian"],
  Iran: ["Iran", "Iranian"],
  Iraq: ["Iraq", "Iraqi"],
  Israel: ["Israel", "Israeli"],
  Jordan: ["Jordan", "Jordanian"],
  Kuwait: ["Kuwait", "Kuwaiti"],
  Lebanon: ["Lebanon", "Lebanese"],
  Oman: ["Oman", "Omani"],
  Palestine: ["Palestine", "Palestinian", "Gaza", "West Bank"],
  Qatar: ["Qatar", "Qatari"],
  "Saudi Arabia": ["Saudi Arabia", "Saudi", "Riyadh", "Jeddah"],
  Syria: ["Syria", "Syrian"],
  Turkey: ["Turkey", "Turkish"],
  Türkiye: ["Türkiye"],
  "United Arab Emirates": [
    "United Arab Emirates", "UAE", "Emirati", "Abu Dhabi", "Dubai",
    "Fujairah", "Sharjah",
  ],
  Yemen: ["Yemen", "Yemeni"],
};

const FOREIGN_VENUES: Array<[string, readonly string[]]> = [
  ["United Kingdom", ["United Kingdom", "UK", "Britain", "British", "London"]],
  ["United States", ["United States", "US", "U.S.", "American", "Washington"]],
];

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string): string {
  return `(?<![A-Za-z])${escaped(alias)}(?![A-Za-z])`;
}

function firstAliasIndex(text: string, aliases: readonly string[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const alias of aliases) {
    const match = new RegExp(aliasPattern(alias), "i").exec(text);
    if (match && match.index < first) first = match.index;
  }
  return first;
}

function venueAliasIndex(text: string, aliases: readonly string[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const alias of aliases) {
    const pattern = aliasPattern(alias);
    const match = new RegExp(
      `\\b(?:in|at|across|inside|outside|near|off|over|within)\\s+(?:the\\s+)?${pattern}`,
      "i",
    ).exec(text);
    if (match && match.index < first) first = match.index;
  }
  return first;
}

/**
 * Infer only jurisdiction explicitly supported by source text. Collector query
 * country hints are intentionally ignored because they are discovery context,
 * not facts.
 */
function inferTextJurisdiction(
  source: RegionalForwardSource,
  topic: RegionalWeeklyTopic,
): string | null {
  const text = `${source.title}\n${source.summary}`;
  const allowed = regionalCountryQuery(topic).split(",");
  const regionalMatches = allowed.flatMap((country) => {
    const aliases = COUNTRY_ALIASES[country] ?? [country];
    const index = firstAliasIndex(text, aliases);
    return Number.isFinite(index) ? [{ country, index, venue: venueAliasIndex(text, aliases) }] : [];
  });
  const foreignVenue = FOREIGN_VENUES.flatMap(([country, aliases]) => {
    const index = venueAliasIndex(text, aliases);
    return Number.isFinite(index) ? [{ country, index }] : [];
  }).sort((a, b) => a.index - b.index)[0];

  // An explicit off-region venue is stronger jurisdiction evidence than an
  // actor descriptor such as "Iran-linked" or "Iranian".
  const regionalVenue = regionalMatches
    .filter((match) => Number.isFinite(match.venue))
    .sort((a, b) => a.venue - b.venue)[0];
  if (foreignVenue && (!regionalVenue || foreignVenue.index < regionalVenue.venue)) {
    return foreignVenue.country;
  }
  if (regionalVenue) return regionalVenue.country;
  return regionalMatches.sort((a, b) => a.index - b.index)[0]?.country ?? null;
}

function issueDay(issueDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    throw new Error(`Invalid regional issue date: ${issueDate}`);
  }
  const value = Date.parse(`${issueDate}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== issueDate) {
    throw new Error(`Invalid regional issue date: ${issueDate}`);
  }
  return value;
}

function sourceTopic(domain: string): string {
  if (domain.toLowerCase() === "cyber") return "regional_cyber";
  if (domain.toLowerCase() === "weather") return "regional_weather";
  return "regional_intelligence";
}

/**
 * Convert read-only regional collector material into checked-fact candidates.
 * Publication time remains occurredAt and incidentDate remains null; no event
 * date, coordinates, location, or collector query-country is promoted to fact.
 */
export function regionalSourcesToIncidents(
  sources: RegionalForwardSource[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
): RegionalIncident[] {
  if (!isRegionalWeeklyTopic(topic)) throw new Error(`Unsupported regional topic: ${topic}`);
  const end = issueDay(issueDate);
  const start = end - 6 * DAY_MS;

  return sources.flatMap((source): RegionalIncidentSourceRow[] => {
    const published = Date.parse(source.publishedAt);
    if (!Number.isFinite(published)) return [];
    const publicationDay = Date.parse(`${new Date(published).toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (publicationDay < start || publicationDay > end) return [];

    const base: RegionalIncidentSourceRow = {
      id: source.id,
      country: inferTextJurisdiction(source, topic),
      title: source.title,
      displayTitle: source.title,
      summary: source.summary,
      source: source.source,
      sourceUrl: source.url,
      occurredAt: new Date(published).toISOString(),
      incidentDate: null,
      topic: sourceTopic(source.domain),
      analystNotes: `regional-collector-domain:${source.domain}`,
      location: null,
      latitude: null,
      longitude: null,
    };
    return [{ ...base, category: regionalIntelligenceCategory(base) }];
  });
}