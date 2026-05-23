import { db, incidentsTable, reportsTable } from "@workspace/db";
import { sql, eq, or } from "drizzle-orm";
import { logger } from "./logger";

// Topics that must each have at least one report card in the Report Builder.
// Kept in sync with TOPIC_LABELS on the client.
const REQUIRED_TOPIC_REPORTS: Array<{
  topic: string;
  title: string;
}> = [
  { topic: "fuel",        title: "APAC Fuel Theft & Diversion Outlook" },
  { topic: "flashpoint",  title: "Indo-Pacific Flashpoint Tracker" },
  { topic: "fertiliser",  title: "South Asia Fertiliser Supply Risk Brief" },
  { topic: "cargo_watch", title: "APAC Cargo Theft & Hijack Monthly" },
];

/**
 * Idempotent data migrations applied at startup.
 *
 * Each block detects an "old-data" marker and only runs if the migration has
 * not been applied yet, so it is safe to run repeatedly across deploys.
 */
export async function runDataMigrations(): Promise<void> {
  try {
    // 1) Severity vocabulary: critical/elevated/moderate/low  →
    //    insignificant/low/moderate/high/extreme.
    //
    //    Detected by the presence of any row using the old terms
    //    'critical' or 'elevated', which do not exist in the new vocabulary.
    const [oldSev] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(
        or(
          eq(incidentsTable.severity, "critical"),
          eq(incidentsTable.severity, "elevated"),
        ),
      );

    if ((oldSev?.n ?? 0) > 0) {
      logger.info({ rows: oldSev?.n }, "Migrating severity vocabulary");
      await db.execute(sql`
        UPDATE incidents SET severity = CASE severity
          WHEN 'critical' THEN 'extreme'
          WHEN 'elevated' THEN 'moderate'
          WHEN 'moderate' THEN 'low'
          WHEN 'low'      THEN 'insignificant'
          ELSE severity
        END
      `);
    }

    // 2) Fertiliser content was originally seeded under topic='flashpoint'.
    //    Move it to its own topic. Detected by absence of any fertiliser rows
    //    combined with the presence of the original fertiliser-themed titles
    //    still sitting under flashpoint.
    const [fertCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(eq(incidentsTable.topic, "fertiliser"));

    if ((fertCount?.n ?? 0) === 0) {
      const res = await db.execute(sql`
        UPDATE incidents
        SET topic = 'fertiliser'
        WHERE topic = 'flashpoint'
          AND (
            title ILIKE '%urea%'
            OR title ILIKE '%phosphate%'
            OR title ILIKE '%fertiliser%'
            OR title ILIKE '%fertilizer%'
            OR title ILIKE '%potash%'
            OR title ILIKE '%DAP %'
          )
      `);
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ rows: res.rowCount }, "Reclassified fertiliser incidents");
      }
    }
    // 3) Ensure every topic has at least one report card in the Report
    //    Builder. Idempotent: only inserts when no report exists for the
    //    topic, so re-runs and new environments self-heal without
    //    duplicating cards.
    const today = new Date().toISOString().slice(0, 10);
    for (const seed of REQUIRED_TOPIC_REPORTS) {
      const [existing] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(reportsTable)
        .where(eq(reportsTable.topic, seed.topic));
      if ((existing?.n ?? 0) === 0) {
        await db.insert(reportsTable).values({
          title: seed.title,
          topic: seed.topic,
          status: "draft",
          issueDate: today,
          author: "J. Sterling",
        });
        logger.info({ topic: seed.topic, title: seed.title }, "Seeded missing topic report");
      }
    }
  } catch (err) {
    logger.error({ err }, "Data migration failed (continuing startup)");
  }
}
