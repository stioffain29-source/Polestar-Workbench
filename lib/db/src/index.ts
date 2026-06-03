import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
