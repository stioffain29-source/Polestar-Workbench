import { pool } from "@workspace/db";
import { runIngestOnce } from "./lib/ingestRunner";

type WorkerMessage =
  | { type: "result"; runId: string; result: Awaited<ReturnType<typeof runIngestOnce>> }
  | { type: "error"; runId: string; error: string };

const runId = process.argv[2] ?? "unknown";

function send(message: WorkerMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function") {
      reject(new Error("ingest worker was started without an IPC channel"));
      return;
    }
    process.send(message, (err) => (err ? reject(err) : resolve()));
  });
}

async function main(): Promise<void> {
  try {
    const result = await runIngestOnce();
    await send({ type: "result", runId, result });
  } catch (err) {
    const error = err instanceof Error ? err.stack ?? err.message : String(err);
    await send({ type: "error", runId, error });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error("[ingest-worker] fatal error", err);
  process.exitCode = 1;
});