import {
  generateCountryProse,
  type GenerateProseInput,
  type ProseIncidentInput,
  type ProseBaselineContext,
} from "../../artifacts/api-server/src/lib/countryProse";

// Exercises the INTERNALS of generateCountryProse / callOnce — the prompt
// assembly (grounding system prompt, standing-background block, numbered
// incident block) and parseSections result mapping — by stubbing only the LLM
// TRANSPORT (global.fetch), not the function itself. The route-level test stubs
// generateCountryProse wholesale, so the seven-section "country" mapping, the
// two-paragraph "png" mapping, the grounding contract, and the degrade-to-
// template-fallback behaviour were never actually exercised. These tests pin
// that contract for BOTH variants:
//   - the request carries the grounding system prompt, the STANDING BACKGROUND
//     block, and a numbered block of ONLY the supplied incidents (canonical,
//     most-recent-first), with the country-aware framing for the "png" variant;
//   - a well-formed reply maps to every expected section key for both variants
//     and threads per-incident summaries back to each incident's own id;
//   - malformed, empty, partial or fenced output degrades to ok:false so the
//     caller falls back to the deterministic template.

const BASE_URL = "https://llm.example.test/v1";
const API_KEY = "test-key";

const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "older",
    topic: "flashpoint",
    title: "Demonstration in Jayapura",
    summary: "Protesters gathered outside the provincial office.",
    location: "Jayapura",
    country: "Papua New Guinea",
    severity: "Moderate",
    occurredAt: "2026-06-10T00:00:00+00:00",
    source: "RNZ",
  },
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

// canonicalIncidents sorts most-recent-first, so the prompt numbers "newer" as 1
// and "older" as 2 regardless of the input order above.
const NUM_TO_ID: Record<string, string> = { "1": "newer", "2": "older" };

const BASELINE: ProseBaselineContext = {
  operatingEnvironment: "Mountainous terrain with limited road access.",
  securityContext: "Tribal disputes recur in the highlands.",
  knownRiskAreas: ["Enga", "Hela"],
  keyCitiesProvinces: ["Port Moresby", "Lae"],
  movementConstraints: "Road travel after dark is discouraged.",
};

function input(over: Partial<GenerateProseInput> = {}): GenerateProseInput {
  return {
    countryName: "Papua New Guinea",
    region: "Pacific",
    basisDays: 90,
    periodWord: "this quarter",
    issueDate: "2026-06-20",
    incidents: INCIDENTS,
    baseline: BASELINE,
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

/** A well-formed seven-section "country" reply. */
function countryReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    executiveSummary: "The highlands drove the period's risk.",
    situation: "A recurrent tribal-dispute environment frames the window.",
    whatHappened: "A convoy was ambushed in Enga and a demonstration occurred in Jayapura.",
    whatMatters: "Road movement in the highlands needs review.",
    implications: ["Review highlands travel.", "Brief staff on convoy routes."],
    watchNext: ["Further ambushes on the highway.", "Spread of unrest to Jayapura."],
    polestarView: "Maintain a cautious posture in the highlands.",
    incidentSummaries: {
      "1": "A convoy was ambushed near the highland highway.",
      "2": "A demonstration formed outside the provincial office in Jayapura.",
    },
    ...over,
  });
}

/** A well-formed structured "png" reply (five narrative sections). */
function pngReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    bluf: "Highland violence is the period's defining concern.",
    executiveSummary: "Enga dominated the window with an armed ambush.",
    whatChanged: "Activity shifted from urban protest towards highland armed clashes.",
    outlook: "Highlands tension is likely to persist into the coming period.",
    polestarView: "Maintain a cautious posture and constrain highland movement.",
    incidentSummaries: {
      "1": "A convoy was ambushed near the highland highway.",
      "2": "A demonstration formed outside the provincial office in Jayapura.",
    },
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

