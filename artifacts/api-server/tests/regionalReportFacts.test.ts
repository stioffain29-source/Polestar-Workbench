import { describe, expect, it, jest } from "@jest/globals";
import type { RegionalIncident } from "../../workbench/src/lib/regionalWeekly";
import type {
  GroundedRegionalEvent,
  RegionalExtraction,
  RegionalFactPacket,
} from "../src/lib/regionalReportFacts";

jest.mock("../src/lib/regionalAi", () => ({ regionalJson: jest.fn() }));

import {
  describeRegionalVerificationShortfall,
  prepareRegionalFactPackets,
  selectGroundedRegionalEvents,
  validateRegionalExtraction,
  verifyAndRepairRegionalExtraction,
} from "../src/lib/regionalReportFacts";
import { regionalJson } from "../src/lib/regionalAi";

const mockedRegionalJson = regionalJson as unknown as jest.Mock<() => Promise<RegionalExtraction>>;
import { reassessRegionalSeverity } from "../src/lib/regionalReportSeverity";
import { regionalAnalyticalInput } from "../src/lib/regionalReportEditorial";

const sourceRow = (
  id: number,
  country: string,
  occurredAt = "2026-09-17",
  title = "Port closure suspends cargo handling",
): RegionalIncident => ({
  id,
  country,
  occurredAt,
  incidentDate: occurredAt,
  title,
  summary: `${title}. The affected operator confirmed the interruption.`,
  source: "Official bulletin",
  severity: "high",
});

const packet = (
  text = "The terminal in Yokohama suspended cargo handling.",
): RegionalFactPacket => ({
  candidateId: "event-1",
  countryHint: "Japan",
  eventDate: "2026-09-17",
  dateBasis: "event",
  sources: [{ id: "1", text, reportedAt: "2026-09-17" }],
  members: [sourceRow(1, "Japan")],
});

const candidate = (
  overrides: Partial<RegionalExtraction["candidates"][number]> = {},
): RegionalExtraction["candidates"][number] => ({
  candidateId: "event-1",
  decision: "include",
  excludeReason: "",
  eventCountry: "Japan",
  location: "Yokohama",
  eventIdentity: "terminal suspension",
  title: "Terminal handling suspended",
  facts: [{
    statement: "The terminal in Yokohama suspended cargo handling.",
    sourceId: "1",
    quote: "The terminal in Yokohama suspended cargo handling.",
  }],
  uncertainties: [],
  businessMateriality: 4,
  ...overrides,
});

const groundedEvent = (
  eventKey: string,
  overrides: Partial<GroundedRegionalEvent> = {},
): GroundedRegionalEvent => ({
  candidateId: eventKey,
  eventKey,
  country: "Japan",
  location: "Yokohama",
  eventDate: "2026-09-17",
  dateBasis: "event",
  category: "Operational Disruption",
  severity: "High",
  title: "Port handling suspended",
  confirmedFacts: ["The terminal suspended cargo handling."],
  evidenceIds: [eventKey],
  uncertainties: [],
  businessMateriality: 4,
  sourceEvidence: ["Official bulletin"],
  quotations: [{
    statement: "The terminal suspended cargo handling.",
    sourceId: eventKey,
    quote: "The terminal suspended cargo handling.",
  }],
  sourceRows: [sourceRow(Number(eventKey.replace(/\D/g, "")) || 1, "Japan")],
  severityRationale: "Test fixture baseline.",
  severityEvidence: [],
  ...overrides,
});

