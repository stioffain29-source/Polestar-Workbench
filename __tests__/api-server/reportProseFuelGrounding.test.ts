import {
  parseTopicSections,
  type GenerateReportProseInput,
} from "../../artifacts/api-server/src/lib/reportProse";

const baseInput = (): GenerateReportProseInput => ({
  topic: "fuel",
  title: "Fuel Watch",
  periodWord: "this week",
  basisDays: 7,
  issueDate: "2026-07-10",
  canonicalEvidenceIds: ["observed-1", "potential-1"],
  incidents: [
    {
      id: "observed-1",
      evidenceId: "observed-1",
      title: "Depot outage interrupts diesel deliveries at Port Alpha",
      summary: "Road tanker deliveries are delayed.",
      location: "Port Alpha",
      country: "Exampleland",
      evidenceStatus: "Reported",
      supportedClaims: ["Diesel deliveries are delayed at Port Alpha."],
    },
    {
      id: "potential-1",
      evidenceId: "potential-1",
      title: "Possible ship-fuel shortage in Otherland",
      summary: "A potential shortage may affect bunkering.",
      location: "Otherland",
      country: "Otherland",
      evidenceStatus: "Potential",
      supportedClaims: ["Potential shortage may affect bunkering in Otherland."],
    },
  ],
});

const requiredSections = {
  executiveSummary: "Summary",
  situation: "Situation",
  whatMatters: "What matters",
  implications: ["Implication"],
  polestarView: "Polestar",
};

function parse(
  input: GenerateReportProseInput,
  whatHappened: unknown,
  watchNext: unknown,
) {
  return parseTopicSections(
    JSON.stringify({
      ...requiredSections,
      whatHappened,
      watchNext,
    }),
    input,
  );
}

describe("Fuel AI evidence grounding", () => {
  it("retains valid analytical sections when What Happened evidence binding fails", () => {
    const result = parse(
      baseInput(),
      [
        {
          text: "Unsupported paraphrase",
          supportingEvidenceIds: ["observed-1"],
          supportingClaim: "A different unsupported claim.",
        },
      ],
      [],
    );
    expect(result).not.toBeNull();
    expect(result?.executiveSummary).toBe("Summary");
    expect(result?.whatMatters).toBe("What matters");
    expect(result?.polestarView).toBe("Polestar");
    expect(result?.whatHappened).toBe("");
  });

  it("drops zero, unknown and semantically irrelevant cited IDs", () => {
    const result = parse(baseInput(), [
      { text: "ship-fuel shortage theme in India, Indonesia", supportingEvidenceIds: ["0"], supportingClaim: "Diesel deliveries are delayed at Port Alpha." },
      { text: "Separate reporting linked the wider disruption to war-related strain on refinery output, with refiners said to be favouring diesel over ship fuel", supportingEvidenceIds: ["observed-1"], supportingClaim: "India refinery exploded and caused shortages" },
      { text: "Diesel deliveries are delayed at Port Alpha.", supportingEvidenceIds: ["observed-1"], supportingClaim: "Diesel deliveries are delayed at Port Alpha." },
    ], [
      { text: "Expansion of aircraft refuelling restrictions beyond the airports already affected in Russia", supportingEvidenceIds: ["missing"], supportingClaim: "Diesel deliveries are delayed at Port Alpha." },
      { text: "Additional strikes by oil transporters or freight carriers in Pakistan", supportingEvidenceIds: ["observed-1"], supportingClaim: "Diesel deliveries are delayed at Port Alpha." },
    ]);
    expect(result?.whatHappened).toBe("Diesel deliveries are delayed at Port Alpha.");
    expect(result?.watchNext).toBe("");
  });

  it("retains mixed citations when a non-Potential ID semantically supports the item", () => {
    const result = parse(baseInput(), [
      {
        text: "Diesel deliveries are delayed at Port Alpha.",
        supportingEvidenceIds: ["observed-1", "potential-1"],
        supportingClaim: "Diesel deliveries are delayed at Port Alpha.",
      },
    ], [
      {
        text: "Monitor whether Diesel deliveries are delayed at Port Alpha.",
        supportingEvidenceIds: ["observed-1", "potential-1"],
        supportingClaim: "Diesel deliveries are delayed at Port Alpha.",
      },
    ]);
    expect(result?.whatHappened).toContain("Port Alpha");
    expect(result?.watchNext).toContain("Port Alpha");
  });

  it("allows Potential only for explicitly conditional Watch Next text", () => {
    const result = parse(baseInput(), [
      {
        text: "Diesel deliveries are delayed at Port Alpha.",
        supportingEvidenceIds: ["observed-1"],
        supportingClaim: "Diesel deliveries are delayed at Port Alpha.",
      },
      {
        text: "A potential shortage may affect bunkering in Otherland.",
        supportingEvidenceIds: ["potential-1"],
        supportingClaim: "Potential shortage may affect bunkering in Otherland.",
      },
    ], [
      {
        text: "Monitor whether Potential shortage may affect bunkering in Otherland.",
        supportingEvidenceIds: ["potential-1"],
        supportingClaim: "Potential shortage may affect bunkering in Otherland.",
      },
      {
        text: "The shortage affects bunkering in Otherland.",
        supportingEvidenceIds: ["potential-1"],
        supportingClaim: "Potential shortage may affect bunkering in Otherland.",
      },
      {
        text: "Monitor risk.",
        supportingEvidenceIds: ["potential-1"],
        supportingClaim: "Potential shortage may affect bunkering in Otherland.",
      },
    ]);
    expect(result?.whatHappened).toBe("Diesel deliveries are delayed at Port Alpha.");
    expect(result?.watchNext).toBe(
      "Monitor whether Potential shortage may affect bunkering in Otherland.",
    );
  });
});