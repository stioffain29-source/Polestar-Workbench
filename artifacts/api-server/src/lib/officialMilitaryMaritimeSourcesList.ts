import { db, officialMilitaryMaritimeSourcesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ListOfficialMilitaryMaritimeSourcesParams } from "@workspace/api-zod";

const DEFAULT_LIMIT = 50;

const FLAG_COLUMNS = {
  significant_incident: officialMilitaryMaritimeSourcesTable.flagSignificantIncident,
  escalation_indicator: officialMilitaryMaritimeSourcesTable.flagEscalationIndicator,
  maritime_disruption: officialMilitaryMaritimeSourcesTable.flagMaritimeDisruption,
  evidence_available: officialMilitaryMaritimeSourcesTable.flagEvidenceAvailable,
  possible_spot_report: officialMilitaryMaritimeSourcesTable.flagPossibleSpotReport,
} as const;

export async function listOfficialMilitaryMaritimeSources(
  query: ListOfficialMilitaryMaritimeSourcesParams,
) {
  const { source, watch, flag, limit } = query;
  const conditions = [];

  if (source) {
    if (source === "partner") {
      conditions.push(
        sql`${officialMilitaryMaritimeSourcesTable.sourceName} NOT IN ('centcom', 'ukmto')`,
      );
    } else {
      conditions.push(eq(officialMilitaryMaritimeSourcesTable.sourceName, source));
    }
  }

  if (watch) {
    conditions.push(
      sql`(${officialMilitaryMaritimeSourcesTable.primaryWatch} = ${watch} OR ${officialMilitaryMaritimeSourcesTable.watchTags} @> ${JSON.stringify([watch])}::jsonb)`,
    );
  }

  if (flag) {
    conditions.push(eq(FLAG_COLUMNS[flag], true));
  }

  const where =
    conditions.length > 1
      ? and(...conditions)
      : conditions.length === 1
        ? conditions[0]
        : undefined;

  return db
    .select({
      id: officialMilitaryMaritimeSourcesTable.id,
      sourceName: officialMilitaryMaritimeSourcesTable.sourceName,
      externalId: officialMilitaryMaritimeSourcesTable.externalId,
      title: officialMilitaryMaritimeSourcesTable.title,
      publishedAt: officialMilitaryMaritimeSourcesTable.publishedAt,
      sourceUrl: officialMilitaryMaritimeSourcesTable.sourceUrl,
      bodyText: officialMilitaryMaritimeSourcesTable.bodyText,
      classification: officialMilitaryMaritimeSourcesTable.classification,
      flagSignificantIncident: officialMilitaryMaritimeSourcesTable.flagSignificantIncident,
      flagEscalationIndicator: officialMilitaryMaritimeSourcesTable.flagEscalationIndicator,
      flagMaritimeDisruption: officialMilitaryMaritimeSourcesTable.flagMaritimeDisruption,
      flagEvidenceAvailable: officialMilitaryMaritimeSourcesTable.flagEvidenceAvailable,
      flagPossibleSpotReport: officialMilitaryMaritimeSourcesTable.flagPossibleSpotReport,
      primaryWatch: officialMilitaryMaritimeSourcesTable.primaryWatch,
      watchTags: officialMilitaryMaritimeSourcesTable.watchTags,
      ingestedAt: officialMilitaryMaritimeSourcesTable.ingestedAt,
      createdAt: officialMilitaryMaritimeSourcesTable.createdAt,
      updatedAt: officialMilitaryMaritimeSourcesTable.updatedAt,
    })
    .from(officialMilitaryMaritimeSourcesTable)
    .where(where)
    .orderBy(
      desc(officialMilitaryMaritimeSourcesTable.publishedAt),
      desc(officialMilitaryMaritimeSourcesTable.id),
    )
    .limit(limit ?? DEFAULT_LIMIT);
}
