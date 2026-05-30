import { format } from "date-fns";

// Single source of truth for "what data is behind this report, how fresh
// is it, and how does it get here". Consumed by every on-screen report
// preview AND every PDF exporter so the "Data as of" line can never
// disagree between screen and PDF.
//
// Ingestion reality (audited 2026-05-30):
//   - flashpoint / protests : live RSS scraper exists (scripts/src/scrape-flashpoint.ts)
//   - cargo_watch           : live RSS scraper exists (scripts/src/scrape-cargo-watch.ts)
//   - fuel / fertiliser / shipping / energy : NO scraper — one-time legacy import only
//   - strikes (Missile Strike Tracker)      : static dataset, no ingestion
//
// Neither scraper is currently on a schedule, so the products that DO have
// a scraper are classified "manual" (run on demand), not "live". When a
// scheduled deployment is wired up they can be promoted to "live".

export type IngestionMode = "live" | "manual" | "static";

const INGESTION_MODE: Record<string, IngestionMode> = {
  flashpoint: "manual",
  protests: "manual",
  cargo_watch: "manual",
  fuel: "static",
  fertiliser: "static",
  shipping: "static",
  energy: "static",
  strikes: "static",
};

export function ingestionMode(topic: string): IngestionMode {
  return INGESTION_MODE[topic] ?? "static";
}

export function ingestionModeLabel(mode: IngestionMode): string {
  switch (mode) {
    case "live":
      return "Live feed";
    case "manual":
      return "Manual scraper";
    case "static":
      return "Static / import only";
  }
}

export interface DataAsOf {
  topic: string;
  mode: IngestionMode;
  modeLabel: string;
  /** Newest event date available for this topic (max occurredAt). */
  latestRecord: Date | null;
  /** When rows for this topic were last written to the database (max createdAt). */
  lastUpdated: Date | null;
}

interface IncidentLike {
  occurredAt: string;
  createdAt?: string | null;
  topic?: string | null;
}

function maxDate(
  incidents: IncidentLike[],
  field: "occurredAt" | "createdAt",
  topic?: string,
): Date | null {
  let max: number | null = null;
  for (const i of incidents) {
    // When a topic filter is supplied, require an exact match so rows with a
    // missing/other topic can never contaminate another topic's status.
    if (topic && i.topic !== topic) continue;
    const raw = i[field];
    if (!raw) continue;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) max = max === null ? t : Math.max(max, t);
  }
  return max === null ? null : new Date(max);
}

/** Newest record (event) date across the supplied incidents, scoped to a topic. */
export function latestRecordDate(incidents: IncidentLike[], topic?: string): Date | null {
  return maxDate(incidents, "occurredAt", topic);
}

/**
 * Compute the "Data as of" descriptor for a topic directly from the
 * incident list the preview already holds. `latestRecord` is the newest
 * event; `lastUpdated` is the newest row-insertion time (the real
 * ingestion signal — accurate for both scraped and imported topics).
 */
export function computeDataAsOf(opts: {
  topic: string;
  incidents: IncidentLike[];
  /** Pass false when the incidents are already scoped to the topic. */
  filterByTopic?: boolean;
}): DataAsOf {
  const mode = ingestionMode(opts.topic);
  const scope = opts.filterByTopic === false ? undefined : opts.topic;
  return {
    topic: opts.topic,
    mode,
    modeLabel: ingestionModeLabel(mode),
    latestRecord: maxDate(opts.incidents, "occurredAt", scope),
    lastUpdated: maxDate(opts.incidents, "createdAt", scope),
  };
}

function fmtDate(d: Date | null): string {
  return d ? format(d, "d MMM yyyy") : "no records";
}

/**
 * Single "Data as of" line shared by screen and PDF. Plain ASCII pipe
 * separators so the PDF sanitiser cannot strip or substitute characters.
 */
export function formatDataAsOfLine(d: DataAsOf): string {
  return [
    `Data status: ${d.modeLabel}`,
    `Latest record: ${fmtDate(d.latestRecord)}`,
    `Last updated: ${fmtDate(d.lastUpdated)}`,
  ].join("   |   ");
}
