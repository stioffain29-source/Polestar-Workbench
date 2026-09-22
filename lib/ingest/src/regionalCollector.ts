import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { fetchFeed } from "./feedFetch";
import { gnews } from "./newsTopic";
import {
  collectMiddleEastForwardCalendar,
  type RegionalForwardCalendarResult,
} from "./regionalForwardCalendar";

export type RegionalCollectorRegion = "apac" | "middle_east";

export interface RegionalForwardSource {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  /** The source publication timestamp. This is deliberately not an event date. */
  publishedAt: string;
  domain: string;
  country?: string;
}

export interface RegionalCoverageCheck {
  domain: string;
  topic?: string | null;
  query?: string;
  status: "checked" | "not_run";
  sourceNames: string[];
  itemsFetched: number;
  candidatesAccepted: number;
  errors: string[];
}

export interface RegionalCollectionResult {
  sources: RegionalForwardSource[];
  coverage: RegionalCoverageCheck;
  domains: RegionalCoverageCheck[];
  requiredDomains: string[];
  searchedGeographies: string[];
}

export interface RegionalFeedItem {
  title?: string | null;
  summary?: string | null;
  link?: string | null;
  publishedAt?: string | Date | null;
}

export interface RegionalFeedResponse {
  title?: string | null;
  items: RegionalFeedItem[];
}

export type RegionalFeedFetcher = (url: string) => Promise<RegionalFeedResponse>;

interface QuerySpec {
  domain: string;
  label: string;
  query: string;
  country?: string;
}

const MIDDLE_EAST_SECURITY_GEOGRAPHIES = [
  "Saudi Arabia",
  "Iran",
  "Iraq",
  "Israel",
  "Lebanon",
  "Syria",
  "Jordan",
  "Yemen",
  "Gulf states",
] as const;

export const MIDDLE_EAST_REQUIRED_GEOGRAPHIES = [
  "Saudi Arabia",
  "UAE",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "Oman",
  "Iran",
  "Iraq",
  "Israel",
  "Palestinian Territories",
  "Lebanon",
  "Syria",
  "Jordan",
  "Yemen",
  "Red Sea approaches",
] as const;

const MIDDLE_EAST_GEOGRAPHY_QUERY_ALIASES: Readonly<Record<
  (typeof MIDDLE_EAST_REQUIRED_GEOGRAPHIES)[number],
  readonly string[]
>> = {
  "Saudi Arabia": ["Saudi Arabia"],
  UAE: ["UAE", "United Arab Emirates", "UnitedArabEmirates"],
  Qatar: ["Qatar"],
  Kuwait: ["Kuwait"],
  Bahrain: ["Bahrain"],
  Oman: ["Oman"],
  Iran: ["Iran"],
  Iraq: ["Iraq"],
  Israel: ["Israel"],
  "Palestinian Territories": ["Palestine", "Palestinian Territories"],
  Lebanon: ["Lebanon"],
  Syria: ["Syria"],
  Jordan: ["Jordan"],
  Yemen: ["Yemen"],
  "Red Sea approaches": ["Red Sea", "RedSea", "Red Sea approaches"],
};

export const MIDDLE_EAST_REQUIRED_DOMAINS = [
  "security",
  "maritime",
  "political",
  "regulatory",
  "operational",
  "energy",
  "weather",
  "cyber",
  "aviation",
] as const;

export const REGIONAL_FORWARD_AREAS = [
  "planned_demonstrations",
  "political_deadlines",
  "sanctions_decisions",
  "military_activity",
  "shipping_restrictions",
  "airport_airspace_changes",
  "weather_warnings",
  "major_events",
  "fuel_energy_decisions",
  "regulatory_implementation",
  "border_restrictions",
] as const;

