import {
  db,
  incidentsTable,
  incidentCorroborationsTable,
  countryReportProseTable,
  reliefwebReportsTable,
  maritimeMovementTable,
  sourcesTable,
} from "@workspace/db";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  isGdeltConfigured,
  isGdeltEnrichEnabled,
  isReliefWebConfigured,
  isVesselRegistryConfigured,
  readVesselRegistryConfig,
  RELIEFWEB_NOT_CONFIGURED_MESSAGE,
  REGISTRY_HEALTH_TOPIC,
  REGISTRY_HEALTH_NAME,
  readSocialWatchConfig,
  SOCIAL_WATCH_IG_HEALTH_NAME,
  SOCIAL_WATCH_TG_HEALTH_NAME,
} from "@workspace/ingest";
import { socialWatchItemsTable } from "@workspace/db";
import type {
  IntegrationStatusItem,
  IntegrationStatusMetric,
  IntegrationStatusResponse,
  IntegrationStatusState,
} from "@workspace/api-zod";
import { isLlmAvailable, OPENAI_ENV_VARS } from "@workspace/ingest";
import { getLiveuamapStatus } from "./liveuamap";
import { getMaritimeSourceHealth } from "./maritimeSources";
import { logger } from "./logger";

// ===========================================================================
// Unified integration status model.
//
// Surfaces the configuration + graceful-degradation state of the four OPTIONAL
// external integrations (GDELT, ReliefWeb, Liveuamap, OpenAI) on a single
// public endpoint. It reports STATE and EVIDENCE only — never the secret values
// themselves — so an operator can see at a glance which integrations are wired
// up and which are cleanly no-op'ing. None of these is required for the core
// product; every one degrades to a non-AI / base-feed fallback when absent.
//
// Six states (see IntegrationStatusState):
//   working          configured AND producing evidence of useful output
//   not_configured   the required secret/appname is missing
//   failing_upstream configured but the upstream is currently unreachable
//   no_data          configured + reachable but nothing useful produced yet
//   disabled         explicitly switched off via an env flag
//   unknown          status could not be determined (e.g. a DB probe failed)
// ===========================================================================

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function metric(label: string, value: string | number | null | undefined): IntegrationStatusMetric {
  return {
    label,
    value: value === null || value === undefined ? "—" : String(value),
  };
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? "never" : dt.toISOString().slice(0, 10);
}

function unknownItem(opts: {
  key: string;
  label: string;
  configured: boolean;
  envVars: string[];
  summary: string;
  detail: string | null;
  docsUrl: string | null;
}): IntegrationStatusItem {
  return {
    key: opts.key,
    label: opts.label,
    status: "unknown",
    summary: opts.summary,
    detail: opts.detail,
    configured: opts.configured,
    optional: true,
    envVars: opts.envVars,
    metrics: [],
    docsUrl: opts.docsUrl,
  };
}

const GDELT_DETAIL =
  "Additive precision layer over flashpoint incidents (sub-national geo, confirmed fatalities, named actors). Never inserts or removes incident rows — only enriches existing ones.";
const RELIEFWEB_DETAIL =
  "Cross-checks scraped incidents against official UN OCHA ReliefWeb reports and attaches corroborating links (shown on Incidents/Topic screens, not in PDFs).";
const RELIEFWEB_REPORTS_DETAIL =
  "Pulls UN OCHA ReliefWeb situational/humanitarian reports for the monitored APAC countries as supporting CONTEXT under Conflict Watch and country reports. Stored in their own table — never as incidents, so they never inflate any count.";
const RELIEFWEB_REPORTS_NOT_CONFIGURED_MESSAGE =
  "RELIEFWEB_APPNAME not set to an approved value — situational context disabled. ReliefWeb's v2 API returns 403 without a pre-approved appname (request one at https://apidoc.reliefweb.int/parameters#appname).";
const LIVEUAMAP_DETAIL =
  "Server-side proxy for the PAID Liveuamap live-map overlay (the key never reaches the browser; upstream calls are TTL-cached). The incident map works fully without it. If keyed but upstream fails, Liveuamap may be blocking this server's egress IP — ask Liveuamap support to allowlist the deployment's public IP for server-to-server API access.";
