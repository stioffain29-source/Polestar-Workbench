import app from "./app";
import { logger } from "./lib/logger";
import { runDataMigrations } from "./lib/migrations";
import { startIngestScheduler } from "./lib/ingestScheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Run data migrations (which seed the scraper source feeds) BEFORE starting
  // the ingest scheduler, so the boot/forced ingest can never fire against a
  // sources table that is still missing a newly seeded feed. The server is
  // already listening, so startup health probes are answered during this work.
  void (async () => {
    try {
      await runDataMigrations();
    } catch (migrationErr) {
      logger.error({ err: migrationErr }, "data migrations failed");
    }
    startIngestScheduler();
  })();
});
