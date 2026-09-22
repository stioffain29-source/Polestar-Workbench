import { describe, expect, it } from "@jest/globals";
import {
  MIDDLE_EAST_COLLECTION_DOMAINS,
  REGIONAL_MAX_MAP_POINTS,
  regionalWatchObservanceNote,
  selectRegionalMapDevelopments,
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

/** The opening assessment now has its own 100-130 word range. */
function summary(words = 115): string {
  const opening = "The most consequential change this week is a confirmed operational disruption at a single named facility.";
  const filler = "Exposure sits with continuity planning and scheduling decisions while connected operations elsewhere continue under existing arrangements without restriction.";
  return `${opening} ${filler.repeat(12)}`.trim().split(/\s+/).slice(0, words).join(" ");
}

function watchItem(day: number, trigger: string) {
  return {
    date: `2026-09-2${day}`,
    location: "Singapore",
    trigger,
    whyItMatters: "Operating requirements may change.",
    whatToWatch: "Watch for the final authority notice.",
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
    regionalOutlook: summary(),
    riskPicture: "The confirmed effects remain bounded but require active operational decisions.",
    polestarOutlook: outlook(developments),
    polestarOutlookEvidenceKeys: developments.map((event) => event.eventKey!),
    domainBriefs: [],
    businessImplications: [{
      heading: "Operations & Assets",
      body: "Confirm local operating conditions before dispatch.",
    }],
    businessImplicationsNarrative: "Confirm local operating conditions before dispatch.",
    watchItems: [
      watchItem(2, "A scheduled implementation window begins"),
      watchItem(3, "A port maintenance closure takes effect"),
      watchItem(4, "A regulatory filing deadline falls due"),
    ],
    glanceMetrics: [],
    mapPoints: developments.slice(0, REGIONAL_MAX_MAP_POINTS).map((event, index) => ({
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
    ["a sixth map item", (value: RegionalCanonicalReport) => {
      value.mapPoints.push({
        ...value.mapPoints[0], title: value.developments[5].title,
      });
    }, `The map must plot one to ${REGIONAL_MAX_MAP_POINTS} distinct developments chosen for the operating picture.`],
    ["a repeated map item", (value: RegionalCanonicalReport) => {
      value.mapPoints[1] = { ...value.mapPoints[0] };
    }, `The map must plot one to ${REGIONAL_MAX_MAP_POINTS} distinct developments chosen for the operating picture.`],
    ["no map item", (value: RegionalCanonicalReport) => {
      value.mapPoints = [];
    }, `The map must plot one to ${REGIONAL_MAX_MAP_POINTS} distinct developments chosen for the operating picture.`],
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
    expect(validateRegionalContentPolicy(report("middle_east_weekly"))).toEqual([]);

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

  it("requires three to five real Middle East forward items, not a holiday calendar", () => {
    expect(validateRegionalContentPolicy(report("middle_east_weekly"))).toEqual([]);

    for (const count of [0, 2, 6]) {
      const value = report("middle_east_weekly");
      value.watchItems = Array.from({ length: count }, (_, index) =>
        watchItem(index % 8, `A scheduled operating decision ${index}`));
      expect(validateRegionalContentPolicy(value)).toContain(
        "7 Day Watch requires 3 to 5 forward items from the separate forward search.",
      );
    }

    // Holidays are real operating information. A genuinely holiday-led week
    // publishes the calendar it has, with a note saying nothing else is
    // scheduled, instead of failing the whole report.
    const holidays = report("middle_east_weekly");
    holidays.watchItems = [
      watchItem(2, "National Day public holiday"),
      watchItem(3, "Eid al-Adha holiday closures"),
      watchItem(4, "A port maintenance closure takes effect"),
    ];
    expect(validateRegionalContentPolicy(holidays)).toEqual([]);
    expect(regionalWatchObservanceNote(holidays.watchItems)).toBe(
      "Public holidays and observances account for most of the week ahead. No further significant scheduled events were identified.",
    );
    expect(regionalWatchObservanceNote([
      watchItem(2, "National Day public holiday"),
      watchItem(3, "Eid al-Adha holiday closures"),
    ])).toBe(
      "The week ahead is led by public holidays and observances. No other significant scheduled events were identified.",
    );
    expect(regionalWatchObservanceNote([
      watchItem(2, "A port maintenance closure takes effect"),
      watchItem(3, "National Day public holiday"),
    ])).toBeNull();
  });

  it("requires the eleven-domain forward search behind the Middle East watch", () => {
    const defects: Array<(value: RegionalCanonicalReport) => void> = [
      (value) => { value.coverageManifest.requiredForwardDomains!.pop(); },
      (value) => { value.coverageManifest.forwardDomains![0].status = "not_run"; },
      (value) => { value.coverageManifest.forwardDomains![0].sourceNames = []; },
      (value) => { value.coverageManifest.forwardDomains![0].errors = ["failed"]; },
      (value) => { value.coverageManifest.forwardSearch.status = "not_run"; },
    ];
    for (const mutate of defects) {
      const value = report("middle_east_weekly");
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

  it("holds the opening assessment to 100 to 130 words", () => {
    for (const words of [99, 131]) {
      const value = report();
      value.regionalOutlook = summary(words);
      expect(validateRegionalContentPolicy(value)).toContain(
        "regionalOutlook must contain 100 to 130 words: it states the week's most consequential change and where exposure sits, not a roundup.",
      );
    }
    for (const words of [100, 130]) {
      const value = report();
      value.regionalOutlook = summary(words);
      expect(validateRegionalContentPolicy(value)).toEqual([]);
    }
  });

  it("rejects prose that describes its own inputs instead of addressing the client", () => {
    const narrative = report();
    narrative.riskPicture = "The supplied facts do not establish wider disruption beyond the named site.";
    expect(validateRegionalContentPolicy(narrative).some((error) =>
      error.startsWith("riskPicture refers to the reporting behind the assessment"))).toBe(true);

    const perDevelopment = report();
    perDevelopment.developments[0].polestarView = "The packet does not confirm a wider outage.";
    expect(validateRegionalContentPolicy(perDevelopment)).toContain(
      "Distinct development 0: source-material voice in polestarView.",
    );
  });

  it("rejects a country-by-country risk picture and business implications", () => {
    const value = report();
    value.riskPicture = "Japan faces a digital recovery decision. Australia faces weather constraints. Singapore awaits regulatory detail. India requires local monitoring.";
    expect(validateRegionalContentPolicy(value)).toContain(
      "riskPicture must connect the developments into a risk picture rather than work through one country at a time.",
    );

    const implications = report();
    implications.businessImplicationsNarrative = "Japan needs continuity cover. Australia needs travel rebooking. Singapore needs filing support. India needs escort arrangements.";
    expect(validateRegionalContentPolicy(implications)).toContain(
      "businessImplicationsNarrative must stay organised by business function rather than by country.",
    );
  });

  it("rejects a Middle East Outlook dominated by energy prose when other risks were selected", () => {
    const value = report("middle_east_weekly");
    value.polestarOutlook = [
      "Refinery outages in Japan and Singapore remain the dominant fuel supply question for the coming week, and operators should expect continued pressure on regional diesel availability while repairs continue at both affected sites.",
      "Pipeline repair work in Australia and India will determine whether crude flows normalise, with electricity demand in both markets still exposed to any further interruption at generation or storage assets.",
      "Gas processing constraints across Malaysia and the Philippines could extend the same exposure into petrochemical feedstock, keeping procurement decisions unusually sensitive to short notice changes.",
      "Regulatory implementation in Singapore and Japan remains the principal separate question, and workforce approvals should be confirmed before committing to new deployments in either market.",
      "Security conditions in India and Australia are stable enough to support existing schedules.",
    ].join(" ");
    expect(validateRegionalContentPolicy(value)).toContain(
      "Polestar Outlook concentrates on energy infrastructure while other material risks were selected.",
    );
  });

  it("plots at most five developments, chosen for breadth rather than severity alone", () => {
    const candidates = [
      { country: "Saudi Arabia", category: "Energy", severity: "Extreme", title: "Refinery fire halts crude processing", whatChanged: "A refinery fire halted crude processing at the plant." },
      { country: "Saudi Arabia", category: "Energy", severity: "High", title: "Second refinery unit shut", whatChanged: "A second refinery unit shut down for inspection." },
      { country: "Israel", category: "Security", severity: "High", title: "Airspace closure suspends flights", whatChanged: "An airspace closure suspended flights at the airport." },
      { country: "Egypt", category: "Regulatory", severity: "Low", title: "Customs rule takes effect", whatChanged: "A customs regulation takes effect at the border crossing." },
      { country: "Iraq", category: "Cyber", severity: "Moderate", title: "Ransomware disrupts port systems", whatChanged: "A ransomware breach disrupted port cargo systems." },
      { country: "Jordan", category: "Political", severity: "Low", title: "Parliamentary vote scheduled", whatChanged: "A parliamentary vote was scheduled for next week." },
      { country: "Yemen", category: "Security", severity: "Moderate", title: "Vessel attacked near Bab el-Mandeb", whatChanged: "A vessel was attacked near the strait." },
    ];
    const chosen = selectRegionalMapDevelopments(candidates);
    expect(chosen).toHaveLength(REGIONAL_MAX_MAP_POINTS);
    // The second Saudi energy entry describes the same operating issue.
    expect(chosen.map((entry) => entry.title)).not.toContain("Second refinery unit shut");
    expect(chosen.map((entry) => entry.country)).toEqual(
      expect.arrayContaining(["Saudi Arabia", "Israel", "Iraq"]));
    const order = chosen.map((entry) => candidates.indexOf(entry));
    expect(order).toEqual([...order].sort((first, second) => first - second));
  });

  it("keeps two different operating issues in the same market and domain", () => {
    const candidates = [
      { country: "Egypt", category: "Regulatory", severity: "Low", title: "Customs rule takes effect", whatChanged: "A customs regulation takes effect at the border crossing." },
      { country: "Egypt", category: "Regulatory", severity: "Low", title: "Work visa approvals suspended", whatChanged: "Work visa approvals were suspended for new applicants." },
      { country: "Israel", category: "Security", severity: "High", title: "Airspace closure suspends flights", whatChanged: "An airspace closure suspended flights at the airport." },
    ];
    expect(selectRegionalMapDevelopments(candidates).map((entry) => entry.title))
      .toEqual(candidates.map((entry) => entry.title));
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