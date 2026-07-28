import type { CanonicalEvent } from "@workspace/country-engine/types";
import {
  buildCountryNarrative,
  countWords,
  type CountryNarrative,
} from "@workspace/country-engine/narrative";
import {
  runQualityGate,
  type QualityGateReport,
  type MapPoint,
} from "@workspace/country-engine/gate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idSeq = 0;
function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  idSeq += 1;
  return {
    eventId: `e${idSeq}`,
    eventTitle: "Armed robbery at a market",
    eventSummary: "Armed men robbed a market and injured two traders.",
    eventDate: "2024-03-05",
    eventEndDate: null,
    publicationDates: ["2024-03-06"],
    physicalCountry: "Papua New Guinea",
    relatedCountry: null,
    city: "Lae",
    district: null,
    provinceOrState: "Morobe",
    latitude: -6.7,
    longitude: 147.0,
    locationPrecision: "Town or city",
    issueCategory: "Violent crime",
    issueSubcategory: null,
    secondaryCategories: [],
    eventStatus: "Confirmed",
    severity: "High",
    severityReason: "Two injuries and weapon use.",
    casualties: 0,
    injuries: 2,
    arrests: 0,
    infrastructureImpact: null,
    transportImpact: null,
    commercialImpact: null,
    staffImpact: null,
    siteImpact: null,
    continuityImpact: null,
    confirmedOperationalEffect: null,
    assessedOperationalRelevance: null,
    impactLevel: "Monitor only",
    classificationConfidence: 90,
    locationConfidence: 90,
    dateConfidence: 90,
    supportingSourceIds: ["s1"],
    duplicateGroupId: null,
    relatedEventIds: [],
    inclusionStatus: "included",
    exclusionReason: null,
    ...overrides,
  };
}

const COUNTRY = "Papua New Guinea";
const WINDOW = { start: "2024-03-01", end: "2024-03-07" };

function baseReport(
  included: CanonicalEvent[],
  extra: Partial<QualityGateReport> = {},
): QualityGateReport {
  const narrative = buildCountryNarrative(included, { countryName: COUNTRY });
  const mapPoints: MapPoint[] = included.map((e) => ({
    eventId: e.eventId,
    lat: e.latitude ?? 0,
    lng: e.longitude ?? 0,
    precision: e.locationPrecision,
  }));
  return {
    events: included,
    included,
    narrative,
    mapPoints,
    sectionWordCounts: narrative.sectionWordCounts,
    hasPriorData: false,
    countryName: COUNTRY,
    reportingWindow: WINDOW,
    ...extra,
  };
}

