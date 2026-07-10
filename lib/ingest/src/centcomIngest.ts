import { recordSourceHealth } from "./sourceHealth";
import {
  CENTCOM_HEALTH_NAME,
  CENTCOM_SOURCE_URL,
  OFFICIAL_M15_HEALTH_TOPIC,
} from "./m15/health";

// M1.5 — CENTCOM press releases ingest (Phase 2 parser). Phase 1 scaffold:
// registers Source Health and returns an empty summary without fetching or
// writing rows. NEVER touches spot_reports.

export const CENTCOM_SOURCE = "centcom" as const;
export const CENTCOM_HEALTH_TOPIC = OFFICIAL_M15_HEALTH_TOPIC;
export { CENTCOM_HEALTH_NAME, CENTCOM_SOURCE_URL } from "./m15/health";
const CENTCOM_HEALTH_NOTES =
  "U.S. Central Command (CENTCOM) official press releases ingested as STANDALONE official sources (never as incidents). Phase 1 scaffold — parser lands in Phase 2.";

function isDisabled(): boolean {
  const v = process.env.CENTCOM_INGEST_ENABLED?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

export type CentcomIngestSummary = {
  source: typeof CENTCOM_SOURCE;
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

export function emptyCentcomIngestSummary(
  err?: unknown,
): CentcomIngestSummary {
  return {
    source: CENTCOM_SOURCE,
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

export async function runCentcomIngest(
  opts: { commit?: boolean } = {},
): Promise<CentcomIngestSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const disabled = isDisabled();

  log(
    `CENTCOM official ingest — mode=${commit ? "COMMIT" : "DRY-RUN"}${disabled ? " (DISABLED)" : ""}`,
  );

  const base: CentcomIngestSummary = {
    source: CENTCOM_SOURCE,
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
    log("  skipped — CENTCOM_INGEST_ENABLED=false");
    if (commit) {
      await recordSourceHealth(
        CENTCOM_HEALTH_TOPIC,
        [
          {
            name: CENTCOM_HEALTH_NAME,
            url: CENTCOM_SOURCE_URL,
            ok: false,
            error: "Switched off (CENTCOM_INGEST_ENABLED=false)",
          },
        ],
        { sourceType: "html", notes: CENTCOM_HEALTH_NOTES },
      );
    }
    return base;
  }

  log("  scaffold only — no live fetch or DB writes (Phase 2 parser)");
  if (commit) {
    await recordSourceHealth(
      CENTCOM_HEALTH_TOPIC,
      [
        {
          name: CENTCOM_HEALTH_NAME,
          url: CENTCOM_SOURCE_URL,
          ok: true,
          collected: 0,
          retained: 0,
          rejected: 0,
        },
      ],
      {
        sourceType: "html",
        scrapeMethod: "HTML listing (Phase 2)",
        notes: CENTCOM_HEALTH_NOTES,
        pending: true,
      },
    );
  }

  return base;
}
