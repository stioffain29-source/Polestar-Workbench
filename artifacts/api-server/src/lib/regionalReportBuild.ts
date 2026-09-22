import {
  db,
  incidentsTable,
  protestEventsTable,
  type InsertReport,
  type FuelHardNumbers,
} from "@workspace/db";
import { and, desc, gte, inArray, lte } from "drizzle-orm";
import { collectRegionalForwardSearch, runRegionalWeeklyCollection } from "@workspace/ingest";
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
import { finishRegionalEditorialReport } from "./regionalReportEditorial";
import { extractRegionalReportFacts, prepareRegionalFactPackets, selectGroundedRegionalEvents } from "./regionalReportFacts";
import { extractRegionalForwardEvents } from "./regionalReportForward";
import { refreshRegionalEditorialOutlook, savedRegionalEditorial } from "./regionalReportRefresh";
import { regionalSourcesToIncidents } from "./regionalReportCollection";
import { regionalEnergyConcentrated } from "../../../workbench/src/lib/regionalContentPolicy";

export type RegionalReportTopic = "apac_weekly" | "middle_east_weekly";
export type RegionalReportBuildStage = "collecting" | "building" | "saving";
export interface RegionalReportBuildOptions {
  collect?: boolean;
  coverageManifest?: RegionalCoverageManifest;
  priorHardNumbers?: unknown;
}

function normalizeHardNumbers(value: unknown): FuelHardNumbers {
  return JSON.parse(JSON.stringify(value)) as FuelHardNumbers;
}

async function reportValues(
  topic: RegionalReportTopic,
  issueDate: string,
  result: Awaited<ReturnType<typeof finishRegionalEditorialReport>>,
  setStage: (stage: RegionalReportBuildStage) => Promise<void>,
  additionalEvidence: Record<string, unknown> = {},
): Promise<InsertReport> {
  const errors = validateRegionalCanonicalStructure(result.canonical);
  if (errors.length > 0) throw new Error(errors.join(" "));
  await setStage("saving");
  return {
    title: topic === "apac_weekly" ? "Polestar APAC Weekly" : "Polestar Middle East Weekly",
    topic, issueDate, status: "draft",
    hardNumbers: normalizeHardNumbers({
      regionalCanonicalReport: result.canonical,
      regionalEvidenceSnapshot: { ...result.evidenceSnapshot, ...additionalEvidence },
    }),
    updatedAt: new Date(),
  };
}

