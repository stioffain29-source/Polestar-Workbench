import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/lib/regionalAi", () => ({ regionalJson: jest.fn() }));

import { regionalJson } from "../src/lib/regionalAi";
import { refreshRegionalEditorialOutlook } from "../src/lib/regionalReportRefresh";
import { REGIONAL_MAX_MAP_POINTS } from "../../workbench/src/lib/regionalContentPolicy";
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

/** The opening assessment has its own 100-130 word range. */
function openingAssessment(words = 115): string {
  const opening = "The most consequential change this week is a verified operational disruption at one named facility.";
  const body = "Exposure sits with continuity planning and scheduling decisions while connected operations elsewhere continue under existing arrangements without restriction.";
  return `${opening} ${body.repeat(12)}`.trim().split(/\s+/).slice(0, words).join(" ");
}

function closingOutlook(words = 135): string {
  const start = "Japan Australia Singapore India Malaysia and the Philippines require distinct decisions as recovery and implementation signals develop.";
  const body = "Operators should rank confirmed service effects while distinguishing stabilisation from plausible deterioration across security mobility regulatory and digital functions.";
  return `${start} ${body.repeat(14)}`.trim().split(/\s+/).slice(0, words).join(" ");
}

function savedEdition(priorOverrides: Partial<RegionalCanonicalReport> = {}) {
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
      regionalOutlook: openingAssessment(),
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
    ...priorOverrides,
  };
  const selectedEventKeys = developments.map((event) => event.eventKey!);
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
  return { prior, developments, selectedEventKeys, saved };
}

describe("APAC regional Outlook refresh", () => {
  it("rewrites only the closing Outlook while preserving the six selected facts, card order, maps and other prose", async () => {
    const { prior, developments, selectedEventKeys, saved } = savedEdition();
    const refreshedText = closingOutlook();
    mockedRegionalJson.mockResolvedValue({
      text: refreshedText,
      evidenceKeys: selectedEventKeys,
    });

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
    // The map carries a five-development selection of the same set, in report order.
    const mapTitles = result.canonical.mapPoints.map((point) => point.title);
    expect(mapTitles).toHaveLength(REGIONAL_MAX_MAP_POINTS);
    expect(prior.mapPoints.map((point) => point.title)).toEqual(expect.arrayContaining(mapTitles));
    expect(mapTitles).toEqual(developments.filter((event) => mapTitles.includes(event.title))
      .map((event) => event.title));
    expect(result.canonical).toMatchObject({
      regionalOutlook: prior.regionalOutlook,
      riskPicture: prior.riskPicture,
      businessImplications: prior.businessImplications,
      businessImplicationsNarrative: prior.businessImplicationsNarrative,
    });
    expect(result.evidenceSnapshot.selectedEventKeys).toEqual(selectedEventKeys);
    expect(result.evidenceSnapshot.analysisEvidence.polestarOutlook).toEqual(selectedEventKeys);
  });

  // Rebuilding stamps the current editorial version, so the retained prose is
  // judged by the current rules. An edition written under an earlier standard
  // must be regenerated rather than re-stamped or half-corrected.
  it.each([
    ["an opening assessment below the current length", {
      regionalOutlook: "The opening assessment ranks the verified operating effects.",
    }],
    ["prose that describes its own inputs", {
      riskPicture: "The supplied facts do not establish disruption beyond the named site.",
    }],
  ])("refreshes a saved edition with %s and reports it instead of cancelling", async (_label, overrides) => {
    const { saved, selectedEventKeys } = savedEdition(overrides);
    mockedRegionalJson.mockResolvedValue({
      text: closingOutlook(),
      evidenceKeys: selectedEventKeys,
    });

    const result = await refreshRegionalEditorialOutlook(saved);

    expect(result.editorialWarnings.join(" ")).toMatch(/predates the current content standard/);
    expect(mockedRegionalJson).toHaveBeenCalled();
  });
});