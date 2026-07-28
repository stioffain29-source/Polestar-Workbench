import type { CanonicalEvent } from "@workspace/country-engine/types";
import {
  buildTopThree,
  buildBluf,
  buildCategoryIntro,
  buildCurrentSituation,
  buildOperationalImpact,
  buildRecommendations,
  buildOutlook,
  buildPolestarView,
  buildCountryNarrative,
  capWords,
  countWords,
  assertNoUnsupportedTrend,
  findBannedOpeners,
  naturaliseTitle,
  compactTitle,
  APPROVED_RECOMMENDATIONS,
} from "@workspace/country-engine/narrative";

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

// ---------------------------------------------------------------------------
// capWords / countWords
// ---------------------------------------------------------------------------

describe("capWords", () => {
  it("returns text unchanged when within cap", () => {
    expect(capWords("One two three.", 10)).toBe("One two three.");
  });

  it("trims at sentence boundaries, never mid-sentence", () => {
    const text = "First short sentence here. Second longer sentence overflows now.";
    const capped = capWords(text, 6);
    expect(capped).toBe("First short sentence here.");
    expect(capped.endsWith(".")).toBe(true);
    expect(countWords(capped)).toBeLessThanOrEqual(6);
  });

  it("keeps the first sentence whole even if it alone exceeds the cap", () => {
    const text = "This single sentence is quite a lot longer than the cap allows here.";
    const capped = capWords(text, 3);
    expect(capped).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// naturaliseTitle (§14/§15)
// ---------------------------------------------------------------------------

describe("compactTitle (§31 clause-boundary trimming)", () => {
  it("trims at a semicolon", () => {
    expect(
      compactTitle("Kama SDA student found dead; police investigate murder"),
    ).toBe("Kama SDA student found dead");
  });

  it("trims at a dash", () => {
    expect(compactTitle("Highway ambush halts convoys — drivers strike")).toBe(
      "Highway ambush halts convoys",
    );
  });

  it("trims at a comma followed by a connective", () => {
    expect(
      compactTitle("Armed raid leaves two dead, as tensions rise in Lae"),
    ).toBe("Armed raid leaves two dead");
  });

  it("does not trim at a bare list comma", () => {
    const t = "Clashes reported in Lae, Madang and Wewak";
    expect(compactTitle(t)).toBe(t);
  });

  it("returns the whole title when no clause boundary exists", () => {
    const t = "Armed robbery at a market in Lae";
    expect(compactTitle(t)).toBe(t);
  });

  it("returns the whole title when the first clause is too short", () => {
    const t = "Riot erupts; hundreds of protesters storm the assembly grounds";
    expect(compactTitle(t)).toBe(t);
  });
});

describe("naturaliseTitle", () => {
  it("converts a shouty ALL-CAPS headline to sentence case", () => {
    expect(
      naturaliseTitle("KAMA SDA STUDENT FOUND DEAD; POLICE INVESTIGATE MURDER"),
    ).toBe("Kama sda student found dead; police investigate murder");
  });

  it("strips leading/trailing colons, semicolons and dashes plus wire cruft", () => {
    expect(naturaliseTitle(": Armed robbery at a market; ")).toBe(
      "Armed robbery at a market",
    );
    expect(naturaliseTitle("— Two injured in clash —")).toBe(
      "Two injured in clash",
    );
  });

  it("collapses whitespace and quotes", () => {
    expect(naturaliseTitle('  "Road   blocked  after landslide"  ')).toBe(
      "Road blocked after landslide",
    );
  });

  it("leaves naturally cased titles intact (leading capital preserved)", () => {
    expect(naturaliseTitle("Armed robbery at a market in Lae")).toBe(
      "Armed robbery at a market in Lae",
    );
  });
});

// ---------------------------------------------------------------------------
// BLUF title + location rendering (§14/§15)
// ---------------------------------------------------------------------------

describe("BLUF title + location rendering (§14/§15)", () => {
  it("naturalises a raw wire headline used as the lead title", () => {
    const events = [
      makeEvent({
        eventTitle:
          "KAMA SDA STUDENT FOUND DEAD; POLICE INVESTIGATE ALLEGED MURDER:",
        severity: "Extreme",
        casualties: 1,
        city: null,
        district: null,
        provinceOrState: "Morobe",
        locationPrecision: "Province or state",
      }),
    ];
    const { value } = buildBluf(events, "Papua New Guinea", null);
    expect(value).not.toMatch(/STUDENT FOUND DEAD/);
    expect(value).toMatch(/kama sda student found dead/i);
    expect(value).not.toMatch(/MURDER:/);
  });

  it("omits the location clause for a Country-only location (never 'at <Country>')", () => {
    const events = [
      makeEvent({
        eventTitle: "Nationwide reports of unrest",
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
      }),
    ];
    const { value } = buildBluf(events, "Papua New Guinea", null);
    expect(value).not.toMatch(/at Papua New Guinea/);
    // Date clause is retained.
    expect(value).toMatch(/on \d+ \w+ \d{4}/);
  });

  it("uses an 'in <province>' clause for province-level precision", () => {
    const events = [
      makeEvent({
        eventTitle: "Communal clash",
        city: null,
        district: null,
        provinceOrState: "Morobe",
        locationPrecision: "Province or state",
      }),
    ];
    const { value } = buildBluf(events, "Papua New Guinea", null);
    expect(value).toMatch(/in Morobe on/);
    expect(value).not.toMatch(/at Morobe/);
  });
});

// ---------------------------------------------------------------------------
// Priority-location lists never name the whole country (task 473)
// ---------------------------------------------------------------------------

describe("priority locations never mix in the country name", () => {
  const mixed = [
    makeEvent(), // Lae / Morobe (sub-national)
    makeEvent({
      eventTitle: "Nationwide unrest reports",
      city: null,
      district: null,
      provinceOrState: null,
      locationPrecision: "Country only",
    }),
  ];

  it("BLUF keeps the country name out of the location list and notes the unlocated remainder", () => {
    const { value } = buildBluf(mixed, "Papua New Guinea", null);
    expect(value).not.toMatch(/recorded in [^.]*Papua New Guinea/);
    expect(value).toMatch(/with the remainder unlocated/);
  });

  it("Current Situation concentrates on sub-national locations only, with a remainder clause", () => {
    const { value } = buildCurrentSituation(mixed, "Papua New Guinea");
    expect(value).not.toMatch(/concentrated in [^.]*Papua New Guinea/);
    expect(value).toMatch(/concentrated in Lae, with the remainder unlocated/);
  });

  it("Current Situation falls back to country-level phrasing when nothing is located", () => {
    const only = [
      makeEvent({
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
      }),
    ];
    const { value } = buildCurrentSituation(only, "Papua New Guinea");
    expect(value).toMatch(/recorded at country level only/);
    expect(value).not.toMatch(/concentrated in Papua New Guinea/);
  });

  it("Pole Star View prioritises sub-national locations, never the country", () => {
    const { value } = buildPolestarView(mixed, {});
    expect(value).not.toMatch(
      /route and site information for [^.]*Papua New Guinea/,
    );
    if (/route and site information/.test(value)) {
      expect(value).toMatch(/route and site information for Lae/);
    }
  });

  it("Pole Star View falls back to 'the affected areas' when nothing is located", () => {
    const only = [
      makeEvent({
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
      }),
    ];
    const { value } = buildPolestarView(only, {});
    expect(value).not.toMatch(/for Papua New Guinea/);
    if (/route and site information/.test(value)) {
      expect(value).toMatch(/for the affected areas/);
    }
  });
});

// ---------------------------------------------------------------------------
// Word caps enforced per §31
// ---------------------------------------------------------------------------

describe("section word caps (§31)", () => {
  const events = [
    makeEvent({ severity: "Extreme", casualties: 3 }),
    makeEvent({ issueCategory: "Civil unrest", city: "Port Moresby" }),
    makeEvent({ issueCategory: "Road and rail", city: "Mount Hagen" }),
  ];

  it("BLUF ≤120 words", () => {
    const { value } = buildBluf(events, "Papua New Guinea", null);
    expect(countWords(value)).toBeLessThanOrEqual(120);
  });

  it("category intro ≤90 words", () => {
    const { value } = buildCategoryIntro("Violent crime", events.slice(0, 1));
    expect(countWords(value)).toBeLessThanOrEqual(90);
  });

  it("current situation ≤120 words", () => {
    const { value } = buildCurrentSituation(events, "Papua New Guinea");
    expect(countWords(value)).toBeLessThanOrEqual(120);
  });

  it("outlook ≤150 words", () => {
    const { value } = buildOutlook(events, null);
    expect(countWords(value)).toBeLessThanOrEqual(150);
  });

  it("pole star view ≤180 words", () => {
    const { value } = buildPolestarView(events, {});
    expect(countWords(value)).toBeLessThanOrEqual(180);
  });
});

// ---------------------------------------------------------------------------
// Banned openers rejected (§15)
// ---------------------------------------------------------------------------

describe("BLUF banned openers (§15)", () => {
  it("generated BLUF does not begin with a banned opener", () => {
    const events = [makeEvent(), makeEvent({ issueCategory: "Civil unrest" })];
    const { value } = buildBluf(events, "Papua New Guinea", null);
    expect(findBannedOpeners(value)).toEqual([]);
  });

  it("detector flags a banned opener", () => {
    expect(
      findBannedOpeners("The operating picture is calm this period."),
    ).toContain("The operating picture");
    expect(findBannedOpeners("The reporting pattern shows...")).toContain(
      "The reporting pattern",
    );
  });
});

// ---------------------------------------------------------------------------
// Trend wording blocked without prior data (§16)
// ---------------------------------------------------------------------------

describe("trend gate (§16)", () => {
  it("flags trend words when no prior data", () => {
    const v = assertNoUnsupportedTrend("Violence increased and continues to escalate.", false);
    expect(v.length).toBeGreaterThan(0);
    expect(v).toEqual(expect.arrayContaining(["increased", "continues"]));
  });

  it("permits trend words when prior data exists", () => {
    expect(
      assertNoUnsupportedTrend("Violence increased this period.", true),
    ).toEqual([]);
  });

  it("outlook without prior data contains no trend wording", () => {
    const events = [makeEvent(), makeEvent({ eventStatus: "Ongoing" })];
    const { value } = buildOutlook(events, null);
    expect(assertNoUnsupportedTrend(value, false)).toEqual([]);
  });

  it("BLUF without prior data contains no trend wording", () => {
    const events = [makeEvent()];
    const { value } = buildBluf(events, "Papua New Guinea", null);
    expect(assertNoUnsupportedTrend(value, false)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Top three (§14)
// ---------------------------------------------------------------------------

describe("buildTopThree (§14)", () => {
  it("selects up to three, ranked by severity, each with a factual sentence", () => {
    const events = [
      makeEvent({ severity: "Low" }),
      makeEvent({ severity: "Extreme", casualties: 4 }),
      makeEvent({ severity: "Moderate" }),
      makeEvent({ severity: "High" }),
    ];
    const { value } = buildTopThree(events);
    expect(value).toHaveLength(3);
    expect(value[0].severity).toBe("Extreme");
    for (const td of value) {
      expect(td.factualSentence.length).toBeGreaterThan(0);
    }
  });

  it("derives an evidence-linked assessed sentence from stored attributes when no explicit effect exists", () => {
    const { value, claims } = buildTopThree([makeEvent()]);
    // makeEvent is Violent crime with injuries — the category implication plus
    // the injury framing form the assessed "what this means" sentence.
    expect(value[0].businessSentence).toMatch(/injuries/i);
    expect(value[0].businessSentence).toMatch(/staff safety|staff-safety/i);
    const assessed = claims.find(
      (c) => c.claimType === "Assessment" && c.claimText === value[0].businessSentence,
    );
    expect(assessed).toBeDefined();
    expect(assessed!.supportingEventIds).toContain(value[0].eventId);
  });

  it("uses confirmed effect for the business sentence when present", () => {
    const e = makeEvent({
      confirmedOperationalEffect: "The road was closed for three hours.",
    });
    const { value } = buildTopThree([e]);
    expect(value[0].businessSentence).toBe("The road was closed for three hours.");
  });

  it("excludes commentary/cancelled from top slots", () => {
    const events = [
      makeEvent({ eventStatus: "Commentary", severity: "Extreme" }),
      makeEvent({ eventStatus: "Confirmed", severity: "Low" }),
    ];
    const { value } = buildTopThree(events);
    expect(value.every((td) => td.eventId !== events[0].eventId)).toBe(true);
  });

  it("naturalises the top-development title (never a raw wire headline)", () => {
    const e = makeEvent({
      eventTitle: "KAMA SDA STUDENT FOUND DEAD; POLICE INVESTIGATE MURDER:",
    });
    const { value } = buildTopThree([e]);
    expect(value[0].title).not.toMatch(/STUDENT FOUND DEAD/);
    expect(value[0].title).toBe(
      "Kama sda student found dead; police investigate murder",
    );
  });
});

// ---------------------------------------------------------------------------
// Recommendations (§20)
// ---------------------------------------------------------------------------

describe("buildRecommendations (§20)", () => {
  const approvedTexts = new Set(APPROVED_RECOMMENDATIONS.map((r) => r.text));

  it("only returns actions from the approved menu", () => {
    const events = [makeEvent(), makeEvent({ issueCategory: "Civil unrest" })];
    const { value } = buildRecommendations(events);
    for (const rec of value) {
      expect(approvedTexts.has(rec.text)).toBe(true);
    }
  });

  it("each recommendation is triggered by ≥1 actual event via a claim", () => {
    const events = [makeEvent()];
    const { value, claims } = buildRecommendations(events);
    expect(value.length).toBeGreaterThan(0);
    const recClaims = claims.filter((c) => c.claimType === "Recommendation");
    for (const c of recClaims) {
      expect(c.supportingEventIds.length).toBeGreaterThan(0);
    }
  });

  it("returns no recommendations when nothing triggers them", () => {
    // A monitor-only health event triggers none of the movement/violence menu.
    const e = makeEvent({
      issueCategory: "Health",
      secondaryCategories: [],
      confirmedOperationalEffect: null,
    });
    const { value } = buildRecommendations([e]);
    expect(value).toEqual([]);
  });

  it("caps at 10 actions and each ≤22 words", () => {
    const events = [
      makeEvent({ issueCategory: "Violent crime" }),
      makeEvent({ issueCategory: "Civil unrest" }),
      makeEvent({ issueCategory: "Policing operation" }),
      makeEvent({ issueCategory: "Maritime" }),
      makeEvent({
        issueCategory: "Road and rail",
        confirmedOperationalEffect: "The road was closed and a curfew imposed.",
      }),
    ];
    const { value } = buildRecommendations(events);
    expect(value.length).toBeLessThanOrEqual(10);
    for (const rec of value) {
      expect(countWords(rec.text)).toBeLessThanOrEqual(22);
    }
  });
});

// ---------------------------------------------------------------------------
// Operational impact (§19)
// ---------------------------------------------------------------------------

describe("buildOperationalImpact (§19)", () => {
  it("skips categories with nothing event-linked to say", () => {
    const map = new Map([["Violent crime", [makeEvent()]] as const]);
    const { value } = buildOperationalImpact(map as any);
    expect(value).toEqual([]);
  });

  it("includes a confirmed effect and caps at 50 words", () => {
    const e = makeEvent({
      confirmedOperationalEffect: "The road was closed for three hours near the market.",
    });
    const map = new Map([["Violent crime", [e]] as const]);
    const { value } = buildOperationalImpact(map as any);
    expect(value).toHaveLength(1);
    expect(countWords(value[0].text)).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// Sparse handling (§27)
// ---------------------------------------------------------------------------

describe("buildCountryNarrative sparse handling (§27)", () => {
  it("returns the short report and omits sections when no events", () => {
    const n = buildCountryNarrative([], { countryName: "Papua New Guinea" });
    expect(n.isSparse).toBe(true);
    expect(n.shortReport).toMatch(/Reporting was limited/i);
    expect(n.topThree).toEqual([]);
    expect(n.bluf).toBe("");
    expect(n.outlook).toBe("");
  });

  it("assembles all sections with a word-count map when events exist", () => {
    const events = [
      makeEvent({ severity: "High" }),
      makeEvent({ issueCategory: "Civil unrest", city: "Port Moresby" }),
    ];
    const n = buildCountryNarrative(events, {
      countryName: "Papua New Guinea",
    });
    expect(n.isSparse).toBe(false);
    expect(n.shortReport).toBeNull();
    expect(n.bluf.length).toBeGreaterThan(0);
    expect(n.claims.length).toBeGreaterThan(0);
    expect(n.sectionWordCounts["Bottom Line Up Front"]).toBeLessThanOrEqual(120);
    expect(n.sectionWordCounts["Outlook"]).toBeLessThanOrEqual(150);
    expect(n.sectionWordCounts["Pole Star View"]).toBeLessThanOrEqual(180);
    // Every claim carries an id.
    for (const c of n.claims) {
      expect(c.claimId).toMatch(/^claim-\d+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// BLUF word cap must never drop the top-development reference sentence
// ---------------------------------------------------------------------------

describe("buildBluf top-development references vs word cap (§14/§15)", () => {
  it("references every ranked Top-3 development even with very long titles", () => {
    const longTitle = (n: number) =>
      `Extended incident ${n} in which ` +
      Array.from({ length: 40 }, (_, i) => `detail${n}x${i}`).join(" ");
    const events = [
      makeEvent({ eventTitle: longTitle(1), severity: "Extreme", casualties: 3 }),
      makeEvent({ eventTitle: longTitle(2), severity: "High" }),
      makeEvent({ eventTitle: longTitle(3), severity: "High" }),
    ];
    const { value: top } = buildTopThree(events);
    expect(top).toHaveLength(3);
    const { value: bluf } = buildBluf(events, "Papua New Guinea", null);
    for (const dev of top) {
      expect(bluf.toLowerCase()).toContain(dev.title.trim().toLowerCase());
    }
  });

  it("compacts long titles at clause boundaries to keep the BLUF within 120 words", () => {
    // Titles long enough that FULL forms alone would exceed the 120-word cap,
    // but each carrying a clause boundary the compact form can trim at.
    const pad = (n: number) =>
      Array.from({ length: 30 }, (_, i) => `context${n}word${i}`).join(" ");
    const events = [
      makeEvent({
        eventTitle: `Armed raid on a fuel depot leaves two dead, as ${pad(1)}`,
        severity: "Extreme",
        casualties: 2,
      }),
      makeEvent({
        eventTitle: `Riot outside the provincial assembly injures police; ${pad(2)}`,
        severity: "High",
      }),
      makeEvent({
        eventTitle: `Highway ambush near Kainantu halts convoys — ${pad(3)}`,
        severity: "High",
      }),
    ];
    const { value: top } = buildTopThree(events);
    expect(top).toHaveLength(3);
    const { value: bluf } = buildBluf(events, "Papua New Guinea", null);
    expect(countWords(bluf)).toBeLessThanOrEqual(120);
    // Every top development is still referenced via its compact form, which is
    // a verbatim leading clause of the stored title (no fabrication).
    for (const dev of top) {
      const compact = compactTitle(dev.title).toLowerCase();
      expect(dev.title.toLowerCase().startsWith(compact.toLowerCase())).toBe(
        true,
      );
      expect(bluf.toLowerCase()).toContain(compact);
    }
  });

  it("still caps the optional analytical tail at 120 words for normal titles", () => {
    const events = [
      makeEvent({ eventTitle: "Armed robbery at a market", severity: "High" }),
      makeEvent({ eventTitle: "Riot outside provincial assembly", severity: "High" }),
      makeEvent({ eventTitle: "Highway ambush near Kainantu", severity: "Medium" }),
    ];
    const { value: bluf } = buildBluf(events, "Papua New Guinea", null);
    expect(countWords(bluf)).toBeLessThanOrEqual(120);
  });
});