export async function buildRegionalReport(
  topic: RegionalReportTopic,
  issueDate: string,
  setStage: (stage: RegionalReportBuildStage) => Promise<void>,
  options?: RegionalReportBuildOptions,
): Promise<InsertReport> {
  await setStage("collecting");
  const prior = savedRegionalEditorial(options?.priorHardNumbers);
  if (topic === "apac_weekly" && prior?.canonical.topic === topic && prior.canonical.issueDate === issueDate) {
    await setStage("building");
    return reportValues(topic, issueDate, await refreshRegionalEditorialOutlook(prior), setStage);
  }
  if (options?.collect === false && !options.coverageManifest) {
    throw new Error("Historical report refresh requires its saved source-coverage audit.");
  }
  // Middle East discovery is always rechecked against the report's own dates.
  // Its new sources stay report-local, not inserted into other product feeds.
  const run = options?.collect === false && topic === "apac_weekly" ? null : await runRegionalWeeklyCollection(
    topic === "apac_weekly" ? "apac" : "middle_east",
    { commit: topic === "apac_weekly", issueDate });
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
  const futureRows = topic === "middle_east_weekly" ? [] : await db.select().from(protestEventsTable).where(and(
    gte(protestEventsTable.eventDate, watchStart),
    lte(protestEventsTable.eventDate, watchEnd),
    inArray(protestEventsTable.status, ["Confirmed", "Planned", "Possible"]),
  ));
  const regionalFutureRows = futureRows.filter((event) =>
    regionalCountries.has(event.country ?? ""));
  let futureEvents = buildApacFutureEvents(
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
  const forwardRun = topic === "middle_east_weekly"
    ? await collectRegionalForwardSearch("middle_east", issueDate)
    : null;
  if (forwardRun && (forwardRun.coverage.status !== "checked" || forwardRun.coverage.errors.length > 0)) {
    throw new Error(`Regional forward collection failed: ${forwardRun.coverage.errors.join("; ") || "not completed"}`);
  }
  const forward = forwardRun
    ? await extractRegionalForwardEvents(forwardRun.sources, topic, issueDate)
    : null;
  if (forward) futureEvents = forward.events;
  const coverageManifest: RegionalCoverageManifest = run ? {
    requiredDomains: run.requiredDomains ?? run.coverage.map((check) => check.domain),
    domains: run.coverage,
    forwardSearch: forwardRun ? {
      ...forwardRun.coverage,
      domain: "forwardSearch",
      candidatesAccepted: futureEvents.length,
    } : {
      domain: "forwardSearch",
      status: "checked",
      sourceNames: ["protest_events", "incident_advisories"],
      itemsFetched: futureRows.length,
      candidatesAccepted: futureEvents.length,
      errors: [],
    },
    requiredGeographies: run.requiredGeographies,
    searchedGeographies: run.searchedGeographies,
    ...(forwardRun ? {
      requiredForwardDomains: forwardRun.requiredDomains,
      forwardDomains: forwardRun.domains,
    } : {}),
    collectionPasses: 1,
  } : options!.coverageManifest!;
  const since = new Date(issueStart);
  since.setUTCDate(since.getUTCDate() - 6);
  const issueEnd = new Date(`${issueDate}T23:59:59.999Z`);
  const incidents = await db.select().from(incidentsTable).where(and(
    gte(incidentsTable.occurredAt, since),
    lte(incidentsTable.occurredAt, issueEnd),
    defaultRelevanceCondition(),
  )).orderBy(desc(incidentsTable.occurredAt));
  let regionalIncidents = [
    ...incidents.map((incident) => ({
    ...incident,
    occurredAt: incident.occurredAt.toISOString(),
    incidentDate: incident.incidentDate?.toISOString() ?? null,
    summary: incident.summary ?? "",
    })),
    ...regionalSourcesToIncidents(run?.candidateRows ?? [], topic, issueDate),
  ];
  const funnel = auditRegionalWeeklyCandidateFunnel(
    regionalIncidents, topic, issueDate, coverageManifest);
  assertRegionalWeeklyReady(funnel);
  let packets = prepareRegionalFactPackets(regionalIncidents, topic, issueDate);
  if (packets.length < 5) throw new Error("Fewer than five material regional candidates remain. No report was generated.");
  let extracted = await extractRegionalReportFacts(packets, topic, issueDate);
  if (topic === "middle_east_weekly" &&
    regionalEnergyConcentrated(selectGroundedRegionalEvents(extracted.events, topic))) {
    const recheck = await runRegionalWeeklyCollection("middle_east", { commit: false, issueDate });
    if (recheck.coverage.some((check) => check.status !== "checked" || check.errors.length > 0)) {
      throw new Error("The energy-concentration collection recheck failed. No report was generated.");
    }
    coverageManifest.collectionPasses = 2;
    coverageManifest.domains = recheck.coverage;
    coverageManifest.searchedGeographies = recheck.searchedGeographies;
    regionalIncidents = [
      ...regionalIncidents,
      ...regionalSourcesToIncidents(recheck.candidateRows ?? [], topic, issueDate),
    ];
    const nextPackets = prepareRegionalFactPackets(regionalIncidents, topic, issueDate);
    // A real repeated search with the same evidence does not require paying
    // for identical extraction again. Never skip the source recheck itself.
    if (JSON.stringify(nextPackets) !== JSON.stringify(packets)) {
      packets = nextPackets;
      extracted = await extractRegionalReportFacts(packets, topic, issueDate);
    }
  }
  const result = await finishRegionalEditorialReport(
    packets, extracted, topic as RegionalWeeklyTopic, issueDate, futureEvents, coverageManifest);
  return reportValues(topic, issueDate, result, setStage,
    forwardRun ? { forwardSources: forwardRun.sources, forwardEvidence: forward?.evidence ?? [] } : {});
}