import { db as sharedDb, sourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isFacebookOsintActive, FACEBOOK_OSINT_HEALTH_NAME } from "@workspace/ingest";

/**
 * The minimal database surface this repair needs, so it can be exercised with a
 * stub instead of a live connection.
 */
export interface HealthRepairDb {
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
}

/**
 * Keep the Facebook OSINT Source Health row honest at boot.
 *
 * When the collector is intentionally off (no usable key, or every pass
 * switched off) the row is reset to `not_configured` so the dashboard does not
 * alarm red over a source nobody asked to run.
 *
 * When the collector IS active the row is left ALONE — deliberately, and this
 * is the whole point of the function existing on its own:
 *
 * The reset nulls `last_success_at`, and that column is the cadence clock for a
 * PAID Apify pull. A null heartbeat reads as "never run", which is a reason to
 * run (initial population), so a repair that fired while the collector was
 * working re-armed the paid pull on every single boot — three paid runs inside
 * fifteen minutes — and no daily schedule could ever hold. It also reported a
 * collecting source as "not configured".
 *
 * The gate therefore asks the COLLECTOR's own predicate. Asking a single env
 * var instead is what caused the bug: the collector also runs on the shared
 * APIFY_TOKEN, so keying on the dedicated FACEBOOK_API_KEY declared a working
 * source unconfigured. `isFacebookOsintActive()` reads the environment at call
 * time, so a key added between boots takes effect immediately.
 */
export async function repairFacebookOsintHealthRow(
  database: HealthRepairDb = sharedDb as unknown as HealthRepairDb,
): Promise<void> {
  if (isFacebookOsintActive()) return;
  await database
    .update(sourcesTable)
    .set({
      status: "not_configured",
      errorMessage: "Integration not configured",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      failureReason: null,
    })
    .where(eq(sourcesTable.name, FACEBOOK_OSINT_HEALTH_NAME));
}
