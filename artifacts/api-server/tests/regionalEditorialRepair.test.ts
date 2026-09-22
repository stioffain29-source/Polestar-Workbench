import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/lib/regionalAi", () => ({ regionalJson: jest.fn() }));

import { regionalJson } from "../src/lib/regionalAi";
import {
  finishRegionalEditorialReport,
  type RegionalAnalysis,
} from "../src/lib/regionalReportEditorial";
import type { GroundedRegionalEvent } from "../src/lib/regionalReportFacts";
import type {
  RegionalCoverageCheck,
  RegionalCoverageManifest,
  RegionalFutureEventInput,
} from "../../workbench/src/lib/regionalWeekly";

const mockedRegionalJson = jest.mocked(regionalJson);
const countries = ["Japan", "Australia", "Singapore", "India", "Malaysia", "Philippines"];
const categories: GroundedRegionalEvent["category"][] = [
  "Cyber",
  "Weather & Natural Hazards",
  "Regulatory",
  "Security",
  "Political",
  "Operational Disruption",
];

beforeEach(() => mockedRegionalJson.mockReset());

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

function grounded(index: number): GroundedRegionalEvent {
  const country = countries[index];
  const fact = `A verified operational change affected the named facility in ${country}.`;
  return {
    candidateId: `candidate-${index}`,
    eventKey: `event-${index}`,
    country,
    location: `${country} Hub`,
    eventDate: "2026-09-17",
    dateBasis: "event",
    category: categories[index],
    severity: "Moderate",
    severityRationale: "The confirmed consequence remains limited in scope.",
    severityEvidence: [],
    title: `Verified development ${index}`,
    confirmedFacts: [fact],
    evidenceIds: [`source-${index}`],
    uncertainties: [],
    businessMateriality: 4,
    sourceEvidence: ["Official bulletin"],
    quotations: [{ statement: fact, sourceId: `source-${index}`, quote: fact }],
    sourceRows: [{
      id: `source-${index}`,
      country,
      occurredAt: "2026-09-17",
      incidentDate: "2026-09-17",
      title: `Raw source ${index}`,
      summary: fact,
      source: "Official bulletin",
      latitude: 10 + index,
      longitude: 100 + index,
    }],
  };
}

const events = Array.from({ length: 6 }, (_, index) => grounded(index));
const eventKeys = events.map((event) => event.eventKey);
const coverageManifest: RegionalCoverageManifest = {
  requiredDomains: Array.from({ length: 7 }, (_, index) => `domain-${index}`),
  domains: Array.from({ length: 7 }, (_, index) => checked(`domain-${index}`)),
  forwardSearch: checked("forward"),
  requiredGeographies: countries,
  searchedGeographies: countries,
};
const futureEvents: RegionalFutureEventInput[] = [{
  date: "2026-09-22",
  location: "Singapore",
  trigger: "A scheduled implementation window begins",
  whyItMatters: "Operating requirements may change.",
  currentSeverity: "Moderate",
  whatToWatch: "Watch for the final authority notice.",
}];

/** One country per sentence, and deliberately past the 160-word ceiling. */
function countryByCountryOutlook(): string {
  const padding = "Operators should continue weighing the confirmed operating effect against the conditional exposure that the coming week may bring to that market alone";
  return countries
    .map((country) => `${country} remains the focus of its own separate update and ${padding}.`)
    .join(" ");
}

function synthesisedOutlook(words = 138): string {
  const opening = "Japan Australia Singapore India Malaysia and the Philippines share one operating question this week.";
  const body = "Operators should rank confirmed service effects together while separating stabilisation from plausible deterioration across security mobility regulatory and digital functions.";
  return `${opening} ${body.repeat(14)}`.trim().split(/\s+/).slice(0, words).join(" ");
}

function analysis(outlook: string): RegionalAnalysis {
  return {
    regionalOutlook: {
      text: "The opening assessment ranks the verified operating effects across the selected markets.",
      evidenceKeys: eventKeys,
    },
    riskPicture: {
      text: "The risk picture separates the confirmed direct effects from contingent exposure.",
      evidenceKeys: eventKeys,
    },
    polestarOutlook: { text: outlook, evidenceKeys: eventKeys },
    businessImplications: [{
      heading: "Operations & Assets",
      body: "Confirm the named facility status before dispatch and hold the decision until the authority notice lands.",
      evidenceKeys: eventKeys,
    }],
    developments: events.map((event) => ({
      eventKey: event.eventKey,
      operationalImpact: "The operational decision remains local to the named facility.",
      polestarView: "The verified effect remains bounded to the named operation.",
      outlook7Days: "Watch for the relevant official operational update.",
    })),
  };
}