describe("generateCountryProse — request assembly (country variant)", () => {
  it("posts to the chat-completions endpoint with the bearer key and JSON mode", async () => {
    mockModelReply(countryReply());

    await generateCountryProse(input(), 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/chat/completions`);
    expect(calls[0].authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body.response_format?.type).toBe("json_object");
    // A reasoning model burns the budget on reasoning first, so the cap must stay
    // high enough to leave room for the JSON answer.
    expect(calls[0].body.max_completion_tokens).toBeGreaterThanOrEqual(8192);
  });

  it("sends the grounding system prompt with the non-negotiable rules", async () => {
    mockModelReply(countryReply());

    await generateCountryProse(input(), 0);

    const [system] = calls[0].body.messages;
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/GROUNDING — non-negotiable/);
    expect(system.content).toMatch(
      /Every statement about what happened during the window must come ONLY from the supplied INCIDENTS/,
    );
    expect(system.content).toMatch(/Do not invent or infer events/);
    // The seven-section contract is requested.
    expect(system.content).toMatch(/"executiveSummary"/);
    expect(system.content).toMatch(/"situation"/);
    expect(system.content).toMatch(/"whatHappened"/);
    expect(system.content).toMatch(/"polestarView"/);
  });

  it("threads the standing background and a numbered incident block, most-recent-first", async () => {
    mockModelReply(countryReply());

    await generateCountryProse(input(), 0);

    const user = calls[0].body.messages[1];
    expect(user.role).toBe("user");
    expect(user.content).toMatch(/COUNTRY: Papua New Guinea \(Pacific\)/);
    // STANDING BACKGROUND block carries the supplied baseline facts.
    expect(user.content).toMatch(/STANDING BACKGROUND/);
    expect(user.content).toContain("Mountainous terrain with limited road access.");
    expect(user.content).toContain("Enga; Hela");
    // Canonical order: newest first.
    expect(user.content).toMatch(/1\. .*Clash on the highlands road/);
    expect(user.content).toMatch(/2\. .*Demonstration in Jayapura/);
    // Each incident's own summary line is included as grounding.
    expect(user.content).toContain("An armed group ambushed a convoy near the highway.");
    expect(user.content).toContain("Protesters gathered outside the provincial office.");
    // No third item is invented.
    expect(user.content).not.toMatch(/^3\. /m);
  });

  it("reports 'none provided' when no baseline is supplied", async () => {
    mockModelReply(countryReply());

    await generateCountryProse(input({ baseline: null }), 0);

    const user = calls[0].body.messages[1];
    expect(user.content).toMatch(/STANDING BACKGROUND[^]*none provided/);
  });
});

describe("generateCountryProse — result mapping (country variant)", () => {
  it("maps a well-formed reply to every section key and id-keyed summaries", async () => {
    mockModelReply(countryReply());

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBeTruthy();
    const s = out.sections;
    expect(s.executiveSummary).toBe("The highlands drove the period's risk.");
    expect(s.situation).toBeTruthy();
    expect(s.whatHappened).toBeTruthy();
    expect(s.whatMatters).toBeTruthy();
    expect(s.polestarView).toBeTruthy();
    expect(s.implications).toEqual(["Review highlands travel.", "Brief staff on convoy routes."]);
    expect(s.watchNext).toEqual([
      "Further ambushes on the highway.",
      "Spread of unrest to Jayapura.",
    ]);
    // Per-incident summaries are keyed back to each incident's own id.
    expect(s.incidentSummaries).toEqual({
      [NUM_TO_ID["1"]]: "A convoy was ambushed near the highland highway.",
      [NUM_TO_ID["2"]]: "A demonstration formed outside the provincial office in Jayapura.",
    });
  });

  it("strips leading dashes/bullets from list items", async () => {
    mockModelReply(
      countryReply({ implications: ["- Review highlands travel.", "* Brief staff."] }),
    );

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.implications).toEqual(["Review highlands travel.", "Brief staff."]);
  });

  it("extracts the JSON object even when the model wraps it in a code fence", async () => {
    mockModelReply("```json\n" + countryReply() + "\n```");

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.executiveSummary).toBe("The highlands drove the period's risk.");
  });
});

describe("generateCountryProse — request assembly + mapping (png variant)", () => {
  it("sends the country-aware structured prompt asking for the narrative sections", async () => {
    mockModelReply(pngReply());

    await generateCountryProse(input({ variant: "png" }), 0);

    const [system] = calls[0].body.messages;
    expect(system.role).toBe("system");
    // The structured prompt names the country and asks for the brief's sections.
    expect(system.content).toMatch(/Papua New Guinea country brief/);
    expect(system.content).toMatch(/produce the brief's narrative sections/);
    expect(system.content).toMatch(/GROUNDING — non-negotiable/);
    // The structured contract requests all five narrative sections (+ summaries).
    expect(system.content).toMatch(/"bluf"/);
    expect(system.content).toMatch(/"executiveSummary"/);
    expect(system.content).toMatch(/"whatChanged"/);
    expect(system.content).toMatch(/"outlook"/);
    expect(system.content).toMatch(/"polestarView"/);
  });

  it("maps a well-formed reply to the five narrative sections, builder sections empty", async () => {
    mockModelReply(pngReply());

    const out = await generateCountryProse(input({ variant: "png" }), 0);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const s = out.sections;
    expect(s.bluf).toBe("Highland violence is the period's defining concern.");
    expect(s.executiveSummary).toBe("Enga dominated the window with an armed ambush.");
    expect(s.whatChanged).toBe("Activity shifted from urban protest towards highland armed clashes.");
    expect(s.outlook).toBe("Highlands tension is likely to persist into the coming period.");
    expect(s.polestarView).toBe("Maintain a cautious posture and constrain highland movement.");
    // The structured builder still owns these sections, so they stay empty.
    expect(s.situation).toBe("");
    expect(s.whatHappened).toBe("");
    expect(s.whatMatters).toBe("");
    expect(s.implications).toEqual([]);
    expect(s.watchNext).toEqual([]);
    // Per-incident summaries still thread back to each incident's own id.
    expect(s.incidentSummaries).toEqual({
      [NUM_TO_ID["1"]]: "A convoy was ambushed near the highland highway.",
      [NUM_TO_ID["2"]]: "A demonstration formed outside the provincial office in Jayapura.",
    });
  });
});

describe("generateCountryProse — graceful degradation (template fallback)", () => {
  it("returns ok:false when the env integration is not configured (no fetch)", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("llm-unavailable");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns ok:false on empty model content", async () => {
    mockModelReply("");

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(false);
  });

  it("returns ok:false on unparseable model output", async () => {
    mockModelReply("this is not json at all");

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false (country) when a required core paragraph is missing", async () => {
    // whatHappened omitted — the country variant requires the core paragraphs.
    mockModelReply(countryReply({ whatHappened: "" }));

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false (png) when outlook is missing", async () => {
    // executiveSummary present but outlook empty — the png variant requires both.
    mockModelReply(pngReply({ outlook: "" }));

    const out = await generateCountryProse(input({ variant: "png" }), 0);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("bad-json");
  });

  it("returns ok:false when the JSON is an array, not an object", async () => {
    mockModelReply(JSON.stringify(["not", "an", "object"]));

    const out = await generateCountryProse(input(), 0);

    expect(out.ok).toBe(false);
  });
});
