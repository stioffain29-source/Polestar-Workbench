import { db, maritimeMovementTable, sourcesTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";
import type {
  MaritimeSourceHealthItem,
  MaritimeSourceState,
} from "@workspace/api-zod";
import { logger } from "./logger";

// ===========================================================================
// Maritime Source Health.
//
// A focused, maritime-specific health board for the six maritime sources the
// Shipping Watch product cares about: UKMTO, the IMB Piracy Reporting Centre,
// the Reuters / news-verification feed, an optional AIS provider, optional
// Windward, and manual movement-context upload.
//
// It uses its OWN four-state vocabulary (distinct from the general integration
// status states) per the product spec:
//   live         producing fresh data within the freshness window
//   stale        configured/seen before, but the newest data is old
//   disabled     explicitly switched off via an env flag
//   unavailable  not configured / no connector / never produced data
//
// Statuses are driven by REAL signals only — the per-feed `sources` telemetry,
// the freshness of the isolated maritime_movement (context) store, and the
// presence of the optional AIS / Windward env scaffolding. An unconfigured AIS
// provider reads "unavailable", NOT "failing": absence is not an outage.
//
// The AIS / Windward env vars (AIS_PROVIDER, AIS_API_KEY, AIS_ENABLED,
// WINDWARD_ENABLED, WINDWARD_API_KEY) are read SERVER-SIDE only; their values
// are never returned — only the derived state and a non-secret detail string.
// ===========================================================================

const FRESH_DAYS = 14;

function freshnessOf(asOf: Date | null): "live" | "stale" | null {
  if (!asOf) return null;
  const ms = asOf.getTime();
  if (Number.isNaN(ms)) return null;
  return Date.now() - ms <= FRESH_DAYS * 86_400_000 ? "live" : "stale";
}

function isFalsey(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

interface ProviderEnv {
  /** A credential is present (the integration COULD run). */
  configured: boolean;
  /** Explicitly switched off via its enable flag. */
  disabled: boolean;
}

function aisEnv(): ProviderEnv {
  const key = process.env.AIS_API_KEY?.trim();
  return { configured: !!key, disabled: isFalsey(process.env.AIS_ENABLED) };
}

function windwardEnv(): ProviderEnv {
  const key = process.env.WINDWARD_API_KEY?.trim();
  return { configured: !!key, disabled: isFalsey(process.env.WINDWARD_ENABLED) };
}

function fmt(d: Date | null): string | null {
  if (!d) return null;
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : d.toISOString().slice(0, 10);
}

/** Newest maritime_movement `data_as_of` whose source_name matches a pattern (or any row). */
async function latestMovement(pattern?: string): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ latest: sql<Date | null>`max(${maritimeMovementTable.dataAsOf})` })
      .from(maritimeMovementTable)
      .where(pattern ? ilike(maritimeMovementTable.sourceName, pattern) : undefined);
    return toDate(row?.latest);
  } catch (err) {
    logger.warn({ err: msg(err) }, "maritime movement freshness query failed");
    return null;
  }
}

/**
 * Newest GENUINELY-MANUAL movement upload — excludes provider-fed rows (AIS /
 * Windward) so the "Manual context upload" row reflects only operator uploads,
 * not the live AIS feed (whose source_name contains "ais").
 */
async function latestManualMovement(): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ latest: sql<Date | null>`max(${maritimeMovementTable.dataAsOf})` })
      .from(maritimeMovementTable)
      .where(
        sql`${maritimeMovementTable.sourceName} NOT ILIKE '%ais%' AND ${maritimeMovementTable.sourceName} NOT ILIKE '%windward%'`,
      );
    return toDate(row?.latest);
  } catch (err) {
    logger.warn({ err: msg(err) }, "manual maritime movement freshness query failed");
    return null;
  }
}

/**
 * Coerce a raw `max(timestamp)` result to a real Date. A raw `sql` aggregate
 * bypasses Drizzle's column type parser, so the pg driver hands back the
 * timestamp as a STRING; without this, freshnessOf/fmt would call .getTime()
 * on a string and throw once any movement row exists.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function item(
  key: string,
  label: string,
  status: MaritimeSourceState,
  detail: string,
  asOf: string | null,
): MaritimeSourceHealthItem {
  return { key, label, status, detail, asOf };
}

/**
 * Status for the news-derived shipping feed (the current confirmed-incident
 * source until the dedicated UKMTO/IMB connector lands). Driven by the live
 * per-feed `sources` telemetry for topic='shipping'.
 */
