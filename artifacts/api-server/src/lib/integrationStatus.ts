import {
  db,
  incidentsTable,
  incidentCorroborationsTable,
  countryReportProseTable,
  reliefwebReportsTable,
  officialMilitaryMaritimeSourcesTable,
  maritimeMovementTable,
  sourcesTable,
  gdeltStructuredItemsTable,
} from "@workspace/db";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  isAisConfigured,
  isGdeltConfigured,
  isGdeltEnrichEnabled,
  isReliefWebConfigured,
  isVesselRegistryConfigured,
  readVesselRegistryConfig,
  RELIEFWEB_NOT_CONFIGURED_MESSAGE,
  REGISTRY_HEALTH_TOPIC,
  REGISTRY_HEALTH_NAME,
  readKammiSourceConfig,
  KAMMI_IG_HEALTH_NAME,
  isGdeltStructuredConfigured,
  isGdeltStructuredEnabled,
  GDELT_STRUCTURED_HEALTH_NAME,
  GDELT_STRUCTURED_HEALTH_TOPIC,
  GDELT_STRUCTURED_NOT_CONFIGURED_MESSAGE,
  SOCIAL_PROMOTE_MARKER_PREFIX,
  SOCIAL_PROMOTE_HEALTH_NAME,
  SOCIAL_PROMOTE_HEALTH_TOPIC,
  markerSocialRawId,
  socialPromoteWarnThreshold,
} from "@workspace/ingest";
import type {
  IntegrationStatusItem,
  IntegrationStatusMetric,
  IntegrationStatusResponse,
  IntegrationStatusState,
} from "@workspace/api-zod";
import { isLlmAvailable, OPENAI_ENV_VARS } from "@workspace/ingest";
import { getLiveuamapStatus } from "./liveuamap";
import { getMaritimeSourceHealth } from "./maritimeSources";
import { getApacLocalSourceHealth } from "./apacLocalSources";
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
//   dormant          configured + reachable, holds only data far past the
//                    freshness window (e.g. a channel that stopped posting)
// ===========================================================================

// Freshness window for the KAMMI Instagram source, mirroring the AIS movement
// FRESH_DAYS gate. A feed whose newest routed post is older than this is
// reported as "dormant" rather than green "working", so a years-stale account
// never reads as a live feed.
const KAMMI_FRESH_DAYS = 30;