describe("regional editorial repair", () => {
  it("re-asks with measured diagnostics and keeps the fixed developments out of the rewrite", async () => {
    const rejected = analysis(countryByCountryOutlook());
    const accepted = synthesisedOutlook();
    // The repair also returns reworded versions of the sections that passed;
    // they must be discarded rather than quietly replacing verified prose.
    mockedRegionalJson
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce({
        regionalOutlook: { text: "A silently reworded opening assessment.", evidenceKeys: eventKeys },
        riskPicture: { text: "A silently reworded risk picture.", evidenceKeys: eventKeys },
        polestarOutlook: { text: accepted, evidenceKeys: eventKeys },
        businessImplications: [],
      });

    const result = await finishRegionalEditorialReport(
      [], { events, rejected: [] }, "apac_weekly", "2026-09-18", futureEvents, coverageManifest,
    );

    expect(mockedRegionalJson).toHaveBeenCalledTimes(2);
    expect(result.canonical.polestarOutlook).toBe(accepted);
    // Only the failing section changes: verified prose and the per-development
    // analysis are preserved rather than regenerated.
    expect(result.canonical.regionalOutlook).toBe(rejected.regionalOutlook.text);
    expect(result.canonical.riskPicture).toBe(rejected.riskPicture.text);
    expect(result.canonical.businessImplications).toEqual([{
      heading: "Operations & Assets",
      body: rejected.businessImplications[0].body,
    }]);
    expect(result.canonical.developments.map((event) => event.polestarView))
      .toEqual(events.map(() => "The verified effect remains bounded to the named operation."));

    const [schema, instruction, input] = mockedRegionalJson.mock.calls[1] as [
      unknown, string, Record<string, any>,
    ];
    expect(Object.keys((schema as any).shape)).not.toContain("developments");
    expect(instruction).toContain("Rewrite ONLY the analytical narrative sections");
    expect(input.validationProblem).toContain("Polestar Outlook");
    expect(input.diagnostics.polestarOutlook.measuredWords).toBeGreaterThan(160);
    expect(input.diagnostics.polestarOutlook.countOfThoseSentences).toBeGreaterThanOrEqual(3);
    expect(input.diagnostics.polestarOutlook.sentencesNamingExactlyOneSelectedCountry[0]).toContain("Japan");
    expect(input.diagnostics.polestarOutlook.maximumAllowed).toBe(2);
    expect(input.diagnostics.polestarOutlook.requiredEvidenceKeys).toEqual(eventKeys);
  });

  it("regenerates the whole analytical object when the fixed developments are at fault", async () => {
    const withBadNumber = analysis(synthesisedOutlook());
    withBadNumber.developments[0].operationalImpact =
      "The operational decision closed 12 berths at the named facility.";
    mockedRegionalJson
      .mockResolvedValueOnce(withBadNumber)
      .mockResolvedValueOnce(analysis(synthesisedOutlook()));

    const result = await finishRegionalEditorialReport(
      [], { events, rejected: [] }, "apac_weekly", "2026-09-18", futureEvents, coverageManifest,
    );

    expect(mockedRegionalJson).toHaveBeenCalledTimes(2);
    const [schema, instruction] = mockedRegionalJson.mock.calls[1] as [unknown, string, unknown];
    expect(Object.keys((schema as any).shape)).toContain("developments");
    expect(instruction).toContain("Return the complete revised analytical object");
    expect(result.canonical.developments[0].operationalImpact)
      .toBe("The operational decision remains local to the named facility.");
  });

  it("stops after the bounded repair attempts instead of saving an unverified report", async () => {
    const rejected = analysis(countryByCountryOutlook());
    mockedRegionalJson
      .mockResolvedValueOnce(rejected)
      .mockResolvedValue({
        regionalOutlook: rejected.regionalOutlook,
        riskPicture: rejected.riskPicture,
        polestarOutlook: rejected.polestarOutlook,
        businessImplications: rejected.businessImplications,
      });

    await expect(finishRegionalEditorialReport(
      [], { events, rejected: [] }, "apac_weekly", "2026-09-18", futureEvents, coverageManifest,
    )).rejects.toThrow(/Polestar Outlook/);
    expect(mockedRegionalJson).toHaveBeenCalledTimes(3);
  });
});