const FORWARD_TERMS: Record<(typeof REGIONAL_FORWARD_AREAS)[number], string> = {
  planned_demonstrations: `("planned demonstration" OR "planned protest" OR "rally scheduled")`,
  political_deadlines: `("political deadline" OR "election deadline" OR "parliament vote" OR "government deadline")`,
  sanctions_decisions: `("sanctions decision" OR "sanctions deadline" OR "sanctions vote" OR "sanctions take effect")`,
  military_activity: `("military exercise" OR "military deployment" OR "military operation" OR "military activity")`,
  shipping_restrictions: `("shipping restriction" OR "navigation warning" OR "port closure" OR "vessel restriction")`,
  airport_airspace_changes: `("airspace closure" OR "airspace restriction" OR "airport closure" OR "flight restriction")`,
  weather_warnings: `("weather warning" OR "weather alert" OR "storm warning" OR "flood warning" OR "heat warning")`,
  major_events: `("major event" OR summit OR conference OR pilgrimage OR festival)`,
  fuel_energy_decisions: `("fuel decision" OR "energy decision" OR "fuel price change" OR "energy policy takes effect")`,
  regulatory_implementation: `("regulation takes effect" OR "regulatory implementation" OR "new rule effective")`,
  border_restrictions: `("border restriction" OR "border closure" OR "crossing closure" OR "entry restriction")`,
};

const REGION_QUERY = {
  apac: `("Asia Pacific" OR APAC OR Australia OR China OR India OR Indonesia OR Japan OR Malaysia OR Myanmar OR Nepal OR Pakistan OR Philippines OR Singapore OR "South Korea" OR Thailand OR Vietnam)`,
  middle_east: `("Middle East" OR Bahrain OR Iran OR Iraq OR Israel OR Jordan OR Kuwait OR Lebanon OR Oman OR Palestine OR Qatar OR "Saudi Arabia" OR Syria OR UAE OR Yemen OR "Red Sea")`,
} satisfies Record<RegionalCollectorRegion, string>;

function dateWindow(issueDate: string, lookbackDays: number): { after: string; before: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    throw new Error(`issueDate must be YYYY-MM-DD, received "${issueDate}"`);
  }
  const issue = new Date(`${issueDate}T00:00:00.000Z`);
  if (!Number.isFinite(issue.getTime()) || issue.toISOString().slice(0, 10) !== issueDate) {
    throw new Error(`issueDate is not a valid calendar date: "${issueDate}"`);
  }
  const after = new Date(issue);
  after.setUTCDate(after.getUTCDate() - lookbackDays);
  const before = new Date(issue);
  before.setUTCDate(before.getUTCDate() + 1);
  return {
    after: after.toISOString().slice(0, 10),
    before: before.toISOString().slice(0, 10),
  };
}

function dated(query: string, issueDate: string, lookbackDays = 7): string {
  const { after, before } = dateWindow(issueDate, lookbackDays);
  return `${query} after:${after} before:${before}`;
}

