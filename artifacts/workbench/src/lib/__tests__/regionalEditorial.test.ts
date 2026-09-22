import { describe, expect, it } from "@jest/globals";
import {
  REGIONAL_EDITORIAL_VERSION,
  containsRegionalSourceLeak,
  validateRegionalEditorialReport,
  validateRegionalFactStatement,
} from "../regionalEditorial";
import {
  regionalCanonicalReportFromHardNumbers,
  type RegionalCanonicalReport,
  type RegionalDevelopment,
} from "../regionalWeekly";

describe("regional structured editorial facts", () => {
  it("requires the quotation to be an exact source span", () => {
    const source = "Officials said the port remained closed while inspections continued.";
    expect(validateRegionalFactStatement(
      "The port remained closed while inspections continued.",
      "the port remained closed while inspections continued",
      source,
    )).toEqual([]);
    expect(validateRegionalFactStatement(
      "The port remained closed while inspections continued.",
      "the port was closed while inspections continued",
      source,
    )).toContain("The supporting quotation is not an exact source span.");
  });

  it("rejects report-attribution wrappers and copied source headlines", () => {
    const wrapped = "\"The terminal suspended cargo handling,\" a report said.";
    expect(validateRegionalFactStatement(
      wrapped,
      wrapped,
      wrapped,
    )).toContain(
      "Write the event as a factual sentence; do not wrap or quote a headline in report-attribution text.",
    );

    const factualSentence = "The terminal suspended cargo handling.";
    expect(validateRegionalFactStatement(
      factualSentence,
      factualSentence,
      factualSentence,
    )).toEqual([]);
    expect(validateRegionalFactStatement(
      factualSentence,
      factualSentence,
      factualSentence,
      "The terminal suspended cargo handling",
    )).toContain("A factual sentence must not be a copied source headline.");
  });

  it("preserves casualty numbers together with their roles", () => {
    const quote = "The blast killed 15 people and injured 56 others.";
    expect(validateRegionalFactStatement(
      "The blast killed 15 people and injured 56 others.",
      quote,
      quote,
    )).toEqual([]);
    expect(validateRegionalFactStatement(
      "The blast injured 15 people and killed 56 others.",
      quote,
      quote,
    )).toContain("A casualty figure or casualty type differs from its quotation.");
    expect(validateRegionalFactStatement(
      "The attack killed 80 people.",
      "The attack injured 80 people.",
      "The attack injured 80 people.",
    )).toContain("A casualty figure or casualty type differs from its quotation.");
    expect(validateRegionalFactStatement(
      "The attack killed 80 people.",
      "Officials reported people were killed in the attack.",
      "Officials reported people were killed in the attack.",
    )).toContain("A numerical claim is not supported by its quotation.");
  });

  it("blocks mastheads, domains, and scrape debris from edited facts", () => {
    for (const value of [
      "Reuters reported the closure.",
      "Read more about the closure.",
      "Details appeared on example.com.",
    ]) {
      expect(containsRegionalSourceLeak(value)).toBe(true);
    }
    expect(validateRegionalFactStatement(
      "Reuters reported the port closure.",
      "Reuters reported the port closure.",
      "Reuters reported the port closure.",
    )).toContain("Publisher or scrape text remains in a fact.");
  });

  it("returns the persisted canonical object unchanged instead of reconstruing it", () => {
    const development = (index: number): RegionalDevelopment => ({
      eventKey: `event-${index}`,
      confirmedFacts: [`Terminal ${index} suspended cargo handling.`],
      dateBasis: "event",
      country: "Japan",
      location: "Yokohama",
      eventDate: "2026-09-17",
      dateVerified: true,
      title: `Terminal ${index} suspension`,
      severity: "High",
      category: "Operational Disruption",
      whatChanged: `Terminal ${index} suspended cargo handling.`,
      operationalSignificance: "Cargo handling is unavailable at the affected terminal.",
      operationalImpact: "Cargo handling is unavailable at the affected terminal.",
      polestarView: "The disruption remains limited to the named terminal.",
      whatToWatch: "Watch for an official reopening notice.",
      outlook7Days: "Watch for an official reopening notice.",
      watchDate: null,
      evidenceIds: [index],
    });
    const developments = [1, 2, 3, 4, 5].map(development);
    const checks = Array.from({ length: 7 }, (_, index) => ({
      domain: `domain-${index}`,
      status: "checked" as const,
      sourceNames: ["Official bulletin"],
      itemsFetched: 1,
      candidatesAccepted: 1,
      errors: [],
    }));
    const report: RegionalCanonicalReport = {
      schemaVersion: "regional-weekly-canonical-v1",
      editorialVersion: "regional-facts-v2",
      topic: "apac_weekly",
      issueDate: "2026-09-18",
      developments,
      regionalOutlook: "Cargo handling interruptions are the principal verified operating exposure.",
      riskPicture: "The selected terminal disruptions affect cargo handling at the named facilities.",
      polestarOutlook: "Official reopening notices remain the clearest signal for operating decisions.",
      businessImplications: [{ heading: "Operations & Assets", body: "Confirm terminal availability before dispatch." }],
      businessImplicationsNarrative: "Confirm terminal availability before dispatch.",
      domainBriefs: [],
      watchItems: [],
      glanceMetrics: [],
      mapPoints: developments.map((row) => ({
        lat: 35.4,
        lng: 139.6,
        label: row.location!,
        title: row.title,
        severity: row.severity,
        eventDate: row.eventDate!,
        summary: row.whatChanged,
      })),
      visualSummary: { byCategory: [], byCountry: [] },
      coverageManifest: {
        requiredDomains: checks.map((check) => check.domain),
        domains: checks,
        forwardSearch: {
          domain: "forward",
          status: "checked",
          sourceNames: ["Official bulletin"],
          itemsFetched: 1,
          candidatesAccepted: 1,
          errors: [],
        },
        requiredGeographies: ["Japan"],
        searchedGeographies: ["Japan"],
      },
    };

    expect(validateRegionalEditorialReport(report)).toEqual([]);
    const loaded = regionalCanonicalReportFromHardNumbers(
      { regionalCanonicalReport: report },
      "apac_weekly",
      "2026-09-18",
    );
    expect(loaded).toBe(report);
    expect(loaded).toEqual(report);
  });
});