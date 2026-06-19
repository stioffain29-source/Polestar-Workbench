import {
  db,
  incidentsTable,
  incidentCorroborationsTable,
  countryReportProseTable,
  reliefwebReportsTable,
} from "@workspace/db";
import { eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  isGdeltConfigured,
  isGdeltEnrichEnabled,
  isReliefWebConfigured,
  RELIEFWEB_NOT_CONFIGURED_MESSAGE,
} from "@workspace/ingest";
import type {
  IntegrationStatusItem,
  IntegrationStatusMetric,
  IntegrationStatusResponse,
  IntegrationStatusState,
} from "@workspace/api-zod";
import { isLlmAvailable } from "./countryProse";
import { getLiveuamapStatus } from "./liveuamap";
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
  "Server-side proxy for the PAID Liveuamap live-map overlay (the key never reaches the browser; upstream calls are TTL-cached). The incident map works fully without it.";
const OPENAI_DETAIL =
  "Powers AI country-report narratives and English translation of foreign-language incident headlines. Both degrade to deterministic non-AI fallbacks when absent.";

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
    status = "no_data";
    summary = "Configured, but no situational reports have been stored yet.";
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
        summary = "Configured, but the Liveuamap upstream is currently unreachable.";
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
  const envVars = ["AI_INTEGRATIONS_OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_API_KEY"];
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

/**
 * Assemble the public integration status snapshot. Each probe catches its own
 * failures and degrades to "unknown" so the endpoint never hard-fails, and the
 * Liveuamap probe reuses its cost-bounded cache so this adds no upstream spend.
 */
export async function getIntegrationStatuses(): Promise<IntegrationStatusResponse> {
  const integrations = await Promise.all([
    gdeltStatus(),
    reliefwebStatus(),
    reliefwebReportsStatus(),
    liveuamapStatus(),
    openaiStatus(),
  ]);
  return { generatedAt: new Date(), integrations };
}
