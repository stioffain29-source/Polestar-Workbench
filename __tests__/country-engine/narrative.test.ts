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
  categoryPhrase,
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
    // Owner rule: the BLUF is our own prose — no raw or quoted headlines.
    expect(value).not.toMatch(/STUDENT FOUND DEAD/);
    expect(value).not.toMatch(/kama sda/i);
    expect(value).not.toMatch(/[“”"]/);
    expect(value).not.toMatch(/MURDER:/);
    // It summarises in our own words: category + place + date.
    expect(value).toMatch(/in Morobe on \d+ \w+ \d{4}/);
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
// BLUF lead sentence states both dates for an out-of-window lead (item 5:
// a row REPORTED inside the current window whose own event date falls
// BEFORE the window start, e.g. old news resurfacing with fresh findings).
// Guarded by countryReportQc.ts Check A, which only WARNS if both dates
// never appear in the narrative — this proves the engine actually produces
// them for the lead sentence rather than relying on chance.
// ---------------------------------------------------------------------------

describe("BLUF lead sentence and out-of-window dates (item 5)", () => {
  it("states both the event date and the (later) reported date when the lead predates the window", () => {
    const events = [
      makeEvent({
        eventDate: "2024-02-20",
        publicationDates: ["2024-03-06"],
      }),
    ];
    const { value } = buildBluf(events, "Papua New Guinea", null, "2024-03-01T00:00:00.000Z");
    // Both dates must appear somewhere in the lead sentence.
    expect(value).toMatch(/20 February 2024/);
    expect(value).toMatch(/6 March 2024/);
    expect(value).toMatch(/only reported on/);
  });

  it("does not add a reported-date clause when the lead falls inside the window", () => {
    const events = [
      makeEvent({
        eventDate: "2024-03-05",
        publicationDates: ["2024-03-06"],
      }),
    ];
    const { value } = buildBluf(events, "Papua New Guinea", null, "2024-03-01T00:00:00.000Z");
    expect(value).not.toMatch(/only reported on/);
    expect(value).not.toMatch(/6 March 2024/);
  });

  it("is byte-identical to the no-windowStart call when windowStart is omitted (backward compatible)", () => {
    const events = [
      makeEvent({
        eventDate: "2024-02-20",
        publicationDates: ["2024-03-06"],
      }),
    ];
    const withoutWindow = buildBluf(events, "Papua New Guinea", null);
    const withNullWindow = buildBluf(events, "Papua New Guinea", null, null);
    expect(withoutWindow.value).toBe(withNullWindow.value);
    expect(withoutWindow.value).not.toMatch(/only reported on/);
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

  it("BLUF keeps the country name out of the location list and does not surface a record-count caveat", () => {
    const { value } = buildBluf(mixed, "Papua New Guinea", null);
    expect(value).not.toMatch(/recorded in [^.]*Papua New Guinea/);
    expect(value).not.toMatch(/did not specify a location/);
  });

  it("Current Situation concentrates on sub-national locations only, without a record-count caveat", () => {
    const { value } = buildCurrentSituation(mixed, "Papua New Guinea");
    expect(value).not.toMatch(/concentrated in [^.]*Papua New Guinea/);
    expect(value).toMatch(/concentrated in Lae/);
    expect(value).not.toMatch(/did not specify a location/);
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

  it("never repeats the same derived category implication verbatim across the top slots", () => {
    // Three same-category events with no explicit effect: the generic
    // "For operators, an event of this kind..." implication may appear at most
    // ONCE across the three business sentences (owner-flagged boilerplate).
    const events = [
      makeEvent({ severity: "Extreme", casualties: 2 }),
      makeEvent({ severity: "High" }),
      makeEvent({ severity: "High" }),
    ];
    const { value } = buildTopThree(events);
    const operatorSentences = value
      .map((td) => td.businessSentence ?? "")
      .flatMap((s) => s.match(/For operators,[^.]*\./g) ?? []);
    expect(operatorSentences.length).toBeLessThanOrEqual(1);
    // Event-specific harm sentences are still allowed on later items.
    expect(value[0].businessSentence).toBeTruthy();
  });

  it("still derives distinct implications when the top slots carry different categories", () => {
    const events = [
      makeEvent({ severity: "High", issueCategory: "Violent crime" }),
      makeEvent({ severity: "High", issueCategory: "Civil unrest" }),
    ];
    const { value } = buildTopThree(events);
    const sentences = value.map((td) => td.businessSentence ?? "");
    expect(sentences[0]).not.toBe(sentences[1]);
  });

  it("BLUF groups repeated category+location clauses instead of repeating them", () => {
    // Three violent-crime events in the same place must not read as three
    // near-identical clauses ("violent crime in X on ... and violent crime in
    // X on ..."). The category+location phrase may appear at most twice
    // (lead + one grouped "further" clause).
    const events = [
      makeEvent({ eventTitle: "Fatal stabbing near the market", city: "East Jakarta", severity: "Extreme", eventDate: "2026-07-28" }),
      makeEvent({ eventTitle: "Shooting outside a bar", city: "East Jakarta", severity: "High", eventDate: "2026-07-28" }),
      makeEvent({ eventTitle: "Armed assault on a shop owner", city: "East Jakarta", severity: "High", eventDate: "2026-07-27" }),
    ];
    const { value } = buildBluf(events, "Jakarta", []);
    const occurrences = value.match(/violent crime[^,.]* in East Jakarta/gi) ?? [];
    expect(occurrences.length).toBeLessThanOrEqual(2);
    expect(value).toMatch(/further/i);
  });

  it("BLUF never lists the report's own theatre name as a location", () => {
    const events = [
      makeEvent({ eventTitle: "Robbery downtown", city: "Jakarta", severity: "High" }),
      makeEvent({ eventTitle: "Burglary in a suburb", city: "Jakarta", severity: "Moderate", issueCategory: "Theft and robbery" }),
    ];
    const { value } = buildBluf(events, "Jakarta", []);
    expect(value).not.toMatch(/recorded in Jakarta\b/);
  });

  it("keeps a follow-up of the same story out of the top slots", () => {
    // An event and its "suspects named" follow-up share category + a
    // distinctive title anchor within 2 days — only one may be selected.
    const original = makeEvent({
      eventTitle: "Circumstances behind the Matraman clash that killed one person",
      eventDate: "2026-07-28",
      severity: "High",
      issueCategory: "Civil unrest",
    });
    const followUp = makeEvent({
      eventTitle: "3 Matraman residents named suspects in Menteng clash",
      eventDate: "2026-07-27",
      severity: "High",
      issueCategory: "Civil unrest",
    });
    const third = makeEvent({
      eventTitle: "Warehouse fire in Cakung injures two workers",
      eventDate: "2026-07-26",
      severity: "Moderate",
      issueCategory: "Fire and accident",
    });
    const { value } = buildTopThree([original, followUp, third]);
    const ids = value.map((td) => td.eventId);
    expect(ids).not.toEqual(expect.arrayContaining([original.eventId, followUp.eventId]));
    expect(ids).toContain(third.eventId);
  });

  it("never merges two distinct events on a shared PLACE token alone", () => {
    // Both titles name the same district (also the resolved city) — a place
    // token must not act as a story anchor.
    const a = makeEvent({
      eventTitle: "Armed robbery at a Matraman mini-market",
      eventDate: "2026-07-28",
      city: "Matraman",
      severity: "High",
    });
    const b = makeEvent({
      eventTitle: "Stabbing outside a Matraman school",
      eventDate: "2026-07-27",
      city: "Matraman",
      severity: "High",
    });
    const { value } = buildTopThree([a, b]);
    expect(value).toHaveLength(2);
  });

  it("keeps genuinely distinct same-category events in separate slots", () => {
    const a = makeEvent({
      eventTitle: "Armed robbery at a Kelapa Gading mini-market",
      eventDate: "2026-07-28",
      severity: "High",
    });
    const b = makeEvent({
      eventTitle: "Stabbing outside a Blok M nightclub",
      eventDate: "2026-07-27",
      severity: "High",
    });
    const { value } = buildTopThree([a, b]);
    expect(value).toHaveLength(2);
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

  it("never emits a blank entry when the repetition guard consumes a category's only sentence", () => {
    // Regression: a category can look non-empty at the top of the loop (it has
    // an assessed-but-not-confirmed event) yet end up with nothing to say once
    // the cross-category repetition guard has already used that exact fixed
    // sentence for an earlier category. Previously this pushed an entry with
    // text: "" (rendered as a bare, empty bullet in the PDF).
    const sameAssessedSentence = "This reporting sits near routes or areas in active use.";
    const first = makeEvent({
      issueCategory: "Violent crime",
      confirmedOperationalEffect: null,
      assessedOperationalRelevance: sameAssessedSentence,
    });
    const second = makeEvent({
      issueCategory: "Civil unrest",
      confirmedOperationalEffect: null,
      assessedOperationalRelevance: sameAssessedSentence,
    });
    const map = new Map([
      ["Violent crime", [first]],
      ["Civil unrest", [second]],
    ] as const);
    const { value } = buildOperationalImpact(map as any);
    // Only the first category keeps the sentence; the second must be skipped
    // entirely rather than emitted with empty text.
    expect(value).toHaveLength(1);
    expect(value[0].category).toBe("Violent crime");
    for (const entry of value) {
      expect(entry.text.trim().length).toBeGreaterThan(0);
    }
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
    const hay = bluf.toLowerCase();
    // Owner rule: no raw headlines — each top development is referenced by
    // its own-words summary (category + location/date), never the title.
    for (const dev of top) {
      expect(hay).not.toContain("extended incident");
      expect(hay).toContain(categoryPhrase(dev.category).toLowerCase());
      expect(hay).toContain(dev.location.toLowerCase());
    }
    expect(countWords(bluf)).toBeLessThanOrEqual(120);
  });

  it("stays within 120 words without quoting any stored title", () => {
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
    // No stored headline text (full or compact) appears in the BLUF.
    const hay = bluf.toLowerCase();
    for (const dev of top) {
      expect(hay).not.toContain("context1word0");
      expect(hay).not.toContain(compactTitle(dev.title).toLowerCase());
      // Referenced instead via category + location/date summary.
      expect(hay).toContain(categoryPhrase(dev.category).toLowerCase());
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

// ---------------------------------------------------------------------------
// §15 follow-up — category intro and outlook location lists never mix the
// country name in when sub-national locations exist.
// ---------------------------------------------------------------------------

describe("category intro / outlook location priority (§15)", () => {
  it("category intro prefers sub-national locations over the country name in a mixed window", () => {
    const events = [
      makeEvent({ city: "Lae", provinceOrState: "Morobe" }),
      makeEvent({
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
      }),
    ];
    const { value } = buildCategoryIntro("Violent crime", events);
    expect(value).toMatch(/mainly in Lae/);
    expect(value).not.toMatch(/mainly in [^.]*Papua New Guinea/);
  });

  it("category intro falls back to the country name only when nothing is located", () => {
    const events = [
      makeEvent({
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
      }),
    ];
    const { value } = buildCategoryIntro("Violent crime", events);
    expect(value).toMatch(/mainly in Papua New Guinea/);
  });

  it("outlook review sentence prefers sub-national locations in a mixed window", () => {
    const events = [
      makeEvent({ city: "Mount Hagen", provinceOrState: "Western Highlands" }),
      makeEvent({
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
        issueCategory: "Civil unrest",
      }),
    ];
    const { value } = buildOutlook(events, null);
    if (/should remain under review/.test(value)) {
      expect(value).not.toMatch(/Papua New Guinea should remain under review/);
    }
  });

  it("outlook falls back to the country name when nothing is located", () => {
    const events = [
      makeEvent({
        city: null,
        district: null,
        provinceOrState: null,
        locationPrecision: "Country only",
      }),
    ];
    const { value } = buildOutlook(events, null);
    if (/should remain under review/.test(value)) {
      expect(value).toMatch(/Papua New Guinea should remain under review/);
    }
  });
});
