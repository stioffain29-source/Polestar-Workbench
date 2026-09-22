import {
  runRegionalIntelligenceIngest,
  runRegionalCyberIngest,
  runRegionalWeatherIngest,
} from "./topicConfigs";
import type { IngestOptions, IngestSummary } from "./types";
import {
  collectMiddleEastBreadth,
  MIDDLE_EAST_REQUIRED_GEOGRAPHIES,
  MIDDLE_EAST_REQUIRED_DOMAINS,
  type RegionalForwardSource,
} from "./regionalCollector";

export type RegionalWeeklyRegion = "apac" | "middle_east";
export type RegionalDomain =
  | "security"
  | "maritime"
  | "political"
  | "regulatory"
  | "operational"
  | "energy"
  | "weather"
  | "cyber"
  | "aviation";
export type RegionalCoverageStatus = "checked" | "not_run";
export type RegionalWeeklyCollectionOptions = IngestOptions & {
  /** Report issue date (YYYY-MM-DD) used to anchor historical collection windows. */
  issueDate?: string;
};
export type RegionalWeeklyRun = {
  region: RegionalWeeklyRegion;
  startedAt: string;
  completedAt: string;
  weather: RegionalDomainRun;
  cyber: RegionalDomainRun;
  coverage: RegionalCoverageRun[];
  requiredGeographies: string[];
  searchedGeographies: string[];
  /** Material collected for report regeneration; dry runs do not write it. */
  candidateRows?: RegionalForwardSource[];
  requiredDomains?: string[];
};
export type RegionalDomainRun = {
  domain: RegionalDomain;
  topic: "regional_weather" | "regional_cyber" | "regional_intelligence" | null;
  query: string;
  status: RegionalCoverageStatus;
  sourceNames: string[];
  itemsFetched: number;
  candidatesAccepted: number;
  errors: string[];
};
export type RegionalCoverageRun = RegionalDomainRun;

const APAC_REQUIRED_GEOGRAPHIES = [
  "Northeast Asia",
  "Southeast Asia",
  "South Asia",
  "Australia",
  "New Zealand",
  "Papua New Guinea",
  "Papua",
  "Pacific Islands",
] as const;
const DOMAIN_QUERIES: Record<RegionalDomain, string> = {
  security: "terrorism bombings shootings insurgency armed conflict unrest maritime security restrictions",
  political: "elections instability mobilisation demonstrations strikes military activity sanctions diplomatic tensions",
  regulatory: "immigration visa labour customs tariffs trade controls border market access data energy regulation",
  operational: "airports ports shipping roads rail border crossings supply chains telecoms site access continuity",
  energy: "fuel oil gas electricity grid disruption energy policy supply shortages availability",
  weather: "earthquakes typhoons cyclones storms flooding landslides wildfires haze volcanoes tsunami heat drought",
  cyber: "ransomware critical infrastructure telecom port airport logistics energy government system attacks",
  maritime: "Strait of Hormuz Red Sea Bab el Mandeb Gulf shipping insurance routing port disruption maritime attacks",
  aviation: "airport disruption airspace restrictions flight cancellations road border logistics disruption",
};

function domainResult(
  domain: RegionalDomain,
  summary: IngestSummary,
): RegionalDomainRun {
  const successfulFeeds = summary.perFeed.filter((feed) => !feed.error);
  const failedFeeds = summary.perFeed.filter((feed) => feed.error);
  return {
    domain,
    topic: summary.topic as RegionalDomainRun["topic"],
    query: DOMAIN_QUERIES[domain],
    status: successfulFeeds.length > 0 ? "checked" : "not_run",
    sourceNames: summary.perFeed.map((feed) => feed.name),
    itemsFetched: summary.itemsConsidered,
    candidatesAccepted: summary.acceptedUnique,
    errors: successfulFeeds.length > 0
      ? []
      : failedFeeds.map((feed) => `${feed.name}: ${feed.error}`),
  };
}

/** Actively collect the required evidence lanes for one regional weekly cycle. */
export async function runRegionalWeeklyCollection(
  region: RegionalWeeklyRegion,
  options: RegionalWeeklyCollectionOptions = {},
): Promise<RegionalWeeklyRun> {
  const startedAt = new Date().toISOString();
  if (region === "middle_east") {
    const issueDate = options.issueDate ?? startedAt.slice(0, 10);
    const breadth = await collectMiddleEastBreadth(issueDate);

    // Preserve the established production persistence path. The breadth
    // collector itself is read-only, so commit:false regeneration can safely
    // consume candidateRows without writing any incident/product data.
    if (options.commit) {
      await Promise.all([
        runRegionalIntelligenceIngest("security", options, region),
        runRegionalIntelligenceIngest("political", options, region),
        runRegionalIntelligenceIngest("regulatory", options, region),
        runRegionalIntelligenceIngest("operational", options, region),
        runRegionalIntelligenceIngest("energy", options, region),
        runRegionalWeatherIngest(options, region),
        runRegionalCyberIngest(options, region),
      ]);
    }
    const coverage = breadth.domains.map((domain): RegionalDomainRun => ({
      ...domain,
      domain: domain.domain as RegionalDomain,
      topic: domain.domain === "weather"
        ? "regional_weather"
        : domain.domain === "cyber"
          ? "regional_cyber"
          : "regional_intelligence",
      query: domain.query ?? DOMAIN_QUERIES[domain.domain as RegionalDomain],
    }));
    return {
      region,
      startedAt,
      completedAt: new Date().toISOString(),
      weather: coverage.find((run) => run.domain === "weather")!,
      cyber: coverage.find((run) => run.domain === "cyber")!,
      coverage,
      requiredDomains: [...MIDDLE_EAST_REQUIRED_DOMAINS],
      requiredGeographies: [...MIDDLE_EAST_REQUIRED_GEOGRAPHIES],
      searchedGeographies: breadth.searchedGeographies,
      candidateRows: breadth.sources,
    };
  }
  const [securitySummary, politicalSummary, regulatorySummary, operationalSummary, energySummary, weatherSummary, cyberSummary] = await Promise.all([
    runRegionalIntelligenceIngest("security", options, region),
    runRegionalIntelligenceIngest("political", options, region),
    runRegionalIntelligenceIngest("regulatory", options, region),
    runRegionalIntelligenceIngest("operational", options, region),
    runRegionalIntelligenceIngest("energy", options, region),
    runRegionalWeatherIngest(options, region),
    runRegionalCyberIngest(options, region),
  ]);
  const collectionDomains = [
    domainResult("security", securitySummary),
    domainResult("political", politicalSummary),
    domainResult("regulatory", regulatorySummary),
    domainResult("operational", operationalSummary),
    domainResult("energy", energySummary),
    domainResult("weather", weatherSummary),
    domainResult("cyber", cyberSummary),
  ];
  const weather = collectionDomains.find((run) => run.domain === "weather")!;
  const cyber = collectionDomains.find((run) => run.domain === "cyber")!;
  const requiredGeographies = region === "apac"
    ? [...APAC_REQUIRED_GEOGRAPHIES]
    : [...MIDDLE_EAST_REQUIRED_GEOGRAPHIES];
  return {
    region,
    startedAt,
    completedAt: new Date().toISOString(),
    weather,
    cyber,
    coverage: collectionDomains,
    requiredGeographies,
    // Every domain config is generated from the full region-specific country
    // registry. Record the geographic groups that registry deliberately covers,
    // rather than comparing umbrella labels with individual feed names.
    searchedGeographies: requiredGeographies,
    requiredDomains: collectionDomains.map((domain) => domain.domain),
  };
}
