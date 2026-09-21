import {
  db,
  incidentsTable,
  protestEventsTable,
  type InsertReport,
  type FuelHardNumbers,
} from "@workspace/db";
import { and, desc, gte, inArray, lte } from "drizzle-orm";
import { runRegionalWeeklyCollection } from "@workspace/ingest";
import { defaultRelevanceCondition } from "./relevanceFilter";
import {
  buildApacFutureEvents,
  auditRegionalWeeklyCandidateFunnel,
  assertRegionalWeeklyReady,
  regionalCountryQuery,
  validateRegionalCanonicalStructure,
  type RegionalCoverageManifest,
  type RegionalWeeklyTopic,
} from "../../../workbench/src/lib/regionalWeekly";
import { buildRegionalEditorialReport } from "./regionalReportEditorial";

export type RegionalReportTopic = "apac_weekly" | "middle_east_weekly";
export type RegionalReportBuildStage = "collecting" | "building" | "saving";
export interface RegionalReportBuildOptions {
  collect?: boolean;
  coverageManifest?: RegionalCoverageManifest;
}

function normalizeHardNumbers(value: unknown): FuelHardNumbers {
  return JSON.parse(JSON.stringify(value)) as FuelHardNumbers;
}

export async function buildRegionalReport(
  topic: RegionalReportTopic,
  issueDate: string,
  setStage: (stage: RegionalReportBuildStage) => Promise<void>,
  options?: RegionalReportBuildOptions,
): Promise<InsertReport> {
  await setStage("collecting");
  if (options?.collect === false && !options.coverageManifest) {
    throw new Error("Historical report refresh requires its saved source-coverage audit.");
  }
  const run = options?.collect === false ? null : await runRegionalWeeklyCollection(
    topic === "apac_weekly" ? "apac" : "middle_east", { commit: true });
  const failed = (run?.coverage ?? options!.coverageManifest!.domains).filter(
    (check) => check.status !== "checked" || check.errors.length > 0,
  );
  if (failed.length > 0) {
    throw new Error(`Regional source collection failed: ${failed
      .map((check) => `${check.domain}: ${check.errors.join(", ") || "no source completed"}`)
      .join("; ")}`);
  }

  await setStage("building");
  const issueStart = new Date(`${issueDate}T00:00:00.000Z`);
  const watchStart = new Date(issueStart.getTime() + 86_400_000);
  const watchEnd = new Date(issueStart.getTime() + 7 * 86_400_000);
  const regionalCountries = new Set(regionalCountryQuery(topic).split(","));
  const futureRows = await db.select().from(protestEventsTable).where(and(
    gte(protestEventsTable.eventDate, watchStart),
    lte(protestEventsTable.eventDate, watchEnd),
    inArray(protestEventsTable.status, ["Confirmed", "Planned", "Possible"]),
  ));
  const regionalFutureRows = futureRows.filter((event) =>
    regionalCountries.has(event.country ?? ""));
  const futureEvents = buildApacFutureEvents(
    regionalFutureRows.map((event) => ({
      eventDate: event.eventDate?.toISOString() ?? null,
      country: event.country,
      city: event.city,
      venue: event.venue,
      eventType: event.eventType,
      issue: event.issue,
      organiser: event.organiser,
      description: event.description,
      sourceTitle: event.sourceTitle,
      disruptionPotential: event.disruptionPotential,
      confidence: event.confidence,
      status: event.status,
      attendance: event.attendance,
    })),
    issueDate,
    topic,
  );
  const coverageManifest: RegionalCoverageManifest = run ? {
    requiredDomains: run.coverage.map((check) => check.domain),
    domains: run.coverage,
    forwardSearch: {
      domain: "forwardSearch",
      status: "checked",
      sourceNames: ["protest_events", "incident_advisories"],
      itemsFetched: futureRows.length,
      candidatesAccepted: futureEvents.length,
      errors: [],
    },
    requiredGeographies: run.requiredGeographies,
    searchedGeographies: run.searchedGeographies,
  } : options!.coverageManifest!;
  const since = new Date(issueStart);
  since.setUTCDate(since.getUTCDate() - 6);
  const issueEnd = new Date(`${issueDate}T23:59:59.999Z`);
  const incidents = await db.select().from(incidentsTable).where(and(
    gte(incidentsTable.occurredAt, since),
    lte(incidentsTable.occurredAt, issueEnd),
    defaultRelevanceCondition(),
  )).orderBy(desc(incidentsTable.occurredAt));
  const regionalIncidents = incidents.map((incident) => ({
    ...incident,
    occurredAt: incident.occurredAt.toISOString(),
    incidentDate: incident.incidentDate?.toISOString() ?? null,
    summary: incident.summary ?? "",
  }));
  const funnel = auditRegionalWeeklyCandidateFunnel(
    regionalIncidents, topic, issueDate, coverageManifest);
  assertRegionalWeeklyReady(funnel);
  const { canonical, evidenceSnapshot } = await buildRegionalEditorialReport(
    regionalIncidents,
    issueDate,
    topic as RegionalWeeklyTopic,
    futureEvents,
    coverageManifest,
  );
  const errors = validateRegionalCanonicalStructure(canonical);
  if (errors.length > 0) throw new Error(errors.join(" "));
  await setStage("saving");
  return {
    title: topic === "apac_weekly"
      ? "Polestar APAC Weekly"
      : "Polestar Middle East Weekly",
    topic,
    issueDate,
    status: "draft",
    hardNumbers: normalizeHardNumbers({
      regionalCanonicalReport: canonical,
      regionalEvidenceSnapshot: evidenceSnapshot,
    }),
    updatedAt: new Date(),
  };
}