import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/lib/regionalAi", () => ({ regionalJson: jest.fn() }));

import { regionalJson } from "../src/lib/regionalAi";
import { refreshRegionalEditorialOutlook } from "../src/lib/regionalReportRefresh";
import type { GroundedRegionalEvent } from "../src/lib/regionalReportFacts";
import type {
  RegionalCanonicalReport,
  RegionalCoverageCheck,
  RegionalDevelopment,
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

function development(event: GroundedRegionalEvent): RegionalDevelopment {
  return {
    eventKey: event.eventKey,
    confirmedFacts: event.confirmedFacts,
    dateBasis: event.dateBasis,
    country: event.country,
    location: event.location,
    eventDate: event.eventDate,
    dateVerified: true,
    title: event.title,
    severity: event.severity,
    severityRationale: event.severityRationale,
    severityEvidence: event.severityEvidence,
    category: event.category,
    whatChanged: event.confirmedFacts.join(" "),
    operationalSignificance: "The operational decision remains local to the named facility.",
    operationalImpact: "The operational decision remains local to the named facility.",
    polestarView: "The verified effect remains bounded to the named operation.",
    whatToWatch: "Watch for the relevant official operational update.",
    outlook7Days: "Watch for the relevant official operational update.",
    watchDate: null,
    evidenceIds: event.evidenceIds,
    sourceEvidence: event.sourceEvidence,
  };
}

function closingOutlook(words = 135): string {
  const start = "Japan Australia Singapore India Malaysia and the Philippines require distinct decisions as recovery and implementation signals develop.";
  const body = "Operators should rank confirmed service effects while distinguishing stabilisation from plausible deterioration across security mobility regulatory and digital functions.";
  return `${start} ${body.repeat(14)}`.trim().split(/\s+/).slice(0, words).join(" ");
}

describe("APAC regional Outlook refresh", () => {
  it("rewrites only the closing Outlook while preserving the six selected facts, card order, maps and other prose", async () => {
    const extractedEvents = Array.from({ length: 6 }, (_, index) => grounded(index));
    const developments = extractedEvents.map(development);
    const checks = Array.from({ length: 7 }, (_, index) => checked(`domain-${index}`));
    const prior: RegionalCanonicalReport = {
      schemaVersion: "regional-weekly-canonical-v1",
      editorialVersion: "regional-facts-v3",
      evidenceFingerprint: "prior-fingerprint",
      topic: "apac_weekly",
      issueDate: "2026-09-18",
      developments,
      regionalOutlook: "The opening assessment ranks the verified operating effects.",
      riskPicture: "The risk picture distinguishes direct effects from contingent exposure.",
      polestarOutlook: closingOutlook(130),
      polestarOutlookEvidenceKeys: developments.map((event) => event.eventKey!),
      domainBriefs: [],
      businessImplications: [{
        heading: "Operations & Assets",
        body: "Confirm the named facility status before dispatch.",
      }],
      businessImplicationsNarrative: "Confirm the named facility status before dispatch.",
      watchItems: [{
        date: "2026-09-22",
        location: "Singapore",
        trigger: "A scheduled implementation window begins",
        whyItMatters: "Operating requirements may change.",
        whatToWatch: "Watch for the final authority notice.",
      }],
      glanceMetrics: [],
      mapPoints: developments.map((event, index) => ({
        lat: 10 + index,
        lng: 100 + index,
        severity: event.severity,
        title: event.title,
        label: event.country,
        summary: event.whatChanged,
        eventDate: event.eventDate!,
      })),
      visualSummary: { byCategory: [], byCountry: [] },
      coverageManifest: {
        requiredDomains: checks.map((check) => check.domain),
        domains: checks,
        forwardSearch: checked("forward"),
        requiredGeographies: countries,
        searchedGeographies: countries,
      },
    };
    const selectedEventKeys = developments.map((event) => event.eventKey!);
    const refreshedText = closingOutlook();
    mockedRegionalJson.mockResolvedValue({
      text: refreshedText,
      evidenceKeys: selectedEventKeys,
    });

    const saved = {
      canonical: prior,
      evidence: {
        version: "regional-facts-v3" as const,
        fingerprint: "prior-fingerprint",
        sourcePackets: [],
        extractedEvents,
        rejectedCandidates: [],
        selectedEventKeys,
        forwardEvents: [{
          date: "2026-09-22",
          location: "Singapore",
          trigger: "A scheduled implementation window begins",
          whyItMatters: "Operating requirements may change.",
          currentSeverity: "Moderate" as const,
          whatToWatch: "Watch for the final authority notice.",
        }],
        analysisEvidence: {
          regionalOutlook: ["event-0"],
          riskPicture: ["event-1"],
          businessImplications: [{
            heading: "Operations & Assets",
            evidenceKeys: ["event-2"],
          }],
          polestarOutlook: selectedEventKeys,
        },
      },
    };

    const result = await refreshRegionalEditorialOutlook(saved);

    expect(mockedRegionalJson).toHaveBeenCalledTimes(1);
    expect(result.canonical.polestarOutlook).toBe(refreshedText);
    expect(result.canonical.polestarOutlookEvidenceKeys).toEqual(selectedEventKeys);
    expect(result.canonical.developments.map((event) => event.eventKey)).toEqual(selectedEventKeys);
    expect(result.canonical.developments.map((event) => ({
      title: event.title,
      confirmedFacts: event.confirmedFacts,
      operationalImpact: event.operationalImpact,
      polestarView: event.polestarView,
      outlook7Days: event.outlook7Days,
    }))).toEqual(developments.map((event) => ({
      title: event.title,
      confirmedFacts: event.confirmedFacts,
      operationalImpact: event.operationalImpact,
      polestarView: event.polestarView,
      outlook7Days: event.outlook7Days,
    })));
    expect(result.canonical.mapPoints.map((point) => point.title))
      .toEqual(prior.mapPoints.map((point) => point.title));
    expect(result.canonical).toMatchObject({
      regionalOutlook: prior.regionalOutlook,
      riskPicture: prior.riskPicture,
      businessImplications: prior.businessImplications,
      businessImplicationsNarrative: prior.businessImplicationsNarrative,
    });
    expect(result.evidenceSnapshot.selectedEventKeys).toEqual(selectedEventKeys);
    expect(result.evidenceSnapshot.analysisEvidence.polestarOutlook).toEqual(selectedEventKeys);
  });
});