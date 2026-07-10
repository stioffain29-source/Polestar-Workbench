import { recordSourceHealth } from "./sourceHealth";
import {
  OFFICIAL_M15_HEALTH_TOPIC,
  UKMTO_HEALTH_NAME,
  UKMTO_SOURCE_URL,
} from "./m15/health";

// M1.5 — UKMTO official products ingest (Phase 2 parser). Phase 1 scaffold:
// registers Source Health and returns an empty summary without fetching or
// writing rows. NEVER touches spot_reports.

export const UKMTO_SOURCE = "ukmto" as const;
export const UKMTO_HEALTH_TOPIC = OFFICIAL_M15_HEALTH_TOPIC;
export { UKMTO_HEALTH_NAME, UKMTO_SOURCE_URL } from "./m15/health";
const UKMTO_HEALTH_NOTES =
  "UK Maritime Trade Operations (UKMTO) — official warnings, advisories and PDF products ingested as STANDALONE official sources (never as incidents). Phase 1 scaffold — parser lands in Phase 2.";

function isDisabled(): boolean {
  const v = process.env.UKMTO_INGEST_ENABLED?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

export type UkmtoIngestSummary = {
  source: typeof UKMTO_SOURCE;
  mode: "commit" | "dry-run";
  configured: boolean;
  disabled: boolean;
  ran: boolean;
  itemsFetched: number;
  inserted: number;
  duplicateInDb: number;
  totalAfter: number;
  errors: string[];
  logLines: string[];
};

export function emptyUkmtoIngestSummary(
  err?: unknown,
): UkmtoIngestSummary {
  return {
    source: UKMTO_SOURCE,
    mode: "dry-run",
    configured: true,
    disabled: false,
    ran: false,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    totalAfter: 0,
    errors: err ? [err instanceof Error ? err.message : String(err)] : [],
    logLines: [],
  };
}

export async function runUkmtoIngest(
  opts: { commit?: boolean } = {},
): Promise<UkmtoIngestSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const disabled = isDisabled();

  log(
    `UKMTO official ingest — mode=${commit ? "COMMIT" : "DRY-RUN"}${disabled ? " (DISABLED)" : ""}`,
  );

  const base: UkmtoIngestSummary = {
    source: UKMTO_SOURCE,
    mode: commit ? "commit" : "dry-run",
    configured: true,
    disabled,
    ran: !disabled,
    itemsFetched: 0,
    inserted: 0,
    duplicateInDb: 0,
    totalAfter: 0,
    errors: [],
    logLines,
  };

  if (disabled) {
    log("  skipped — UKMTO_INGEST_ENABLED=false");
    if (commit) {
      await recordSourceHealth(
        UKMTO_HEALTH_TOPIC,
        [
          {
            name: UKMTO_HEALTH_NAME,
            url: UKMTO_SOURCE_URL,
            ok: false,
            error: "Switched off (UKMTO_INGEST_ENABLED=false)",
          },
        ],
        { sourceType: "html", notes: UKMTO_HEALTH_NOTES },
      );
    }
    return base;
  }

  log("  scaffold only — no live fetch or DB writes (Phase 2 parser)");
  if (commit) {
    await recordSourceHealth(
      UKMTO_HEALTH_TOPIC,
      [
        {
          name: UKMTO_HEALTH_NAME,
          url: UKMTO_SOURCE_URL,
          ok: true,
          collected: 0,
          retained: 0,
          rejected: 0,
        },
      ],
      {
        sourceType: "html",
        scrapeMethod: "HTML listing (Phase 2)",
        notes: UKMTO_HEALTH_NOTES,
        pending: true,
      },
    );
  }

  return base;
}
