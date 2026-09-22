import {
  getRegionalReportJob,
  startRegionalReport,
  type RegionalReportJob,
  type RegionalReportJobInput,
} from "@workspace/api-client-react";
import {
  RegionalCreationError,
  waitForRegionalReport,
} from "../regionalReportCreation";

jest.mock("@workspace/api-client-react", () => ({
  getRegionalReportJob: jest.fn(),
  startRegionalReport: jest.fn(),
}));

const mockedGetRegionalReportJob = jest.mocked(getRegionalReportJob);
const mockedStartRegionalReport = jest.mocked(startRegionalReport);

const input: RegionalReportJobInput = {
  requestId: "0f4cb980-3037-4c0d-b8e0-757e13d42b2a",
  topic: "apac_weekly",
  issueDate: "2026-09-18",
};

function job(
  overrides: Partial<RegionalReportJob> = {},
): RegionalReportJob {
  return {
    id: input.requestId,
    topic: input.topic,
    issueDate: input.issueDate,
    status: "completed",
    stage: "completed",
    reportId: 42,
    error: null,
    ...overrides,
  };
}

function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function accessResponse(body: unknown, status = 200): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

function options(
  controller = new AbortController(),
  onReconnecting = jest.fn(),
) {
  return {
    signal: controller.signal,
    onProgress: jest.fn(),
    onReconnecting,
    pollMs: 0,
    retryMs: 0,
    requestTimeoutMs: 50,
  };
}

function expectRequestTransport(requestOptions: RequestInit | undefined): void {
  expect(requestOptions).toEqual(expect.objectContaining({
    credentials: "include",
    redirect: "follow",
  }));
  expect(requestOptions?.redirect).not.toBe("manual");
}

