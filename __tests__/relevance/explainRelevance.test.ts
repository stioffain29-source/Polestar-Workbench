import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

function input(overrides: Partial<RelevanceInput> & Pick<RelevanceInput, "topic" | "title">): RelevanceInput {
  return {
    summary: "",
    ...overrides,
  };
}

describe("explainRelevance", () => {
  describe("flashpoint", () => {
    it("rescues unmistakable protest headlines even when the summary mentions air strike", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Teachers protest abduction of colleague",
          summary: "Background mentions an air strike elsewhere",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("title-rescue");
    });

    it("drops sports headlines that misuse the word protest", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Malaysia awarded takraw title after Thailand protest referee's call",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("homonym in headline");
    });

    it("drops market rally headlines without public-order context", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Stocks extend rally as markets surge",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toMatch(/homonym|ambiguous token/);
    });

    it("keeps genuine protest records with unambiguous cues", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Thousands march in Dhaka over wage dispute",
          summary: "Police deploy tear gas as protesters clash with security forces",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toMatch(/unambiguous|ambiguous token/);
    });

    it("drops student crime stories that are not mobilisation", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Student raped near campus in provincial town",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("student non-mobilisation");
    });
  });

  describe("cargo_watch", () => {
    it("drops retail shoplifting noise", () => {
      const result = explainRelevance(
        "cargo_watch",
        input({
          topic: "cargo_watch",
          title: "Retail shoplifting wave hits stores nationwide",
          summary: "Cargo theft trends discussed in commentary",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("cargo off-topic");
    });

    it("keeps concrete hijack events", () => {
      const result = explainRelevance(
        "cargo_watch",
        input({
          topic: "cargo_watch",
          title: "Truck hijacked on Malaysia-Thailand route",
          summary: "Armed men seized container load at checkpoint",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });
  });

  describe("shipping", () => {
    it("drops vessel sale-and-purchase commentary", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Owner cashes in on ageing suezmax pair",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("shipping off-topic");
    });

    it("keeps maritime seizure incidents", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Tanker seized by naval forces in Gulf",
          summary: "Vessel boarded and diverted to port",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });
  });

  describe("fuel", () => {
    it("drops bank price-call commentary", () => {
      const result = explainRelevance(
        "fuel",
        input({
          topic: "fuel",
          title: "Goldman forecasts Brent crude to reach $120 per barrel",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("fuel off-topic");
    });
  });
});
