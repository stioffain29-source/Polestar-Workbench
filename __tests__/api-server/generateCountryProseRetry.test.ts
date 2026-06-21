import {
  generateCountryProse,
  type GenerateProseInput,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/countryProse";

// Exercises the RETRY / BACKOFF layer that wraps callOnce in
// generateCountryProse — the part the request-assembly / parsing suite
// (generateCountryProse.test.ts) deliberately ran with retries=0 and never
// touched. By stubbing only the LLM TRANSPORT (global.fetch) we pin the retry
// contract:
//   - a transient failure (timeout, 5xx) on the first attempt is retried and a
//     well-formed second reply ultimately succeeds (ok:true);
//   - a 429 / 5xx carrying a Retry-After header is treated as retryable;
//   - a non-retryable failure (http-400) is NOT retried;
//   - once the retry budget is exhausted the call gives up with ok:false.
//
// Backoff delays are collapsed to ~0ms here (global.setTimeout is overridden to
// fire on the next tick regardless of the requested delay) so the suite stays
// fast without changing any production timing. The override also harmlessly
// shortens callOnce's abort timer, which is always cleared before it fires.

const BASE_URL = "https://llm.example.test/v1";
const API_KEY = "test-key";

const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "newer",
    topic: "flashpoint",
    title: "Clash on the highlands road",
    summary: "An armed group ambushed a convoy near the highway.",
    location: "Enga",
    country: "Papua New Guinea",
    severity: "High",
    occurredAt: "2026-06-12T00:00:00+00:00",
    source: "Reuters",
  },
];

function input(over: Partial<GenerateProseInput> = {}): GenerateProseInput {
  return {
    countryName: "Papua New Guinea",
    region: "Pacific",
    basisDays: 90,
    periodWord: "this quarter",
    issueDate: "2026-06-20",
    incidents: INCIDENTS,
    baseline: null,
    ...over,
  };
}

/** A well-formed seven-section "country" reply (passes parseSections). */
function countryReply(): string {
  return JSON.stringify({
    executiveSummary: "The highlands drove the period's risk.",
    situation: "A recurrent tribal-dispute environment frames the window.",
    whatHappened: "A convoy was ambushed in Enga.",
    whatMatters: "Road movement in the highlands needs review.",
    implications: ["Review highlands travel."],
    watchNext: ["Further ambushes on the highway."],
    polestarView: "Maintain a cautious posture in the highlands.",
    incidentSummaries: { "1": "A convoy was ambushed near the highland highway." },
  });
}

/** One scripted response for a single fetch call. */
type Step =
  | { kind: "reply"; content: string }
  | { kind: "status"; status: number; retryAfter?: string }
  | { kind: "network"; message: string };

/**
 * Install a fetch stub that consumes one scripted Step per call, in order, and
 * records how many times it was invoked. The last step is reused if more calls
 * arrive than steps were scripted (so an unexpected extra retry is visible as a
 * higher call count, not a crash).
 */
function scriptFetch(steps: Step[]): { count: () => number } {
  let i = 0;
  const fn = jest.fn(async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step.kind === "network") {
      throw new Error(step.message);
    }
    if (step.kind === "status") {
      return {
        ok: step.status >= 200 && step.status < 300,
        status: step.status,
        headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? step.retryAfter ?? null : null) },
        json: async () => ({}),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: step.content }, finish_reason: "stop" }] }),
    } as unknown as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return { count: () => fn.mock.calls.length };
}

const origFetch = global.fetch;
const origSetTimeout = global.setTimeout;

beforeEach(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = BASE_URL;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = API_KEY;
  // Collapse every backoff (and the abort timer) to the next tick so the retry
  // loop runs effectively instantly. clearTimeout still cancels the real id.
  global.setTimeout = ((fn: (...a: unknown[]) => void) =>
    origSetTimeout(fn, 0)) as unknown as typeof setTimeout;
});

afterEach(() => {
  global.fetch = origFetch;
  global.setTimeout = origSetTimeout;
  jest.restoreAllMocks();
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
});

describe("generateCountryProse — retry / backoff layer", () => {
  it("retries a transient 5xx (model briefly unavailable) and succeeds on the follow-up reply", async () => {
    const fetcher = scriptFetch([
      { kind: "status", status: 503 }, // transient: server briefly unavailable
      { kind: "reply", content: countryReply() },
    ]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.executiveSummary).toBe("The highlands drove the period's risk.");
    // First call failed (503), second call succeeded.
    expect(fetcher.count()).toBe(2);
  });

  it("retries bad-json output then succeeds once a well-formed reply arrives", async () => {
    const fetcher = scriptFetch([
      { kind: "reply", content: "not json at all" }, // bad-json → retryable
      { kind: "reply", content: countryReply() },
    ]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(true);
    expect(fetcher.count()).toBe(2);
  });

  it("retries an empty model reply (empty-content) then succeeds on a well-formed reply", async () => {
    const fetcher = scriptFetch([
      { kind: "reply", content: "" }, // empty-content(stop) → retryable
      { kind: "reply", content: countryReply() },
    ]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(true);
    expect(fetcher.count()).toBe(2);
  });

  it("treats a 429 with a numeric Retry-After header as retryable and retries", async () => {
    const fetcher = scriptFetch([
      { kind: "status", status: 429, retryAfter: "0" }, // rate-limited, retry immediately
      { kind: "reply", content: countryReply() },
    ]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(true);
    expect(fetcher.count()).toBe(2);
  });

  it("treats a 503 with a Retry-After date header as retryable and retries", async () => {
    const when = new Date(Date.now() + 1000).toUTCString();
    const fetcher = scriptFetch([
      { kind: "status", status: 503, retryAfter: when },
      { kind: "reply", content: countryReply() },
    ]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(true);
    expect(fetcher.count()).toBe(2);
  });

  it("does NOT retry a non-retryable http-400 and returns its error on the first attempt", async () => {
    const fetcher = scriptFetch([
      { kind: "status", status: 400 }, // client error: not retryable
      { kind: "reply", content: countryReply() }, // would succeed if (wrongly) retried
    ]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("http-400");
    // Exactly one attempt — the loop must not have retried.
    expect(fetcher.count()).toBe(1);
  });

  it("gives up with ok:false once the retry budget is exhausted", async () => {
    // Every attempt returns a transient 500; with retries=2 that is 3 attempts.
    const fetcher = scriptFetch([{ kind: "status", status: 500 }]);

    const out = await generateCountryProse(input(), 2);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("http-500");
    expect(fetcher.count()).toBe(3); // initial + 2 retries
  });

  it("honours a retries=0 budget by attempting exactly once", async () => {
    const fetcher = scriptFetch([{ kind: "status", status: 500 }]);

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(false);
    expect(fetcher.count()).toBe(1);
  });
});
