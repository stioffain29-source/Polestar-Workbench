import type {
  IngestSummary,
  MarketPriceSummary,
  MarketSnapshotSummary,
  StrikesIngestSummary,
} from "@workspace/ingest";
import type { IngestRunResult } from "./ingestRunner";

/** Compact failure rollup for scheduler/admin logs and API responses. */
export type IngestFailureSummary = {
  hadFailures: boolean;
  topicFailures: { topic: string; message: string }[];
  feedErrors: { topic: string; feed: string; error: string }[];
  marketPriceErrors: { id: string; error: string }[];
  marketSnapshotErrors: { key: string; error: string }[];
};

const MAX_FEED_ERRORS = 12;
const MAX_ERROR_LEN = 200;

function clip(s: string): string {
  return s.length <= MAX_ERROR_LEN ? s : `${s.slice(0, MAX_ERROR_LEN)}…`;
}

function topicFailureMessage(
  s: IngestSummary | StrikesIngestSummary,
): string | null {
  const line = s.logLines.find((l) => /ingest failed/i.test(l));
  return line ? clip(line) : null;
}

function feedErrorsFromPerFeed(
  topic: string,
  perFeed: IngestSummary["perFeed"],
): IngestFailureSummary["feedErrors"] {
  return perFeed
    .filter((f) => f.error)
    .map((f) => ({ topic, feed: f.name, error: clip(f.error!) }));
}

function finalize(
  partial: Omit<IngestFailureSummary, "hadFailures">,
): IngestFailureSummary {
  const hadFailures =
    partial.topicFailures.length > 0 ||
    partial.feedErrors.length > 0 ||
    partial.marketPriceErrors.length > 0 ||
    partial.marketSnapshotErrors.length > 0;
  return { hadFailures, ...partial };
}

export function summarizeMarketPriceFailures(
  prices: MarketPriceSummary,
): IngestFailureSummary {
  return finalize({
    topicFailures: [],
    feedErrors: [],
    marketPriceErrors: prices.seriesErrors.map((e) => ({
      id: e.id,
      error: clip(e.error),
    })),
    marketSnapshotErrors: [],
  });
}

export function summarizeStrikesFailures(
  strikes: StrikesIngestSummary,
): IngestFailureSummary {
  const topicFailures: IngestFailureSummary["topicFailures"] = [];
  const failMsg = topicFailureMessage(strikes);
  if (failMsg) topicFailures.push({ topic: "strikes", message: failMsg });

  return finalize({
    topicFailures,
    feedErrors: feedErrorsFromPerFeed("strikes", strikes.perFeed).slice(
      0,
      MAX_FEED_ERRORS,
    ),
    marketPriceErrors: [],
    marketSnapshotErrors: [],
  });
}

/** Roll up partial failures from a completed full ingest run. */
export function summarizeIngestFailures(
  result: Extract<IngestRunResult, { ran: true }>,
): IngestFailureSummary {
  const incidents: Array<{ topic: string; summary: IngestSummary }> = [
    { topic: "flashpoint", summary: result.flashpoint },
    { topic: "cargo_watch", summary: result.cargoWatch },
    { topic: "shipping", summary: result.shipping },
    { topic: "energy", summary: result.energy },
    { topic: "fertiliser", summary: result.fertiliser },
    { topic: "fuel", summary: result.fuel },
  ];

  const topicFailures: IngestFailureSummary["topicFailures"] = [];
  const feedErrors: IngestFailureSummary["feedErrors"] = [];

  for (const { topic, summary } of incidents) {
    const failMsg = topicFailureMessage(summary);
    if (failMsg) topicFailures.push({ topic, message: failMsg });
    feedErrors.push(...feedErrorsFromPerFeed(topic, summary.perFeed));
  }

  const strikesFail = topicFailureMessage(result.strikes);
  if (strikesFail)
    topicFailures.push({ topic: "strikes", message: strikesFail });
  feedErrors.push(...feedErrorsFromPerFeed("strikes", result.strikes.perFeed));

  return finalize({
    topicFailures,
    feedErrors: feedErrors.slice(0, MAX_FEED_ERRORS),
    marketPriceErrors: result.marketPrices.seriesErrors.map((e) => ({
      id: e.id,
      error: clip(e.error),
    })),
    marketSnapshotErrors: result.marketSnapshot.errors.map((e) => ({
      key: e.key,
      error: clip(e.error),
    })),
  });
}
