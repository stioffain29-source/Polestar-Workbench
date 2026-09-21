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
  buildRegionalCanonicalReport,
  buildApacFutureEvents,
  auditRegionalWeeklyCandidateFunnel,
  assertRegionalWeeklyReady,
  curateRegionalWeeklyIncidents,
  validateRegionalCanonicalStructure,
  type RegionalCoverageManifest,
  type RegionalWeeklyTopic,
} from "../../../workbench/src/lib/regionalWeekly";

export type RegionalReportTopic = "apac_weekly" | "middle_east_weekly";
export type RegionalReportBuildStage = "collecting" | "building" | "saving";

function normalizeHardNumbers(value: unknown): FuelHardNumbers {
  return JSON.parse(JSON.stringify(value)) as FuelHardNumbers;
}

export async function buildRegionalReport(
  topic: RegionalReportTopic,
  issueDate: string,
  setStage: (stage: RegionalReportBuildStage) => Promise<void>,
): Promise<InsertReport> {
  await setStage("collecting");
  const run = await runRegionalWeeklyCollection(
    topic === "apac_weekly" ? "apac" : "middle_east",
    { commit: true },
  );
  const failed = run.coverage.filter(
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
  const regionalCountries = new Set(topic === "apac_weekly"
    ? ["Australia", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China", "East Timor", "Fiji", "Hong Kong", "India", "Indonesia", "Japan", "Laos", "Malaysia", "Maldives", "Mongolia", "Myanmar", "Nepal", "New Zealand", "North Korea", "Pakistan", "Papua New Guinea", "Philippines", "Singapore", "South Korea", "Sri Lanka", "Taiwan", "Thailand", "Timor-Leste", "Vietnam"]
    : ["Bahrain", "Iran", "Iraq", "Israel", "Jordan", "Kuwait", "Lebanon", "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria", "UAE", "United Arab Emirates", "Yemen"]);
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
  );
  const coverageManifest: RegionalCoverageManifest = {
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
  };
  const since = new Date(`${issueDate}T23:59:59.999Z`);
  since.setUTCDate(since.getUTCDate() - 7);
  const incidents = await db.select().from(incidentsTable).where(and(
    gte(incidentsTable.occurredAt, since),
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
  const canonical = buildRegionalCanonicalReport(
    curateRegionalWeeklyIncidents(regionalIncidents, topic, issueDate),
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
    hardNumbers: normalizeHardNumbers({ regionalCanonicalReport: canonical }),
    updatedAt: new Date(),
  };
}