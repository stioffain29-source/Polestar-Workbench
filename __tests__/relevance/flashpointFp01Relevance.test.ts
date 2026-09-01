import { explainRelevance, RELEVANCE_RULE_VERSION } from "@workspace/relevance";

describe("Flashpoint relevance FP-01", () => {
  it("bumps RELEVANCE_RULE_VERSION for backfill", () => {
    expect(RELEVANCE_RULE_VERSION).toBe("2026-09-01.1");
  });

  it("drops diplomatic UN retract legal-process slop", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title:
        "Hasina's Lawyer Urges UN to Retract Bangladesh Protest Death Toll Report",
    });
    expect(verdict.relevant).toBe(false);
    expect(verdict.reason).toMatch(/homonym|diplomatic|slop|excluded/i);
  });

  it("keeps Tokyo anti-government rally with No War banner", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title:
        "Thousands rally in Tokyo against Takaichi moves under 'No War' banner",
    });
    expect(verdict.relevant).toBe(true);
  });

  it("keeps abductee-family Tokyo rally dropped as ambiguous before FP-01", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title:
        "Abductees' families urge govt. to take concrete steps at Tokyo rally",
    });
    expect(verdict.relevant).toBe(true);
  });

  it("still drops motorsport rally homonym", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Ogier extends WRC Rally Japan lead after SS12",
      summary: "The rally leader pulled away on dirt stages near Sapporo.",
    });
    expect(verdict.relevant).toBe(false);
  });

  it("still drops interstate diplomatic lodge protest", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Malaysia lodges strong protest after Israeli interception of Gaza flotilla",
    });
    expect(verdict.relevant).toBe(false);
  });
});