function ageInDays(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

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
const OFFICIAL_M15_DETAIL =
  "M1.5 primary military & maritime official sources (CENTCOM press releases, UKMTO warnings/advisories, partner products). Stored in their own table with analyst flags and dual-watch routing — never as incidents, so they never inflate any count. Phase 1 registers connector slots and Source Health; live parsers land in Phase 2.";
const LIVEUAMAP_DETAIL =
  "Server-side proxy for the PAID Liveuamap live-map overlay (the key never reaches the browser; upstream calls are TTL-cached). The incident map works fully without it. If keyed but upstream fails, Liveuamap may be blocking this server's egress IP — ask Liveuamap support to allowlist the deployment's public IP for server-to-server API access.";
const OPENAI_DETAIL =
  "Powers AI country-report narratives and English translation of foreign-language incident headlines. Both degrade to deterministic non-AI fallbacks when absent.";
const VESSEL_REGISTRY_DETAIL =
  "Additive precision layer over the AIS movement sample: looks up each cargo/tanker vessel by IMO/MMSI to split the chokepoint count into bulk / container / LNG-LPG. Never touches incidents; when absent those three columns simply stay NULL ('not reported').";
const AIS_DETAIL =
  "Live ship-movement sample for the tracked maritime chokepoints (vessel counts, inbound/outbound split, AIS-visible vs dark/gap). Stored in its own movement table as CONTEXT — never as incidents, so it never inflates any count. The vessel-registry layer sits on top to add the cargo-type breakdown.";

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

async function officialMilitaryMaritimeStatus(): Promise<IntegrationStatusItem> {
  const envVars = [
    "CENTCOM_INGEST_ENABLED",
    "UKMTO_INGEST_ENABLED",
    "JMIC_INGEST_ENABLED",
    "CMF_INGEST_ENABLED",
  ];
  let centcom = 0;
  let ukmto = 0;
  let partners = 0;
  let latest: Date | null = null;
  try {
    const [row] = await db
      .select({
        centcom: sql<number>`count(*) filter (where ${officialMilitaryMaritimeSourcesTable.sourceName} = 'centcom')::int`,
        ukmto: sql<number>`count(*) filter (where ${officialMilitaryMaritimeSourcesTable.sourceName} = 'ukmto')::int`,
        partners: sql<number>`count(*) filter (where ${officialMilitaryMaritimeSourcesTable.sourceName} not in ('centcom', 'ukmto'))::int`,
        latest: sql<Date | null>`max(${officialMilitaryMaritimeSourcesTable.ingestedAt})`,
      })
      .from(officialMilitaryMaritimeSourcesTable);
    centcom = row?.centcom ?? 0;
    ukmto = row?.ukmto ?? 0;
    partners = row?.partners ?? 0;
    latest = row?.latest ?? null;
  } catch (err) {
    logger.warn({ err: msg(err) }, "official military maritime integration status query failed");
    return unknownItem({
      key: "official_military_maritime",
      label: "Primary Military and Maritime Sources",
      configured: true,
      envVars,
      summary: "Status query failed.",
      detail: OFFICIAL_M15_DETAIL,
      docsUrl: null,
    });
  }

  const total = centcom + ukmto + partners;
  let status: IntegrationStatusState;
  let summary: string;
  if (total > 0) {
    status = "working";
    summary = `Holding ${total} official CENTCOM/UKMTO/partner item(s) as standalone sources — never counted as incidents.`;
  } else {
    status = "no_data";
    summary =
      "Built and merged; CENTCOM + UKMTO connector scaffolds registered — awaiting Phase 2 parsers and the first successful ingest.";
  }

  return {
    key: "official_military_maritime",
    label: "Primary Military and Maritime Sources",
    status,
    summary,
    detail: OFFICIAL_M15_DETAIL,
    configured: true,
    optional: true,
    envVars,
    metrics: [
      metric("CENTCOM items", centcom),
      metric("UKMTO items", ukmto),
      metric("Partner items", partners),
      metric("Latest ingest", fmtDate(latest)),
    ],
    docsUrl: null,
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

function aisFalsey(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

async function aisMovementStatus(): Promise<IntegrationStatusItem> {
  const envVars = [
    "AIS_API_KEY",
    "AISSTREAM_API_KEY",
    "AIS_ENABLED",
    "AIS_PROVIDER",
    "AIS_COLLECT_SECONDS",
  ];
  const docsUrl = "https://aisstream.io";

  // The movement table is fed by ONE of two collection sources, mirroring
  // runMaritimeMovementIngest: the free aisstream terrestrial stream (gated by
  // AIS_API_KEY + AIS_ENABLED), or — when a PAID Datalastic registry key is the
  // chosen provider — Datalastic's satellite area query, which DELIBERATELY
  // bypasses the aisstream gates (VESSEL_REGISTRY_ENABLED is its kill-switch).
  // So a Datalastic-sourced deployment with no AIS_API_KEY is still configured.
  const registryCfg = readVesselRegistryConfig();
  const useDatalastic =
    registryCfg.configured && registryCfg.enabled && registryCfg.provider === "datalastic";
  const aisProvider = process.env.AIS_PROVIDER?.trim().toLowerCase() || "aisstream";
  const activeProvider = useDatalastic ? "datalastic" : aisProvider;
  // The aisstream AIS_ENABLED gate only applies when Datalastic is NOT the source.
  const enabled = useDatalastic ? true : !aisFalsey(process.env.AIS_ENABLED);
  const configured = isAisConfigured() || useDatalastic;

  // EVIDENCE: how many ship-movement snapshots are stored, across how many
  // chokepoint theatres, and the most recent snapshot timestamp.
  let rows = 0;
  let latest: Date | null = null;
  let theatres = 0;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${maritimeMovementTable.dataAsOf})`,
        theatres: sql<number>`count(distinct ${maritimeMovementTable.theatre})::int`,
      })
      .from(maritimeMovementTable);
    rows = row?.n ?? 0;
    latest = row?.latest ?? null;
    theatres = row?.theatres ?? 0;
  } catch (err) {
    logger.warn({ err: msg(err) }, "ais movement integration status query failed");
    return unknownItem({
      key: "ais_movement",
      label: "AIS vessel movement",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: AIS_DETAIL,
      docsUrl,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!enabled) {
    status = "disabled";
    summary =
      "Switched off (AIS_ENABLED=false) — no live ship-movement sample is collected. Incident feeds and the incident map are unaffected.";
  } else if (!configured) {
    status = "not_configured";
    summary =
      "No collection source — neither an aisstream AIS_API_KEY nor a Datalastic registry key is set, so the maritime movement table stays empty. Incident feeds are unaffected.";
  } else if (rows > 0) {
    status = "working";
    summary = `Holding ${rows} ship-movement snapshot(s) across ${theatres} chokepoint(s) as maritime context — never counted as incidents.`;
  } else {
    status = "no_data";
    summary =
      "Configured, but no ship-movement snapshots collected yet — awaiting the next AIS sample.";
  }

  return {
    key: "ais_movement",
    label: "AIS vessel movement",
    status,
    summary,
    detail: AIS_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Provider", activeProvider),
      metric("Chokepoints tracked", theatres),
      metric("Movement snapshots", rows),
      metric("Last movement", fmtDate(latest)),
    ],
    docsUrl,
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

const KAMMI_IG_DETAIL =
  "KAMMI Pusat's public Instagram feed is treated as JUST ANOTHER NEWS SOURCE. Public posts are fetched via the paid Apify Instagram scraper, PII-scrubbed, translated to English, then content-routed and relevance-gated by the SAME engine as every scraper — a genuine protest lands in the relevant incident feed (Flashpoint / Protests & Civil Unrest) and slop is discarded at the router. There is no separate review queue or context table. No-ops cleanly when INSTAGRAM_API_KEY / APIFY_TOKEN is unset or KAMMI_ENABLED=false.";

// Count of KAMMI-sourced incidents (marker analyst_notes LIKE '%@kammi.pusat%')
// and the newest post timestamp. KAMMI is a source provider: its posts land in
// the shared `incidents` table via the relevance router, so its telemetry is the
// count of rows it has routed — never a separate context table.
async function kammiIncidentCounts(): Promise<{
  total: number;
  latest: Date | null;
}> {
  const res = await db.execute(
    sql`SELECT count(*)::int AS n, max(occurred_at) AS latest FROM incidents WHERE analyst_notes LIKE '%@kammi.pusat%'`,
  );
  const row = res.rows[0] as
    | { n: number | string | null; latest: Date | string | null }
    | undefined;
  const latest = row?.latest ?? null;
  return {
    total: Number(row?.n ?? 0),
    latest: latest ? new Date(latest) : null,
  };
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
    "APIFY_TOKEN",
    "INSTAGRAM_ENABLED",
    "INSTAGRAM_PROVIDER",
    "INSTAGRAM_API_BASE",
    "INSTAGRAM_ACTOR",
    "KAMMI_INSTAGRAM_HANDLE",
    "KAMMI_ENABLED",
    "KAMMI_MAX_ITEMS",
  ];
  const cfg = readKammiSourceConfig();
  const ig = cfg.instagram;
  const configured = ig.configured;
  const docsUrl = "https://apify.com";

  let total = 0;
  let latest: Date | null = null;
  let feedStatus: string | null = null;
  try {
    // KAMMI is a source provider: its telemetry is the count of incidents it has
    // routed into the shared table (marker analyst_notes LIKE '%@kammi.pusat%').
    const counts = await kammiIncidentCounts();
    total = counts.total;
    latest = counts.latest;
    feedStatus = await socialFeedStatus(KAMMI_IG_HEALTH_NAME);
  } catch (err) {
    logger.warn({ err: msg(err) }, "KAMMI instagram status query failed");
    return unknownItem({
      key: "social_watch_instagram",
      label: "KAMMI Instagram",
      configured,
      envVars,
      summary: "Status query failed.",
      detail: KAMMI_IG_DETAIL,
      docsUrl,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!cfg.enabled) {
    status = "disabled";
    summary =
      "Switched off (KAMMI_ENABLED=false) — the KAMMI Instagram source is disabled. Other incident feeds are unaffected.";
  } else if (!ig.enabled) {
    status = "disabled";
    summary =
      "Switched off (INSTAGRAM_ENABLED=false) — the KAMMI Instagram source is disabled.";
  } else if (!configured) {
    status = "not_configured";
    summary =
      "No Apify Instagram credential (INSTAGRAM_API_KEY or APIFY_TOKEN) set — KAMMI Instagram posts are not being fetched. Other incident feeds are unaffected.";
  } else if (feedStatus === "failing") {
    status = "failing_upstream";
    summary =
      "Configured, but the Apify Instagram scraper upstream is returning errors on consecutive runs — no KAMMI posts are being collected.";
  } else if (total > 0) {
    const age = ageInDays(latest);
    if (age !== null && age > KAMMI_FRESH_DAYS) {
      status = "dormant";
      summary = `Feed appears dormant — newest of ${total} KAMMI-routed incident(s) is ${age} day(s) old (past the ${KAMMI_FRESH_DAYS}-day freshness window).`;
    } else {
      status = "working";
      summary = `Routed ${total} KAMMI Instagram post(s) into the relevant incident feed; slop is discarded at the router.`;
    }
  } else {
    status = "no_data";
    summary =
      "Configured, but no KAMMI Instagram post has passed the relevance router into an incident feed yet — awaiting the next scrape or a protest-relevant post.";
  }

  return {
    key: "social_watch_instagram",
    label: "KAMMI Instagram",
    status,
    summary,
    detail: KAMMI_IG_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Account", `@${ig.handle}`),
      metric("Provider", ig.provider),
      metric("Incidents routed", total),
      metric("Latest post", fmtDate(latest)),
    ],
    docsUrl,
  };
}

const TAPA_DETAIL =
  "TAPA's Incident Information Service (IIS) is the authoritative members-only database of supply-chain cargo-theft incidents (land, warehouse, in-transit). There is no public API or connector — TAPA cargo-theft events currently reach Cargo Watch only as news echoes via the cargo feeds. Absence is a coverage gap, not an outage; the cargo feeds are unaffected.";
const X_OSINT_DETAIL =
  "X (Twitter) cargo-security OSINT would surface first-hand port / warehouse / in-transit theft and hijack reports as ADDITIVE context (never as incidents without an explicit operator promote, mirroring the Facebook OSINT pass). It needs paid X API access and a dedicated connector — neither is built yet, so nothing is collected. The cargo feeds are unaffected.";

// Cargo-security AUTHORITY / OSINT sources that have no live connector yet.
// They are surfaced here with a truthful "not_configured" state (a coverage gap
// an operator can see at a glance) rather than being silently omitted — which
// would falsely imply the live news-echo feeds are the complete picture. Neither
// has a secret that would switch it on (the connector itself is unbuilt), so we
// advertise no env vars and keep them out of any failing-source count.
function tapaStatus(): IntegrationStatusItem {
  return {
    key: "tapa_iis",
    label: "TAPA IIS (cargo-theft database)",
    status: "not_configured",
    summary:
      "No direct TAPA IIS connector — TAPA's cargo-theft Incident Information Service is a paid members-only database with no public API, so those events arrive only as news echoes via the cargo feeds.",
    detail: TAPA_DETAIL,
    configured: false,
    optional: true,
    envVars: [],
    metrics: [metric("Direct connector", "none"), metric("Coverage", "news echo only")],
    docsUrl: "https://tapaemea.org",
  };
}

function xOsintStatus(): IntegrationStatusItem {
  return {
    key: "x_cargo_osint",
    label: "X / Twitter (cargo-security OSINT)",
    status: "not_configured",
    summary:
      "No X (Twitter) cargo-security OSINT connector — first-hand theft / hijack reports would need paid X API access and a dedicated connector, neither of which is built yet, so nothing is collected.",
    detail: X_OSINT_DETAIL,
    configured: false,
    optional: true,
    envVars: [],
    metrics: [metric("Direct connector", "none"), metric("Access", "paid API")],
    docsUrl: "https://developer.x.com",
  };
}

const GDELT_STRUCTURED_DETAIL =
  "Daily pull of GDELT Cloud v2 Events + Stories for Indonesia, the Philippines, Thailand and Papua New Guinea, bucketed into lanes (Protests, Civil unrest and riots, Security incidents, Crime, Transport disruption) with Jakarta and Indonesian-Papua sub-buckets. A standalone STRUCTURED CONTEXT layer in its own table — never an incident, so it never inflates any count or reaches a report/PDF. Self-throttles to a daily cadence with a hard per-run call cap to stay inside the free-tier QU budget.";

async function gdeltStructuredStatus(): Promise<IntegrationStatusItem> {
  const envVars = [
    "GDELT_CLOUD_API_KEY",
    "GDELT_STRUCTURED_ENABLED",
    "GDELT_STRUCTURED_INTERVAL_HOURS",
    "GDELT_STRUCTURED_MAX_CALLS",
    "GDELT_CLOUD_API_BASE",
  ];
  const configured = isGdeltStructuredConfigured();
  const enabled = isGdeltStructuredEnabled();
  const docsUrl = "https://gdeltcloud.com";

  // EVIDENCE: how many structured items are stored, across how many lanes and
  // countries, the most recent source date, plus the collector's own live
  // health row (a sustained upstream outage escalates it to "failing").
  let total = 0;
  let latest: Date | null = null;
  let lanes = 0;
  let countries = 0;
  let feedStatus: string | null = null;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${gdeltStructuredItemsTable.sourceDate})`,
        lanes: sql<number>`count(distinct ${gdeltStructuredItemsTable.lane})::int`,
        countries: sql<number>`count(distinct ${gdeltStructuredItemsTable.country})::int`,
      })
      .from(gdeltStructuredItemsTable);
    total = row?.n ?? 0;
    latest = row?.latest ?? null;
    lanes = row?.lanes ?? 0;
    countries = row?.countries ?? 0;
    const [health] = await db
      .select({ status: sourcesTable.status })
      .from(sourcesTable)
      .where(
        and(
          eq(sourcesTable.name, GDELT_STRUCTURED_HEALTH_NAME),
          eq(sourcesTable.topic, GDELT_STRUCTURED_HEALTH_TOPIC),
        ),
      );
    feedStatus = health?.status ?? null;
  } catch (err) {
    logger.warn({ err: msg(err) }, "gdelt structured integration status query failed");
    return unknownItem({
      key: "gdelt_structured",
      label: GDELT_STRUCTURED_HEALTH_NAME,
      configured,
      envVars,
      summary: "Status query failed.",
      detail: GDELT_STRUCTURED_DETAIL,
      docsUrl,
    });
  }

  let status: IntegrationStatusState;
  let summary: string;
  if (!enabled) {
    status = "disabled";
    summary =
      "Switched off (GDELT_STRUCTURED_ENABLED=false) — the structured event layer is not collected. Incident feeds are unaffected.";
  } else if (!configured) {
    status = "not_configured";
    summary = GDELT_STRUCTURED_NOT_CONFIGURED_MESSAGE;
  } else if (feedStatus === "failing") {
    status = "failing_upstream";
    summary =
      "Configured, but GDELT Cloud is returning errors on consecutive runs — no structured items are being collected.";
  } else if (total > 0) {
    status = "working";
    summary = `Holding ${total} structured event/story item(s) across ${lanes} lane(s) and ${countries} country(ies) as standalone context — never counted as incidents.`;
  } else {
    status = "no_data";
    summary =
      "Configured, but no structured items collected yet — awaiting the next daily GDELT Cloud pull.";
  }

  return {
    key: "gdelt_structured",
    label: GDELT_STRUCTURED_HEALTH_NAME,
    status,
    summary,
    detail: GDELT_STRUCTURED_DETAIL,
    configured,
    optional: true,
    envVars,
    metrics: [
      metric("Items stored", total),
      metric("Lanes covered", lanes),
      metric("Countries covered", countries),
      metric("Latest event", fmtDate(latest)),
    ],
    docsUrl,
  };
}

