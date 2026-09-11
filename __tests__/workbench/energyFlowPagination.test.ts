import { energyFlowBulletItems } from "../../artifacts/workbench/src/components/EnergyFlowPages";

describe("Energy Watch flowing recommendation content", () => {
  it("retains more than ten complete newline recommendations, including long multi-sentence text", () => {
    const longRecommendation =
      "Maintain alternate procurement approvals before the next review. This recommendation is deliberately multi-sentence and remains materially important after the first sentence. Escalate any exception through the operational resilience lead.";
    const source = [
      ...Array.from({ length: 11 }, (_, index) => `- Recommendation ${index + 1}: retain this complete action.`),
      `• ${longRecommendation}`,
    ].join("\n");

    const items = energyFlowBulletItems(source);

    expect(items).toHaveLength(12);
    expect(items[0]).toBe("Recommendation 1: retain this complete action.");
    expect(items[10]).toBe("Recommendation 11: retain this complete action.");
    expect(items[11]).toBe(longRecommendation);
    expect(items.join("\n")).toContain(
      "This recommendation is deliberately multi-sentence and remains materially important after the first sentence.",
    );
  });
});