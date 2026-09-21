import {
  getRegionalReportJob,
  startRegionalReport,
  type RegionalReportJob,
  type RegionalReportJobInput,
} from "@workspace/api-client-react";

export type RegionalCreationErrorKind = "connection" | "session" | "report";

export class RegionalCreationError extends Error {
  constructor(message: string, public readonly kind: RegionalCreationErrorKind) {
    super(message);
    this.name = "RegionalCreationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["queued", "running", "completed", "failed"]);
const STAGES = new Set(["queued", "collecting", "building", "saving", "completed", "failed"]);

/** Store the identity in the URL before sending anything. Refresh, browser Back
 * and a lost POST response must all resume the same job, never another draft. */
export function regionalCreationInput(
  topic: RegionalReportJobInput["topic"],
  issueDate: string,
): RegionalReportJobInput {
  const url = new URL(window.location.href);
  const savedId = url.searchParams.get("requestId");
  const savedDate = url.searchParams.get("issueDate");
  if (savedId && (!UUID_RE.test(savedId) || !savedDate || !/^\d{4}-\d{2}-\d{2}$/.test(savedDate))) {
    throw new RegionalCreationError("This creation link is invalid. Return to Regional Reports and choose Create Report.", "report");
  }
  const input = { requestId: savedId ?? crypto.randomUUID(), topic, issueDate: savedId ? savedDate! : issueDate };
  url.searchParams.set("requestId", input.requestId);
  url.searchParams.set("issueDate", input.issueDate);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return input;
}

function httpStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
}

function serverMessage(error: unknown): string | undefined {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
      return data.error;
    }
  }
  return undefined;
}

function abortError(): DOMException {
  return new DOMException("Creation page closed", "AbortError");
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type CreationOptions = {
  signal: AbortSignal;
  onProgress: (job: RegionalReportJob) => void;
  onReconnecting: (reconnecting: boolean) => void;
  retryFailed?: boolean;
  pollMs?: number;
  retryMs?: number;
  requestTimeoutMs?: number;
};

/** Only short HTTP calls cross the private preview/publishing proxy. Source
 * collection and the atomic report save continue independently on the server. */
export async function waitForRegionalReport(
  input: RegionalReportJobInput,
  options: CreationOptions,
): Promise<number> {
  const { signal } = options;
  const request = async (operation: (requestSignal: AbortSignal) => Promise<RegionalReportJob>) => {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw abortError();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, options.requestTimeoutMs ?? 20_000);
      try {
        const job = await operation(controller.signal);
        if (signal.aborted) throw abortError();
        if (!job || job.id !== input.requestId || job.topic !== input.topic ||
          job.issueDate !== input.issueDate || !STATUSES.has(job.status) || !STAGES.has(job.stage)) {
          throw new RegionalCreationError("The server returned an unexpected response. Reload this page to restore access and resume this report.", "session");
        }
        options.onReconnecting(false);
        return job;
      } catch (error) {
        if (signal.aborted) throw abortError();
        if (error instanceof RegionalCreationError) throw error;
        const status = httpStatus(error);
        if (status === 401 || status === 403 || status === 0) {
          throw new RegionalCreationError("Your session needs to be refreshed. Reload this page to sign in and resume the same report.", "session");
        }
        const transient = status === undefined || status === 408 || status === 429 || (status >= 500);
        if (!transient) throw error;
        if (attempt >= 3) {
          throw new RegionalCreationError(
            "The connection was interrupted. Reconnect to check the same creation request, or reload this page if your session has expired. Neither action creates another report.",
            "connection",
          );
        }
        options.onReconnecting(true);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
      await pause((options.retryMs ?? 1_500) * (attempt + 1), signal);
    }
  };
  const fetchOptions = (requestSignal: AbortSignal): RequestInit => ({
    credentials: "same-origin",
    redirect: "manual",
    cache: "no-store",
    signal: requestSignal,
  });
  try {
    let job: RegionalReportJob;
    try {
      job = await request((requestSignal) => getRegionalReportJob(input.requestId, fetchOptions(requestSignal)));
    } catch (error) {
      if (httpStatus(error) !== 404) throw error;
      job = await request((requestSignal) => startRegionalReport(input, fetchOptions(requestSignal)));
    }
    if (job.status === "failed" && options.retryFailed) {
      job = await request((requestSignal) => startRegionalReport(input, fetchOptions(requestSignal)));
    }
    const started = Date.now();
    while (true) {
      if (signal.aborted) throw abortError();
      options.onProgress(job);
      if (job.status === "completed") {
        if (!Number.isSafeInteger(job.reportId) || (job.reportId ?? 0) <= 0) {
          throw new RegionalCreationError("The completed job has no saved report. Return to Regional Reports to check the result.", "report");
        }
        return job.reportId!;
      }
      if (job.status === "failed") {
        throw new RegionalCreationError(job.error || "Report creation failed. No incomplete report was saved.", "report");
      }
      if (Date.now() - started > 10 * 60_000) {
        throw new RegionalCreationError("Creation is still queued or running. Reconnect to check its progress; the same request will be used.", "connection");
      }
      await pause(options.pollMs ?? 1_500, signal);
      job = await request((requestSignal) => getRegionalReportJob(input.requestId, fetchOptions(requestSignal)));
    }
  } catch (error) {
    if (error instanceof RegionalCreationError || signal.aborted) throw error;
    throw new RegionalCreationError(serverMessage(error) || "The server could not start this report. Please try again.", "report");
  }
}