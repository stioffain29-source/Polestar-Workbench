import { sql } from "drizzle-orm";
import { sourcesTable } from "@workspace/db";

// Effective Source Health status for a `sources` row.
//
// A feed that has been auto-escalated to "failing" but whose latest successful
// fetch is NEWER than its latest failure has already self-recovered — the next
// ingest run would reset it to "operational", but on an autoscale deployment
// that run can be hours away. So we treat such a row as recovered immediately,
// everywhere a "problem" source is derived (Source Health KPIs, the dashboard
// counts and alerts), so a self-healed blip drops out of the queue at once.
//
// Recovery only overrides the AUTO status ("failing"). Manual analyst
// classifications (blocked / stale / delayed / not_configured) are never
// auto-cleared by a stray success timestamp.
export function effectiveSourceStatusSql() {
  return sql<string>`(
    case
      when ${sourcesTable.status} = 'failing'
        and ${sourcesTable.lastSuccessAt} is not null
        and ${sourcesTable.lastFailureAt} is not null
        and ${sourcesTable.lastSuccessAt} > ${sourcesTable.lastFailureAt}
      then 'operational'
      else ${sourcesTable.status}
    end
  )`;
}

// Optional integrations (GDELT, ReliefWeb) that are intentionally off or still
// awaiting approval. These must not appear in dashboard source alerts.
export function optionalIntegrationNoiseSql() {
  return sql`(
    ${sourcesTable.name} in (
      'GDELT Conflict Events',
      'ReliefWeb (UN OCHA)',
      'ReliefWeb Situational Reports (UN OCHA)'
    )
    and ${sourcesTable.status} in ('not_configured', 'pending')
  )`;
}