describe("regional report structured-facts pipeline", () => {
  it("uses the actual seven-day date window before candidate preparation", () => {
    const packets = prepareRegionalFactPackets([
      sourceRow(1, "Japan", "2026-09-12"),
      sourceRow(2, "Singapore", "2026-09-11"),
      sourceRow(3, "Australia", "2026-09-19"),
    ], "apac_weekly", "2026-09-18");
    const ids = packets.flatMap((row) => row.members.map((member) => member.id));
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
  });

  it("rejects unsupported event jurisdictions", () => {
    const result = validateRegionalExtraction({
      candidates: [candidate({
        eventCountry: "France",
        location: "Paris",
        facts: [],
      })],
    }, [packet()], "apac_weekly");
    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([{
      candidateId: "event-1",
      kind: "excluded",
      reason: "The event jurisdiction is outside this region.",
    }]);
  });

  it("uses the explicit include decision even when excludeReason is ':null'", () => {
    const result = validateRegionalExtraction({
      candidates: [candidate({ decision: "include", excludeReason: ":null" })],
    }, [packet()], "apac_weekly");
    expect(result.rejected).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].severityRationale).toBeTruthy();
    expect(result.events[0].severityEvidence).toEqual([]);
  });

  it("rejects candidates whose explicit decision is exclude", () => {
    const reason = "No verified operational consequence.";
    const result = validateRegionalExtraction({
      candidates: [candidate({
        decision: "exclude",
        excludeReason: reason,
        eventCountry: "",
        location: "",
        eventIdentity: "",
        title: "",
        facts: [],
        businessMateriality: 0,
      })],
    }, [packet()], "apac_weekly");
    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([{ candidateId: "event-1", kind: "excluded", reason }]);
  });

  it("rejects mastheads and source debris in extracted copy", () => {
    const result = validateRegionalExtraction({
      candidates: [candidate({ title: "Reuters: terminal handling suspended" })],
    }, [packet()], "apac_weekly");
    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([{
      candidateId: "event-1",
      kind: "unverified",
      reason: "The extracted title is not edited factual copy.",
    }]);
  });

  it("rejects a title copied exactly from the raw source headline", () => {
    const title = "Yokohama terminal suspends cargo handling";
    const result = validateRegionalExtraction({
      candidates: [candidate({ title })],
    }, [packet(`${title}\nThe terminal in Yokohama suspended cargo handling.`)], "apac_weekly");
    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([{
      candidateId: "event-1",
      kind: "unverified",
      reason: "A raw source headline was copied instead of an edited title.",
    }]);
  });

  it("drops only the unverifiable candidate and keeps every other event", () => {
    const packets = [1, 2, 3].map((index) => ({ ...packet(), candidateId: `event-${index}` }));
    const candidates = packets.map((row, index) => candidate({
      candidateId: row.candidateId,
      eventIdentity: `terminal suspension ${index}`,
    }));
    const statement = "\"Yokohama terminal halts all cargo handling after fire\", the report said.";
    candidates[1] = candidate({
      candidateId: "event-2",
      facts: [{ statement, sourceId: "1", quote: "The terminal in Yokohama suspended cargo handling." }],
    });

    const result = validateRegionalExtraction({ candidates }, packets, "apac_weekly");
    expect(result.events.map((event) => event.candidateId)).toEqual(["event-1", "event-3"]);
    expect(result.rejected).toEqual([{
      candidateId: "event-2",
      kind: "unverified",
      reason: expect.stringContaining("Fact verification failed:"),
      evidence: { statement, quote: "The terminal in Yokohama suspended cargo handling." },
    }]);
    expect(result.rejected[0].reason)
      .toContain("A quoted span this long reproduces source copy");
  });

  it("keeps a candidate that quotes a named vessel in an otherwise factual sentence", () => {
    const text = "The bulk carrier MV Pacific Star resumed cargo handling in Yokohama.";
    // The real extraction path always supplies the source headline, and the
    // quoted name occurs inside it: that is naming, not reproduced copy.
    const sourcePacket = {
      ...packet(text),
      sources: [{
        id: "1",
        text,
        headline: "MV Pacific Star resumes cargo handling at Yokohama",
        reportedAt: "2026-09-17",
      }],
    };
    const result = validateRegionalExtraction({
      candidates: [candidate({
        facts: [{
          statement: "The bulk carrier \"MV Pacific Star\" resumed cargo handling in Yokohama.",
          sourceId: "1",
          quote: "The bulk carrier MV Pacific Star resumed cargo handling in Yokohama.",
        }],
      })],
    }, [sourcePacket], "apac_weekly");
    expect(result.rejected).toEqual([]);
    expect(result.events).toHaveLength(1);
  });

  it("states the verification arithmetic when too few candidates survive", () => {
    const packets = [1, 2, 3, 4, 5, 6].map((index) => ({ ...packet(), candidateId: `event-${index}` }));
    const message = describeRegionalVerificationShortfall(packets, {
      events: [groundedEvent("japan:one"), groundedEvent("japan:two"), groundedEvent("japan:three")],
      rejected: [
        { candidateId: "event-4", kind: "excluded", reason: "The event jurisdiction is outside this region." },
        { candidateId: "event-5", kind: "unverified", reason: "Fact verification failed: A numerical claim is not supported by its quotation." },
        { candidateId: "event-6", kind: "unverified", reason: "The factual summary is too long." },
      ],
    }, 5);
    expect(message).toContain("Only 3 of 6 regional candidates passed fact verification; 5 are required.");
    expect(message).toContain("1 candidate was excluded as outside the region");
    expect(message).toContain("2 candidates were dropped after the correction pass:");
    expect(message).toContain("A numerical claim is not supported by its quotation.");
    expect(message).toContain("The factual summary is too long.");
    expect(message).toContain("No report was generated.");
  });

  it("drops a candidate the correction pass could not fix instead of failing the run", async () => {
    const packets = [1, 2].map((index) => ({ ...packet(), candidateId: `event-${index}` }));
    const broken = candidate({
      candidateId: "event-2",
      facts: [{
        statement: "The terminal suspended cargo handling, one report said.",
        sourceId: "1",
        quote: "The terminal in Yokohama suspended cargo handling.",
      }],
    });
    const extraction = {
      candidates: [candidate({ candidateId: "event-1" }), broken],
    };
    mockedRegionalJson.mockResolvedValueOnce({ candidates: [broken] });

    const result = await verifyAndRepairRegionalExtraction(extraction, packets, "apac_weekly", "2026-09-18");
    expect(mockedRegionalJson).toHaveBeenCalledTimes(1);
    expect(result.events.map((event) => event.candidateId)).toEqual(["event-1"]);
    expect(result.rejected).toEqual([{
      candidateId: "event-2",
      kind: "unverified",
      reason: expect.stringContaining("do not wrap or quote a headline in report-attribution text"),
      evidence: {
        statement: "The terminal suspended cargo handling, one report said.",
        quote: "The terminal in Yokohama suspended cargo handling.",
      },
    }]);
  });

  it("rates LPG supply stress Moderate without confirmed material consequences", () => {
    const assessment = reassessRegionalSeverity({
      severity: "High",
      category: "Energy",
      confirmedFacts: [
        "LPG supply stress is affecting Nepal.",
        "Business curtailment is not confirmed and affected locations are unclear.",
      ],
    });
    expect(assessment.severity).toBe("Moderate");
    expect(assessment.evidence).toEqual(["LPG supply stress is affecting Nepal."]);
  });

  it("rates confirmed sustained multi-location LPG failure High", () => {
    const assessment = reassessRegionalSeverity({
      severity: "Moderate",
      confirmedFacts: ["LPG remained unavailable for two weeks across multiple cities."],
    });
    expect(assessment.severity).toBe("High");
  });

  it.each([
    ["Airport fuel depot was attacked.", "Moderate"],
    ["An attack interrupted the airport fuel depot and materially disrupted flights.", "High"],
    ["Drone attacks damaged three oil pumping stations.", "High"],
  ] as const)("reassesses Middle East infrastructure evidence: %s", (fact, severity) => {
    expect(reassessRegionalSeverity({
      severity: "Moderate",
      category: "Security",
      confirmedFacts: [fact],
    }).severity).toBe(severity);
  });

  it("rates the saved Riyadh airport depot attack High on confirmed fire evidence", () => {
    const assessment = reassessRegionalSeverity({
      severity: "Moderate",
      category: "Security",
      confirmedFacts: [
        "An airport fuel depot in Riyadh was hit in an attack.",
        "The strike set a fuel depot ablaze at an airport in the Saudi capital.",
      ],
    });
    expect(assessment.severity).toBe("High");
    expect(assessment.evidence).toEqual([
      "An airport fuel depot in Riyadh was hit in an attack.",
      "The strike set a fuel depot ablaze at an airport in the Saudi capital.",
    ]);
  });

  it("does not treat nearby smoke as confirmed critical-infrastructure damage", () => {
    const assessment = reassessRegionalSeverity({
      severity: "Moderate",
      category: "Security",
      confirmedFacts: [
        "An airport fuel depot was attacked.",
        "Smoke was observed nearby.",
      ],
    });
    expect(assessment.severity).toBe("Moderate");
  });

  it.each([
    "Flights faced major disruption after the airport attack.",
    "Three Saudi pipeline pumping stations were damaged in attacks.",
  ])("rates the confirmed live operational consequence High: %s", (fact) => {
    expect(reassessRegionalSeverity({
      severity: "Moderate",
      category: "Security",
      confirmedFacts: [fact],
    }).severity).toBe("High");
  });

  it("rates airport-first major flight disruption High despite later recovery", () => {
    const assessment = reassessRegionalSeverity({
      severity: "Moderate",
      category: "Operational Disruption",
      confirmedFacts: [
        "Riyadh airport faced major flight disruption after flames and smoke were seen nearby.",
        "Airport operations later recovered to normal.",
      ],
    });
    expect(assessment.severity).toBe("High");
    expect(assessment.evidence).toEqual([
      "Riyadh airport faced major flight disruption after flames and smoke were seen nearby.",
    ]);
  });

  it("can combine separate confirmed attack and critical-infrastructure damage facts", () => {
    const assessment = reassessRegionalSeverity({
      severity: "Moderate",
      confirmedFacts: [
        "Drones attacked energy facilities near Riyadh.",
        "Three oil pumping stations were damaged.",
      ],
    });
    expect(assessment.severity).toBe("High");
    expect(assessment.evidence).toHaveLength(2);
  });

  it("rejects incompatible flat quantities when extraction declares a source conflict", () => {
    const conflictingPacket: RegionalFactPacket = {
      ...packet(),
      countryHint: "Saudi Arabia",
      sources: [
        {
          id: "two",
          text: "Two Saudi East-West pipeline stations damaged in drone attack",
          reportedAt: "2026-09-16",
        },
        {
          id: "three",
          text: "Saudi pipeline attack damaged three pumping stations",
          reportedAt: "2026-09-17",
        },
      ],
    };
    const result = validateRegionalExtraction({
      candidates: [candidate({
        eventCountry: "Saudi Arabia",
        location: "Saudi Arabia",
        eventIdentity: "pipeline station attack damage",
        title: "Pipeline stations were damaged",
        facts: [
          {
            statement: "A drone attack damaged two Saudi East-West pipeline stations.",
            sourceId: "two",
            quote: "Two Saudi East-West pipeline stations damaged in drone attack",
          },
          {
            statement: "A Saudi pipeline attack damaged three pumping stations.",
            sourceId: "three",
            quote: "Saudi pipeline attack damaged three pumping stations",
          },
        ],
        uncertainties: ["Sources differ on whether two stations or three pumping stations were damaged."],
      })],
    }, [conflictingPacket], "middle_east_weekly");
    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([{
      candidateId: "event-1",
      kind: "unverified",
      reason: "Conflicting quantities must be reconciled to a supported common fact or explicitly attributed.",
    }]);
  });

  it("does not escalate forecast, uncertain, negated, or unconfirmed impacts", () => {
    const assessment = reassessRegionalSeverity({
      severity: "Low",
      confirmedFacts: [
        "Flights could be disrupted next week.",
        "Damage to the pumping station is unconfirmed.",
        "The airport reported no disruption.",
      ],
    });
    expect(assessment.severity).toBe("Low");
    expect(assessment.evidence).toEqual([]);
  });

  it("preserves supported casualty severity", () => {
    expect(reassessRegionalSeverity({
      severity: "High",
      confirmedFacts: ["The attack killed three people and injured six."],
    }).severity).toBe("High");
    expect(reassessRegionalSeverity({
      severity: "Extreme",
      confirmedFacts: ["The attack killed 24 people."],
    }).severity).toBe("Extreme");
  });

  it("merges the same eventKey while retaining every source id", () => {
    const selected = selectGroundedRegionalEvents([
      groundedEvent("japan:terminal-suspension", { evidenceIds: [11] }),
      groundedEvent("japan:terminal-suspension", { candidateId: "event-2", evidenceIds: [12] }),
      groundedEvent("singapore:data-rule", { country: "Singapore", category: "Regulatory" }),
      groundedEvent("australia:storm", { country: "Australia", category: "Weather & Natural Hazards" }),
      groundedEvent("india:power", { country: "India", category: "Energy" }),
      groundedEvent("malaysia:system", { country: "Malaysia", category: "Cyber" }),
    ]);
    expect(selected).toHaveLength(5);
    expect(selected.find((event) => event.eventKey === "japan:terminal-suspension")?.evidenceIds)
      .toEqual([11, 12]);
  });

  it("retains a genuine Cyber event in a six-event selection", () => {
    const selected = selectGroundedRegionalEvents([
      groundedEvent("japan:port", { severity: "Extreme" }),
      groundedEvent("india:attack", { country: "India", category: "Security" }),
      groundedEvent("australia:rule", { country: "Australia", category: "Regulatory" }),
      groundedEvent("philippines:storm", { country: "Philippines", category: "Weather & Natural Hazards" }),
      groundedEvent("indonesia:fuel", { country: "Indonesia", category: "Energy" }),
      groundedEvent("thailand:politics", { country: "Thailand", category: "Political" }),
      groundedEvent("malaysia:breach", { country: "Malaysia", category: "Cyber" }),
    ]);
    expect(selected).toHaveLength(6);
    expect(selected.some((event) => event.eventKey === "malaysia:breach")).toBe(true);
  });

  it("allows seven or eight high-materiality Middle East events without padding", () => {
    const events = Array.from({ length: 8 }, (_, index) => groundedEvent(`me:event-${index}`, {
      country: index % 2 ? "Saudi Arabia" : "Iraq",
      category: index === 0 ? "Cyber" : "Security",
      severity: "High",
    }));
    expect(selectGroundedRegionalEvents(events, "middle_east_weekly")).toHaveLength(8);
    expect(selectGroundedRegionalEvents(events.slice(0, 5), "middle_east_weekly")).toHaveLength(5);
    expect(selectGroundedRegionalEvents(events)).toHaveLength(6);
  });

  it("drops unchanged electricity-rate context and broadens country coverage before a second same-market incident", () => {
    const selected = selectGroundedRegionalEvents([
      groundedEvent("singapore:kept-electricity-rate", {
        country: "Singapore",
        severity: "Extreme",
        category: "Energy",
        confirmedFacts: ["The electricity rate was kept unchanged for the quarter."],
      }),
      groundedEvent("japan:port-one", {
        country: "Japan",
        severity: "Extreme",
        category: "Security",
      }),
      groundedEvent("japan:port-two", {
        country: "Japan",
        category: "Security",
      }),
      groundedEvent("malaysia:cyber-outage", {
        country: "Malaysia",
        category: "Cyber",
        confirmedFacts: ["The customer platform remained offline after a cyber incident."],
      }),
      groundedEvent("australia:facility", { country: "Australia", category: "Security" }),
      groundedEvent("india:facility", { country: "India", category: "Security" }),
      groundedEvent("indonesia:facility", { country: "Indonesia", category: "Security" }),
      groundedEvent("thailand:facility", { country: "Thailand", category: "Security" }),
    ]);
    const keys = selected.map((event) => event.eventKey);

    expect(selected).toHaveLength(6);
    expect(keys).not.toContain("singapore:kept-electricity-rate");
    expect(keys).toContain("malaysia:cyber-outage");
    expect(keys).toContain("thailand:facility");
    expect(keys).not.toContain("japan:port-two");
  });

  it("gives the analytical writer only checked structured facts", () => {
    const event = groundedEvent("japan:terminal-suspension");
    const input = regionalAnalyticalInput([event], "apac_weekly", "2026-09-18");
    expect(input.events[0]).toEqual({
      eventKey: event.eventKey,
      country: event.country,
      location: event.location,
      eventDate: event.eventDate,
      dateBasis: event.dateBasis,
      category: event.category,
      severity: event.severity,
      title: event.title,
      confirmedFacts: event.confirmedFacts,
      evidenceIds: event.evidenceIds,
      uncertainties: event.uncertainties,
    });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("sourceRows");
    expect(serialized).not.toContain("quotations");
    expect(serialized).not.toContain("Official bulletin");
    expect(serialized).not.toContain("Port closure suspends cargo handling");
  });
});