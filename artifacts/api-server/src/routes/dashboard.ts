import { Router, type IRouter } from "express";
import { db, incidentsTable, sourcesTable, reportsTable } from "@workspace/db";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { defaultRelevanceCondition } from "../lib/relevanceFilter";

const router: IRouter = Router();

const TOPICS: Record<string, string> = {
  fuel: "Fuel",
  flashpoint: "Flashpoint",
  protests: "Protests & Civil Unrest",
  fertiliser: "Fertiliser",
  energy: "Energy",
  shipping: "Shipping",
  cargo_watch: "Cargo Watch",
  conflict: "Conflict Watch",
};

router.get("/dashboard/overview", async (_req, res): Promise<void> => {
  const since7d = new Date(Date.now() - 7 * 86400000);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      critical: sql<number>`sum(case when ${incidentsTable.severity} = 'extreme' then 1 else 0 end)::int`,
    })
    .from(incidentsTable)
    .where(and(gte(incidentsTable.occurredAt, since7d), defaultRelevanceCondition()));

  const [sourceCounts] = await db
    .select({
      active: sql<number>`sum(case when ${sourcesTable.status} = 'operational' then 1 else 0 end)::int`,
      failing: sql<number>`sum(case when ${sourcesTable.status} in ('failing','blocked','stale') then 1 else 0 end)::int`,
    })
    .from(sourcesTable);

  const [reportCounts] = await db
    .select({ inProgress: sql<number>`sum(case when ${reportsTable.status} in ('draft','review') then 1 else 0 end)::int` })
    .from(reportsTable);

  const topicCards = await Promise.all(
    Object.entries(TOPICS).map(async ([topic, label]) => {
      const [total] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(incidentsTable)
        .where(and(eq(incidentsTable.topic, topic), defaultRelevanceCondition()));
      const [agg7d] = await db
        .select({
          count: sql<number>`count(*)::int`,
          critical: sql<number>`sum(case when ${incidentsTable.severity} = 'extreme' then 1 else 0 end)::int`,
        })
        .from(incidentsTable)
        .where(and(eq(incidentsTable.topic, topic), gte(incidentsTable.occurredAt, since7d), defaultRelevanceCondition()));
      const [latest] = await db
        .select()
        .from(incidentsTable)
        .where(and(eq(incidentsTable.topic, topic), defaultRelevanceCondition()))
        .orderBy(desc(incidentsTable.occurredAt))
        .limit(1);
      return {
        topic,
        label,
        incidentCount: total?.count ?? 0,
        incidentCount7d: agg7d?.count ?? 0,
        criticalCount: agg7d?.critical ?? 0,
        latestHeadline: latest?.title ?? null,
        latestAt: latest?.occurredAt ?? null,
      };
    }),
  );

  // Server now applies the shared relevance gate (see relevanceFilter), so
  // these rows are already clean. The client keeps its own gate as
  // defense-in-depth; the modest over-fetch leaves headroom for it.
  const recentIncidents = await db
    .select()
    .from(incidentsTable)
    .where(defaultRelevanceCondition())
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(40);

  const sourceAlerts = await db
    .select()
    .from(sourcesTable)
    .where(ne(sourcesTable.status, "operational"))
    .orderBy(desc(sourcesTable.lastFailureAt))
    .limit(8);

  const reportsPipeline = await db
    .select()
    .from(reportsTable)
    .where(ne(reportsTable.status, "published"))
    .orderBy(desc(reportsTable.issueDate))
    .limit(8);

  res.json({
    totalIncidents7d: totals?.total ?? 0,
    criticalIncidents7d: totals?.critical ?? 0,
    activeSources: sourceCounts?.active ?? 0,
    failingSources: sourceCounts?.failing ?? 0,
    reportsInProgress: reportCounts?.inProgress ?? 0,
    topicCards,
    recentIncidents,
    sourceAlerts,
    reportsPipeline,
  });
});

export default router;
