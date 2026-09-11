import { computeTopicFastFacts } from "../../artifacts/workbench/src/lib/topicFastFacts";

describe("topicFastFacts — Energy evidence cards", () => {
  const issueDate = "2026-06-20";

  it("keeps the anchors but emits no obsolete metadata for forecast-only rows", () => {
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
    const cardLabels = cards.map((card) => card.label);
    expect(cardLabels).toEqual(
      expect.arrayContaining(["Reporting Period", "Most Affected Country"]),
    );
    expect(cardLabels).not.toEqual(
      expect.arrayContaining([
        "Total Records",
        "Highest Severity",
        "Top Issue Type",
        "Latest Incident",
      ]),
    );
    expect(cards.some((card) => (card.note ?? "").includes("forecast"))).toBe(false);
    expect(cards.some((card) => (card.note ?? "").includes("Data quality issue"))).toBe(false);
  });

  it("uses source headlines as evidence instead of generic issue metadata", () => {
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
    const evidenceNotes = cards.map((card) => card.note ?? "").join(" ");
    expect(evidenceNotes).toContain("Power outages hit Karachi after transmission fault");
    expect(evidenceNotes).toContain("More power outages reported across Sindh");
    expect(cards.map((card) => card.label)).not.toEqual(
      expect.arrayContaining([
        "Total Records",
        "Highest Severity",
        "Top Issue Type",
        "Latest Incident",
      ]),
    );
  });
});
