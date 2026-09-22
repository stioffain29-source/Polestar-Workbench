import { describe, expect, it } from "@jest/globals";
import {
  MIDDLE_EAST_COLLECTION_DOMAINS,
  validateRegionalContentPolicy,
} from "../../workbench/src/lib/regionalContentPolicy";
import type {
  RegionalCoverageCheck,
  RegionalCoverageManifest,
  RegionalFutureEventInput,
  RegionalWeeklyTopic,
} from "../../workbench/src/lib/regionalWeekly";
import {
  assembleRegionalEditorialReport,
  reassessRegionalEvents,
  type RegionalAnalysis,
} from "../src/lib/regionalReportEditorial";
import {
  validateRegionalExtraction,
  type RegionalExtraction,
  type RegionalFactPacket,
} from "../src/lib/regionalReportFacts";
import { reassessRegionalSeverity } from "../src/lib/regionalReportSeverity";

describe("regional casualty severity regression", () => {
  it("downgrades an attack-only event without inventing damage or retaining Extreme", () => {
    const fact = "A bomb attack struck a police post in Kohat.";
    expect(reassessRegionalSeverity({
      confirmedFacts: [fact],
      severity: "Extreme",
      category: "Security",
    })).toEqual({
      severity: "Moderate",
      rationale: expect.stringMatching(/attack/i),
      evidence: [fact],
    });
  });

  it.each([
    "The casualty toll after the attack remains unknown.",
    "Reports of casualties after the attack are unconfirmed.",
    "Authorities said reports of deaths after the attack were false.",
  ])("never escalates an attack on %s", (casualtyFact) => {
    const attackFact = "A bomb attack struck a police post in Kohat.";
    const assessment = reassessRegionalSeverity({
      confirmedFacts: [attackFact, casualtyFact],
      severity: "Extreme",
      category: "Security",
    });
    expect(assessment.severity).toBe("Moderate");
    expect(assessment.evidence).toEqual([attackFact]);
  });

  it.each([
    ["The death toll from the bombing of a police station in Kohat rose to seven.", "High"],
    ["ATS officer Riaz Khan was killed in the attack.", "High"],
    ["Three police officers were injured in the bombing in Kohat.", "High"],
    ["The death toll from the Kohat police-station bombing rose to 23.", "Extreme"],
  ] as const)("recognises supported casualty wording verbatim: %s", (fact, severity) => {
    const assessment = reassessRegionalSeverity({
      confirmedFacts: [fact],
      severity,
      category: "Security",
    });
    expect(assessment.severity).toBe(severity);
    expect(assessment.evidence).toEqual([fact]);
  });

  it("does not retain Extreme for exactly one person killed", () => {
    const fact = "One police officer was killed in the bombing in Kohat.";
    expect(reassessRegionalSeverity({
      confirmedFacts: [fact],
      severity: "Extreme",
      category: "Security",
    })).toMatchObject({
      severity: "High",
      evidence: [fact],
    });
  });

  it("is idempotent when final assembly reassesses the same supported facts", () => {
    const fact = "The death toll from the Kohat police-station bombing rose to 23.";
    const first = reassessRegionalSeverity({
      confirmedFacts: [fact],
      severity: "Extreme",
      category: "Security",
    });
    const second = reassessRegionalSeverity({
      confirmedFacts: [fact],
      severity: first.severity,
      category: "Security",
    });
    expect(second).toEqual(first);
  });
});

type EventFixture = {
  country: string;
  location: string;
  identity: string;
  title: string;
  fact: string;
};