const SOCIAL_PROMOTE_DETAIL =
  "The social OSINT promote pass reads isolated social_raw context rows and auto-mints incidents from those that clear the server-side security + credibility gate (marker analyst_notes 'social_raw:<id>'). This panel surfaces what the scheduler auto-created so an analyst can review it here instead of in deployment logs. When the LAST run promoted more than the alarm threshold it flags 'needs review' (amber) — a possible gate regression or a burst of look-alike posts. Read-only: it never changes the promote gate.";

// Read-only analyst review of what the social OSINT promote pass auto-created.
// EVIDENCE: total promoted incidents, the newest few markers/dates, and the
// last commit run's promoted count (from the promote pass's own Source Health
// row). The panel turns amber ("attention") when that last-run count exceeded
// socialPromoteWarnThreshold() — the SAME threshold the ingest runner alarms on
// in the logs — so the two never disagree. This function only READS; it never
// promotes or alters gate logic.
async function socialPromoteStatus(): Promise<IntegrationStatusItem> {
  const threshold = socialPromoteWarnThreshold();
  const like = `${SOCIAL_PROMOTE_MARKER_PREFIX}%`;

  let total = 0;
  let latest: Date | null = null;
  let recent: Array<{ id: number; topic: string; notes: string | null; createdAt: Date | null }> =
    [];
  let lastRunInserted: number | null = null;
  let lastRunAt: Date | null = null;
  try {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${incidentsTable.createdAt})`,
      })
      .from(incidentsTable)
      .where(sql`${incidentsTable.analystNotes} LIKE ${like}`);
    total = row?.n ?? 0;
    latest = row?.latest ?? null;

    recent = await db
      .select({
        id: incidentsTable.id,
        topic: incidentsTable.topic,
        notes: incidentsTable.analystNotes,
        createdAt: incidentsTable.createdAt,
      })
      .from(incidentsTable)
      .where(sql`${incidentsTable.analystNotes} LIKE ${like}`)
      .orderBy(sql`${incidentsTable.createdAt} desc`)
      .limit(3);

    // Last commit run's outcome, recorded by runSocialPromote into its own
    // Source Health row (itemsRetained = that run's promoted count).
    const [health] = await db
      .select({
        retained: sourcesTable.itemsRetained,
        lastSuccessAt: sourcesTable.lastSuccessAt,
      })
      .from(sourcesTable)
      .where(
        and(
          eq(sourcesTable.name, SOCIAL_PROMOTE_HEALTH_NAME),
          eq(sourcesTable.topic, SOCIAL_PROMOTE_HEALTH_TOPIC),
        ),
      );
    lastRunInserted = health?.retained ?? null;
    lastRunAt = health?.lastSuccessAt ?? null;
  } catch (err) {
    logger.warn({ err: msg(err) }, "social promote integration status query failed");
    return unknownItem({
      key: "social_promote",
      label: "Social OSINT auto-promotion",
      configured: true,
      envVars: ["SOCIAL_PROMOTE_WARN_THRESHOLD"],
      summary: "Status query failed.",
      detail: SOCIAL_PROMOTE_DETAIL,
      docsUrl: null,
    });
  }

  const overThreshold = lastRunInserted !== null && lastRunInserted > threshold;

  let status: IntegrationStatusState;
  let summary: string;
  if (overThreshold) {
    status = "attention";
    summary = `Needs review — the last promote run auto-created ${lastRunInserted} incident(s), above the alarm threshold of ${threshold}. Check the newest social_raw incidents below for a possible gate regression or a burst of look-alike posts.`;
  } else if (total > 0) {
    status = "working";
    summary = `Auto-promoted ${total} social OSINT incident(s) to date; the last run added ${
      lastRunInserted ?? 0
    }, within the alarm threshold of ${threshold}.`;
  } else {
    status = "no_data";
    summary =
      "No social OSINT context row has cleared the promote gate into an incident yet — nothing to review.";
  }

  const metrics: IntegrationStatusMetric[] = [
    metric("Auto-promoted incidents", total),
    metric("Last run promoted", lastRunInserted),
    metric("Alarm threshold", threshold),
    metric("Last run", fmtDate(lastRunAt)),
    metric("Newest promoted", fmtDate(latest)),
  ];
  // The newest markers themselves, so an analyst can jump straight to the rows.
  for (const r of recent) {
    metrics.push(
      metric(
        `Incident #${r.id} (${r.topic})`,
        `social_raw:${markerSocialRawId(r.notes) ?? "?"} · ${fmtDate(r.createdAt)}`,
      ),
    );
  }

  return {
    key: "social_promote",
    label: "Social OSINT auto-promotion",
    status,
    summary,
    detail: SOCIAL_PROMOTE_DETAIL,
    configured: true,
    optional: true,
    envVars: ["SOCIAL_PROMOTE_WARN_THRESHOLD"],
    metrics,
    docsUrl: null,
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
  const [integrations, maritimeSources, apacLocal] = await Promise.all([
    Promise.all([
      Promise.resolve(adminControlsStatus()),
      gdeltStatus(),
      reliefwebStatus(),
      reliefwebReportsStatus(),
      officialMilitaryMaritimeStatus(),
      liveuamapStatus(),
      aisMovementStatus(),
      vesselRegistryStatus(),
      openaiStatus(),
      socialInstagramStatus(),
      socialPromoteStatus(),
      gdeltStructuredStatus(),
      Promise.resolve(tapaStatus()),
      Promise.resolve(xOsintStatus()),
    ]),
    getMaritimeSourceHealth(),
    getApacLocalSourceHealth(),
  ]);
  return { generatedAt: new Date(), integrations, maritimeSources, apacLocal };
}
