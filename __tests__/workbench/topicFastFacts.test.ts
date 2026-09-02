import { computeTopicFastFacts } from "../../artifacts/workbench/src/lib/topicFastFacts";

describe("topicFastFacts — Top Issue Type apology (TC-02)", () => {
  const issueDate = "2026-06-20";

  it("shows Data quality issue when the leader is Other energy incident", () => {
    const cards = computeTopicFastFacts({
      topic: "energy",
      topicLabel: "Energy Watch",
      issueDate,
      incidents: [
        {
          topic: "energy",
          title: "Peak power demand forecast revised upward for Delhi",
          severity: "Moderate",
          occurredAt: "2026-06-18T10:00:00Z",
          country: "India",
        },
        {
          topic: "energy",
          title: "Peak power demand outlook updated for Maharashtra",
          severity: "Low",
          occurredAt: "2026-06-17T10:00:00Z",
          country: "India",
        },
      ],
    });
    const topType = cards.find((c) => c.label === "Top Issue Type");
    expect(topType?.value).toBe("Multiple energy incident types");
    expect(topType?.note).toBe("Data quality issue");
  });

  it("shows a count note for a real Power outage plurality", () => {
    const cards = computeTopicFastFacts({
      topic: "energy",
      topicLabel: "Energy Watch",
      issueDate,
      incidents: [
        {
          topic: "energy",
          title: "Power outages hit Karachi after transmission fault",
          severity: "High",
          occurredAt: "2026-06-18T10:00:00Z",
          country: "Pakistan",
        },
        {
          topic: "energy",
          title: "More power outages reported across Sindh",
          severity: "Moderate",
          occurredAt: "2026-06-17T10:00:00Z",
          country: "Pakistan",
        },
      ],
    });
    const topType = cards.find((c) => c.label === "Top Issue Type");
    expect(topType?.value).toBe("Power outage");
    expect(topType?.note).toBe("2 records");
  });
});
