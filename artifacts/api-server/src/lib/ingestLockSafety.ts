type LockLossLogger = {
  error: (obj: unknown, message: string) => void;
};

type FatalExit = (code: number) => never;

/**
 * Losing the PostgreSQL session that owns the advisory lock is process-fatal.
 * PostgreSQL releases a session lock immediately on disconnect, while ingest
 * work may still have other pooled writes queued. Exiting is the only safe
 * synchronous fence: the supervisor waits for process exit before permitting a
 * local successor, and another instance cannot overlap a dead process.
 */
export function terminateAfterIngestLockLoss(
  err: unknown,
  logger: LockLossLogger,
  exit: FatalExit = process.exit,
): never {
  logger.error(
    { err },
    "ingest advisory-lock session lost; terminating process to fence all remaining writes",
  );
  return exit(1);
}