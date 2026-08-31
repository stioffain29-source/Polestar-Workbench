import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { createIngestProcessRunner } from "../../artifacts/api-server/src/lib/ingestProcess";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.kills.push(signal);
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

describe("supervised ingest process", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not let a successor start until a timed-out hung worker has exited", async () => {
    const children: FakeChild[] = [];
    const runner = createIngestProcessRunner({
      forkWorker: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ChildProcess;
      },
      timeoutMs: 1_000,
      terminateGraceMs: 250,
      createRunId: () => `run-${children.length + 1}`,
    });

    const first = runner();
    expect(children).toHaveLength(1);
    children[0]!.emit("message", { type: "stage", stage: "hung test stage" });

    jest.advanceTimersByTime(1_000);
    expect(children[0]!.kills).toEqual(["SIGTERM"]);

    const blocked = await runner();
    expect(blocked).toEqual({ ran: false, reason: "locked" });
    expect(children).toHaveLength(1);

    jest.advanceTimersByTime(250);
    expect(children[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);

    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    children[0]!.finish(null, "SIGKILL");
    await expect(first).resolves.toEqual({
      ran: false,
      reason: "timed_out",
      runId: "run-1",
      lastStage: "hung test stage",
      termination: "sigkill",
    });

    const successor = runner();
    expect(children).toHaveLength(2);
    children[1]!.emit("message", {
      type: "result",
      runId: "run-2",
      result: {
        ran: true,
        startedAt: "2026-08-31T00:00:00.000Z",
        finishedAt: "2026-08-31T00:00:01.000Z",
        durationMs: 1_000,
      },
    });
    children[1]!.finish(0, null);

    await expect(successor).resolves.toMatchObject({
      ran: true,
      durationMs: 1_000,
      startedAt: new Date("2026-08-31T00:00:00.000Z"),
      finishedAt: new Date("2026-08-31T00:00:01.000Z"),
    });
  });

  it("reports cancellation only after the cancelled worker exits", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const runner = createIngestProcessRunner({
      forkWorker: () => child as unknown as ChildProcess,
      timeoutMs: 10_000,
      terminateGraceMs: 250,
      createRunId: () => "cancelled-run",
    });

    const running = runner({ signal: controller.signal });
    child.emit("message", { type: "stage", stage: "cancelled test stage" });
    controller.abort();
    expect(child.kills).toEqual(["SIGTERM"]);

    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    child.finish(null, "SIGTERM");
    await expect(running).resolves.toEqual({
      ran: false,
      reason: "cancelled",
      runId: "cancelled-run",
      lastStage: "cancelled test stage",
      termination: "sigterm",
    });
  });

  it("clears ownership after a worker fails to spawn", async () => {
    const children: FakeChild[] = [];
    const runner = createIngestProcessRunner({
      forkWorker: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ChildProcess;
      },
      timeoutMs: 10_000,
      terminateGraceMs: 250,
      createRunId: () => `spawn-${children.length + 1}`,
    });

    const failed = runner();
    children[0]!.emit("error", new Error("spawn failed"));
    await expect(failed).rejects.toThrow("spawn failed");

    const successor = runner();
    expect(children).toHaveLength(2);
    children[1]!.emit("message", {
      type: "result",
      runId: "spawn-2",
      result: {
        ran: true,
        startedAt: "2026-08-31T00:00:00.000Z",
        finishedAt: "2026-08-31T00:00:01.000Z",
        durationMs: 1_000,
      },
    });
    children[1]!.finish(0, null);
    await expect(successor).resolves.toMatchObject({ ran: true });
  });
});