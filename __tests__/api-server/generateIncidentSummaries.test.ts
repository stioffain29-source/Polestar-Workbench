import {
  generateIncidentSummaries,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/countryProse";
import { clearIntegrationEnv } from "./integrationEnvTestHelpers";

// Exercises the INTERNALS of generateIncidentSummaries — the prompt assembly and
// the result parsing/mapping — by stubbing only the LLM TRANSPORT (global.fetch),
// not the function itself. The route-level test (reportIncidentSummaries.test.ts)
// stubs generateIncidentSummaries wholesale, so the grounding contract (each
// summary built ONLY from its own incident's title/summary, no invented facts,
// every incident maps to its own id) was never actually exercised. These tests
// pin that contract:
//   - the request carries the grounding system prompt and a numbered block of
//     ONLY the supplied incidents (their own title + summary), in canonical
//     (most-recent-first) order;
//   - a well-formed model reply maps each incident NUMBER back to that
//     incident's own id;
//   - malformed, empty, partial or fenced model output degrades gracefully
//     rather than throwing or fabricating.

const BASE_URL = "https://llm.example.test/v1";
const API_KEY = "test-key";

const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "older",
    topic: "cargo_watch",
    title: "Warehouse break-in in Lahore",
    summary: "Goods were stolen from a bonded warehouse overnight.",
    location: "Lahore",
    country: "Pakistan",
    severity: "Moderate",
    occurredAt: "2026-06-10T00:00:00+00:00",
    source: "Dawn",
  },
  {
    id: "newer",
    topic: "cargo_watch",
    title: "Cargo theft on the Karachi corridor",
    summary: "A container lorry was hijacked outside the port.",
    location: "Karachi",
    country: "Pakistan",
    severity: "High",
    occurredAt: "2026-06-12T00:00:00+00:00",
    source: "Reuters",
  },
];

// canonicalIncidents sorts most-recent-first, so the prompt numbers "newer" as 1
// and "older" as 2 regardless of the input order above.
const NUM_TO_ID: Record<string, string> = { "1": "newer", "2": "older" };

interface CapturedCall {
  url: string;
  authorization: string | null;
  body: {
    model: string;
    max_completion_tokens: number;
    response_format?: { type?: string };
    messages: { role: string; content: string }[];
  };
}

let calls: CapturedCall[] = [];

/**
 * Install a fetch stub that records the request and returns the given body as a
 * 200 JSON chat-completion. `content` is what the model "said".
 */