const OPENAI_DETAIL =
  "Powers AI country-report narratives and English translation of foreign-language incident headlines. Both degrade to deterministic non-AI fallbacks when absent.";
const VESSEL_REGISTRY_DETAIL =
  "Additive precision layer over the AIS movement sample: looks up each cargo/tanker vessel by IMO/MMSI to split the chokepoint count into bulk / container / LNG-LPG. Never touches incidents; when absent those three columns simply stay NULL ('not reported').";

async function gdeltStatus(): Promise<IntegrationStatusItem> {
  const envVars = ["GDELT_CLOUD_API_KEY", "GDELT_ENRICH_ENABLED", "GDELT_CLOUD_API_BASE"];
  const configured = isGdeltConfigured();
  const enabled = isGdeltEnrichEnabled();

  let enriched = 0;
  let latest: Date | null = null;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${incidentsTable.gdeltEnrichedAt})`,
      })
      .from(incidentsTable)
      .where(isNotNull(incidentsTable.gdeltEnrichedAt));
    enriched = row?.n ?? 0;
    latest = row?.latest ?? null;
  } catch (err) {
    logger.warn({ err: msg(err) }, "gdelt integration status query failed");
    return unknownItem({
      key: "gdelt",
      label: "GDELT Conflict Events",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: GDELT_DETAIL,
      docsUrl: "https://gdeltcloud.com",
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!enabled) {
    status = "disabled";
    summary = "Enrichment switched off (GDELT_ENRICH_ENABLED=false). The base flashpoint feed is unaffected.";
  } else if (!configured) {
    status = "not_configured";
    summary = "No GDELT_CLOUD_API_KEY — precision enrichment is skipped; the base flashpoint feed is unaffected.";
  } else if (enriched > 0) {
    status = "working";
    summary = `Enriched ${enriched} flashpoint incident(s) with structured GDELT fields.`;
  } else {
    status = "no_data";
    summary = "Configured, but no incidents have been enriched yet (low cadence; matches are sparse by design).";
  }

  return {
    key: "gdelt",
    label: "GDELT Conflict Events",
    status,
    summary,
    detail: GDELT_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [metric("Enriched incidents", enriched), metric("Last enriched", fmtDate(latest))],
    docsUrl: "https://gdeltcloud.com",
  };
}

async function reliefwebStatus(): Promise<IntegrationStatusItem> {
  const envVars = ["RELIEFWEB_APPNAME"];
  const configured = isReliefWebConfigured();

  let links = 0;
  let latest: Date | null = null;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${incidentCorroborationsTable.matchedAt})`,
      })
      .from(incidentCorroborationsTable)
      .where(eq(incidentCorroborationsTable.provider, "reliefweb"));
    links = row?.n ?? 0;
    latest = row?.latest ?? null;
  } catch (err) {
    logger.warn({ err: msg(err) }, "reliefweb integration status query failed");
    return unknownItem({
      key: "reliefweb",
      label: "ReliefWeb (UN OCHA)",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: RELIEFWEB_DETAIL,
      docsUrl: "https://apidoc.reliefweb.int/parameters#appname",
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!configured) {
    status = "not_configured";
    summary = RELIEFWEB_NOT_CONFIGURED_MESSAGE;
  } else if (links > 0) {
    status = "working";
    summary = `Attached ${links} official corroboration(s) to scraped incidents.`;
  } else {
    status = "no_data";
    summary = "Configured, but no corroborations have matched yet.";
  }

  return {
    key: "reliefweb",
    label: "ReliefWeb (UN OCHA)",
    status,
    summary,
    detail: RELIEFWEB_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [metric("Corroborations", links), metric("Last match", fmtDate(latest))],
    docsUrl: "https://apidoc.reliefweb.int/parameters#appname",
  };
}

async function reliefwebReportsStatus(): Promise<IntegrationStatusItem> {
  const envVars = ["RELIEFWEB_APPNAME"];
  const configured = isReliefWebConfigured();

  let reports = 0;
  let latest: Date | null = null;
  let countries = 0;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${reliefwebReportsTable.publishedAt})`,
        countries: sql<number>`count(distinct ${reliefwebReportsTable.country})::int`,
      })
      .from(reliefwebReportsTable)
      .where(eq(reliefwebReportsTable.sourceName, "reliefweb"));
    reports = row?.n ?? 0;
    latest = row?.latest ?? null;
    countries = row?.countries ?? 0;
  } catch (err) {
    logger.warn({ err: msg(err) }, "reliefweb reports integration status query failed");
    return unknownItem({
      key: "reliefweb_reports",
      label: "ReliefWeb Situational Reports (UN OCHA)",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: RELIEFWEB_REPORTS_DETAIL,
      docsUrl: "https://apidoc.reliefweb.int/parameters#appname",
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!configured) {
    status = "not_configured";
    summary = RELIEFWEB_REPORTS_NOT_CONFIGURED_MESSAGE;
  } else if (reports > 0) {
    status = "working";
    summary = `Holding ${reports} UN OCHA situational report(s) as supporting context — never counted as incidents.`;
  } else {
    // Built and merged, but no live data yet. The appname is not approved (403)
    // and ReliefWeb blocks this server's egress IP (same class as Liveuamap),
    // so this is "pending" — awaiting approval + production network validation —
    // NOT a broken integration.
    status = "pending";
    summary =
      "Built and merged; live data pending — awaiting appname approval and production network validation. ReliefWeb returns 403 until the appname is approved and currently blocks this server's network, so recheck from the published deployment once approved.";
  }

  return {
    key: "reliefweb_reports",
    label: "ReliefWeb Situational Reports (UN OCHA)",
    status,
    summary,
    detail: RELIEFWEB_REPORTS_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Built", "yes"),
      metric("Merged", "yes"),
      metric("Live data", reports > 0 ? "yes" : "pending"),
      metric("Reports stored", reports),
      metric("Latest report", fmtDate(latest)),
      metric("Countries covered", countries),
    ],
    docsUrl: "https://apidoc.reliefweb.int/parameters#appname",
  };
}

async function liveuamapStatus(): Promise<IntegrationStatusItem> {
  const envVars = ["LIVEUAMAP_API_KEY"];
  try {
    const s = await getLiveuamapStatus();
    let summary: string;
    switch (s.state) {
      case "working":
        summary = `Live overlay active — ${s.events} cached event(s) for the default region.`;
        break;
      case "not_configured":
        summary = "No LIVEUAMAP_API_KEY — the paid live-map overlay is disabled. The incident map is unaffected.";
        break;
      case "failing_upstream":
        summary =
          "Configured, but Liveuamap is unreachable from this server (often an egress IP block). The map shows overlay unavailable; ask Liveuamap to allowlist the deployment IP.";
        break;
      case "no_data":
        summary = "Configured and reachable, but no events returned for the default region.";
        break;
      default:
        summary = "Configured; the overlay has not been probed yet.";
        break;
    }
    return {
      key: "liveuamap",
      label: "Liveuamap (live-map overlay)",
      status: s.state,
      summary,
      detail: LIVEUAMAP_DETAIL,
      configured: s.configured,
      optional: true,
      envVars,
      metrics: [
        metric("Cached events", s.events),
        metric("Last fetched", fmtDate(s.fetchedAt)),
        metric("Free requests left", s.freerequests),
      ],
      docsUrl: "https://liveuamap.com",
    };
  } catch (err) {
    logger.warn({ err: msg(err) }, "liveuamap integration status probe failed");
    return unknownItem({
      key: "liveuamap",
      label: "Liveuamap (live-map overlay)",
      configured: !!process.env.LIVEUAMAP_API_KEY?.trim(),
      envVars,
      summary: "Status probe failed.",
      detail: LIVEUAMAP_DETAIL,
      docsUrl: "https://liveuamap.com",
    });
  }
}

async function openaiStatus(): Promise<IntegrationStatusItem> {
  const envVars = [...OPENAI_ENV_VARS];
  const configured = isLlmAvailable();

  let translated = 0;
  let proseRows = 0;
  try {
    const [t] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(isNotNull(incidentsTable.displayTitle));
    translated = t?.n ?? 0;
    const [p] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(countryReportProseTable)
      .where(ne(countryReportProseTable.model, "unavailable"));
    proseRows = p?.n ?? 0;
  } catch (err) {
    logger.warn({ err: msg(err) }, "openai integration status query failed");
    return unknownItem({
      key: "openai",
      label: "OpenAI (AI narratives & translation)",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: OPENAI_DETAIL,
      docsUrl: null,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!configured) {
    status = "not_configured";
    summary =
      "No AI integration provisioned — country narratives use the deterministic template and foreign headlines stay untranslated.";
  } else {
    status = "working";
    summary = "AI integration available for country narratives and headline translation.";
  }

  return {
    key: "openai",
    label: "OpenAI (AI narratives & translation)",
    status,
    summary,
    detail: OPENAI_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Translated headlines", translated),
      metric("AI narratives cached", proseRows),
    ],
    docsUrl: null,
  };
}

async function vesselRegistryStatus(): Promise<IntegrationStatusItem> {
  const envVars = [
    "VESSEL_REGISTRY_API_KEY",
    "VESSEL_REGISTRY_ENABLED",
    "VESSEL_REGISTRY_PROVIDER",
    "VESSEL_REGISTRY_API_BASE",
    "VESSEL_REGISTRY_MAX_LOOKUPS",
  ];
  const cfg = readVesselRegistryConfig();
  const configured = isVesselRegistryConfigured();
  const docsUrl = "https://datalastic.com";

  // EVIDENCE: how many movement snapshots carry a resolved cargo-type split
  // (any of the three breakdown columns populated), and the most recent one,
  // plus the registry's own live health row (a sustained datalastic outage
  // escalates it to "failing").
  let breakdownRows = 0;
  let latest: Date | null = null;
  let feedStatus: string | null = null;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${maritimeMovementTable.dataAsOf})`,
      })
      .from(maritimeMovementTable)
      .where(
        sql`${maritimeMovementTable.bulkCarriersCount} IS NOT NULL OR ${maritimeMovementTable.containerCount} IS NOT NULL OR ${maritimeMovementTable.lngLpgCount} IS NOT NULL`,
      );
    breakdownRows = row?.n ?? 0;
    latest = row?.latest ?? null;
    const [health] = await db
      .select({ status: sourcesTable.status })
      .from(sourcesTable)
      .where(
        and(
          eq(sourcesTable.name, REGISTRY_HEALTH_NAME),
          eq(sourcesTable.topic, REGISTRY_HEALTH_TOPIC),
        ),
      );
    feedStatus = health?.status ?? null;
  } catch (err) {
    logger.warn({ err: msg(err) }, "vessel registry integration status query failed");
    return unknownItem({
      key: "vessel_registry",
      label: "Vessel registry (cargo-type breakdown)",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: VESSEL_REGISTRY_DETAIL,
      docsUrl,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!cfg.enabled) {
    status = "disabled";
    summary =
      "Switched off (VESSEL_REGISTRY_ENABLED=false) — the bulk/container/LNG-LPG breakdown stays unreported (NULL). The AIS movement sample is unaffected.";
  } else if (!configured) {
    status = "not_configured";
    summary =
      "No VESSEL_REGISTRY_API_KEY — the cargo-type split is skipped, so bulk/container/LNG-LPG stay NULL ('not reported'). The AIS movement counts are unaffected.";
  } else if (feedStatus === "failing") {
    status = "failing_upstream";
    summary =
      "Configured, but the vessel-registry upstream is returning errors on consecutive runs — no cargo-type classes are being resolved.";
  } else if (breakdownRows > 0) {
    status = "working";
    summary = `Resolved cargo-type classes for ${breakdownRows} chokepoint snapshot(s) (bulk / container / LNG-LPG).`;
  } else {
    status = "no_data";
    summary =
      "Configured, but no cargo-type classes resolved yet — awaiting an AIS movement sample with registry-matched vessels.";
  }

  return {
    key: "vessel_registry",
    label: "Vessel registry (cargo-type breakdown)",
    status,
    summary,
    detail: VESSEL_REGISTRY_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Provider", cfg.provider),
      metric("Snapshots with split", breakdownRows),
      metric("Last resolved", fmtDate(latest)),
    ],
    docsUrl,
  };
}