export function buildMiddleEastBreadthQueries(issueDate: string): QuerySpec[] {
  const threatTerms = `("missile attack" OR "drone attack" OR terrorism OR "armed conflict" OR "military activity" OR "cross border escalation" OR "civil unrest" OR "security restriction")`;
  const security = MIDDLE_EAST_SECURITY_GEOGRAPHIES.map((country) => ({
    domain: "security",
    label: `Middle East security — ${country}`,
    query: dated(`${threatTerms} "${country}"`, issueDate),
    country,
  }));
  return [
    ...security,
    {
      domain: "maritime",
      label: "Middle East maritime — Hormuz and Gulf shipping",
      query: dated(`("Strait of Hormuz" OR "Gulf shipping") ("container traffic" OR "oil shipping" OR "LNG shipping" OR "port disruption" OR "shipping restriction" OR insurance OR routing OR "maritime attack")`, issueDate),
    },
    {
      domain: "maritime",
      label: "Middle East maritime — Red Sea and Bab el Mandeb",
      query: dated(`("Red Sea" OR "Bab el Mandeb" OR "Bab al-Mandab") ("container traffic" OR shipping OR "port disruption" OR restriction OR insurance OR routing OR attack)`, issueDate),
    },
    {
      domain: "political",
      label: "Middle East political",
      query: dated(`${REGION_QUERY.middle_east} ("government policy" OR "political instability" OR election OR "major government decision" OR sanctions)`, issueDate),
    },
    {
      domain: "regulatory",
      label: "Middle East regulatory",
      query: dated(`${REGION_QUERY.middle_east} (sanctions OR "trade restriction" OR customs OR visa OR immigration OR labour OR "foreign investment control" OR "fuel regulation" OR "market access")`, issueDate),
    },
    {
      domain: "operational",
      label: "Middle East operational",
      query: dated(`${REGION_QUERY.middle_east} ("logistics disruption" OR "road disruption" OR "border crossing" OR "supply chain" OR telecommunications)`, issueDate),
    },
    {
      domain: "energy",
      label: "Middle East energy",
      query: dated(`${REGION_QUERY.middle_east} (oil OR gas OR LNG OR electricity OR refinery OR pipeline OR "fuel shortage" OR "energy policy")`, issueDate),
    },
    {
      domain: "cyber",
      label: "Middle East cyber and digital infrastructure",
      query: dated(`${REGION_QUERY.middle_east} ("cyber attack" OR ransomware OR "data breach" OR "government systems" OR telecommunications OR "cloud infrastructure" OR "Iran linked cyber") (government OR port OR airport OR energy OR infrastructure)`, issueDate),
    },
    {
      domain: "weather",
      label: "Middle East weather and natural hazards",
      query: dated(`${REGION_QUERY.middle_east} ("heavy rain" OR flooding OR sandstorm OR "extreme heat" OR earthquake OR "severe storm") (warning OR disruption OR aviation OR roads)`, issueDate),
    },
    {
      domain: "aviation",
      label: "Middle East aviation and transport",
      query: dated(`${REGION_QUERY.middle_east} ("airport disruption" OR "airspace restriction" OR "flight cancellation" OR "road disruption" OR "border restriction" OR "major logistics disruption")`, issueDate),
    },
  ];
}

export function buildRegionalForwardQueries(
  region: RegionalCollectorRegion,
  issueDate: string,
): QuerySpec[] {
  return REGIONAL_FORWARD_AREAS.map((domain) => ({
    domain,
    label: `${region === "apac" ? "APAC" : "Middle East"} forward — ${domain.replaceAll("_", " ")}`,
    query: dated(`${REGION_QUERY[region]} ${FORWARD_TERMS[domain]}`, issueDate, 14),
  }));
}

async function defaultFeedFetcher(url: string): Promise<RegionalFeedResponse> {
  const parser = new Parser({
    timeout: 20_000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench RegionalCollector)" },
  });
  const parsed = await fetchFeed(parser, url, { stagger: true });
  return {
    title: parsed.title,
    items: (parsed.items ?? []).map((item) => ({
      title: item.title,
      summary: item.contentSnippet || item.content,
      link: item.link,
      publishedAt: item.isoDate || item.pubDate,
    })),
  };
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sourceFromTitle(title: string, feedTitle: string | null | undefined): {
  title: string;
  source: string;
} {
  const split = title.lastIndexOf(" - ");
  return split > 0
    ? { title: title.slice(0, split).trim(), source: title.slice(split + 3).trim() }
    : { title, source: clean(feedTitle) || "Google News" };
}

function sourceId(url: string, domain: string, publishedAt: string): string {
  return createHash("sha256").update(`${domain}\n${url}\n${publishedAt}`).digest("hex").slice(0, 24);
}

