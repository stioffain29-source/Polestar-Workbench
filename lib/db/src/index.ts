import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// keepAlive + timeouts are the guard against the recurring ingest hang: Neon
// can kill a backend mid-run ("terminating connection due to administrator
// command"); without TCP keepalive a query issued on that half-dead socket
// never settles, so the awaiting stage hangs forever. query_timeout makes any
// single query reject after 5 minutes (generous — chunked backfills stay well
// under it) so the caller's try/catch can log and move on instead of wedging.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Protocol-labelled connections let the database reject writes from a
  // pre-fence binary during a rolling deployment. Ingest workers override this
  // with polestar-ingest:<runId>; all current API/CLI processes use app:v2.
  application_name:
    process.env.PGAPPNAME?.trim() || `polestar-app:v2:${process.pid}`,
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});

// A pooled connection can be dropped by the server at any time — idle timeout,
// failover, or "terminating connection due to administrator command" during a
// long-running job (e.g. the boot ingest catch-up). Without an 'error' listener
// the pg Client re-emits that as an uncaught 'error' event, which crashes the
// whole Node process. Handling it here lets the pool discard the dead client
// and keep serving. console.error is the deliberate last-resort sink: lib/db is
// shared by the server and the CLI scrapers and must not depend on either's logger.
pool.on("error", (err) => {
  console.error(
    "[db] idle pool client error (connection dropped, discarded):",
    err instanceof Error ? err.message : err,
  );
});

export const db = drizzle(pool, { schema });

export * from "./schema";
