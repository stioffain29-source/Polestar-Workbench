/**
 * Country-engine reprocess worker (child process).
 *
 * The rule-versioned reprocess (owner brief §35) re-runs the shared country
 * engine over EVERY configured country's 120-day incident window whenever
 * COUNTRY_ENGINE_RULE_VERSION is bumped. That work is CPU-bound and two of the
 * slugs exceed 50,000 source rows, so running it inside the API process pinned
 * the single Node event loop for minutes after every publish: the workbench
 * shell loaded, every API call queued behind the engine, and the app looked
 * dead until the loop came back. It therefore runs HERE, in a forked child
 * (same pattern as the ingest worker), leaving the server free to serve.
 *
 * Progress is recorded per slug in app_migration_markers, so an instance that
 * is restarted mid-run resumes rather than redoing finished countries. The
 * version-level marker is written only once every configured slug is done.
 *
 * Usage:
 *   node dist/countryEngineWorker.mjs               # every pending slug
 *   node dist/countryEngineWorker.mjs jakarta ...   # only the named slugs
 */
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  COUNTRY_ENGINE_RULE_VERSION,
  COUNTRY_ENGINE_CONFIGS,
} from "@workspace/country-engine/config";
import { runCountryEngine } from "./lib/countryEngine";
import { logger } from "./lib/logger";

export const COUNTRY_ENGINE_MARKER_KEY = `country_engine_reprocess_${COUNTRY_ENGINE_RULE_VERSION}`;

/** Hard ceiling on a single worker run. Indonesia (the slowest slug) takes
 *  ~3.5 minutes; anything past this is pathological, so the worker gives up
 *  rather than holding its slug lock and burning CPU forever. */
const WATCHDOG_MINUTES = Math.max(
  10,
  Number(process.env.COUNTRY_ENGINE_WATCHDOG_MINUTES ?? 60) || 60,
);

/**
 * Run `fn` while holding a session advisory lock for `slug`, or skip it.
 *
 * runCountryEngine persists by upserting every canonical event and then
 * DELETING the slug's rows that the run did not produce. Two runs of the same
 * slug against the same database therefore race: the slower one can finish
 * last and delete events the newer one just wrote. Boot forks, an operator's
 * manual run and the post-ingest runCountryEngineAll can all overlap, so the
 * lock — not luck — keeps one writer per slug.
 */
async function withSlugLock<T>(
  slug: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const client = await pool.connect();
  let clientBroken = false;
  let locked = false;
  client.on("error", () => {
    clientBroken = true;
  });
  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [`country-engine:${slug}`],
    );
    locked = res.rows[0]?.locked === true;
    if (!locked) return { ran: false };
    return { ran: true, value: await fn() };
  } finally {
    if (locked && !clientBroken) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [`country-engine:${slug}`],
        );
      } catch {
        clientBroken = true;
      }
    }
    client.release(clientBroken ? true : undefined);
  }
}

async function main(): Promise<number> {
  const allSlugs = Object.keys(COUNTRY_ENGINE_CONFIGS);
  const requested = process.argv.slice(2).filter(Boolean);
  const unknown = requested.filter((s) => !allSlugs.includes(s));
  if (unknown.length > 0) {
    logger.error(
      { unknown, known: allSlugs },
      "countryEngineWorker: unknown country slug(s) requested",
    );
    return 2;
  }
  const slugs = requested.length > 0 ? requested : allSlugs;
  const markerKey = COUNTRY_ENGINE_MARKER_KEY;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_migration_markers (
      key text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const failed: string[] = [];
  for (const slug of slugs) {
    const slugMarker = `${markerKey}:${slug}`;
    const done = await db.execute(sql`
      SELECT 1 FROM app_migration_markers WHERE key = ${slugMarker}
    `);
    if ((done.rowCount ?? 0) > 0) {
      logger.info({ slug, marker: markerKey }, "countryEngineWorker: slug already reprocessed");
      continue;
    }
    const startedAt = Date.now();
    try {
      const outcome = await withSlugLock(slug, async () => {
        await runCountryEngine(slug);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${slugMarker})
          ON CONFLICT (key) DO NOTHING
        `);
      });
      if (!outcome.ran) {
        // Another process holds this slug. Leaving the marker unwritten is
        // correct: whoever holds the lock writes it when it finishes, and if
        // that run dies the next boot picks the slug up again.
        logger.warn(
          { slug, marker: markerKey },
          "countryEngineWorker: slug already running elsewhere — skipped",
        );
        continue;
      }
      logger.info(
        { slug, marker: markerKey, durationMs: Date.now() - startedAt },
        "countryEngineWorker: slug reprocessed",
      );
    } catch (err) {
      // One country's failure must not stop the rest; its marker stays
      // unwritten so the next boot retries just that country.
      failed.push(slug);
      logger.error(
        { err, slug, marker: markerKey },
        "countryEngineWorker: slug failed (continuing)",
      );
    }
  }

  // The version-level marker gates the whole block on boot, so it may only be
  // written once EVERY configured country is done — including countries this
  // run was not asked to process.
  const doneRows = await db.execute(sql`
    SELECT key FROM app_migration_markers WHERE key LIKE ${`${markerKey}:%`}
  `);
  const doneSlugs = new Set(
    (doneRows.rows as Array<{ key: string }>).map((r) => r.key.slice(markerKey.length + 1)),
  );
  const remaining = allSlugs.filter((s) => !doneSlugs.has(s));
  if (remaining.length === 0) {
    await db.execute(sql`
      INSERT INTO app_migration_markers (key) VALUES (${markerKey})
      ON CONFLICT (key) DO NOTHING
    `);
    logger.info({ marker: markerKey }, "countryEngineWorker: reprocess complete for every country");
  } else {
    logger.warn(
      { marker: markerKey, remaining },
      "countryEngineWorker: reprocess incomplete — version marker not written; retries next boot",
    );
  }

  return failed.length > 0 ? 1 : 0;
}

// The parent API process going away (deploy, crash, restart) must take this
// worker with it: a survivor would keep running the OLD binary's rules against
// the database while its replacement starts on the new ones. Markers are
// per-slug, so the successor resumes from wherever this run stopped.
process.on("disconnect", () => {
  logger.warn(
    { marker: COUNTRY_ENGINE_MARKER_KEY },
    "countryEngineWorker: parent process disconnected — exiting (resumes on next boot)",
  );
  process.exit(0);
});

// unref'd so it never keeps a finished run alive, but it still fires while the
// process is working.
const watchdog = setTimeout(
  () => {
    logger.error(
      { marker: COUNTRY_ENGINE_MARKER_KEY, watchdogMinutes: WATCHDOG_MINUTES },
      "countryEngineWorker: watchdog expired — exiting (resumes on next boot)",
    );
    process.exit(1);
  },
  WATCHDOG_MINUTES * 60_000,
);
watchdog.unref();

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    logger.error({ err }, "countryEngineWorker: fatal error");
    process.exit(1);
  },
);
