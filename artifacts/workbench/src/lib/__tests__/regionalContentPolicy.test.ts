import { describe, expect, it } from "@jest/globals";
import {
  MIDDLE_EAST_COLLECTION_DOMAINS,
  validateRegionalContentPolicy,
} from "../regionalContentPolicy";
import {
  regionalCanonicalReportFromHardNumbers,
  type RegionalCanonicalReport,
  type RegionalCoverageCheck,
  type RegionalDevelopment,
} from "../regionalWeekly";

const countries = ["Japan", "Australia", "Singapore", "India", "Malaysia", "Philippines"];
const categories: RegionalDevelopment["category"][] = [
  "Cyber",
  "Weather & Natural Hazards",
  "Regulatory",
  "Security",
  "Political",
  "Operational Disruption",
];

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

function development(index: number, overrides: Partial<RegionalDevelopment> = {}): RegionalDevelopment {
  return {
    eventKey: `event-${index}`,
    confirmedFacts: [`A verified operational change occurred in ${countries[index % countries.length]}.`],
    dateBasis: "event",
    country: countries[index % countries.length],
    location: `${countries[index % countries.length]} Hub`,
    eventDate: "2026-09-17",
    dateVerified: true,
    title: `Distinct development ${index}`,
    severity: "Moderate",
    severityRationale: "The confirmed consequence is material but remains limited in scope.",
    severityEvidence: [],
    category: categories[index % categories.length],
    whatChanged: "A verified operational change affected the named facility.",
    operationalSignificance: "Operators must confirm local availability.",
    operationalImpact: "Operators must confirm local availability.",
    polestarView: "The consequence remains bounded to the named operation.",
    whatToWatch: "Watch for an official restoration notice.",
    outlook7Days: "Watch for an official restoration notice.",
    watchDate: null,
    evidenceIds: [`source-${index}`],
    ...overrides,
  };
}

function outlook(events: RegionalDevelopment[], words = 130): string {
  const opening = `Japan Australia Singapore face distinct operational decisions while India Malaysia and the Philippines provide the wider regional context.`;
  const filler = "Verified conditions require proportionate decisions as operators compare recovery signals and implementation changes across connected supply mobility security and digital functions.";
  const tokens = `${opening} ${filler.repeat(12)}`.trim().split(/\s+/);
  return tokens.slice(0, words).join(" ");
}

function report(topic: RegionalCanonicalReport["topic"] = "apac_weekly"): RegionalCanonicalReport {
  const count = topic === "apac_weekly" ? 6 : 5;
  const developments = Array.from({ length: count }, (_, index) => development(index));
  const requiredForwardDomains = Array.from({ length: 11 }, (_, index) => `forward-${index}`);
  const domains = topic === "middle_east_weekly"
    ? MIDDLE_EAST_COLLECTION_DOMAINS.map(checked)
    : Array.from({ length: 7 }, (_, index) => checked(`apac-${index}`));
  return {
    schemaVersion: "regional-weekly-canonical-v1",
    editorialVersion: "regional-facts-v3",
    topic,
    issueDate: "2026-09-18",
    developments,
    regionalOutlook: "The selected changes create distinct operating decisions across the region.",
    riskPicture: "The confirmed effects remain bounded but require active operational decisions.",
    polestarOutlook: outlook(developments),
    polestarOutlookEvidenceKeys: developments.map((event) => event.eventKey!),
    domainBriefs: [],
    businessImplications: [{
      heading: "Operations & Assets",
      body: "Confirm local operating conditions before dispatch.",
    }],
    businessImplicationsNarrative: "Confirm local operating conditions before dispatch.",
    watchItems: [{
      date: "2026-09-22",
      location: "Singapore",
      trigger: "A scheduled implementation window begins",
      whyItMatters: "Operating requirements may change.",
      whatToWatch: "Watch for the final authority notice.",
    }],
    glanceMetrics: [],
    mapPoints: developments.map((event, index) => ({
      lat: index,
      lng: index,
      severity: event.severity,
      title: event.title,
      label: event.location!,
      summary: event.whatChanged,
      eventDate: event.eventDate!,
    })),
    visualSummary: { byCategory: [], byCountry: [] },
    coverageManifest: {
      requiredDomains: domains.map((check) => check.domain),
      domains,
      forwardSearch: checked("forward-search"),
      requiredGeographies: [],
      searchedGeographies: [],
      requiredForwardDomains,
      forwardDomains: requiredForwardDomains.map(checked),
      collectionPasses: 2,
    },
  };
}

