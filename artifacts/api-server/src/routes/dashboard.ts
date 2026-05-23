import { Router, type IRouter } from "express";
import { db, incidentsTable, sourcesTable, reportsTable } from "@workspace/db";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";

const router: IRouter = Router();

const TOPICS: Record<string, string> = {
  fuel: "Fuel",
  flashpoint: "Flashpoint",
  protests: "Protests & Civil Unrest",
  fertiliser: "Fertiliser",
  energy: "Energy",
  shipping: "Shipping",
  cargo_watch: "Cargo Watch",
};

router.get("/dashboard/overview", async (_req, res): Promise<void> => {
  const since7d = new Date(Date.now() - 7 * 86400000);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      critical: sql<number>`sum(case when ${incidentsTable.severity} = 'critical' then 1 else 0 end)::int`,
    })
    .from(incidentsTable)
    .where(gte(incidentsTable.occurredAt, since7d));

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
      const [agg] = await db
        .select({
          count: sql<number>`count(*)::int`,
          critical: sql<number>`sum(case when ${incidentsTable.severity} = 'critical' then 1 else 0 end)::int`,
        })
        .from(incidentsTable)
        .where(and(eq(incidentsTable.topic, topic), gte(incidentsTable.occurredAt, since7d)));
      const [latest] = await db
        .select()
        .from(incidentsTable)
        .where(eq(incidentsTable.topic, topic))
        .orderBy(desc(incidentsTable.occurredAt))
        .limit(1);
      return {
        topic,
        label,
        incidentCount: agg?.count ?? 0,
        criticalCount: agg?.critical ?? 0,
        latestHeadline: latest?.title ?? null,
        latestAt: latest?.occurredAt ?? null,
      };
    }),
  );

  const recentIncidents = await db
    .select()
    .from(incidentsTable)
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(8);

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
