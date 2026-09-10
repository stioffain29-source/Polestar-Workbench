import { Router, type IRouter } from "express";
import {
  db,
  incidentsTable,
  maritimeSemanticEvidenceTable,
  sourcesTable,
  reportsTable,
} from "@workspace/db";
import { and, desc, eq, gte, ne, notInArray, sql } from "drizzle-orm";
import {
  defaultRelevanceCondition,
  currentMaritimeSemanticProjectionCondition,
  validatedMaritimeIncidentCondition,
} from "../lib/relevanceFilter";
import {
  dashboardSourceAlertsExcludeSql,
  effectiveSourceStatusSql,
} from "../lib/sourceHealthSql";
import { withCorroborations } from "./incidents";

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

async function canonicalShippingAggregate(since?: Date): Promise<{
  count: number;
  critical: number;
}> {
  const conditions = [
    eq(incidentsTable.topic, "shipping"),
    defaultRelevanceCondition(),
    validatedMaritimeIncidentCondition(),
  ];
  if (since) conditions.push(gte(incidentsTable.occurredAt, since));
  const [row] = await db
    .select({
      count: sql<number>`count(distinct ${maritimeSemanticEvidenceTable.developmentKey})::int`,
      critical: sql<number>`count(distinct case
        when ${maritimeSemanticEvidenceTable.severity} = 'extreme'
        then ${maritimeSemanticEvidenceTable.developmentKey}
        else null end)::int`,
    })
    .from(incidentsTable)
    .innerJoin(
      maritimeSemanticEvidenceTable,
      and(
        eq(maritimeSemanticEvidenceTable.incidentId, incidentsTable.id),
        currentMaritimeSemanticProjectionCondition(),
      ),
    )
    .where(and(...conditions));
  return { count: row?.count ?? 0, critical: row?.critical ?? 0 };
}

router.get("/dashboard/overview", async (_req, res): Promise<void> => {
  const since7d = new Date(Date.now() - 7 * 86400000);

  const [nonMaritimeTotals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      critical: sql<number>`sum(case when ${incidentsTable.severity} = 'extreme' then 1 else 0 end)::int`,
    })
    .from(incidentsTable)
    .where(and(
      gte(incidentsTable.occurredAt, since7d),
      notInArray(incidentsTable.topic, ["shipping", "maritime"]),
      defaultRelevanceCondition(),
    ));
  const maritimeTotals = await canonicalShippingAggregate(since7d);

  // Count by EFFECTIVE status so an auto-failing feed that has since recovered
  // (latest success newer than latest failure) is not double-counted as a
  // problem on the dashboard — consistent with the Source Health page.
  const effStatus = effectiveSourceStatusSql();
  const [sourceCounts] = await db
    .select({
      active: sql<number>`sum(case when ${effStatus} = 'operational' then 1 else 0 end)::int`,
      failing: sql<number>`sum(case when ${effStatus} in ('failing','blocked','stale') then 1 else 0 end)::int`,
    })
    .from(sourcesTable);

  const [reportCounts] = await db
    .select({ inProgress: sql<number>`sum(case when ${reportsTable.status} in ('draft','review') then 1 else 0 end)::int` })
    .from(reportsTable);

  const topicCards = await Promise.all(
    Object.entries(TOPICS).map(async ([topic, label]) => {
      if (topic === "shipping") {
        const total = await canonicalShippingAggregate();
        const agg7d = await canonicalShippingAggregate(since7d);
        const [latest] = await db
          .select()
          .from(incidentsTable)
          .where(and(
            eq(incidentsTable.topic, topic),
            defaultRelevanceCondition(),
            validatedMaritimeIncidentCondition(),
          ))
          .orderBy(desc(incidentsTable.occurredAt))
          .limit(1);
        return {
          topic,
          label,
          incidentCount: total.count,
          incidentCount7d: agg7d.count,
          criticalCount: agg7d.critical,
          latestHeadline:
            latest?.displayTitle?.trim() || latest?.title?.trim() || null,
          latestAt: latest?.occurredAt ?? null,
        };
      }
      const [total] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(incidentsTable)
        .where(and(
          eq(incidentsTable.topic, topic),
          defaultRelevanceCondition(),
          validatedMaritimeIncidentCondition(),
        ));
      const [agg7d] = await db
        .select({
          count: sql<number>`count(*)::int`,
          critical: sql<number>`sum(case when ${incidentsTable.severity} = 'extreme' then 1 else 0 end)::int`,
        })
        .from(incidentsTable)
        .where(and(
          eq(incidentsTable.topic, topic),
          gte(incidentsTable.occurredAt, since7d),
          defaultRelevanceCondition(),
          validatedMaritimeIncidentCondition(),
        ));
      const [latest] = await db
        .select()
        .from(incidentsTable)
        .where(and(
          eq(incidentsTable.topic, topic),
          defaultRelevanceCondition(),
          validatedMaritimeIncidentCondition(),
        ))
        .orderBy(desc(incidentsTable.occurredAt))
        .limit(1);
      return {
        topic,
        label,
        incidentCount: total?.count ?? 0,
         incidentCount7d: agg7d?.count ?? 0,
         criticalCount: agg7d?.critical ?? 0,
        latestHeadline:
          latest?.displayTitle?.trim() || latest?.title?.trim() || null,
        latestAt: latest?.occurredAt ?? null,
      };
    }),
  );

  // Server now applies the shared relevance gate (see relevanceFilter), so
  // these rows are already clean. The client keeps its own gate as
  // defense-in-depth; the modest over-fetch leaves headroom for it.
  const recentIncidentRows = await db
    .select()
    .from(incidentsTable)
    .where(defaultRelevanceCondition())
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(40);
  const recentIncidents = await withCorroborations(recentIncidentRows);

  const sourceAlerts = await db
    .select()
    .from(sourcesTable)
    .where(sql`not ${dashboardSourceAlertsExcludeSql()}`)
    .orderBy(desc(sourcesTable.lastFailureAt))
    .limit(8);

  const reportsPipeline = await db
    .select()
    .from(reportsTable)
    .where(ne(reportsTable.status, "published"))
    .orderBy(desc(reportsTable.issueDate))
    .limit(8);

  res.json({
    totalIncidents7d: (nonMaritimeTotals?.total ?? 0) + maritimeTotals.count,
    criticalIncidents7d: (nonMaritimeTotals?.critical ?? 0) + maritimeTotals.critical,
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
