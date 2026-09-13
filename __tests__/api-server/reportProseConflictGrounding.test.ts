import {
  parseTopicSections,
  type GenerateReportProseInput,
} from "../../artifacts/api-server/src/lib/reportProse";

const input: GenerateReportProseInput = {
  topic: "conflict",
  title: "Conflict Watch",
  periodWord: "this week",
  basisDays: 7,
  issueDate: "2026-07-10",
  canonicalEvidenceIds: ["incident-1"],
  incidents: [{
    id: "incident-1",
    title: "Militants attack a checkpoint in Exampleland",
    country: "Exampleland",
    severity: "High",
    occurredAt: "2026-07-10T08:00:00Z",
  }],
};

const required = {
  executiveSummary: "Summary",
  situation: "Situation",
  whatHappened: "What happened",
  whatMatters: "What matters",
  implications: ["Implication"],
  polestarView: "Polestar",
};

describe("Conflict AI Watch Next grounding", () => {
  it("retains only conditional items bound to current incident IDs", () => {
    const result = parseTopicSections(
      JSON.stringify({
        ...required,
        watchNext: [
          {
            text: "Monitor whether attacks recur near the checkpoint.",
            supportingIncidentIds: ["incident-1"],
          },
          {
            text: "Monitor a separate conflict in Nowhere.",
            supportingIncidentIds: ["missing"],
          },
          {
            text: "The checkpoint is under attack.",
            supportingIncidentIds: ["incident-1"],
          },
        ],
      }),
      input,
    );
    expect(result?.watchNext).toBe(
      "Monitor whether attacks recur near the checkpoint.",
    );
    expect(result?.provenance?.watchNext).toEqual([{
      supportingIncidentIds: ["incident-1"],
      supportingEvidenceFamilyIds: [],
      verifiedText: "Monitor whether attacks recur near the checkpoint.",
    }]);
  });

  it("rejects legacy unbound Watch Next prose", () => {
    const result = parseTopicSections(
      JSON.stringify({
        ...required,
        watchNext: "Monitor renewed fighting in a different country.",
      }),
      input,
    );
    expect(result?.watchNext).toBe("");
    expect(result?.provenance?.watchNext).toEqual([]);
  });
});