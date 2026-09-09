import { isTransientFlashpointValidityReason, normalizeFlashpointEventDate, validateFlashpointEvent } from "@workspace/ingest";

describe("flashpoint semantic validity", () => {
  const original = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (original) process.env.OPENAI_API_KEY = original;
    else delete process.env.OPENAI_API_KEY;
    jest.restoreAllMocks();
  });

  it("fails closed when the semantic service is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await validateFlashpointEvent({ title: "Workers protest", summary: "A report discusses it" });
    expect(result.verdict).toBe("needs_review");
    expect(result.confidence.event).toBe(0);
    expect(isTransientFlashpointValidityReason(result.reason)).toBe(true);
  });

  it("distinguishes retryable service holds from substantive decisions", () => {
    expect(isTransientFlashpointValidityReason("semantic validator HTTP 503")).toBe(true);
    expect(isTransientFlashpointValidityReason("incomplete geography evidence")).toBe(false);
  });

  it("projects a valid ISO timestamp to its UTC calendar date without repairing malformed dates", () => {
    expect(normalizeFlashpointEventDate("2026-09-09T07:30:09.000Z")).toBe("2026-09-09");
    expect(normalizeFlashpointEventDate("2026-09-09T23:30:00+08:00")).toBe("2026-09-09");
    expect(normalizeFlashpointEventDate("September 9")).toBe("September 9");
    expect(normalizeFlashpointEventDate(null)).toBeNull();
  });

  it("accepts an otherwise coherent event when the provider returns its date as an ISO timestamp", async () => {
    process.env.OPENAI_API_KEY = "test";
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        eventOccurred: true, actor: "protesters", activity: "demonstration", physicalLocation: "Seoul",
        country: "South Korea", eventType: "protest", eventDate: "2026-09-09T07:30:09.000Z",
        currentness: "current", assignedCountrySupported: true,
        confidence: { event: .9, classification: .9, geography: .95, date: .8 },
        contradictions: [], verdict: "valid", reason: "reported event",
      }) } }],
    }), { status: 200 }));
    const result = await validateFlashpointEvent({ title: "Protesters gather in Seoul", summary: "A demonstration took place in Seoul." });
    expect(result.eventDate).toBe("2026-09-09");
    expect(result.verdict).toBe("valid");
  });

  it("treats a provider-valid scheduled future event as established without upgrading uncertainty", async () => {
    process.env.OPENAI_API_KEY = "test";
    const base = {
      eventOccurred: false, actor: "bus workers", activity: "scheduled strike", physicalLocation: "Seoul",
      country: "South Korea", eventType: "labour_strike", eventDate: "2026-09-16",
      currentness: "future", assignedCountrySupported: true,
      confidence: { event: .9, classification: .9, geography: .95, date: .9 },
      contradictions: [], reason: "scheduled event",
    };
    const fetchMock = jest.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ...base, verdict: "valid" }) } }],
    }), { status: 200 }));
    expect((await validateFlashpointEvent({ title: "Strike scheduled", summary: "Workers will strike in Seoul." })).verdict).toBe("valid");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ...base, verdict: "needs_review" }) } }],
    }), { status: 200 }));
    expect((await validateFlashpointEvent({ title: "Strike may happen", summary: "Talks continue." })).verdict).toBe("needs_review");
  });

  it("uses structured JSON and preserves category dimensions", async () => {
    process.env.OPENAI_API_KEY = "test";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        eventOccurred: true, actor: "workers", activity: "strike", physicalLocation: "factory",
        country: "Testland", eventType: "labour_strike", eventDate: "2026-01-01", currentness: "current",
        assignedCountrySupported: true,
        confidence: { event: .9, classification: .9, geography: .8, date: .7 },
        contradictions: [], verdict: "valid", reason: "reported event",
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await validateFlashpointEvent({ title: "Workers strike", summary: "A strike occurred at a factory", assignedCountry: "Testland", assignedLocation: "factory", publishedAt: new Date("2026-01-01"), candidateEventDate: new Date("2026-01-01") });
    expect(result.verdict).toBe("valid");
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain("json_schema");
    expect(body).toContain("assignedCountry");
    expect(body).toContain("publishedAt");
  });

  it.each([
    ["incoherent valid", { verdict: "valid", eventOccurred: false, assignedCountrySupported: true }, "invalid"],
    ["unsupported country", { verdict: "valid", eventOccurred: true, assignedCountrySupported: false }, "invalid"],
    ["confidence out of bounds", { verdict: "valid", eventOccurred: true, assignedCountrySupported: true, confidence: { event: 2, classification: .9, geography: .9, date: .9 } }, "needs_review"],
  ])("%s fails closed", async (_name, partial, expected) => {
    process.env.OPENAI_API_KEY = "test";
    const payload = {
      eventOccurred: true, actor: "workers", activity: "strike", physicalLocation: "factory", country: "x",
      eventType: "labour", eventDate: null, currentness: "current", assignedCountrySupported: true,
      confidence: { event: .9, classification: .9, geography: .9, date: .9 }, contradictions: [], reason: "x",
      ...partial,
    };
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 }));
    const result = await validateFlashpointEvent({ title: "candidate", summary: "facts" });
    expect(result.verdict).toBe(expected);
  });
});