const SOCIAL_WATCH_IG_DETAIL =
  "Monitors the KAMMI Pusat public Instagram account for planned/active protest mobilisation as ADDITIVE context. Posts are stored in their own table — never as incidents, so they never inflate any count. Confirmed-active items can be promoted to a flashpoint incident by an operator.";
const SOCIAL_WATCH_TG_DETAIL =
  "Reads the KAMMI public Telegram channel from the free public web view (no login) for planned/active protest mobilisation as ADDITIVE context. Posts are stored in their own table — never as incidents. Confirmed-active items can be promoted to a flashpoint incident by an operator.";

async function socialWatchPlatformCounts(
  platform: "instagram" | "telegram",
): Promise<{ total: number; latest: Date | null }> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      latest: sql<Date | string | null>`max(${socialWatchItemsTable.postedAt})`,
    })
    .from(socialWatchItemsTable)
    .where(eq(socialWatchItemsTable.platform, platform));
  const latest = row?.latest ?? null;
  return { total: row?.n ?? 0, latest: latest ? new Date(latest) : null };
}

async function socialFeedStatus(name: string): Promise<string | null> {
  const [health] = await db
    .select({ status: sourcesTable.status })
    .from(sourcesTable)
    .where(and(eq(sourcesTable.name, name), eq(sourcesTable.topic, "flashpoint")));
  return health?.status ?? null;
}