describe("regional final-content policy", () => {
  it("accepts exactly six mapped APAC developments with Cyber, weather, regulatory and a populated watch", () => {
    expect(validateRegionalContentPolicy(report())).toEqual([]);
  });

  it.each([
    ["five developments", (value: RegionalCanonicalReport) => {
      value.developments.pop();
      value.polestarOutlookEvidenceKeys!.pop();
      value.mapPoints.pop();
    }, "APAC must retain six distinct developments and map items."],
    ["five map items", (value: RegionalCanonicalReport) => value.mapPoints.pop(),
      "Every selected development must retain its distinct map item."],
    ["no Cyber event", (value: RegionalCanonicalReport) => {
      value.developments[0].category = "Security";
    }, "APAC requires a material Cyber development; do not substitute filler."],
    ["no weather event", (value: RegionalCanonicalReport) => {
      value.developments[1].category = "Security";
    }, "APAC requires a material Weather & Natural Hazards development; do not substitute filler."],
    ["no regulatory event", (value: RegionalCanonicalReport) => {
      value.developments[2].category = "Security";
    }, "APAC requires a material Regulatory development; do not substitute filler."],
    ["an empty watch", (value: RegionalCanonicalReport) => {
      value.watchItems = [];
    }, "APAC 7 Day Watch must remain populated."],
  ])("rejects APAC with %s", (_label, mutate, expected) => {
    const value = report();
    mutate(value);
    expect(validateRegionalContentPolicy(value)).toContain(expected);
  });

  it("requires rationale for every severity and evidence only for High or Extreme", () => {
    const moderate = report();
    moderate.developments[0].severityEvidence = [];
    expect(validateRegionalContentPolicy(moderate)).toEqual([]);

    const missingRationale = report();
    missingRationale.developments[0].severityRationale = " ";
    expect(validateRegionalContentPolicy(missingRationale)).toContain(
      "Severity has not been reassessed from confirmed consequences: Distinct development 0.",
    );

    for (const severity of ["High", "Extreme"] as const) {
      const unsupported = report();
      unsupported.developments[0].severity = severity;
      unsupported.developments[0].severityEvidence = [];
      expect(validateRegionalContentPolicy(unsupported)).toContain(
        "Severity has not been reassessed from confirmed consequences: Distinct development 0.",
      );
      unsupported.developments[0].severityEvidence = ["A confirmed material consequence occurred."];
      expect(validateRegionalContentPolicy(unsupported)).toEqual([]);
    }
  });

  it("enforces a 120-160 word closing Outlook, every selected key, and at least three selected countries", () => {
    for (const words of [119, 161]) {
      const value = report();
      value.polestarOutlook = outlook(value.developments, words);
      expect(validateRegionalContentPolicy(value)).toContain("Polestar Outlook must contain 120–160 words.");
    }

    const missingKey = report();
    missingKey.polestarOutlookEvidenceKeys!.pop();
    expect(validateRegionalContentPolicy(missingKey)).toContain(
      "Polestar Outlook must consider the complete selected development set.",
    );

    const foreignKey = report();
    foreignKey.polestarOutlookEvidenceKeys!.push("not-selected");
    expect(validateRegionalContentPolicy(foreignKey)).toContain(
      "Polestar Outlook must consider the complete selected development set.",
    );

    const narrow = report();
    narrow.polestarOutlook = Array.from({ length: 130 }, (_, index) =>
      index === 0 ? "Japan" : "assessment").join(" ");
    expect(validateRegionalContentPolicy(narrow)).toContain(
      "Polestar Outlook must assess the wider region, not one country or incident.",
    );
  });

  it("rejects six country mini-updates but accepts cross-country thematic synthesis", () => {
    const padTo130Words = (opening: string) => {
      const filler = "Regional decisions should rank verified recovery signals and distinguish direct effects from contingent exposure across connected supply mobility regulatory and digital functions.";
      return `${opening} ${filler.repeat(12)}`.trim().split(/\s+/).slice(0, 130).join(" ");
    };
    const miniUpdates = report();
    miniUpdates.polestarOutlook = padTo130Words(
      "Japan faces a digital recovery decision. Australia faces weather-related mobility constraints. Singapore awaits regulatory implementation detail. India requires local security monitoring. Malaysia needs confirmation of operational restoration. The Philippines faces a separate continuity decision.",
    );
    expect(validateRegionalContentPolicy(miniUpdates)).toContain(
      "Polestar Outlook must synthesise regional risks rather than list separate country updates.",
    );

    const synthesis = report();
    synthesis.polestarOutlook = padTo130Words(
      "Digital recovery in Japan and regulatory implementation in Singapore together determine the near-term continuity burden. Weather constraints in Australia and mobility decisions in India should be compared through their effects on connected routes. Restoration signals in Malaysia and the Philippines will show whether disruption is stabilising across shared operating functions.",
    );
    expect(validateRegionalContentPolicy(synthesis)).toEqual([]);
  });

  it("requires five to eight Middle East events and all nine collection checks to be genuinely completed", () => {
    const valid = report("middle_east_weekly");
    valid.watchItems = [];
    expect(validateRegionalContentPolicy(valid)).toEqual([]);

    for (const count of [4, 9]) {
      const value = report("middle_east_weekly");
      value.developments = Array.from({ length: count }, (_, index) => development(index));
      value.mapPoints = value.developments.map((event, index) => ({
        lat: index, lng: index, severity: event.severity, title: event.title,
        label: event.location!, summary: event.whatChanged, eventDate: event.eventDate!,
      }));
      value.polestarOutlookEvidenceKeys = value.developments.map((event) => event.eventKey!);
      expect(validateRegionalContentPolicy(value)).toContain(
        "Middle East requires five to eight material developments.",
      );
    }

    for (const defect of ["status", "sources", "errors"] as const) {
      const value = report("middle_east_weekly");
      const check = value.coverageManifest.domains[0];
      if (defect === "status") check.status = "not_run";
      if (defect === "sources") check.sourceNames = [];
      if (defect === "errors") check.errors = ["collection failed"];
      expect(validateRegionalContentPolicy(value)).toContain(
        `Middle East collection is incomplete: ${MIDDLE_EAST_COLLECTION_DOMAINS[0]}.`,
      );
    }
  });

  it("permits a zero Middle East watch only after all eleven forward domains and the separate search completed", () => {
    const valid = report("middle_east_weekly");
    valid.watchItems = [];
    expect(validateRegionalContentPolicy(valid)).toEqual([]);

    const defects: Array<(value: RegionalCanonicalReport) => void> = [
      (value) => { value.coverageManifest.requiredForwardDomains!.pop(); },
      (value) => { value.coverageManifest.forwardDomains![0].status = "not_run"; },
      (value) => { value.coverageManifest.forwardDomains![0].sourceNames = []; },
      (value) => { value.coverageManifest.forwardDomains![0].errors = ["failed"]; },
      (value) => { value.coverageManifest.forwardSearch.status = "not_run"; },
    ];
    for (const mutate of defects) {
      const value = report("middle_east_weekly");
      value.watchItems = [];
      mutate(value);
      expect(validateRegionalContentPolicy(value)).toContain(
        "Middle East requires a completed, separate eleven-domain 7 Day Watch search.",
      );
    }
  });

  it("requires a second collection pass when energy infrastructure dominates selection", () => {
    const value = report("middle_east_weekly");
    value.developments.slice(0, 4).forEach((event) => {
      event.category = "Energy";
    });
    value.coverageManifest.collectionPasses = 1;
    expect(validateRegionalContentPolicy(value)).toContain(
      "Energy infrastructure still dominates; repeat the broad collection before generation.",
    );
    value.coverageManifest.collectionPasses = 2;
    expect(validateRegionalContentPolicy(value)).toEqual([]);
  });

  it("keeps legacy v2 reports readable without six domain briefs or the new 120-word minimum", () => {
    const legacy = report();
    legacy.editorialVersion = "regional-facts-v2";
    legacy.developments = legacy.developments.slice(0, 5);
    legacy.mapPoints = legacy.mapPoints.slice(0, 5);
    legacy.polestarOutlook = "A concise saved outlook remains readable.";
    legacy.polestarOutlookEvidenceKeys = undefined;
    legacy.watchItems = [];
    expect(regionalCanonicalReportFromHardNumbers(
      { regionalCanonicalReport: legacy },
      "apac_weekly",
      legacy.issueDate,
    )).toBe(legacy);
  });
});