const apacFixtures: EventFixture[] = [
  {
    country: "Pakistan",
    location: "Kohat",
    identity: "Kohat police bombing casualties",
    title: "Police officers injured in Kohat bombing",
    fact: "Three police officers were injured in the bombing in Kohat.",
  },
  {
    country: "Japan",
    location: "Tokyo",
    identity: "Tokyo hotel data breach",
    title: "Tokyo hotel disclosed customer data breach",
    fact: "A cyber breach exposed customer records at a hotel in Tokyo.",
  },
  {
    country: "Australia",
    location: "Cairns",
    identity: "Cairns flood road closure",
    title: "Flooding closed a road in Cairns",
    fact: "Flooding closed a local road in Cairns.",
  },
  {
    country: "Singapore",
    location: "Singapore",
    identity: "Singapore customs reporting rules",
    title: "Customs reporting rules took effect",
    fact: "Singapore implemented new customs reporting rules for importers.",
  },
  {
    country: "India",
    location: "Mumbai",
    identity: "Mumbai factory protest",
    title: "Workers protested outside Mumbai factory",
    fact: "Workers held a protest outside a factory in Mumbai.",
  },
  {
    country: "Philippines",
    location: "Cebu",
    identity: "Cebu cargo vessel delay",
    title: "Cargo vessel delayed at Cebu port",
    fact: "A cargo vessel was delayed at Cebu port.",
  },
];

const middleEastFixtures: EventFixture[] = [
  {
    country: "Saudi Arabia",
    location: "Riyadh",
    identity: "Riyadh bombing fatality toll",
    title: "Riyadh bombing toll reached 23",
    fact: "The death toll from the bombing in Riyadh rose to 23.",
  },
  {
    country: "Jordan",
    location: "Amman",
    identity: "Amman customs reporting rules",
    title: "Customs reporting rules took effect",
    fact: "Jordan implemented new customs reporting rules for importers in Amman.",
  },
  {
    country: "United Arab Emirates",
    location: "Dubai",
    identity: "Dubai hotel data breach",
    title: "Dubai hotel disclosed customer data breach",
    fact: "A cyber breach exposed customer records at a hotel in Dubai.",
  },
  {
    country: "Oman",
    location: "Sohar",
    identity: "Sohar cargo vessel delay",
    title: "Cargo vessel delayed at Sohar port",
    fact: "A cargo vessel was delayed at Sohar port.",
  },
  {
    country: "Iraq",
    location: "Basra",
    identity: "Basra factory protest",
    title: "Workers protested outside Basra factory",
    fact: "Workers held a protest outside a factory in Basra.",
  },
];

function extractedEvents(fixtures: EventFixture[], topic: RegionalWeeklyTopic) {
  const packets: RegionalFactPacket[] = fixtures.map((fixture, index) => ({
    candidateId: `event-${index + 1}`,
    countryHint: fixture.country,
    eventDate: "2026-09-17",
    dateBasis: "event",
    sources: [{
      id: `source-${index + 1}`,
      headline: `Official incident update ${index + 1}`,
      text: `Official incident update ${index + 1}\n${fixture.fact}`,
      reportedAt: "2026-09-17",
    }],
    members: [{
      id: `source-${index + 1}`,
      country: fixture.country,
      occurredAt: "2026-09-17",
      incidentDate: "2026-09-17",
      title: `Official incident update ${index + 1}`,
      summary: fixture.fact,
      source: "Official bulletin",
      latitude: 20 + index,
      longitude: 50 + index,
    }],
  }));
  const candidates: RegionalExtraction["candidates"] = fixtures.map((fixture, index) => ({
    candidateId: `event-${index + 1}`,
    decision: "include",
    excludeReason: "",
    eventCountry: fixture.country,
    location: fixture.location,
    eventIdentity: fixture.identity,
    title: fixture.title,
    facts: [{
      statement: fixture.fact,
      sourceId: `source-${index + 1}`,
      quote: fixture.fact,
    }],
    uncertainties: [],
    businessMateriality: 4,
  }));
  return validateRegionalExtraction({ candidates }, packets, topic).events;
}

function checked(domain: string): RegionalCoverageCheck {
  return {
    domain,
    status: "checked",
    sourceNames: ["Official bulletin"],
    itemsFetched: 1,
    candidatesAccepted: 1,
    errors: [],
  };
}

