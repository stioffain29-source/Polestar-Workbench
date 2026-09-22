import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { db } from "@workspace/db";

jest.mock("../../artifacts/api-server/src/lib/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

import {
  launchRegionalReportJob,
  regionalReportWorkerAppName,
  startRegionalReportJobRecovery,
} from "../../artifacts/api-server/src/lib/regionalReportJobService";
import { installRegionalReportWorkerLifetime } from "../../artifacts/api-server/src/lib/regionalReportWorkerLifetime";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = jest.fn((_signal?: NodeJS.Signals | number) => true);
}

describe("regional report worker process boundary", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(db, "update").mockImplementation(() => {
      const chain: Record<string, unknown> = {
        set: () => chain,
        where: () => chain,
        returning: () => Promise.resolve([{ id: "reserved" }]),
      };
      return chain as never;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("uses the explicitly allowed v2 app-writer protocol without impersonating ingest", () => {
    const label = regionalReportWorkerAppName(
      "3f9cc756-bfd1-4c37-8b8c-cdfae95b5737",
      "30537ddd-55cb-4d87-8da8-f8fca4436d1b",
    );
    expect(label).toMatch(/^polestar-app:v2:regional-report:/);
    expect(label).not.toMatch(/^polestar-ingest:/);
    expect(Buffer.byteLength(label)).toBeLessThanOrEqual(63);
  });

  // Recovery previously ran only after data migrations succeeded, and the
  // periodic timer was installed at the end of a successful pass. One failing
  // pass therefore left the product with no reclaim at all, so jobs abandoned
  // by a deploy stayed "running" through every later restart.
  it("keeps the periodic reclaim installed when the first recovery pass fails", async () => {
    jest.spyOn(db, "update").mockImplementation(() => {
      throw new Error("relation \"regional_report_jobs\" does not exist");
    });
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    startRegionalReportJobRecovery();
    await Promise.resolve();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it("terminates the actual isolated worker with SIGTERM then SIGKILL on timeout", async () => {
    const child = new FakeChild();
    await launchRegionalReportJob("3f9cc756-bfd1-4c37-8b8c-cdfae95b5737", {
      forkWorker: () => child as unknown as ChildProcess,
      timeout: 25,
      grace: 10,
    });

    jest.advanceTimersByTime(25);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    jest.advanceTimersByTime(10);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.signalCode = "SIGKILL";
    child.emit("exit", null, "SIGKILL");
  });

  it("hard-stops an orphan on its own deadline or parent disconnect", () => {
    const processLike = new EventEmitter();
    const terminate = jest.fn();
    const clear = installRegionalReportWorkerLifetime({
      timeoutMs: 50,
      onTerminate: terminate,
      processLike,
    });
    jest.advanceTimersByTime(50);
    expect(terminate).toHaveBeenCalledWith("deadline");
    processLike.emit("disconnect");
    expect(terminate).toHaveBeenCalledTimes(1);
    clear();

    const disconnected = jest.fn();
    installRegionalReportWorkerLifetime({
      timeoutMs: 50,
      onTerminate: disconnected,
      processLike,
    });
    processLike.emit("disconnect");
    expect(disconnected).toHaveBeenCalledWith("parent_disconnected");
  });
});