async function socialInstagramStatus(): Promise<IntegrationStatusItem> {
  const envVars = [
    "INSTAGRAM_API_KEY",
    "INSTAGRAM_ENABLED",
    "INSTAGRAM_PROVIDER",
    "INSTAGRAM_API_BASE",
    "INSTAGRAM_ACTOR",
    "KAMMI_INSTAGRAM_HANDLE",
    "SOCIAL_WATCH_ENABLED",
  ];
  const cfg = readSocialWatchConfig();
  const ig = cfg.instagram;
  const configured = ig.configured;
  const docsUrl = "https://apify.com";

  let total = 0;
  let latest: Date | null = null;
  let feedStatus: string | null = null;
  try {
    const counts = await socialWatchPlatformCounts("instagram");
    total = counts.total;
    latest = counts.latest;
    feedStatus = await socialFeedStatus(SOCIAL_WATCH_IG_HEALTH_NAME);
  } catch (err) {
    logger.warn({ err: msg(err) }, "social watch instagram status query failed");
    return unknownItem({
      key: "social_watch_instagram",
      label: "KAMMI Instagram (Social Watch)",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: SOCIAL_WATCH_IG_DETAIL,
      docsUrl,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!cfg.enabled) {
    status = "disabled";
    summary =
      "Switched off (SOCIAL_WATCH_ENABLED=false) — social-media protest monitoring is disabled. Incident feeds are unaffected.";
  } else if (!ig.enabled) {
    status = "disabled";
    summary =
      "Switched off (INSTAGRAM_ENABLED=false) — the Instagram social-watch source is disabled.";
  } else if (!configured) {
    status = "not_configured";
    summary =
      "No INSTAGRAM_API_KEY — the paid Instagram scraper is disabled, so no Instagram posts are collected. The Telegram social-watch source and all incident feeds are unaffected.";
  } else if (feedStatus === "failing") {
    status = "failing_upstream";
    summary =
      "Configured, but the Instagram scraper upstream is returning errors on consecutive runs — no posts are being collected.";
  } else if (total > 0) {
    status = "working";
    summary = `Holding ${total} KAMMI Instagram post(s) as protest-monitoring context — never counted as incidents.`;
  } else {
    status = "no_data";
    summary =
      "Configured, but no Instagram posts collected yet — awaiting the next scrape or a protest-relevant post.";
  }

  return {
    key: "social_watch_instagram",
    label: "KAMMI Instagram (Social Watch)",
    status,
    summary,
    detail: SOCIAL_WATCH_IG_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Account", `@${ig.handle}`),
      metric("Provider", ig.provider),
      metric("Posts stored", total),
      metric("Latest post", fmtDate(latest)),
    ],
    docsUrl,
  };
}

async function socialTelegramStatus(): Promise<IntegrationStatusItem> {
  const envVars = ["KAMMI_TELEGRAM_CHANNEL", "TELEGRAM_ENABLED", "SOCIAL_WATCH_ENABLED"];
  const cfg = readSocialWatchConfig();
  const tg = cfg.telegram;
  const configured = tg.configured;
  const docsUrl = `https://t.me/s/${tg.channel}`;

  let total = 0;
  let latest: Date | null = null;
  let feedStatus: string | null = null;
  try {
    const counts = await socialWatchPlatformCounts("telegram");
    total = counts.total;
    latest = counts.latest;
    feedStatus = await socialFeedStatus(SOCIAL_WATCH_TG_HEALTH_NAME);
  } catch (err) {
    logger.warn({ err: msg(err) }, "social watch telegram status query failed");
    return unknownItem({
      key: "social_watch_telegram",
      label: "KAMMI Telegram (Social Watch)",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: SOCIAL_WATCH_TG_DETAIL,
      docsUrl,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!cfg.enabled) {
    status = "disabled";
    summary =
      "Switched off (SOCIAL_WATCH_ENABLED=false) — social-media protest monitoring is disabled. Incident feeds are unaffected.";
  } else if (!tg.enabled) {
    status = "disabled";
    summary =
      "Switched off (TELEGRAM_ENABLED=false) — the Telegram social-watch source is disabled.";
  } else if (!configured) {
    status = "not_configured";
    summary =
      "No KAMMI_TELEGRAM_CHANNEL set — the free Telegram public-web reader is disabled.";
  } else if (feedStatus === "failing") {
    status = "failing_upstream";
    summary =
      "Configured, but the Telegram public web view is currently unreachable — no posts are being collected.";
  } else if (total > 0) {
    status = "working";
    summary = `Holding ${total} KAMMI Telegram post(s) as protest-monitoring context — never counted as incidents.`;
  } else {
    status = "no_data";
    summary =
      "Configured and reachable, but no protest-relevant Telegram posts collected yet.";
  }

  return {
    key: "social_watch_telegram",
    label: "KAMMI Telegram (Social Watch)",
    status,
    summary,
    detail: SOCIAL_WATCH_TG_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Channel", tg.channel),
      metric("Access", "free public web view"),
      metric("Posts stored", total),
      metric("Latest post", fmtDate(latest)),
    ],
    docsUrl,
  };
}

function adminControlsStatus(): IntegrationStatusItem {
  const configured = Boolean(process.env["INGEST_ADMIN_TOKEN"]?.trim());
  return {
    key: "admin_controls",
    label: "Admin operator controls",
    status: configured ? "working" : "not_configured",
    summary: configured
      ? "Manual ingest, source mutations, and incident backfill are enabled."
      : "Manual ingest, source editing, and backfill routes return 503 until INGEST_ADMIN_TOKEN is set.",
    detail:
      "Gates POST /api/admin/*, source create/update/delete, maritime movement upload, and incident backfill. Present the token via Authorization: Bearer or x-ingest-token.",
    configured,
    optional: false,
    envVars: ["INGEST_ADMIN_TOKEN"],
    metrics: [metric("Privileged routes", configured ? "enabled" : "disabled")],
    docsUrl: null,
  };
}

/**
 * Assemble the public integration status snapshot. Each probe catches its own
 * failures and degrades to "unknown" so the endpoint never hard-fails, and the
 * Liveuamap probe reuses its cost-bounded cache so this adds no upstream spend.
 */
export async function getIntegrationStatuses(): Promise<IntegrationStatusResponse> {
  const [integrations, maritimeSources] = await Promise.all([
    Promise.all([
      Promise.resolve(adminControlsStatus()),
      gdeltStatus(),
      reliefwebStatus(),
      reliefwebReportsStatus(),
      liveuamapStatus(),
      vesselRegistryStatus(),
      openaiStatus(),
      socialInstagramStatus(),
      socialTelegramStatus(),
    ]),
    getMaritimeSourceHealth(),
  ]);
  return { generatedAt: new Date(), integrations, maritimeSources };
}
