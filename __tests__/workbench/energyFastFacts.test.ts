import {
  buildEnergyEvidenceCards,
} from "../../artifacts/workbench/src/lib/energyFastFacts";
import {
  computeTopicFastFacts,
  type TopicFastFactsIncident,
} from "../../artifacts/workbench/src/lib/topicFastFacts";

const ISSUE_DATE = "2026-06-15";

function incident(
  title: string,
  overrides: Partial<TopicFastFactsIncident> = {},
): TopicFastFactsIncident {
  return {
    topic: "energy",
    title,
    severity: "moderate",
    occurredAt: "2026-06-14T10:00:00.000Z",
    country: "Philippines",
    ...overrides,
  };
}

function labels(cards: ReturnType<typeof computeTopicFastFacts>): string[] {
  return cards.map((card) => card.label);
}

describe("Energy Fast Facts contract", () => {
  it("keeps the reporting anchors when there is no energy data", () => {
    const cards = computeTopicFastFacts({
      topic: "energy",
      topicLabel: "Energy Watch",
      issueDate: ISSUE_DATE,
      incidents: [],
    });

    expect(labels(cards)).toEqual(
      expect.arrayContaining(["Reporting Period", "Most Affected Country"]),
    );
    expect(labels(cards)).not.toEqual(
      expect.arrayContaining([
        "Total Records",
        "Highest Severity",
        "Top Issue Type",
        "Latest Incident",
      ]),
    );
  });

  it("removes future and out-of-window rows before building evidence", () => {
    const inWindow = incident(
      "Substation fire cuts power to parts of Dhaka for hours",
      { country: "Bangladesh" },
    );
    const future = incident("Future substation outage should not be reported", {
      country: "India",
      occurredAt: "2026-06-16T10:00:00.000Z",
    });
    const old = incident("Old substation outage should not be reported", {
      country: "Nepal",
      occurredAt: "2026-06-01T10:00:00.000Z",
    });

    const cards = computeTopicFastFacts({
      topic: "energy",
      topicLabel: "Energy Watch",
      issueDate: ISSUE_DATE,
      incidents: [inWindow, future, old],
    });
    const evidenceNotes = cards
      .filter((card) => card.label !== "Reporting Period" && card.label !== "Most Affected Country")
      .map((card) => card.note ?? "")
      .join(" ");

    expect(cards.find((card) => card.label === "Most Affected Country")?.value).toBe("Bangladesh");
    expect(evidenceNotes).toContain("Substation fire cuts power to parts of Dhaka for hours");
    expect(evidenceNotes).not.toContain("Future substation outage");
    expect(evidenceNotes).not.toContain("Old substation outage");
  });

  it("removes unrelated topics for Energy while leaving other topic cards generic", () => {
    const unrelated = incident("Tanker attacked by armed skiffs in the Gulf of Aden", {
      topic: "shipping",
      country: "Yemen",
    });
    const energy = incident("Power shortage worsens across Cebu", {
      country: "Philippines",
    });
    const energyCards = computeTopicFastFacts({
      topic: "energy",
      topicLabel: "Energy Watch",
      issueDate: ISSUE_DATE,
      incidents: [energy, unrelated],
    });
    const energyEvidenceNotes = energyCards
      .map((card) => card.note ?? "")
      .join(" ");

    expect(energyCards.find((card) => card.label === "Most Affected Country")?.value).toBe(
      "Philippines",
    );
    expect(energyEvidenceNotes).not.toContain("Tanker attacked");

    const fuelCards = computeTopicFastFacts({
      topic: "fuel",
      topicLabel: "Fuel Watch",
      issueDate: ISSUE_DATE,
      incidents: [
        incident("Refinery fire disrupts fuel supply in Pakistan", {
          topic: "fuel",
          country: "Pakistan",
        }),
      ],
    });
    expect(labels(fuelCards)).toEqual(
      expect.arrayContaining([
        "Reporting Period",
        "Total Records",
        "Highest Severity",
        "Top Issue Type",
        "Most Affected Country",
        "Latest Incident",
      ]),
    );
  });

  it("prefers displayTitle, deduplicates identical headlines, and keeps cards bounded", () => {
    const sourceHeadline =
      "Cebu faces longer brownouts as Visayas power shortage worsens";
    const cards = buildEnergyEvidenceCards([
      incident("Internal translated title", {
        displayTitle: sourceHeadline,
      }),
      incident("Internal duplicate title", {
        displayTitle: sourceHeadline,
        id: "duplicate",
      }),
      incident("A second power shortage develops in Davao", {
        country: "Philippines",
      }),
      incident("A third power shortage develops in Iloilo", {
        country: "Philippines",
      }),
      incident("A fourth power shortage develops in Bacolod", {
        country: "Philippines",
      }),
      incident("A fifth power shortage develops in Cebu", {
        country: "Philippines",
      }),
    ]);

    expect(cards.length).toBeLessThanOrEqual(4);
    expect(cards.filter((card) => card.note === sourceHeadline)).toHaveLength(1);
    expect(cards.some((card) => (card.note ?? "").includes("Internal translated title"))).toBe(
      false,
    );
  });

  it("uses Power Demand for an observed demand development", () => {
    const cards = buildEnergyEvidenceCards([
      incident("Peak power demand hits a record in Delhi", { country: "India" }),
    ]);

    expect(cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Power Demand",
          value: "Record electricity demand",
          note: "Peak power demand hits a record in Delhi",
        }),
      ]),
    );
  });

  it("does not turn forecast-only reporting into a confirmed outage", () => {
    const cards = computeTopicFastFacts({
      topic: "energy",
      topicLabel: "Energy Watch",
      issueDate: ISSUE_DATE,
      incidents: [
        incident("Peak power demand forecast revised upward for Delhi", {
          country: "India",
        }),
      ],
    });

    expect(labels(cards)).not.toEqual(
      expect.arrayContaining(["Power Supply", "Infrastructure Outage"]),
    );
    expect(cards.every((card) => !(card.note ?? "").includes("forecast"))).toBe(true);
  });

  it("does not turn a negated no-outage headline into an evidence card", () => {
    const cards = buildEnergyEvidenceCards([
      incident("Power outage fears fade as officials report no outages", {
        country: "India",
      }),
    ]);

    expect(cards.some((card) =>
      ["Power Supply", "Infrastructure Outage", "Power Demand", "Additional Development"]
        .includes(card.label),
    )).toBe(false);
  });
});