import {
  runRegionalCyberIngest,
  runRegionalWeatherIngest,
} from "./topicConfigs";
import type { IngestOptions, IngestSummary } from "./types";

export type RegionalWeeklyRegion = "apac" | "middle_east";
export type RegionalDomain = "weather" | "cyber";
export type RegionalWeeklyRun = {
  region: RegionalWeeklyRegion;
  startedAt: string;
  completedAt: string;
  weather: RegionalDomainRun;
  cyber: RegionalDomainRun;
};
export type RegionalDomainRun = {
  topic: "regional_weather" | "regional_cyber";
  sourceNames: string[];
  itemsFetched: number;
  candidatesAccepted: number;
  errors: string[];
};

function domainResult(summary: IngestSummary): RegionalDomainRun {
  return {
    topic: summary.topic as RegionalDomainRun["topic"],
    sourceNames: summary.perFeed.map((feed) => feed.name),
    itemsFetched: summary.itemsConsidered,
    candidatesAccepted: summary.acceptedUnique,
    errors: summary.perFeed.flatMap((feed) =>
      feed.error ? [`${feed.name}: ${feed.error}`] : [],
    ),
  };
}

/** Actively collect both evidence lanes for one regional weekly cycle. */
export async function runRegionalWeeklyCollection(
  region: RegionalWeeklyRegion,
  options: IngestOptions = {},
): Promise<RegionalWeeklyRun> {
  const startedAt = new Date().toISOString();
  // The configured feeds are region-anchored; running both lanes is intentional
  // even when one has no qualifying item, because that outcome is evidence.
  const [weatherSummary, cyberSummary] = await Promise.all([
    runRegionalWeatherIngest(options, region),
    runRegionalCyberIngest(options, region),
  ]);
  return {
    region,
    startedAt,
    completedAt: new Date().toISOString(),
    weather: domainResult(weatherSummary),
    cyber: domainResult(cyberSummary),
  };
}