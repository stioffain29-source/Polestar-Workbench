export type IngestTopic =
  | "flashpoint"
  | "cargo_watch"
  | "shipping"
  | "energy"
  | "fertiliser"
  | "fuel"
  | "data_centres"
  | "conflict"
  | "indonesia_local"
  | "apac_local";

export type FeedStat = {
  name: string;
  found: number;
  accepted: number;
  rejected: number;
  error?: string;
};

// PNG-specific ingest diagnostics for one flashpoint run. Surfaced in the
// admin/ingest response, the run log lines, and (DB-derived) in the PNG report's
// "Source confidence & reporting gaps" section. All counts are PNG-only.
export type PngIngestDiagnostics = {
  /** PNG articles pulled, per source feed. */
  articlesBySource: Array<[string, number]>;
  /** Items resolving to Papua New Guinea (accepted or rejected). */
  matchedPng: number;
  /** Accepted PNG items that resolved a monitored PNG province/locality. */
  matchedLocations: number;
  /** PNG items accepted on a crime/operational incident term. */
  matchedIncidentTerms: number;
  /** PNG items dropped as duplicates (in-batch or already in DB). */
  rejectedDuplicates: number;
  /** PNG items whose occurrence date falls outside the recent reporting horizon. */
  rejectedOld: number;
  /** PNG-country items rejected for carrying no security-relevant cue. */
  rejectedNonSecurity: number;
  /** New PNG report candidates promoted for insert this run. */
  promotedCandidates: number;
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
  /** PNG-only ingest diagnostics (flashpoint runs only). */
  pngDiagnostics?: PngIngestDiagnostics;
  /** Human-readable report lines, for CLI rendering. */
  logLines: string[];
};

export type IngestOptions = {
  /** When false, performs a dry run and writes nothing. */
  commit?: boolean;
  /** Cargo Watch only: restrict inserts to titles containing this substring. */
  titleFilter?: string | null;
};
