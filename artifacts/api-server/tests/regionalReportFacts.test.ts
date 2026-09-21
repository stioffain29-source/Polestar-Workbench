import { describe, expect, it, jest } from "@jest/globals";
import type { RegionalIncident } from "../../workbench/src/lib/regionalWeekly";
import type {
  GroundedRegionalEvent,
  RegionalExtraction,
  RegionalFactPacket,
} from "../src/lib/regionalReportFacts";

jest.mock("../src/lib/regionalAi", () => ({ regionalJson: jest.fn() }));

import {
  prepareRegionalFactPackets,
  selectGroundedRegionalEvents,
  validateRegionalExtraction,
} from "../src/lib/regionalReportFacts";
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
      reason: "The event jurisdiction is outside this region.",
    }]);
  });

  it("uses the explicit include decision even when excludeReason is ':null'", () => {
    const result = validateRegionalExtraction({
      candidates: [candidate({ decision: "include", excludeReason: ":null" })],
    }, [packet()], "apac_weekly");
    expect(result.rejected).toEqual([]);
    expect(result.events).toHaveLength(1);
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
    expect(result.rejected).toEqual([{ candidateId: "event-1", reason }]);
  });

  it("rejects mastheads and source debris in extracted copy", () => {
    expect(() => validateRegionalExtraction({
      candidates: [candidate({ title: "Reuters: terminal handling suspended" })],
    }, [packet()], "apac_weekly")).toThrow(
      "The extracted title is not edited factual copy: event-1.",
    );
  });

  it("rejects a title copied exactly from the raw source headline", () => {
    const title = "Yokohama terminal suspends cargo handling";
    expect(() => validateRegionalExtraction({
      candidates: [candidate({ title })],
    }, [packet(`${title}\nThe terminal in Yokohama suspended cargo handling.`)], "apac_weekly"))
      .toThrow("A raw source headline was copied instead of an edited title for event-1.");
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