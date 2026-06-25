import {
  generateReportProse,
  type GenerateReportProseInput,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/reportProse";

// Exercises the INTERNALS of generateReportProse / callOnce — the prompt
// assembly (topic-aware grounding system prompt, numbered incident block) and
// parseTopicSections result mapping — by stubbing only the LLM TRANSPORT
// (global.fetch), not the function itself. The route-level test stubs
// generateReportProse wholesale, so the seven-section mapping, the grounding
// contract, and the degrade-to-template-fallback behaviour were never actually
// exercised. These tests pin that contract:
//   - the request carries the topic-aware grounding system prompt and a numbered
//     block of ONLY the supplied incidents (canonical, most-recent-first);
//   - a well-formed reply maps to every section key, joining the implications and
//     watchNext arrays into newline-delimited strings (the editor's textarea form);
//   - malformed, empty, partial or fenced output degrades to ok:false so the
//     caller falls back to the deterministic template.

const BASE_URL = "https://llm.example.test/v1";
const API_KEY = "test-key";

const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "older",
    topic: "shipping",
    title: "Tanker boarded off Singapore",
    summary: "Robbers boarded a tanker in the eastbound lane and fled.",
    location: "Singapore Strait",
    country: "Singapore",
    severity: "Low",
    occurredAt: "2026-06-10T00:00:00+00:00",
    source: "ReCAAP",
  },
  {
    id: "newer",
    topic: "shipping",
    title: "Drone strike on bulk carrier near Hodeidah",
    summary: "A bulk carrier was struck by a one-way drone in the southern Red Sea.",
    location: "Red Sea",
    country: "Yemen",
    severity: "High",
    occurredAt: "2026-06-12T00:00:00+00:00",
    source: "UKMTO",
  },
];

function input(over: Partial<GenerateReportProseInput> = {}): GenerateReportProseInput {
  return {
    topic: "shipping",
    title: "Shipping & Maritime Security",
    basisDays: 7,
    periodWord: "this week",
    issueDate: "2026-06-13",
    incidents: INCIDENTS,
    ...over,
  };
}

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

/** A well-formed seven-section topic reply. */
function topicReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    executiveSummary: "Red Sea drone risk dominated the week.",
    situation: "A standing one-way-munition threat frames the southern Red Sea.",
    whatHappened: "A bulk carrier was struck near Hodeidah and a tanker was boarded off Singapore.",
    whatMatters: "Hardening transits and watch-keeping in the southern Red Sea needs review.",
    implications: ["Review southern Red Sea routeing.", "Brief masters on drone-attack drills."],
    watchNext: ["Further strikes near Hodeidah.", "Spread of boardings in the Singapore Strait."],
    polestarView: "Maintain a cautious transit posture through the southern Red Sea.",
    ...over,
  });
}

const origFetch = global.fetch;

beforeEach(() => {
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

describe("generateReportProse — request assembly", () => {
  it("posts to the chat-completions endpoint with the bearer key and JSON mode", async () => {
    mockModelReply(topicReply());

    await generateReportProse(input(), 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/chat/completions`);
    expect(calls[0].authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body.response_format?.type).toBe("json_object");
    expect(calls[0].body.max_completion_tokens).toBeGreaterThanOrEqual(8192);
  });

  it("sends the topic-aware grounding system prompt with the non-negotiable rules", async () => {
    mockModelReply(topicReply());

    await generateReportProse(input(), 0);

    const [system] = calls[0].body.messages;
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/Shipping & Maritime Security report/);
    expect(system.content).toMatch(/GROUNDING — non-negotiable/);
    expect(system.content).toMatch(
      /Every statement about what happened during the window must come ONLY from the supplied INCIDENTS/,
    );
    // The narrative contract: synthesise themes, not a list of incidents.
    expect(system.content).toMatch(/NOT a list of the incidents/);
    // The seven-section contract is requested.
    expect(system.content).toMatch(/"executiveSummary"/);
    expect(system.content).toMatch(/"situation"/);
    expect(system.content).toMatch(/"whatHappened"/);
    expect(system.content).toMatch(/"polestarView"/);
  });

  it("threads a numbered incident block, most-recent-first, and invents no third item", async () => {
    mockModelReply(topicReply());

    await generateReportProse(input(), 0);

    const user = calls[0].body.messages[1];
    expect(user.role).toBe("user");
    expect(user.content).toMatch(/REPORT: Shipping & Maritime Security/);
    expect(user.content).toMatch(/REPORTING WINDOW: this week/);
    // Canonical order: newest first.
    expect(user.content).toMatch(/1\. .*Drone strike on bulk carrier near Hodeidah/);
    expect(user.content).toMatch(/2\. .*Tanker boarded off Singapore/);
    expect(user.content).toContain("A bulk carrier was struck by a one-way drone in the southern Red Sea.");
    expect(user.content).not.toMatch(/^3\. /m);
  });

  it("frames an unknown topic with the generic fallback label", async () => {
    mockModelReply(topicReply());

    await generateReportProse(input({ topic: "made_up", title: "" }), 0);

    const [system] = calls[0].body.messages;
    expect(system.content).toMatch(/Security report/);
  });
});

describe("generateReportProse — result mapping", () => {
  it("maps a well-formed reply to every section key, joining lists into strings", async () => {
    mockModelReply(topicReply());

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBeTruthy();
    const s = out.sections;
    expect(s.executiveSummary).toBe("Red Sea drone risk dominated the week.");
    expect(s.situation).toBeTruthy();
    expect(s.whatHappened).toBeTruthy();
    expect(s.whatMatters).toBeTruthy();
    expect(s.polestarView).toBeTruthy();
    // implications / watchNext arrays are joined into newline-delimited strings.
    expect(s.implications).toBe(
      "Review southern Red Sea routeing.\nBrief masters on drone-attack drills.",
    );
    expect(s.watchNext).toBe(
      "Further strikes near Hodeidah.\nSpread of boardings in the Singapore Strait.",
    );
  });

  it("strips leading dashes/bullets when joining list items", async () => {
    mockModelReply(topicReply({ implications: ["- Review routeing.", "* Brief masters."] }));

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.implications).toBe("Review routeing.\nBrief masters.");
  });

  it("accepts list sections already supplied as a string", async () => {
    mockModelReply(topicReply({ implications: "Already a string.", watchNext: "One line." }));

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.implications).toBe("Already a string.");
    expect(out.sections.watchNext).toBe("One line.");
  });

  it("extracts the JSON object even when the model wraps it in a code fence", async () => {
    mockModelReply("```json\n" + topicReply() + "\n```");

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.executiveSummary).toBe("Red Sea drone risk dominated the week.");
  });
});

describe("generateReportProse — graceful degradation (template fallback)", () => {
  it("returns ok:false when the env integration is not configured (no fetch)", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("llm-unavailable");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns ok:false on empty model content", async () => {
    mockModelReply("");

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(false);
  });

  it("returns ok:false on unparseable model output", async () => {
    mockModelReply("this is not json at all");

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false when a required core paragraph is missing", async () => {
    mockModelReply(topicReply({ whatHappened: "" }));

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false when the JSON is an array, not an object", async () => {
    mockModelReply(JSON.stringify(["not", "an", "object"]));

    const out = await generateReportProse(input(), 0);

    expect(out.ok).toBe(false);
  });
});
