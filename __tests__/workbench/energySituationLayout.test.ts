import { segmentEnergySituationProse } from "../../artifacts/workbench/src/lib/energySituationLayout";

describe("Energy source-led sections", () => {
  it("does not fabricate Visayas or Dhaka headings from the uploaded report's prose", () => {
    const overview = "The reporting period shows a mix of supply shortfall, grid instability and tariff pressure across several markets. In the Philippines, tight supply and power plant outages coincided with recurring rotational brownouts in the Visayas and a renewed red alert on the grid, while wholesale prices in the region rose sharply.";
    const detail = "In the Philippines, the Visayas remained under pressure. Consumers were reported to have endured recurring rotational brownouts in August.";
    const dhaka = "The most acute single disruption in the window was in Dhaka, where a substation fire cut power to parts of the city for hours.";
    const result = segmentEnergySituationProse([overview, detail, dhaka].join("\n\n"));
    expect(result.map((s) => s.text)).toEqual([overview, detail, dhaka]);
    expect(result.every((s) => s.heading === null)).toBe(true);
  });

  it("supports source headings for any geography or issue, without a fixed country list", () => {
    const result = segmentEnergySituationProse("Brief cross-cutting assessment.\n\n## Chile — Transmission\nA line outage interrupted supply.\n\n## Industrial electricity costs\nCosts increased for affected operators.");
    expect(result.filter((s) => s.kind === "standalone-label").map((s) => s.heading))
      .toEqual(["Chile — Transmission", "Industrial electricity costs"]);
    expect(result.some((s) => s.text.startsWith("##"))).toBe(false);
  });

  it("groups repeated explicit labels once and retains distinct detail without duplicate paragraphs", () => {
    const result = segmentEnergySituationProse("PHILIPPINES / VISAYAS\nFirst supported detail.\nBANGLADESH / DHAKA\nAnother supported detail.\nPHILIPPINES / VISAYAS\nSecond supported detail.\nFirst supported detail.");
    expect(result.map((s) => s.text)).toEqual([
      "PHILIPPINES / VISAYAS", "First supported detail.", "Second supported detail.",
      "BANGLADESH / DHAKA", "Another supported detail.",
    ]);
  });
});