function checkNames(r: ReturnType<typeof runQualityGate>): string[] {
  return r.failures.filter((f) => f.severity === "critical").map((f) => f.check);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runQualityGate — passing report", () => {
  it("passes a clean report", () => {
    const report = baseReport([
      makeEvent({ severity: "High" }),
      makeEvent({ issueCategory: "Civil unrest", city: "Port Moresby" }),
    ]);
    const result = runQualityGate(report);
    expect(result.passed).toBe(true);
    expect(result.failures.filter((f) => f.severity === "critical")).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Fail closed cases (§33)
// ---------------------------------------------------------------------------

describe("runQualityGate — fails closed (§33)", () => {
  it("fails when a foreign event is included", () => {
    const report = baseReport([
      makeEvent({ physicalCountry: "Australia", city: "Cairns" }),
    ]);
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("no_foreign_included_event");
  });

  it("fails when a map point has an unknown location", () => {
    const events = [makeEvent()];
    const report = baseReport(events);
    report.mapPoints = [
      { eventId: events[0].eventId, lat: -6.7, lng: 147, precision: "Unknown" },
    ];
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("map_point_credible_precision");
  });

  it("fails when a map point references a non-included event", () => {
    const events = [makeEvent()];
    const report = baseReport(events);
    report.mapPoints = [
      { eventId: "ghost", lat: -6.7, lng: 147, precision: "Town or city" },
    ];
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("map_point_included_event");
  });

  it("fails when a banned phrase appears in the BLUF", () => {
    const events = [makeEvent()];
    const report = baseReport(events);
    report.narrative = {
      ...report.narrative,
      bluf: "The operating picture is calm across the country this period.",
    } as CountryNarrative;
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("no_banned_phrase");
  });

  it("fails on a severity mismatch between a claim and its stored event", () => {
    const events = [makeEvent({ severity: "High" })];
    const report = baseReport(events);
    report.narrative = {
      ...report.narrative,
      claims: [
        ...report.narrative.claims,
        {
          claimId: "claim-x",
          claimText: "This was an Extreme incident.",
          section: "Top Developments",
          supportingEventIds: [events[0].eventId],
          supportingSourceIds: ["s1"],
          supportingMetric: null,
          claimType: "Confirmed fact",
          confidence: 90,
        },
      ],
    } as CountryNarrative;
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("severity_matches_stored");
  });

  it("fails on unsupported trend wording without prior data", () => {
    const events = [makeEvent()];
    const report = baseReport(events);
    report.hasPriorData = false;
    report.narrative = {
      ...report.narrative,
      outlook: "Violence increased and continues to escalate across the province.",
    } as CountryNarrative;
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("no_unsupported_trend");
  });

  it("does NOT fail on trend wording when prior data exists", () => {
    const events = [makeEvent()];
    const report = baseReport(events);
    report.hasPriorData = true;
    report.narrative = {
      ...report.narrative,
      outlook: "Violence increased this period compared with the previous window.",
    } as CountryNarrative;
    const result = runQualityGate(report);
    expect(checkNames(result)).not.toContain("no_unsupported_trend");
  });

  it("fails when an included duplicate group appears twice", () => {
    const report = baseReport([
      makeEvent({ duplicateGroupId: "g1" }),
      makeEvent({ duplicateGroupId: "g1" }),
    ]);
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("no_included_duplicate");
  });

  it("warns (not fails) on an out-of-window event reported inside the window", () => {
    const report = baseReport([makeEvent({ eventDate: "2024-01-01" })]);
    const result = runQualityGate(report);
    // publicationDates default to in-window, so §33 downgrades to a warning.
    const failure = result.failures.find((f) => f.check === "event_within_window");
    expect(failure?.severity).toBe("warning");
  });

  it("fails when an included event is dated AND reported outside the window", () => {
    const report = baseReport([
      makeEvent({ eventDate: "2024-01-01", publicationDates: ["2024-01-02"] }),
    ]);
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("event_within_window");
  });

  it("fails on Low-severity filler from an excluded class", () => {
    const report = baseReport([
      makeEvent({ severity: "Low", exclusionReason: "ceremony_or_praise" }),
    ]);
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("no_low_severity_filler");
  });

  it("fails when a section exceeds its §31 word limit", () => {
    const events = [makeEvent()];
    const report = baseReport(events);
    report.sectionWordCounts = {
      ...report.sectionWordCounts,
      "Bottom Line Up Front": 200,
    };
    const result = runQualityGate(report);
    expect(result.passed).toBe(false);
    expect(checkNames(result)).toContain("section_word_count");
  });
});

// ---------------------------------------------------------------------------
// §33 — top developments referenced in narrative (task: unmentioned headline)
// ---------------------------------------------------------------------------

describe("checkTopDevelopmentsReferenced (§33)", () => {
  it("passes for a normally assembled narrative", () => {
    const events = [
      makeEvent({ eventTitle: "Armed robbery at a market", severity: "High" }),
      makeEvent({ eventTitle: "Riot outside provincial assembly", severity: "High" }),
      makeEvent({ eventTitle: "Highway ambush near Kainantu", severity: "Medium" }),
    ];
    const report = baseReport(events);
    const result = runQualityGate(report);
    const hits = result.failures.filter(
      (f) => f.check === "top_development_referenced",
    );
    expect(hits).toHaveLength(0);
  });

  it("fails when a Top-3 development is absent from the narrative text", () => {
    const events = [
      makeEvent({ eventTitle: "Armed robbery at a market", severity: "High" }),
      makeEvent({ eventTitle: "Riot outside provincial assembly", severity: "High" }),
    ];
    const report = baseReport(events);
    // Simulate a regression that strips the "The period also brought …"
    // reference from every narrative section.
    const missing = report.narrative.topThree[1];
    expect(missing).toBeDefined();
    const scrub = (s: string) =>
      s.replace(new RegExp(missing.title, "ig"), "something else");
    report.narrative = {
      ...report.narrative,
      bluf: scrub(report.narrative.bluf),
      currentSituation: scrub(report.narrative.currentSituation),
      outlook: scrub(report.narrative.outlook),
    };
    const result = runQualityGate(report);
    const hits = result.failures.filter(
      (f) => f.check === "top_development_referenced",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("critical");
    expect(hits[0].eventId).toBe(missing.eventId);
    expect(result.passed).toBe(false);
  });

  it("skips the check for sparse reports (§27)", () => {
    const report = baseReport([]);
    const result = runQualityGate(report);
    expect(
      result.failures.filter((f) => f.check === "top_development_referenced"),
    ).toHaveLength(0);
  });

  it("still passes when top-development titles are so long the BLUF word cap bites", () => {
    const longTitle = (n: number) =>
      `Extended incident ${n} in which ` +
      Array.from({ length: 40 }, (_, i) => `detail${n}x${i}`).join(" ");
    const events = [
      makeEvent({ eventTitle: longTitle(1), severity: "Extreme", casualties: 3 }),
      makeEvent({ eventTitle: longTitle(2), severity: "High" }),
      makeEvent({ eventTitle: longTitle(3), severity: "High" }),
    ];
    const report = baseReport(events);
    const result = runQualityGate(report);
    // The reference check must NOT fail — the word cap may only trim the
    // optional analytical tail, never the top-development references. (The
    // section word-count check may flag the oversized BLUF separately, which
    // is a visible failure rather than a silent drop.)
    expect(
      result.failures.filter((f) => f.check === "top_development_referenced"),
    ).toHaveLength(0);
  });
});
