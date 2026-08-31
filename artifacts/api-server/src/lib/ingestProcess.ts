import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { IngestRunResult } from "./ingestRunner";

type WorkerMessage =
  | { type: "stage"; stage: string }
  | { type: "result"; runId: string; result: IngestRunResult }
  | { type: "error"; runId: string; error: string };

export type IngestProcessResult =
  | IngestRunResult
  | {
      ran: false;
      reason: "timed_out" | "cancelled";
      runId: string;
      lastStage: string;
      termination: "sigterm" | "sigkill";
    };

type ForkWorker = (runId: string) => ChildProcess;

export type IngestProcessRunnerOptions = {
  forkWorker: ForkWorker;
  timeoutMs: number;
  terminateGraceMs: number;
  createRunId: () => string;
};

function reviveResult(result: IngestRunResult): IngestRunResult {
  if (!result.ran) return result;
  return {
    ...result,
    startedAt: new Date(result.startedAt),
    finishedAt: new Date(result.finishedAt),
  };
}

export function createIngestProcessRunner(options: IngestProcessRunnerOptions) {
  let activeChild: ChildProcess | null = null;

  return async function runIngestProcess(input?: {
    signal?: AbortSignal;
  }): Promise<IngestProcessResult> {
    if (activeChild) return { ran: false, reason: "locked" };

    const runId = options.createRunId();
    const child = options.forkWorker(runId);
    activeChild = child;
    let lastStage = "(worker starting)";
    let terminalReason: "timed_out" | "cancelled" | null = null;
    let termination: "sigterm" | "sigkill" = "sigterm";
    let resultMessage: IngestRunResult | null = null;
    let errorMessage: string | null = null;
    let spawned = false;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    return await new Promise<IngestProcessResult>((resolve, reject) => {
      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        input?.signal?.removeEventListener("abort", onAbort);
        activeChild = null;
      };

      const requestTermination = (reason: "timed_out" | "cancelled") => {
        if (terminalReason) return;
        terminalReason = reason;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            termination = "sigkill";
            child.kill("SIGKILL");
          }
        }, options.terminateGraceMs);
        killTimer.unref?.();
      };

      const onAbort = () => requestTermination("cancelled");
      input?.signal?.addEventListener("abort", onAbort, { once: true });
      if (input?.signal?.aborted) onAbort();

      timeoutTimer = setTimeout(
        () => requestTermination("timed_out"),
        options.timeoutMs,
      );
      timeoutTimer.unref?.();

      child.on("message", (raw: unknown) => {
        const message = raw as WorkerMessage;
        if (message.type === "stage") {
          lastStage = message.stage;
        } else if (message.type === "result" && message.runId === runId) {
          resultMessage = reviveResult(message.result);
        } else if (message.type === "error" && message.runId === runId) {
          errorMessage = message.error;
        }
      });

      child.once("spawn", () => {
        spawned = true;
      });

      child.once("error", (err) => {
        errorMessage = err.stack ?? err.message;
        if (!spawned && !settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });

      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (terminalReason) {
          resolve({
            ran: false,
            reason: terminalReason,
            runId,
            lastStage,
            termination,
          });
          return;
        }
        if (resultMessage) {
          resolve(resultMessage);
          return;
        }
        reject(
          new Error(
            errorMessage ??
              `ingest worker ${runId} exited without a result (code=${code}, signal=${signal ?? "none"}, lastStage=${lastStage})`,
          ),
        );
      });
    });
  };
}

const timeoutMinutes =
  Math.max(10, Number(process.env.INGEST_WATCHDOG_MINUTES ?? 90) || 90);
const workerPath = path.resolve(
  path.dirname(process.argv[1] ?? process.cwd()),
  "ingestWorker.mjs",
);

export const runIngestProcess = createIngestProcessRunner({
  forkWorker: (runId) =>
    fork(workerPath, [runId], {
      execArgv: ["--enable-source-maps"],
      env: { ...process.env, PGAPPNAME: `polestar-ingest:${runId}` },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }),
  timeoutMs: timeoutMinutes * 60_000,
  terminateGraceMs: 5_000,
  createRunId: randomUUID,
});