function mockModelReply(content: string, status = 200): void {
  global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
    const opts = (init ?? {}) as { headers?: Record<string, string>; body?: string };
    calls.push({
      url: String(url),
      authorization: opts.headers?.authorization ?? null,
      body: JSON.parse(opts.body ?? "{}"),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** A model reply with the proper JSON object shape. */
function reply(summaries: Record<string, string>): string {
  return JSON.stringify({ incidentSummaries: summaries });
}

const origFetch = global.fetch;

beforeEach(() => {
  clearIntegrationEnv();
  calls = [];
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = BASE_URL;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = API_KEY;
});

afterEach(() => {
  global.fetch = origFetch;
  jest.restoreAllMocks();
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
});

describe("generateIncidentSummaries — request assembly", () => {
  it("posts to the chat-completions endpoint with the bearer key", async () => {
    mockModelReply(reply({ "1": "Lorry hijacked near the port.", "2": "Warehouse robbed overnight." }));

    await generateIncidentSummaries(INCIDENTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/chat/completions`);
    expect(calls[0].authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body.response_format?.type).toBe("json_object");
  });

  it("sends the grounding system prompt and a generous completion budget", async () => {
    mockModelReply(reply({ "1": "x", "2": "y" }));

    await generateIncidentSummaries(INCIDENTS);

    const [system] = calls[0].body.messages;
    expect(system.role).toBe("system");
    // The non-negotiable grounding rule must be present in the prompt.
    expect(system.content).toMatch(/Ground each summary ONLY on that incident's own title and summary line/);
    expect(system.content).toMatch(/Do not invent, infer or add facts/);
    // A reasoning model burns the budget on reasoning first, so the cap must stay
    // high enough to leave room for the JSON answer.
    expect(calls[0].body.max_completion_tokens).toBeGreaterThanOrEqual(8192);
  });

  it("numbers ONLY the supplied incidents, each with its own title and summary, most-recent-first", async () => {
    mockModelReply(reply({ "1": "x", "2": "y" }));

    await generateIncidentSummaries(INCIDENTS);

    const user = calls[0].body.messages[1];
    expect(user.role).toBe("user");
    // Canonical order: newest first.
    expect(user.content).toMatch(/1\. .*Cargo theft on the Karachi corridor/);
    expect(user.content).toMatch(/2\. .*Warehouse break-in in Lahore/);
    // Each incident's own summary line is included as grounding.
    expect(user.content).toContain("A container lorry was hijacked outside the port.");
    expect(user.content).toContain("Goods were stolen from a bonded warehouse overnight.");
    // No third item is invented.
    expect(user.content).not.toMatch(/^3\. /m);
  });
});

describe("generateIncidentSummaries — result mapping", () => {
  it("maps each incident NUMBER back to that incident's own id", async () => {
    mockModelReply(
      reply({
        "1": "Container lorry hijacked outside Karachi.",
        "2": "Bonded warehouse robbed overnight in Lahore.",
      }),
    );

    const out = await generateIncidentSummaries(INCIDENTS);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBeTruthy();
    expect(out.summaries[NUM_TO_ID["1"]]).toBe("Container lorry hijacked outside Karachi.");
    expect(out.summaries[NUM_TO_ID["2"]]).toBe("Bonded warehouse robbed overnight in Lahore.");
    // No stray keys — exactly the two supplied incidents.
    expect(Object.keys(out.summaries).sort()).toEqual(["newer", "older"]);
  });

  it("extracts the JSON object even when the model wraps it in a code fence", async () => {
    mockModelReply(
      "```json\n" + reply({ "1": "Fenced summary one.", "2": "Fenced summary two." }) + "\n```",
    );

    const out = await generateIncidentSummaries(INCIDENTS);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summaries.newer).toBe("Fenced summary one.");
    expect(out.summaries.older).toBe("Fenced summary two.");
  });

  it("keeps the resolvable summaries when the model returns a partial set", async () => {
    // Only incident 1 answered; the missing one degrades to absent (the caller's
    // deterministic fallback fills it), never a fabricated entry.
    mockModelReply(reply({ "1": "Only the first incident summarised." }));

    const out = await generateIncidentSummaries(INCIDENTS);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summaries).toEqual({ newer: "Only the first incident summarised." });
  });

  it("ignores out-of-range numbers that match no incident", async () => {
    mockModelReply(reply({ "1": "Real summary.", "9": "Hallucinated extra incident." }));

    const out = await generateIncidentSummaries(INCIDENTS);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summaries).toEqual({ newer: "Real summary." });
  });
});

describe("generateIncidentSummaries — graceful degradation", () => {
  it("returns ok:false when the env integration is not configured (no fetch)", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;

    const out = await generateIncidentSummaries(INCIDENTS, 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("llm-unavailable");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns ok:false on empty model content", async () => {
    mockModelReply("");

    const out = await generateIncidentSummaries(INCIDENTS, 0);

    expect(out.ok).toBe(false);
  });

  it("returns ok:false on unparseable model output", async () => {
    mockModelReply("this is not json at all");

    const out = await generateIncidentSummaries(INCIDENTS, 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false when the JSON has no usable incidentSummaries", async () => {
    mockModelReply(JSON.stringify({ incidentSummaries: {} }));

    const out = await generateIncidentSummaries(INCIDENTS, 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false when incidentSummaries is the wrong type", async () => {
    mockModelReply(JSON.stringify({ incidentSummaries: "not an object" }));

    const out = await generateIncidentSummaries(INCIDENTS, 0);

    expect(out.ok).toBe(false);
  });
});
