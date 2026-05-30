export type IngestTopic = "flashpoint" | "cargo_watch";

export type FeedStat = {
  name: string;
  found: number;
  accepted: number;
  rejected: number;
  error?: string;
};

export type IngestSummary = {
  topic: IngestTopic;
  mode: "commit" | "dry-run";
  sourcesFetched: number;
  itemsConsidered: number;
  acceptedRaw: number;
  acceptedUnique: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  rejected: number;
  /** Total rows for this topic after the run. Null in dry-run. */
  totalAfter: number | null;
  /** Max(occurredAt) for this topic after the run as ISO date (yyyy-mm-dd). Null if unknown. */
  latestRecord: string | null;
  /** Max(createdAt) for this topic after the run as ISO timestamp. Null if unknown. */
  lastUpdated: string | null;
  perFeed: FeedStat[];
  countryCoverage: Array<[string, number]>;
  /** Human-readable report lines, for CLI rendering. */
  logLines: string[];
};

export type IngestOptions = {
  /** When false, performs a dry run and writes nothing. */
  commit?: boolean;
  /** Cargo Watch only: restrict inserts to titles containing this substring. */
  titleFilter?: string | null;
};
