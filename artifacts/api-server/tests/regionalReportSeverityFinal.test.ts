import { reassessRegionalSeverity } from "../src/lib/regionalReportSeverity";

describe("regional final severity evidence", () => {
  it("keeps active-voice confirmed deaths as auditable High evidence", () => {
    const fact = "A Houthi drone attack in Saudi Arabia killed one person.";
    expect(reassessRegionalSeverity({ confirmedFacts: [fact], severity: "High" })).toEqual({
      severity: "High",
      rationale: "Confirmed deaths or injuries support a High rating.",
      evidence: [fact],
    });
  });

  it("does not turn hypothetical casualties into a confirmed consequence", () => {
    expect(reassessRegionalSeverity({
      confirmedFacts: ["A further attack could kill one person."], severity: "Moderate",
    }).severity).toBe("Moderate");
  });
});