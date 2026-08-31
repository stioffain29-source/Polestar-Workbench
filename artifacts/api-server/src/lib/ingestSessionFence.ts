const INGEST_APPLICATION_PREFIX = "polestar-ingest:";

type QueryResult<Row> = { rows: Row[] };
type FenceClient = {
  query: <Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>;
};

type Sleep = (ms: number) => Promise<void>;

const sleep: Sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

export async function verifyIngestWriteFence(
  client: FenceClient,
): Promise<void> {
  const verification = await client.query<{
    fence_table: boolean;
    fence_function: boolean;
    missing_tables: string[];
  }>(
    `SELECT
       to_regclass('public.ingest_run_fence') IS NOT NULL AS fence_table,
       to_regprocedure('public.enforce_ingest_run_fence()') IS NOT NULL AS fence_function,
       ARRAY(
         SELECT format('%I.%I', n.nspname, c.relname)
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_trigger t
             ON t.tgrelid = c.oid
            AND t.tgname = 'ingest_run_fence_guard'
            AND NOT t.tgisinternal
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
            AND c.relname <> 'ingest_run_fence'
            AND NOT c.relispartition
            AND t.oid IS NULL
          ORDER BY 1
       ) AS missing_tables`,
  );
  const row = verification.rows[0];
  if (
    !row?.fence_table ||
    !row.fence_function ||
    row.missing_tables.length > 0
  ) {
    throw new Error(
      `ingest write fence is incomplete (table=${Boolean(row?.fence_table)}, function=${Boolean(row?.fence_function)}, missing=${row?.missing_tables.join(",") || "none"})`,
    );
  }
}

/**
 * Fence a successor worker from writes already submitted by an older worker.
 *
 * A killed process closes its sockets, but PostgreSQL may briefly keep a query
 * from another pooled connection alive. The successor holds the global
 * advisory lock while it terminates every older, uniquely-labelled ingest
 * session and waits until pg_stat_activity confirms they are all gone. Only
 * then may the new run execute its first stage.
 */
export async function fencePriorIngestSessions(
  client: FenceClient,
  wait: Sleep = sleep,
): Promise<number> {
  await verifyIngestWriteFence(client);
  const current = await client.query<{
    application_name: string;
    backend_pid: string;
  }>(
    `SELECT current_setting('application_name') AS application_name,
            pg_backend_pid()::text AS backend_pid`,
  );
  const applicationName = current.rows[0]?.application_name ?? "";
  const backendPid = current.rows[0]?.backend_pid ?? "unknown";
  const workerRunId = applicationName.startsWith(INGEST_APPLICATION_PREFIX)
    ? applicationName.slice(INGEST_APPLICATION_PREFIX.length)
    : `api:${backendPid}`;

  // Advancing this row is the correctness fence. Every worker-originated table
  // mutation takes a FOR SHARE lock on this row inside its own transaction.
  // This update therefore waits for already-started old writes to finish; after
  // it commits, any newly submitted stale-worker write is rejected by trigger.
  await client.query(
    `INSERT INTO ingest_run_fence (singleton, active_run_id, updated_at)
     VALUES (true, $1, now())
     ON CONFLICT (singleton) DO UPDATE
       SET active_run_id = EXCLUDED.active_run_id,
           updated_at = EXCLUDED.updated_at`,
    [workerRunId],
  );

  const terminated = await client.query<{ pid: number; terminated: boolean }>(
    `SELECT pid, pg_terminate_backend(pid) AS terminated
       FROM pg_stat_activity
      WHERE application_name LIKE $1
        AND ($2 = '' OR application_name <> $2)
        AND pid <> pg_backend_pid()`,
    [`${INGEST_APPLICATION_PREFIX}%`, applicationName],
  );

  while (true) {
    const remaining = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM pg_stat_activity
        WHERE application_name LIKE $1
          AND ($2 = '' OR application_name <> $2)
          AND pid <> pg_backend_pid()`,
      [`${INGEST_APPLICATION_PREFIX}%`, applicationName],
    );
    if (Number(remaining.rows[0]?.count ?? 0) === 0) {
      return terminated.rows.length;
    }
    await wait(50);
  }
}