function coverage(topic: RegionalWeeklyTopic): RegionalCoverageManifest {
  if (topic === "apac_weekly") {
    const domains = ["security", "political", "regulatory", "operational", "energy", "weather", "cyber"];
    return {
      requiredDomains: domains,
      domains: domains.map(checked),
      forwardSearch: checked("forward"),
      requiredGeographies: apacFixtures.map((event) => event.country),
      searchedGeographies: apacFixtures.map((event) => event.country),
    };
  }
  const requiredForwardDomains = Array.from({ length: 11 }, (_, index) => `forward-${index}`);
  return {
    requiredDomains: [...MIDDLE_EAST_COLLECTION_DOMAINS],
    domains: MIDDLE_EAST_COLLECTION_DOMAINS.map(checked),
    forwardSearch: checked("forward"),
    requiredGeographies: middleEastFixtures.map((event) => event.country),
    searchedGeographies: middleEastFixtures.map((event) => event.country),
    requiredForwardDomains,
    forwardDomains: requiredForwardDomains.map(checked),
    collectionPasses: 2,
  };
}

function outlook(countries: string[]): string {
  const opening = `${countries.join(", ")} present connected operating questions that should be compared through verified consequences rather than assumed escalation.`;
  const body = "Operators should rank confirmed effects, distinguish direct disruption from contingent exposure, and use official recovery signals to adjust security, mobility, compliance, logistics, staffing, and digital continuity decisions.";
  return `${opening} ${body.repeat(10)}`.trim().split(/\s+/).slice(0, 135).join(" ");
}

function analysisFor(events: ReturnType<typeof extractedEvents>): RegionalAnalysis {
  const keys = events.map((event) => event.eventKey);
  return {
    regionalOutlook: {
      text: "Verified consequences create different operating decisions across the region.",
      evidenceKeys: keys,
    },
    riskPicture: {
      text: "Direct incident effects remain distinct from wider contingent exposure.",
      evidenceKeys: keys,
    },
    polestarOutlook: {
      text: outlook(events.map((event) => event.country)),
      evidenceKeys: keys,
    },
    businessImplications: [{
      heading: "Operations & Assets",
      body: "Confirm local operating status and official recovery notices before changing continuity measures.",
      evidenceKeys: keys,
    }],
    developments: events.map((event) => ({
      eventKey: event.eventKey,
      operationalImpact: "Local teams should verify the directly affected service or site.",
      polestarView: "The confirmed effect supports a proportionate response without broader assumptions.",
      outlook7Days: "Watch for an official incident or restoration update.",
    })),
  };
}

describe.each([
  ["apac_weekly", apacFixtures, "High", apacFixtures[0].fact],
  ["middle_east_weekly", middleEastFixtures, "Extreme", middleEastFixtures[0].fact],
] as const)("regional extraction-to-final severity integration for %s", (
  topic,
  fixtures,
  expectedSeverity,
  expectedEvidence,
) => {
  it("survives repeated reassessment and the real final content-policy gate", () => {
    const events = extractedEvents([...fixtures], topic);
    const reassessed = reassessRegionalEvents(reassessRegionalEvents(events));
    const futureEvents: RegionalFutureEventInput[] = topic === "apac_weekly" ? [{
      date: "2026-09-20",
      location: "Singapore",
      trigger: "A customs implementation window begins",
      whyItMatters: "Import reporting requirements may change.",
      currentSeverity: "Moderate",
      whatToWatch: "Watch for the final customs authority notice.",
    }] : [];
    const report = assembleRegionalEditorialReport(
      reassessed,
      analysisFor(reassessed),
      topic,
      "2026-09-18",
      futureEvents,
      coverage(topic),
    );

    expect(report.developments[0]).toMatchObject({
      severity: expectedSeverity,
      severityEvidence: [expectedEvidence],
    });
    expect(validateRegionalContentPolicy(report)).toEqual([]);
  });
});