async function newsFeedStatus(): Promise<MaritimeSourceHealthItem> {
  const label = "Reuters / news-verification feed";
  try {
    const rows = await db
      .select({
        status: sourcesTable.status,
        lastSuccessAt: sourcesTable.lastSuccessAt,
      })
      .from(sourcesTable)
      .where(eq(sourcesTable.topic, "shipping"));
    if (rows.length === 0) {
      return item(
        "news",
        label,
        "unavailable",
        "No shipping feed telemetry recorded yet.",
        null,
      );
    }
    let latestSuccess: Date | null = null;
    let anyOperational = false;
    for (const r of rows) {
      if (r.status === "operational") anyOperational = true;
      if (r.lastSuccessAt && (!latestSuccess || r.lastSuccessAt > latestSuccess)) {
        latestSuccess = r.lastSuccessAt;
      }
    }
    const fresh = freshnessOf(latestSuccess);
    if (anyOperational && fresh === "live") {
      return item("news", label, "live", `${rows.length} shipping feed(s) operational.`, fmt(latestSuccess));
    }
    if (fresh === "stale") {
      return item("news", label, "stale", "Newest successful poll is older than the freshness window.", fmt(latestSuccess));
    }
    return item("news", label, "unavailable", "No recent successful shipping poll.", fmt(latestSuccess));
  } catch (err) {
    logger.warn({ err: msg(err) }, "maritime news source health query failed");
    return item("news", label, "unavailable", "Status query failed.", null);
  }
}

async function providerStatus(opts: {
  key: string;
  label: string;
  env: ProviderEnv;
  pattern: string;
  envVar: string;
}): Promise<MaritimeSourceHealthItem> {
  const { key, label, env, pattern, envVar } = opts;
  if (env.disabled) {
    return item(key, label, "disabled", `Switched off (${envVar}=false).`, null);
  }
  if (!env.configured) {
    return item(key, label, "unavailable", `Not configured — set ${envVar} to enable. Optional; absence is not an outage.`, null);
  }
  const latest = await latestMovement(pattern);
  const fresh = freshnessOf(latest);
  if (fresh === "live") {
    return item(key, label, "live", "Configured; fresh movement context available.", fmt(latest));
  }
  if (fresh === "stale") {
    return item(key, label, "stale", "Configured; newest movement context is older than the freshness window.", fmt(latest));
  }
  return item(key, label, "stale", "Configured, but no movement context received yet.", null);
}

async function manualUploadStatus(): Promise<MaritimeSourceHealthItem> {
  const label = "Manual context upload";
  const latest = await latestManualMovement();
  const fresh = freshnessOf(latest);
  if (fresh === "live") {
    return item("manual_upload", label, "live", "Recent manual movement-context upload present.", fmt(latest));
  }
  if (fresh === "stale") {
    return item("manual_upload", label, "stale", "A manual movement-context upload exists but is older than the freshness window.", fmt(latest));
  }
  return item("manual_upload", label, "unavailable", "No manual movement-context upload yet.", null);
}

/**
 * Assemble the six-source maritime health snapshot. Each probe is independent
 * and degrades to a non-alarming state; the whole thing never throws.
 */
export async function getMaritimeSourceHealth(): Promise<MaritimeSourceHealthItem[]> {
  const [news, ais, windward, manual] = await Promise.all([
    newsFeedStatus(),
    providerStatus({
      key: "ais",
      label: "AIS provider",
      env: aisEnv(),
      pattern: "%ais%",
      envVar: "AIS_API_KEY",
    }),
    providerStatus({
      key: "windward",
      label: "Windward",
      env: windwardEnv(),
      pattern: "%windward%",
      envVar: "WINDWARD_API_KEY",
    }),
    manualUploadStatus(),
  ]);

  // UKMTO and the IMB Piracy Reporting Centre have no live connector yet — that
  // is a separately-tracked ingest source. They read "unavailable" (slots in
  // when that connector lands) rather than "failing": nothing is broken.
  const ukmto = item(
    "ukmto",
    "UKMTO",
    "unavailable",
    "No live UKMTO connector yet — confirmed events arrive via the news feed until the dedicated maritime source lands.",
    null,
  );
  const imb = item(
    "imb",
    "IMB Piracy Reporting Centre",
    "unavailable",
    "No live IMB connector yet — slots into the confirmed-incidents table when the dedicated piracy source lands.",
    null,
  );

  return [ukmto, imb, news, ais, windward, manual];
}
