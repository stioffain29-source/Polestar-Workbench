import { explainRelevance, isFlashpointProcessNotEvent } from "@workspace/relevance";

describe("Flashpoint process-vs-event (Sprint B C1/C2/C9)", () => {
  it("drops a rights-commission investigation that only names a past protest", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Human rights commission opens investigation into last month's protest deaths",
      summary: "The inquiry will take witness statements from officials.",
    });
    expect(isFlashpointProcessNotEvent(
      "Human rights commission opens investigation into last month's protest deaths",
      "The inquiry will take witness statements from officials.",
    )).toBe(true);
    expect(verdict.relevant).toBe(false);
    expect(verdict.reason).toMatch(/process|investigation/i);
  });

  it("drops an arrest-over-crackdown accountability row", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Former interior minister arrested over last year's protest crackdown",
    });
    expect(verdict.relevant).toBe(false);
  });

  it("keeps a live gathering that demands a probe", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Workers marched through the capital demanding a probe into last month's crackdown",
      summary: "Demonstrators remained in a sit-in outside the municipal offices.",
    });
    expect(verdict.relevant).toBe(true);
  });

  it("keeps an ordinary street protest with no process framing", () => {
    const verdict = explainRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Thousands rally in Hanoi against Takaichi moves under a No War banner",
    });
    expect(verdict.relevant).toBe(true);
  });
});
