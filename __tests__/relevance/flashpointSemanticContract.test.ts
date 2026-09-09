import { FLASHPOINT_VALIDITY_VERSION, validateFlashpointSemanticContract } from "@workspace/relevance";

const valid = {
  version: FLASHPOINT_VALIDITY_VERSION,
  verdict: "valid" as const, eventOccurred: true, actor: "workers", activity: "strike",
  physicalLocation: "Factory", country: "Country", eventType: "labour_strike" as const,
  eventDate: "2026-01-01", currentness: "current" as const, assignedCountrySupported: true,
  confidence: { event: .75, classification: .7, geography: .75, date: .65 }, contradictions: [],
};

describe("Flashpoint semantic contract", () => {
  it("accepts every threshold boundary", () => expect(validateFlashpointSemanticContract(valid).valid).toBe(true));
  it.each([
    ["provider", { verdict: "needs_review" }],
    ["event", { eventOccurred: false }],
    ["actor", { actor: "" }], ["activity", { activity: "" }], ["location", { physicalLocation: "" }],
    ["country", { country: "" }], ["date", { eventDate: null }], ["type", { eventType: "unknown" }],
    ["historical", { currentness: "historical" }], ["assignment", { assignedCountrySupported: false }],
    ["contradiction", { contradictions: ["headline/body conflict"] }],
    ["event confidence", { confidence: { ...valid.confidence, event: .74 } }],
    ["classification confidence", { confidence: { ...valid.confidence, classification: .69 } }],
    ["geography confidence", { confidence: { ...valid.confidence, geography: .74 } }],
    ["date confidence", { confidence: { ...valid.confidence, date: .64 } }],
    ["unlisted type", { eventType: "technology_launch" }],
    ["nonsense date", { eventDate: "tomorrow" }],
    ["impossible date", { eventDate: "2026-02-30" }],
    ["NaN", { confidence: { ...valid.confidence, event: Number.NaN } }],
    ["Infinity", { confidence: { ...valid.confidence, geography: Number.POSITIVE_INFINITY } }],
    ["old version", { version: "old" }],
  ])("rejects adversarial %s", (_name, patch) => {
    expect(validateFlashpointSemanticContract({ ...valid, ...patch } as typeof valid).valid).toBe(false);
  });
});