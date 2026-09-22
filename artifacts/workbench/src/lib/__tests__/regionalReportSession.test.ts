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
    "keeps checking after more than four %s access probes and never reports session",
    async (_label, probe) => {
      const controller = new AbortController();
      mockedGetRegionalReportJob.mockImplementation(async () => {
        if (mockedGetRegionalReportJob.mock.calls.length > 5) {
          controller.abort();
        }
        throw statusError(401);
      });
      mockedFetch.mockImplementation(probe);

      const error = await waitForRegionalReport(input, options(controller)).catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({ name: "AbortError" });
      expect(error).not.toMatchObject({ kind: "session" });
      expect(mockedGetRegionalReportJob.mock.calls.length).toBeGreaterThan(4);
      // The final GET aborts the outer operation before it can launch a probe.
      expect(mockedFetch).toHaveBeenCalledTimes(
        mockedGetRegionalReportJob.mock.calls.length - 1,
      );
      expect(mockedStartRegionalReport).not.toHaveBeenCalled();
    },
  );

  it("recovers after more than four HTML status responses without duplicating the job", async () => {
    const htmlResponseError = Object.assign(
      new Error("Failed to parse response as JSON"),
      {
        name: "ResponseParseError",
        status: 200,
        rawBody: "<!doctype html><title>Sign in</title>",
      },
    );
    mockedGetRegionalReportJob
      .mockRejectedValueOnce(htmlResponseError)
      .mockRejectedValueOnce(htmlResponseError)
      .mockRejectedValueOnce(htmlResponseError)
      .mockRejectedValueOnce(htmlResponseError)
      .mockRejectedValueOnce(htmlResponseError)
      .mockResolvedValueOnce(job());

    await expect(waitForRegionalReport(input, options())).resolves.toBe(42);
    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(6);
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

  it("reconciles GET after a lost POST response instead of submitting again", async () => {
    mockedGetRegionalReportJob
      .mockRejectedValueOnce(statusError(404))
      .mockResolvedValueOnce(job());
    mockedStartRegionalReport.mockRejectedValueOnce(new TypeError("response lost"));

    await expect(waitForRegionalReport(input, options())).resolves.toBe(42);

    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(2);
    expect(mockedStartRegionalReport).toHaveBeenCalledTimes(1);
    for (const [postInput, requestOptions] of mockedStartRegionalReport.mock.calls) {
      expect(postInput).toBe(input);
      expect(postInput.requestId).toBe(input.requestId);
      expectRequestTransport(requestOptions);
    }
  });

  it("does not POST again when a lost explicit retry response reconciles to failed", async () => {
    mockedGetRegionalReportJob
      .mockResolvedValueOnce(job({
        status: "failed",
        stage: "failed",
        reportId: null,
        error: "First attempt failed",
      }))
      .mockResolvedValueOnce(job({
        status: "failed",
        stage: "failed",
        reportId: null,
        error: "Retry also failed",
      }));
    mockedStartRegionalReport.mockRejectedValueOnce(new TypeError("response lost"));

    await expect(waitForRegionalReport(input, {
      ...options(),
      retryFailed: true,
    })).rejects.toMatchObject({
      kind: "report",
      message: "Retry also failed",
    });
    expect(mockedGetRegionalReportJob).toHaveBeenCalledTimes(2);
    expect(mockedStartRegionalReport).toHaveBeenCalledTimes(1);
  });

  it("consumes explicit retry once and does not restart after running becomes failed", async () => {
    mockedGetRegionalReportJob
      .mockResolvedValueOnce(job({
        status: "failed",
        stage: "failed",
        reportId: null,
        error: "First attempt failed",
      }))
      .mockResolvedValueOnce(job({
        status: "failed",
        stage: "failed",
        reportId: null,
        error: "Retry failed validation",
      }));
    mockedStartRegionalReport.mockResolvedValueOnce(job({
      status: "running",
      stage: "building",
      reportId: null,
    }));

    await expect(waitForRegionalReport(input, {
      ...options(),
      retryFailed: true,
    })).rejects.toMatchObject({
      kind: "report",
      message: "Retry failed validation",
    });
    expect(mockedStartRegionalReport).toHaveBeenCalledTimes(1);
  });

  it("keeps polling a healthy running job beyond ten minutes", async () => {
    const now = jest.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10 * 60_000 + 1);
    mockedGetRegionalReportJob
      .mockResolvedValueOnce(job({
        status: "running",
        stage: "building",
        reportId: null,
      }))
      .mockResolvedValueOnce(job());

    try {
      await expect(waitForRegionalReport(input, options())).resolves.toBe(42);
    } finally {
      now.mockRestore();
    }
    expect(mockedStartRegionalReport).not.toHaveBeenCalled();
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