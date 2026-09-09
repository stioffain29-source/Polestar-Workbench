import app from "./app";
import { loadDevEnv } from "./lib/loadDevEnv.js";
import { logger } from "./lib/logger";
import { runDataMigrations } from "./lib/migrations";
import { startIngestScheduler } from "./lib/ingestScheduler";
import { convergeFlashpointValidity } from "./lib/flashpointValidityConvergence";

loadDevEnv();

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

app.listen(port, "0.0.0.0", (err) => {
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
      logger.error(
        { err: migrationErr },
        "data migrations failed; ingest scheduler not started",
      );
      return;
    }
    // Converge the newest semantic rows before launching the much larger
    // multi-topic ingest. This prevents a semantic-version publish from leaving
    // the fail-closed 24-hour map empty while the full ingest runs.
    try {
      await convergeFlashpointValidity(20);
    } catch (validityErr) {
      logger.error(
        { err: validityErr },
        "initial flashpoint semantic convergence failed",
      );
    }
    startIngestScheduler();
    // Continue through the current report window in the background. The first
    // 20 newest rows above restore recent map coverage as quickly as possible.
    void convergeFlashpointValidity(400).then(
      (result) => logger.info(result, "flashpoint semantic convergence finished"),
      (err) => logger.error({ err }, "flashpoint semantic convergence failed"),
    );
  })();
});
