import {
  db,
  maritimeMovementTable,
  maritimeSecurityEventsTable,
  officialMilitaryMaritimeSourcesTable,
  sourcesTable,
} from "@workspace/db";
import {
  CENTCOM_HEALTH_NAME,
  OFFICIAL_M15_HEALTH_TOPIC,
  UKMTO_HEALTH_NAME,
} from "../../../../lib/ingest/src/m15/health";
import { resolveAisKey } from "../../../../lib/ingest/src/maritimeMovement";
import { and, eq, ilike, sql } from "drizzle-orm";
import type {
  MaritimeSourceHealthItem,
  MaritimeSourceState,
} from "@workspace/api-zod";
import { logger } from "./logger";

// ===========================================================================
// Maritime Source Health.
//
// Shipping Watch maritime sources plus M1.5 official military & maritime
// sources (CENTCOM, UKMTO). Uses its OWN four-state vocabulary:
//   live / stale / disabled / unavailable
//
// Official-source rows probe the isolated `official_military_maritime_sources`
// table AND the per-feed `sources` telemetry written by the ingest scaffolds.
// ===========================================================================

export const OFFICIAL_M15_GROUP = "Primary Military and Maritime Sources";

const FRESH_DAYS = 14;

interface OfficialSourceDef {
  key: string;
  label: string;
  sourceName: string;
  healthName: string;
  healthTopic: string;
  envVar: string;
}

const OFFICIAL_SOURCES: OfficialSourceDef[] = [
  {
    key: "centcom",
    label: "CENTCOM (official releases)",
    sourceName: "centcom",
    healthName: CENTCOM_HEALTH_NAME,
    healthTopic: OFFICIAL_M15_HEALTH_TOPIC,
    envVar: "CENTCOM_INGEST_ENABLED",
  },
  {
    key: "ukmto",
    label: "UKMTO (official advisories)",
    sourceName: "ukmto",
    healthName: UKMTO_HEALTH_NAME,
    healthTopic: OFFICIAL_M15_HEALTH_TOPIC,
    envVar: "UKMTO_INGEST_ENABLED",
  },
];

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
  configured: boolean;
  disabled: boolean;
}

function aisEnv(): ProviderEnv {
  const key = resolveAisKey();
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
  group?: string,
): MaritimeSourceHealthItem {
  return { key, label, status, detail, asOf, group: group ?? null };
}

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

async function latestOfficialSource(
  sourceName: string,
): Promise<{ count: number; latest: Date | null }> {
  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${officialMilitaryMaritimeSourcesTable.ingestedAt})`,
      })
      .from(officialMilitaryMaritimeSourcesTable)
      .where(eq(officialMilitaryMaritimeSourcesTable.sourceName, sourceName));
    return { count: row?.count ?? 0, latest: toDate(row?.latest) };
  } catch (err) {
    logger.warn({ err: msg(err), sourceName }, "official source freshness query failed");
    return { count: 0, latest: null };
  }
}

async function officialFeedStatus(
  healthName: string,
  healthTopic: string,
): Promise<{ status: string | null; lastSuccessAt: Date | null }> {
  try {
    const [row] = await db
      .select({
        status: sourcesTable.status,
        lastSuccessAt: sourcesTable.lastSuccessAt,
      })
      .from(sourcesTable)
      .where(
        and(eq(sourcesTable.name, healthName), eq(sourcesTable.topic, healthTopic)),
      );
    return {
      status: row?.status ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
    };
  } catch (err) {
    logger.warn({ err: msg(err), healthName }, "official source feed telemetry query failed");
    return { status: null, lastSuccessAt: null };
  }
}

async function officialSourceStatus(def: OfficialSourceDef): Promise<MaritimeSourceHealthItem> {
  if (isFalsey(process.env[def.envVar])) {
    return item(
      def.key,
      def.label,
      "disabled",
      `Switched off (${def.envVar}=false).`,
      null,
      OFFICIAL_M15_GROUP,
    );
  }

  const [{ count, latest }, feed] = await Promise.all([
    latestOfficialSource(def.sourceName),
    officialFeedStatus(def.healthName, def.healthTopic),
  ]);

  const dataFresh = freshnessOf(latest);
  const pollFresh = freshnessOf(feed.lastSuccessAt);

  if (count > 0 && dataFresh === "live") {
    return item(
      def.key,
      def.label,
      "live",
      `${count} official item(s) on file; connector registered.`,
      fmt(latest),
      OFFICIAL_M15_GROUP,
    );
  }
  if (count > 0 && dataFresh === "stale") {
    return item(
      def.key,
      def.label,
      "stale",
      `${count} official item(s) on file, but the newest is older than the freshness window.`,
      fmt(latest),
      OFFICIAL_M15_GROUP,
    );
  }
  if (feed.status === "failing") {
    return item(
      def.key,
      def.label,
      "stale",
      "Connector registered but the upstream fetch is failing — awaiting a successful run.",
      fmt(feed.lastSuccessAt),
      OFFICIAL_M15_GROUP,
    );
  }
  if (feed.status === "pending" || feed.status === "operational" || pollFresh) {
    return item(
      def.key,
      def.label,
      "stale",
      "Connector registered (Phase 1 scaffold) — awaiting first official items from the Phase 2 parser.",
      fmt(feed.lastSuccessAt),
      OFFICIAL_M15_GROUP,
    );
  }
  return item(
    def.key,
    def.label,
    "stale",
    "Connector slot registered — awaiting the first ingest run.",
    null,
    OFFICIAL_M15_GROUP,
  );
}

async function imbPiracyStatus(): Promise<MaritimeSourceHealthItem> {
  const label = "IMB Piracy Reporting Centre";
  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${maritimeSecurityEventsTable.fetchedAt})`,
      })
      .from(maritimeSecurityEventsTable)
      .where(eq(maritimeSecurityEventsTable.sourceName, "icc_imb"));
    const latest = toDate(row?.latest);
    const fresh = freshnessOf(latest);
    const count = row?.count ?? 0;
    if (count > 0 && fresh === "live") {
      return item(
        "imb",
        label,
        "live",
        `${count} current-year IMB event(s) mirrored in the standalone maritime-security table.`,
        fmt(latest),
      );
    }
    if (count > 0 && fresh === "stale") {
      return item(
        "imb",
        label,
        "stale",
        "IMB data exists but is older than the freshness window.",
        fmt(latest),
      );
    }
    return item(
      "imb",
      label,
      "stale",
      "ICC/IMB connector registered — awaiting a successful map fetch.",
      fmt(latest),
    );
  } catch (err) {
    logger.warn({ err: msg(err) }, "IMB maritime source health query failed");
    return item("imb", label, "unavailable", "Status query failed.", null);
  }
}

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

export async function getMaritimeSourceHealth(): Promise<MaritimeSourceHealthItem[]> {
  const [official, imb, news, ais, windward, manual] = await Promise.all([
    Promise.all(OFFICIAL_SOURCES.map((def) => officialSourceStatus(def))),
    imbPiracyStatus(),
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

  const recaap = item(
    "recaap",
    "ReCAAP ISC",
    "unavailable",
    "No direct ReCAAP ISC connector yet — Asia piracy events arrive only as news echoes via the shipping and cargo feeds.",
    null,
  );

  return [...official, imb, recaap, news, ais, windward, manual];
}
