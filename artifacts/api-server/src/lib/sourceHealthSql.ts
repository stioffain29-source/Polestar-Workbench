import { sql } from "drizzle-orm";
import { sourcesTable } from "@workspace/db";
import {
  FACEBOOK_OSINT_HEALTH_NAME,
  OPTIONAL_INTEGRATION_SOURCE_NAME_LIST,
} from "../../../../lib/ingest/src/optionalIntegrations";
import {
  CENTCOM_HEALTH_NAME,
  UKMTO_HEALTH_NAME,
} from "../../../../lib/ingest/src/m15/health";

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

// Optional integrations (GDELT, ReliefWeb, Facebook OSINT) that are
// intentionally off or still awaiting approval. These must not appear in
// dashboard source alerts.
export function optionalIntegrationNoiseSql() {
  const names = OPTIONAL_INTEGRATION_SOURCE_NAME_LIST.map((n) => sql`${n}`);
  return sql`(
    ${sourcesTable.name} in (${sql.join(names, sql`, `)})
    and ${sourcesTable.status} in ('not_configured', 'pending')
  )`;
}

// Mirrors the workbench `isSourceActionRequired` gate: only feeds that need
// operator follow-up surface on the dashboard alerts panel.
export function dashboardSourceAlertsExcludeSql() {
  const eff = effectiveSourceStatusSql();
  const optionalNames = OPTIONAL_INTEGRATION_SOURCE_NAME_LIST.map((n) => sql`${n}`);
  const m15Names = [CENTCOM_HEALTH_NAME, UKMTO_HEALTH_NAME].map((n) => sql`${n}`);
  return sql`(
    ${eff} in ('operational', 'pending')
    or (
      ${eff} = 'not_configured'
      and ${sourcesTable.name} in (${sql.join(optionalNames, sql`, `)})
    )
    or (
      ${sourcesTable.name} = ${FACEBOOK_OSINT_HEALTH_NAME}
      and ${sourcesTable.errorMessage} ilike '%integration not configured%'
    )
    or (
      ${sourcesTable.topic} = 'official_military_maritime'
      and ${sourcesTable.name} in (${sql.join(m15Names, sql`, `)})
      and ${sourcesTable.errorMessage} ilike '%403%'
    )
    or (
      ${sourcesTable.topic} = 'flashpoint'
      and ${sourcesTable.name} = 'The Kathmandu Post'
      and (
        ${sourcesTable.errorMessage} ilike '%invalid character%'
        or ${sourcesTable.errorMessage} ilike '%malformed%'
        or ${sourcesTable.failureReason} = 'parse_error'
      )
    )
    or ${optionalIntegrationNoiseSql()}
  )`;
}
