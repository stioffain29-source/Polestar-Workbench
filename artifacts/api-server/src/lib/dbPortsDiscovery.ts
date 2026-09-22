import { db, gdeltStructuredItemsTable, incidentsTable } from "@workspace/db";
import {
  DB_PORTS_DISCOVERY_SQL_PATTERN,
  type DbPortsDiscoveryRow,
} from "@workspace/db-ports";
import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Bounded, read-only discovery from already-persisted rows. */
export async function readDbPortsDiscovery(
  window: { startDate: string; endDate: string },
): Promise<{ rows: DbPortsDiscoveryRow[]; truncated: boolean }> {
  const from = new Date(`${window.startDate}T00:00:00.000Z`);
  const through = new Date(`${window.endDate}T23:59:59.999Z`);
  const incidentProbe = await db
    .select()
    .from(incidentsTable)
    .where(and(
      eq(incidentsTable.relevanceStatus, "relevant"),
      eq(incidentsTable.validityStatus, "valid"),
      gte(incidentsTable.occurredAt, from),
      lte(incidentsTable.occurredAt, through),
      or(
        sql`${incidentsTable.title} ~* ${DB_PORTS_DISCOVERY_SQL_PATTERN}`,
        sql`${incidentsTable.summary} ~* ${DB_PORTS_DISCOVERY_SQL_PATTERN}`,
      ),
    ))
    .orderBy(asc(incidentsTable.occurredAt))
    .limit(2001);
  const incidentRows = incidentProbe.slice(0, 2000);
  const remaining = 4000 - incidentRows.length;
  const gdeltProbe = remaining
    ? await db
        .select()
        .from(gdeltStructuredItemsTable)
        .where(and(
          gte(gdeltStructuredItemsTable.sourceDate, from),
          lte(gdeltStructuredItemsTable.sourceDate, through),
          or(
            sql`${gdeltStructuredItemsTable.title} ~* ${DB_PORTS_DISCOVERY_SQL_PATTERN}`,
            sql`${gdeltStructuredItemsTable.summary} ~* ${DB_PORTS_DISCOVERY_SQL_PATTERN}`,
          ),
        ))
        .orderBy(asc(gdeltStructuredItemsTable.sourceDate))
        .limit(remaining + 1)
    : [];
  const rows = [
    ...incidentRows.map((row) => ({
      id: `incident:${row.id}`,
      title: row.title,
      summary: row.summary,
      country: row.country,
      location: row.location ?? "",
      sourceName: row.source ?? "Persisted incident source",
      sourceUrl: row.resolvedUrl ?? row.sourceUrl ?? "",
      sourceDate: dateOnly(row.occurredAt),
      eventDate: dateOnly(row.incidentDate),
      clusterKey: row.eventClusterKey,
    })),
    ...gdeltProbe.map((row) => ({
      id: `gdelt:${row.id}`,
      title: row.title,
      summary: row.summary ?? "",
      country: row.country ?? "",
      location: row.location ?? "",
      sourceName: row.sourceName,
      sourceUrl: row.primaryStoryUrl ?? row.url ?? "",
      sourceDate: dateOnly(row.sourceDate),
      eventDate: null,
      clusterKey: null,
    })),
  ];
  return {
    rows,
    truncated: incidentProbe.length > 2000 || gdeltProbe.length > remaining,
  };
}