function completedQueries(check: RegionalCoverageCheck): string[] {
  const queries = (check.query ?? "").split(" | ").map((query) => query.trim()).filter(Boolean);
  if (queries.length === 0) return [];
  if (check.status === "checked" && check.errors.length === 0) return queries;
  if (check.errors.length === 0
    || check.errors.some((error) => !check.sourceNames.some((label) => error.startsWith(`${label}:`)))) {
    return [];
  }

  // Multi-query checks retain labels and errors in matching order. Preserve
  // successful siblings when one fetch failed, but never infer success when
  // there is no per-query audit evidence.
  if (queries.length !== check.sourceNames.length) return [];
  return queries.filter((_query, index) => {
    const label = check.sourceNames[index];
    return !check.errors.some((error) => error.startsWith(`${label}:`));
  });
}

function queryNamesAlias(query: string, alias: string): boolean {
  const compactQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const compactAlias = alias.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return compactAlias.length > 0 && compactQuery.includes(compactAlias);
}

/**
 * Derive geographic audit metadata only from queries proven to have completed.
 * Umbrella labels such as "Middle East" and "Gulf states" are intentionally
 * not aliases for any individual required country.
 */
export function deriveMiddleEastSearchedGeographies(
  coverage: readonly RegionalCoverageCheck[],
): string[] {
  const evidence = coverage.flatMap(completedQueries);
  return MIDDLE_EAST_REQUIRED_GEOGRAPHIES.filter((geography) =>
    evidence.some((query) =>
      MIDDLE_EAST_GEOGRAPHY_QUERY_ALIASES[geography].some((alias) =>
        queryNamesAlias(query, alias))),
  );
}

