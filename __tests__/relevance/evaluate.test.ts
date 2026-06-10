import { evaluateIncidentRelevance } from "@workspace/relevance";

describe("evaluateIncidentRelevance", () => {
  it("scores irrelevant records as zero", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Stocks extend rally as markets surge",
    });
    expect(verdict.relevant).toBe(false);
    expect(verdict.status).toBe("irrelevant");
    expect(verdict.score).toBe(0);
  });

  it("scores title-rescued records as one", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Teachers protest abduction of colleague",
    });
    expect(verdict.relevant).toBe(true);
    expect(verdict.score).toBe(1);
    expect(verdict.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("scores ambiguous-token keeps below certainty", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Nationwide rally builds in capital",
      summary: "Trade union leaders detained by police",
    });
    expect(verdict.relevant).toBe(true);
    expect(verdict.reason).toContain("ambiguous token");
    expect(verdict.score).toBe(0.7);
  });
});
