/** @jest-environment jsdom */
import {
  getRegionalReportJob,
  startRegionalReport,
  type RegionalReportJob,
  type RegionalReportJobInput,
} from "@workspace/api-client-react";
import {
  regionalCreationInput,
  waitForRegionalReport,
} from "../../artifacts/workbench/src/lib/regionalReportCreation";

jest.mock("@workspace/api-client-react", () => ({
  getRegionalReportJob: jest.fn(),
  startRegionalReport: jest.fn(),
}));

const getJob = jest.mocked(getRegionalReportJob);
const startJob = jest.mocked(startRegionalReport);
const input: RegionalReportJobInput = {
  requestId: "24c24b69-36a7-4b91-94da-df4e66b25839",
  topic: "apac_weekly",
  issueDate: "2026-09-21",
};
const queued: RegionalReportJob = {
  id: input.requestId,
  topic: input.topic,
  issueDate: input.issueDate,
  status: "queued",
  stage: "queued",
  reportId: null,
  error: null,
};
const completed: RegionalReportJob = { ...queued, status: "completed", stage: "completed", reportId: 164 };
const failed: RegionalReportJob = { ...queued, status: "failed", stage: "failed", error: "Regional coverage is incomplete." };
const missing = { status: 404, data: { error: "Job not found" } };
const originalFetch = globalThis.fetch;
const accessFetch = jest.fn();

function options() {
  return {
    signal: new AbortController().signal,
    pollMs: 0,
    retryMs: 0,
    requestTimeoutMs: 100,
    onProgress: jest.fn(),
    onReconnecting: jest.fn(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: accessFetch,
  });
  window.history.replaceState(null, "", "/regional-reports/create/apac_weekly");
});

afterAll(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

describe("regional report creation transport", () => {
  test("uses short start/status requests and returns the saved report after real stages", async () => {
    getJob.mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ ...queued, status: "running", stage: "collecting" })
      .mockResolvedValueOnce({ ...queued, status: "running", stage: "building" })
      .mockResolvedValueOnce({ ...queued, status: "running", stage: "saving" })
      .mockResolvedValueOnce(completed);
    startJob.mockResolvedValueOnce(queued);
    const callbacks = options();
    await expect(waitForRegionalReport(input, callbacks)).resolves.toBe(164);
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(startJob).toHaveBeenCalledWith(input, expect.objectContaining({
      credentials: "include",
      redirect: "follow",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }));
    expect(callbacks.onProgress.mock.calls.map(([job]) => job.stage))
      .toEqual(["queued", "collecting", "building", "saving", "completed"]);
  });

  test("a lost POST response retries the same identity rather than another draft", async () => {
    getJob.mockRejectedValueOnce(missing);
    startJob.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(completed);
    const callbacks = options();
    await expect(waitForRegionalReport(input, callbacks)).resolves.toBe(164);
    expect(startJob.mock.calls.map(([body]) => body.requestId)).toEqual([input.requestId, input.requestId]);
    expect(callbacks.onReconnecting).toHaveBeenCalledWith(true);
  });

  test("reload recovers a completed job without another POST", async () => {
    getJob.mockResolvedValueOnce(completed);
    await expect(waitForRegionalReport(input, options())).resolves.toBe(164);
    expect(startJob).not.toHaveBeenCalled();
  });

  test("a polling disconnection recovers without restarting server work", async () => {
    getJob.mockResolvedValueOnce({ ...queued, status: "running", stage: "building" })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(completed);
    const callbacks = options();
    await expect(waitForRegionalReport(input, callbacks)).resolves.toBe(164);
    expect(startJob).not.toHaveBeenCalled();
    expect(callbacks.onReconnecting).toHaveBeenCalledWith(true);
  });

  test("does not silently retry actual report validation failures", async () => {
    getJob.mockResolvedValueOnce(failed);
    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      kind: "report",
      message: failed.error,
    });
    expect(startJob).not.toHaveBeenCalled();
  });

  test("explicit retry resumes the failed job with its original identity", async () => {
    getJob.mockResolvedValueOnce(failed);
    startJob.mockResolvedValueOnce(completed);
    await expect(waitForRegionalReport(input, { ...options(), retryFailed: true })).resolves.toBe(164);
    expect(startJob).toHaveBeenCalledWith(input, expect.any(Object));
  });

  test("a persistent network failure gives a reconnect action, not a false report failure", async () => {
    getJob.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      kind: "connection",
      message: expect.stringContaining("same request"),
    });
    expect(getJob).toHaveBeenCalledTimes(4);
    expect(startJob).not.toHaveBeenCalled();
  });

  test("bounds a hanging status call and does not leave polling stuck", async () => {
    getJob.mockImplementation((_id, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
    }));
    await expect(waitForRegionalReport(input, { ...options(), requestTimeoutMs: 2 })).rejects.toMatchObject({
      kind: "connection",
    });
    expect(getJob).toHaveBeenCalledTimes(4);
  });

  test("status 0 reconnects without claiming the session expired", async () => {
    getJob.mockRejectedValue({ status: 0 });
    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      kind: "connection",
    });
    expect(getJob).toHaveBeenCalledTimes(4);
    expect(accessFetch).not.toHaveBeenCalled();
    expect(startJob).not.toHaveBeenCalled();
  });

  test("a genuine 401 is a session error only after the access probe", async () => {
    getJob.mockRejectedValue({ status: 401 });
    accessFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json; charset=utf-8" },
      json: async () => ({ authenticated: false, allowed: false }),
    });
    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      kind: "session",
      message: expect.stringContaining("resume this report"),
    });
    expect(accessFetch).toHaveBeenCalledWith("/api/access", expect.objectContaining({
      credentials: "include",
      redirect: "follow",
      headers: { Accept: "application/json" },
    }));
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(startJob).not.toHaveBeenCalled();
  });

  test("an HTML status body reconnects without starting a duplicate job", async () => {
    getJob.mockResolvedValue("<!doctype html><title>Sign in</title>" as unknown as RegionalReportJob);
    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      kind: "connection",
    });
    expect(getJob).toHaveBeenCalledTimes(4);
    expect(startJob).not.toHaveBeenCalled();
  });

  test("leaving the page stops polling without sending a server cancellation", async () => {
    const controller = new AbortController();
    const callbacks = options();
    getJob.mockResolvedValueOnce(queued);
    callbacks.onProgress.mockImplementation(() => controller.abort());
    await expect(waitForRegionalReport(input, { ...callbacks, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(startJob).not.toHaveBeenCalled();
  });
});

describe("regional creation URL identity", () => {
  test("refresh preserves both request identity and original date", () => {
    const first = regionalCreationInput("apac_weekly", "2026-09-21");
    expect(window.location.search).toContain(first.requestId);
    expect(regionalCreationInput("apac_weekly", "2026-09-22")).toEqual(first);
  });

  test("a new explicit Create navigation is still a new report, even on the same day", () => {
    const first = regionalCreationInput("apac_weekly", "2026-09-21");
    window.history.replaceState(null, "", "/regional-reports/create/apac_weekly");
    const second = regionalCreationInput("apac_weekly", "2026-09-21");
    expect(second.requestId).not.toBe(first.requestId);
  });

  test("an invalid saved identity is not silently replaced with another request", () => {
    window.history.replaceState(null, "", "/regional-reports/create/apac_weekly?requestId=broken");
    expect(() => regionalCreationInput("apac_weekly", "2026-09-21")).toThrow("creation link is invalid");
  });
});