describe("regional report session recovery", () => {
  const originalFetch = globalThis.fetch;
  const mockedFetch = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();

  beforeAll(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: mockedFetch,
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  beforeEach(() => {
    mockedGetRegionalReportJob.mockReset();
    mockedStartRegionalReport.mockReset();
    mockedFetch.mockReset();
  });

  it("retries status 0 with the same GET identity and browser transport", async () => {
    mockedGetRegionalReportJob
      .mockRejectedValueOnce(statusError(0))
      .mockResolvedValueOnce(job());

    await expect(waitForRegionalReport(input, options())).resolves.toBe(42);

    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(2);
    for (const [requestId, requestOptions] of mockedGetRegionalReportJob.mock.calls) {
      expect(requestId).toBe(input.requestId);
      expectRequestTransport(requestOptions);
    }
    expect(mockedStartRegionalReport).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "probes access after %s and resumes an authenticated allowed request",
    async (status) => {
      mockedGetRegionalReportJob
        .mockRejectedValueOnce(statusError(status))
        .mockResolvedValueOnce(job());
      mockedFetch.mockResolvedValueOnce(
        accessResponse({ authenticated: true, allowed: true }),
      );

      await expect(waitForRegionalReport(input, options())).resolves.toBe(42);

      expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(2);
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/access",
        expect.objectContaining({
          credentials: "include",
          redirect: "follow",
        }),
      );
      const accessOptions = mockedFetch.mock.calls[0]?.[1];
      expect(accessOptions?.redirect).not.toBe("manual");
    },
  );

  it("classifies an unauthenticated access probe as a session error", async () => {
    mockedGetRegionalReportJob.mockRejectedValueOnce(statusError(401));
    mockedFetch.mockResolvedValueOnce(
      accessResponse({ authenticated: false, allowed: false }),
    );

    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      name: "RegionalCreationError",
      kind: "session",
    } satisfies Partial<RegionalCreationError>);
    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(1);
    expect(mockedStartRegionalReport).not.toHaveBeenCalled();
  });

  it("classifies authenticated denial as access without repeating POST", async () => {
    mockedGetRegionalReportJob.mockRejectedValueOnce(statusError(404));
    mockedStartRegionalReport.mockRejectedValueOnce(statusError(403));
    mockedFetch.mockResolvedValueOnce(
      accessResponse({ authenticated: true, allowed: false }),
    );

    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      name: "RegionalCreationError",
      kind: "access",
    });
    expect(mockedStartRegionalReport).toHaveBeenCalledTimes(1);
    expect(mockedStartRegionalReport.mock.calls[0]?.[0]).toBe(input);
  });

  it.each([
    ["failed", () => Promise.reject(new TypeError("probe disconnected"))],
    ["non-JSON", () => Promise.resolve(accessResponse("<!doctype html>"))],
  ])(
    "bounds reconnect attempts when the access probe is %s and never reports session",
    async (_label, probe) => {
      mockedGetRegionalReportJob.mockRejectedValue(statusError(401));
      mockedFetch.mockImplementation(probe);

      const error = await waitForRegionalReport(input, options()).catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({
        name: "RegionalCreationError",
        kind: "connection",
      });
      expect(error).not.toMatchObject({ kind: "session" });
      expect(mockedGetRegionalReportJob.mock.calls.length).toBeGreaterThan(1);
      expect(mockedGetRegionalReportJob.mock.calls.length).toBeLessThanOrEqual(5);
      expect(mockedFetch).toHaveBeenCalledTimes(
        mockedGetRegionalReportJob.mock.calls.length,
      );
      expect(mockedStartRegionalReport).not.toHaveBeenCalled();
    },
  );

  it("bounds reconnects for an HTML status response without duplicating the job", async () => {
    const htmlResponseError = Object.assign(
      new Error("Failed to parse response as JSON"),
      {
        name: "ResponseParseError",
        status: 200,
        rawBody: "<!doctype html><title>Sign in</title>",
      },
    );
    mockedGetRegionalReportJob.mockRejectedValue(htmlResponseError);

    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      name: "RegionalCreationError",
      kind: "connection",
    });
    expect(mockedGetRegionalReportJob.mock.calls.length).toBeGreaterThan(1);
    expect(mockedGetRegionalReportJob.mock.calls.length).toBeLessThanOrEqual(5);
    expect(mockedStartRegionalReport).not.toHaveBeenCalled();
  });

  it("rejects a structurally wrong job identity as a report error", async () => {
    mockedGetRegionalReportJob.mockResolvedValueOnce(job({
      id: "d8ff9263-c845-40df-805b-508a91d874d0",
    }));

    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      name: "RegionalCreationError",
      kind: "report",
    });
    expect(mockedStartRegionalReport).not.toHaveBeenCalled();
  });

  it("retries a lost POST response with the exact same request identity", async () => {
    mockedGetRegionalReportJob.mockRejectedValueOnce(statusError(404));
    mockedStartRegionalReport
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(job());

    await expect(waitForRegionalReport(input, options())).resolves.toBe(42);

    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(1);
    expect(mockedStartRegionalReport).toHaveBeenCalledTimes(2);
    for (const [postInput, requestOptions] of mockedStartRegionalReport.mock.calls) {
      expect(postInput).toBe(input);
      expect(postInput.requestId).toBe(input.requestId);
      expectRequestTransport(requestOptions);
    }
  });

  it("surfaces the failed job's real error as a report error", async () => {
    mockedGetRegionalReportJob.mockResolvedValueOnce(job({
      status: "failed",
      stage: "failed",
      reportId: null,
      error: "Source collection exceeded the provider deadline",
    }));

    await expect(waitForRegionalReport(input, options())).rejects.toMatchObject({
      name: "RegionalCreationError",
      kind: "report",
      message: "Source collection exceeded the provider deadline",
    });
  });

  it("rejects AbortError when aborted during a retry", async () => {
    const controller = new AbortController();
    const onReconnecting = jest.fn((reconnecting: boolean) => {
      if (reconnecting) controller.abort();
    });
    mockedGetRegionalReportJob.mockRejectedValueOnce(
      new TypeError("connection dropped"),
    );

    await expect(
      waitForRegionalReport(input, options(controller, onReconnecting)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(1);
    expect(mockedStartRegionalReport).not.toHaveBeenCalled();
  });
});