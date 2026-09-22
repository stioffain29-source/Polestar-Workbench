import {
  getRegionalReportJob,
  startRegionalReport,
  type RegionalReportJob,
  type RegionalReportJobInput,
} from "@workspace/api-client-react";

export type RegionalCreationErrorKind = "connection" | "session" | "access" | "report";

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

/** Persist a same-row refresh identity before POSTing, for the same durability
 * guarantees as creation without reusing a creation request accidentally. */
export function regionalRebuildInput(
  topic: RegionalReportJobInput["topic"],
  issueDate: string,
  targetReportId: number,
  expectedUpdatedAt: string,
): RegionalReportJobInput {
  const url = new URL(window.location.href);
  const savedId = url.searchParams.get("rebuildRequestId");
  const savedTarget = Number(url.searchParams.get("rebuildTargetReportId"));
  const savedExpected = url.searchParams.get("rebuildExpectedUpdatedAt");
  if (
    savedId &&
    (!UUID_RE.test(savedId) ||
      savedTarget !== targetReportId ||
      !savedExpected ||
      Number.isNaN(new Date(savedExpected).getTime()))
  ) {
    throw new RegionalCreationError(
      "This refresh link belongs to different report inputs. Reload the report before retrying.",
      "report",
    );
  }
  const input: RegionalReportJobInput = {
    requestId: savedId ?? crypto.randomUUID(),
    topic,
    issueDate,
    targetReportId,
    expectedUpdatedAt: savedExpected ?? expectedUpdatedAt,
  };
  url.searchParams.set("rebuildRequestId", input.requestId);
  url.searchParams.set("rebuildTargetReportId", String(targetReportId));
  url.searchParams.set(
    "rebuildExpectedUpdatedAt",
    input.expectedUpdatedAt!,
  );
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return input;
}

export function clearRegionalRebuildInput(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("rebuildRequestId");
  url.searchParams.delete("rebuildTargetReportId");
  url.searchParams.delete("rebuildExpectedUpdatedAt");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function regionalRefreshDisabled(input: {
  hasUpdatedAt: boolean;
  hasUnsavedEdits: boolean;
  status?: RegionalReportJob["status"];
}): boolean {
  return (
    !input.hasUpdatedAt ||
    input.hasUnsavedEdits ||
    input.status === "queued" ||
    input.status === "running"
  );
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

/** The private hosting gateway can redirect or reject a request before it
 * reaches the app. Only the app's explicit access response establishes whether
 * the owner session is missing; status 0/HTML are not proof of a logout. */
async function checkRegionalAccess(signal: AbortSignal): Promise<"allowed" | "session" | "access" | "unknown"> {
  try {
    const response = await fetch("/api/access", {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return "unknown";
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("authenticated" in data) || !("allowed" in data)) return "unknown";
    if (data.authenticated === true && data.allowed === true) return "allowed";
    if (data.authenticated === true && data.allowed === false) return "access";
    if (data.authenticated === false && data.allowed === false) return "session";
    return "unknown";
  } catch {
    return "unknown";
  }
}

class RegionalTransportError extends Error {}

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
        // Following a gateway redirect can return its HTML login page instead
        // of JSON. Reconnect without losing the job identity or inventing a
        // session-expiry diagnosis.
        if (typeof job === "string") throw new RegionalTransportError("Non-JSON report response");
        if (!job || job.id !== input.requestId || job.topic !== input.topic ||
          job.issueDate !== input.issueDate || !STATUSES.has(job.status) || !STAGES.has(job.stage)) {
          throw new RegionalCreationError("The server returned an invalid report status. Retry the same request; no new report will be created.", "report");
        }
        options.onReconnecting(false);
        return job;
      } catch (error) {
        if (signal.aborted) throw abortError();
        if (error instanceof RegionalCreationError) throw error;
        const status = httpStatus(error);
        if (status === 401 || status === 403) {
          const access = await checkRegionalAccess(controller.signal);
          if (signal.aborted) throw abortError();
          if (access === "session") {
            throw new RegionalCreationError("Sign in to resume this report. Your creation request is preserved; signing in will not create another report.", "session");
          }
          if (access === "access") {
            throw new RegionalCreationError("This account does not have access to the workbench. Sign in with the owner account to resume the same report.", "access");
          }
        }
        const transient = status === undefined || status === 0 || status === 401 || status === 403 ||
          status === 408 || status === 429 || status >= 500 ||
          error instanceof RegionalTransportError ||
          (error instanceof Error && error.name === "ResponseParseError");
        if (!transient) throw error;
        if (attempt >= 3) {
          throw new RegionalCreationError(
            "The connection to the report service was interrupted. Reconnect to check the same request. If access to the site was interrupted, reopen this page. Neither action creates another report.",
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
    credentials: "include",
    // manual turns even a recoverable gateway redirect into opaque status 0.
    redirect: "follow",
    headers: { Accept: "application/json" },
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