async function collectQueries(
  specs: QuerySpec[],
  requiredDomains: readonly string[],
  fetcher: RegionalFeedFetcher,
): Promise<RegionalCollectionResult> {
  const outcomes: Array<{
    spec: QuerySpec;
    response?: RegionalFeedResponse;
    error?: string;
    sources: RegionalForwardSource[];
  }> = new Array(specs.length);
  const concurrency = 3;

  for (let offset = 0; offset < specs.length; offset += concurrency) {
    await Promise.all(specs.slice(offset, offset + concurrency).map(async (spec, localIndex) => {
      const index = offset + localIndex;
      try {
        const response = await fetcher(gnews(spec.query));
        const sources: RegionalForwardSource[] = [];
        for (const item of response.items) {
          const rawTitle = clean(item.title);
          const url = clean(item.link);
          const published = item.publishedAt ? new Date(item.publishedAt) : null;
          if (!rawTitle || !url || !published || !Number.isFinite(published.getTime())) continue;
          const publishedAt = published.toISOString();
          const parsedTitle = sourceFromTitle(rawTitle, response.title);
          sources.push({
            id: sourceId(url, spec.domain, publishedAt),
            title: parsedTitle.title,
            summary: clean(item.summary) || parsedTitle.title,
            source: parsedTitle.source,
            url,
            publishedAt,
            domain: spec.domain,
            ...(spec.country ? { country: spec.country } : {}),
          });
        }
        outcomes[index] = { spec, response, sources };
      } catch (error) {
        outcomes[index] = {
          spec,
          error: error instanceof Error ? error.message : String(error),
          sources: [],
        };
      }
    }));
  }

  const domains = requiredDomains.map((domain): RegionalCoverageCheck => {
    const runs = outcomes.filter((outcome) => outcome.spec.domain === domain);
    const failures = runs.filter((run) => run.error);
    return {
      domain,
      topic: "regional_research",
      query: runs.map((run) => run.spec.query).join(" | "),
      // A multi-query lane is checked only when every required query fetched.
      status: runs.length > 0 && failures.length === 0 ? "checked" : "not_run",
      sourceNames: runs.map((run) => run.spec.label),
      itemsFetched: runs.reduce((sum, run) => sum + (run.response?.items.length ?? 0), 0),
      candidatesAccepted: runs.reduce((sum, run) => sum + run.sources.length, 0),
      errors: failures.map((run) => `${run.spec.label}: ${run.error}`),
    };
  });

  const seen = new Set<string>();
  const sources = outcomes.flatMap((outcome) => outcome.sources).filter((source) => {
    const key = `${source.url}\n${source.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const coverage: RegionalCoverageCheck = {
    domain: "aggregate",
    topic: "regional_research",
    query: specs.map((spec) => spec.query).join(" | "),
    status: domains.every((domain) => domain.status === "checked") ? "checked" : "not_run",
    sourceNames: specs.map((spec) => spec.label),
    itemsFetched: domains.reduce((sum, domain) => sum + domain.itemsFetched, 0),
    candidatesAccepted: sources.length,
    errors: domains.flatMap((domain) => domain.errors),
  };
  return {
    sources,
    coverage,
    domains,
    requiredDomains: [...requiredDomains],
    searchedGeographies: deriveMiddleEastSearchedGeographies(domains),
  };
}

export async function collectMiddleEastBreadthWithFetcher(
  issueDate: string,
  fetcher: RegionalFeedFetcher,
): Promise<RegionalCollectionResult> {
  return await collectQueries(
    buildMiddleEastBreadthQueries(issueDate),
    MIDDLE_EAST_REQUIRED_DOMAINS,
    fetcher,
  );
}

export async function collectMiddleEastBreadth(issueDate: string): Promise<RegionalCollectionResult> {
  return await collectMiddleEastBreadthWithFetcher(issueDate, defaultFeedFetcher);
}

export async function collectRegionalForwardSearchWithFetcher(
  region: RegionalCollectorRegion,
  issueDate: string,
  fetcher: RegionalFeedFetcher,
): Promise<Omit<RegionalCollectionResult, "searchedGeographies">> {
  return await collectQueries(
    buildRegionalForwardQueries(region, issueDate),
    REGIONAL_FORWARD_AREAS,
    fetcher,
  ).then(({ searchedGeographies: _searchedGeographies, ...result }) => result);
}

export async function collectRegionalForwardSearch(
  region: RegionalCollectorRegion,
  issueDate: string,
): Promise<{
  sources: RegionalForwardSource[];
  coverage: RegionalCoverageCheck;
  domains: RegionalCoverageCheck[];
  requiredDomains: string[];
}> {
  const news = await collectRegionalForwardSearchWithFetcher(region, issueDate, defaultFeedFetcher);
  if (region !== "middle_east") return news;

  let calendar: RegionalForwardCalendarResult;
  try {
    calendar = await collectMiddleEastForwardCalendar(issueDate);
  } catch (error) {
    calendar = {
      sources: [],
      coverage: {
        domain: "major_events_calendar",
        topic: "regional_research",
        status: "not_run",
        sourceNames: ["Office Holidays public holiday calendars"],
        itemsFetched: 0,
        candidatesAccepted: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
  return mergeRegionalForwardCalendar(news, calendar);
}

export function mergeRegionalForwardCalendar(
  news: Omit<RegionalCollectionResult, "searchedGeographies">,
  calendar: RegionalForwardCalendarResult,
): Omit<RegionalCollectionResult, "searchedGeographies"> {
  const majorEvents = news.domains.find((domain) => domain.domain === "major_events");
  if (majorEvents) {
    majorEvents.sourceNames.push(...calendar.coverage.sourceNames);
    majorEvents.itemsFetched += calendar.coverage.itemsFetched;
    majorEvents.candidatesAccepted += calendar.coverage.candidatesAccepted;
    majorEvents.errors.push(...calendar.coverage.errors);
    // Deliberately retain the news query's status. A successful supplemental
    // calendar must never disguise a failed major-events RSS search.
  }
  news.sources.push(...calendar.sources);
  news.coverage.itemsFetched += calendar.coverage.itemsFetched;
  news.coverage.candidatesAccepted += calendar.sources.length;
  news.coverage.sourceNames.push(...calendar.coverage.sourceNames);
  news.coverage.errors.push(...calendar.coverage.errors);
  return news;
}