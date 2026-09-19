/**
 * Development-only Regional Weekly acceptance harness.
 *
 * Production is evidence-only: it is queried with a read-only pool and is
 * never passed to a writer.  Generation, persistence, reload and PDF export
 * all use the development database and the normal regional projection code.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import pg from "../../../lib/db/node_modules/pg/esm/index.mjs";

const prodUrl = process.env.PROD_DATABASE_URL?.trim();
const devUrl = process.env.DATABASE_URL?.trim();
if (!prodUrl || !devUrl) throw new Error("PROD_DATABASE_URL and DATABASE_URL are required");
if (prodUrl === devUrl) throw new Error("Refusing to run: production and development URLs are identical");
process.env.DATABASE_URL = devUrl;

const { db, incidentsTable, reportsTable, protestEventsTable } = await import("@workspace/db");
const { and, eq, gte, lte, inArray } = await import("drizzle-orm");
const { runProtestScheduleIngest, runRegionalWeeklyCollection } = await import("@workspace/ingest");
const {
  auditRegionalWeeklyCandidateFunnel,
  assertRegionalWeeklyReady,
  buildRegionalWeeklyDevelopments,
  buildStructuredRegionalBluf,
  buildStructuredRegionalOutlook,
  buildRegionalBusinessImplicationsNarrative,
  buildApacWeeklyWatchlist,
  curateRegionalWeeklyIncidents,
  selectRegionalKeyDevelopments,
  validateRegionalWeeklyAssessment,
} = await import("../src/lib/regionalWeekly");
const { fetchRegionalFutureEvents } = await import("./topicReportData");
const { runHeadlessReportExport } = await import("./exportReportPdfHeadless");

// Load the complete production evidence window through the read-only pool.
// Do not substitute a health probe: this is the actual basis used below.
type RegionalEvidence = Record<string, unknown> & {
  id: number; title: string; displayTitle?: string | null; summary: string;
  country: string; occurredAt: string; source?: string | null;
};
const prod = new pg.Pool({ connectionString: prodUrl, max: 1, application_name: "regional-weekly-e2e-readonly" });
const startDate = new Date(Date.now() - 6 * 86400000);
const endDate = new Date();
let productionEvidence: RegionalEvidence[];
try {
  const result = await prod.query(
    `select id, topic, title, display_title, summary, country, location,
            latitude, longitude, severity, category, occurred_at, incident_date,
            source, analyst_notes, event_cluster_key
       from incidents
      where occurred_at >= $1 and occurred_at <= $2
      order by occurred_at desc, id desc`,
    [startDate, endDate],
  );
  productionEvidence = result.rows.map((row) => ({
    ...row,
    displayTitle: row.display_title,
    occurredAt: new Date(row.occurred_at).toISOString(),
    analystNotes: row.analyst_notes,
    eventClusterKey: row.event_cluster_key,
  }));
} finally {
  await prod.end();
}

const outDir = resolve(process.cwd(), "scripts/.regional-weekly-e2e");
mkdirSync(outDir, { recursive: true });
const forwardCollection = await runProtestScheduleIngest({ commit: true, now: endDate });
const runs = {
  apac: await runRegionalWeeklyCollection("apac", { commit: true }),
  middle_east: await runRegionalWeeklyCollection("middle_east", { commit: true }),
};

const today = endDate;
const issueDate = today.toISOString().slice(0, 10);
const devCollectorEvidence = await db.select().from(incidentsTable).where(
  and(
    gte(incidentsTable.occurredAt, startDate),
    lte(incidentsTable.occurredAt, endDate),
    inArray(incidentsTable.topic, ["regional_weather", "regional_cyber"]),
  ),
);
const stableKey = (row: RegionalEvidence) =>
  `${row.country}|${(row.eventClusterKey ?? row.title).toString().toLowerCase().replace(/\W+/g, " ").trim()}|${row.occurredAt.slice(0, 10)}`;
const evidenceByKey = new Map(productionEvidence.map((row) => [stableKey(row), row]));
for (const row of devCollectorEvidence) {
  const normalized = { ...row, displayTitle: row.displayTitle, occurredAt: new Date(row.occurredAt).toISOString() } as unknown as RegionalEvidence;
  if (!evidenceByKey.has(stableKey(normalized))) evidenceByKey.set(stableKey(normalized), normalized);
}
const incidents = [...evidenceByKey.values()];
if (!incidents.length) throw new Error("No development evidence in the current reporting window");

const reportIds: number[] = [];
const requestedTopic = process.env.REGIONAL_WEEKLY_ONLY;
const reportRuns = ([["APAC", "apac_weekly"], ["Middle East", "middle_east_weekly"]] as const)
  .filter(([, topic]) => !requestedTopic || requestedTopic === topic);
for (const [region, topic] of reportRuns) {
  const key = region === "APAC" ? "apac" : "middle_east";
  const run = runs[key];
  const weather = { startedAt: run.startedAt, completedAt: run.completedAt, ...run.weather };
  const cyber = { startedAt: run.startedAt, completedAt: run.completedAt, ...run.cyber };
  const forwardRows = await fetchRegionalFutureEvents(issueDate, topic);
  const forwardCandidates = await db.select({ id: protestEventsTable.id }).from(protestEventsTable).where(
    and(
      gte(protestEventsTable.eventDate, today),
      lte(protestEventsTable.eventDate, new Date(today.getTime() + 7 * 86400000)),
      inArray(protestEventsTable.status, ["Confirmed", "Planned", "Possible"]),
    ),
  );
  const futureIncidentCandidates = await db.select({ id: incidentsTable.id }).from(incidentsTable).where(
    and(gte(incidentsTable.occurredAt, today), lte(incidentsTable.occurredAt, new Date(today.getTime() + 7 * 86400000))),
  );
  const forward = {
    startedAt: run.startedAt,
    completedAt: new Date().toISOString(),
    sourceNames: ["google_news_protest_schedule", "incident_advisories"],
    itemsFetched: forwardCollection.itemsConsidered + futureIncidentCandidates.length,
    candidatesAccepted: forwardRows.length,
    errors: forwardCollection.errors,
  };
  const coverage = { weather, cyber, forward };
  const regional = incidents.filter((row) => row.country != null);
  const curated = curateRegionalWeeklyIncidents(regional, topic, issueDate);
  const funnel = auditRegionalWeeklyCandidateFunnel(incidents, topic, issueDate, coverage);
  assertRegionalWeeklyReady(funnel, { auditedTrueShortage: process.env.ALLOW_TRUE_SHORTAGE === "1" });
  const selected = selectRegionalKeyDevelopments(curated, topic);
  const developments = buildRegionalWeeklyDevelopments(selected, issueDate, topic);
  const renderedEvidenceIds = new Set(
    developments.flatMap((row) => row.evidenceIds ?? []).map(String),
  );
  const selectedSnapshot = selected.filter((row) => {
    const members = (row as typeof row & { sourceMembers?: Array<{ id?: string | number }> }).sourceMembers ?? [row];
    return members.some((member) => member.id !== undefined && renderedEvidenceIds.has(String(member.id)));
  });
  const watch = buildApacWeeklyWatchlist(developments, forwardRows, issueDate);
  const errors = validateRegionalWeeklyAssessment(developments, topic);
  if (errors.length) throw new Error(`${region} validation failed: ${errors.join("; ")}`);
  const evidenceIds = developments.flatMap((row) => row.evidenceIds ?? []).map(String);
  if (!evidenceIds.length) throw new Error(`${region} has no durable evidence IDs`);
  const fingerprint = `${topic}:${issueDate}:${evidenceIds.join(",")}`;
  const [saved] = await db.insert(reportsTable).values({
    title: `Polestar ${region} Weekly — ${issueDate}`,
    topic,
    status: "draft",
    issueDate,
    executiveSummary: buildStructuredRegionalBluf(developments, topic),
    situation: buildStructuredRegionalOutlook(developments, topic),
    // Regional development cards are rebuilt from the persisted evidence
    // snapshot. Do not duplicate their full JSON payload into a prose column.
    whatHappened: "",
    whatMatters: buildRegionalBusinessImplicationsNarrative(developments),
    watchNext: JSON.stringify(watch),
    hardNumbers: {
      regionalCollectorRun: { ...run, forward },
      evidenceIds,
      regionalEvidenceSnapshot: selectedSnapshot,
      regionalForwardSnapshot: forwardRows,
      selectedEvidenceIds: evidenceIds,
      funnel,
      model: { provider: "deterministic-shared-regional-engine", version: "regional-weekly-v1" },
    },
    proseBasisFingerprint: fingerprint,
    proseProvenance: Object.fromEntries(
      ["executiveSummary", "situation", "whatHappened", "whatMatters", "watchNext"].map((section) => [
        section,
        { kind: "GENERATED", fingerprint, generationBasisFingerprint: fingerprint },
      ]),
    ),
    updatedAt: new Date(),
  }).returning({ id: reportsTable.id });
  if (!saved) throw new Error(`Could not save ${region} report`);
  const [reloaded] = await db.select().from(reportsTable).where(eq(reportsTable.id, saved.id));
  if (!reloaded || reloaded.proseBasisFingerprint !== fingerprint) throw new Error(`${region} save/reload fingerprint mismatch`);
  const reloadedNumbers = reloaded.hardNumbers as {
    evidenceIds?: string[];
    regionalForwardSnapshot?: typeof forwardRows;
  } | null;
  if (!reloadedNumbers?.evidenceIds?.join(",") || reloadedNumbers.evidenceIds.join(",") !== evidenceIds.join(",")) {
    throw new Error(`${region} reloaded evidence basis mismatch`);
  }
  const normalizedForwardRows = JSON.parse(JSON.stringify(forwardRows)) as typeof forwardRows;
  if (!isDeepStrictEqual(reloadedNumbers.regionalForwardSnapshot ?? [], normalizedForwardRows)) {
    throw new Error(`${region} save/reload forward-event snapshot mismatch`);
  }
  if (!isDeepStrictEqual(reloaded.watchNext ? JSON.parse(reloaded.watchNext) : [], JSON.parse(JSON.stringify(watch)))) {
    throw new Error(`${region} save/reload watch-list mismatch`);
  }
  const persistedSnapshot = (reloaded.hardNumbers as { regionalEvidenceSnapshot?: Array<{ id?: number; country?: string }> } | null)?.regionalEvidenceSnapshot ?? [];
  const expectedIds = selectedSnapshot.flatMap((row) => {
    const members = (row as typeof row & { sourceMembers?: Array<{ id?: number }> }).sourceMembers ?? [row];
    return members.map((member) => member.id).filter((id): id is number => typeof id === "number");
  }).map(String);
  if (persistedSnapshot.some((row) => !row.country || !new Set(region === "APAC"
    ? ["Australia","Bangladesh","Bhutan","Brunei","Cambodia","China","Fiji","Hong Kong","India","Indonesia","Japan","Kiribati","Laos","Malaysia","Maldives","Marshall Islands","Micronesia","Mongolia","Myanmar","Nauru","Nepal","New Zealand","North Korea","Pakistan","Palau","Papua New Guinea","Philippines","Samoa","Singapore","Solomon Islands","South Korea","Sri Lanka","Taiwan","Thailand","Timor-Leste","Tonga","Tuvalu","Vanuatu","Vietnam"]
    : ["Bahrain","Egypt","Iran","Iraq","Israel","Jordan","Kuwait","Lebanon","Oman","Palestine","Qatar","Saudi Arabia","Syria","Turkey","Türkiye","United Arab Emirates","UAE","Yemen"]).has(row.country))) {
    throw new Error(`${region} persisted snapshot crosses regional boundary`);
  }
  if (expectedIds.join(",") !== evidenceIds.join(",")) throw new Error(`${region} selected evidence IDs differ from persisted basis`);
  reportIds.push(saved.id);
}

for (const [index, topic] of reportRuns.map(([, topic]) => topic).entries()) {
  const pdf = resolve(outDir, `${topic}-${reportIds[index]}.pdf`);
  await runHeadlessReportExport({
    reportId: reportIds[index],
    topic,
    outPath: pdf,
  });
  console.log(`${topic} reportId=${reportIds[index]} pdf=${pdf}`);
}