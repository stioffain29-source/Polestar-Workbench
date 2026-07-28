// Unit tests for the @workspace/country-engine canonical-event pipeline core.
//
// Covers the owner-brief scenarios: foreign-venue exclusion, physical-location
// attribution, ceremonial / routine-rescue / commentary / appointment
// exclusions, duplicate merging with supporting sources, retrospective
// recycling, and unknown-location precision.

import {
  buildCanonicalEvents,
  classifyArticle,
  attributeCountry,
  extractEventDate,
  assessSeverity,
  assessImpact,
  resolveUnderlyingPublisher,
  getCountryEngineConfig,
  COUNTRY_ENGINE_CONFIGS,
  type EngineSourceInput,
} from "@workspace/country-engine";

const PNG = getCountryEngineConfig("papua-new-guinea");
const INDONESIA = getCountryEngineConfig("indonesia");

function input(partial: Partial<EngineSourceInput> & { id: string; title: string }): EngineSourceInput {
  return {
    topic: "test",
    occurredAt: "2024-06-15T00:00:00.000Z",
    ...partial,
  };
}

describe("classifyArticle exclusions (§3-4)", () => {
  it("excludes a foreign conference (delegation at a conference)", () => {
    const r = classifyArticle(
      { title: "PNG delegation attends security conference in Cairns" },
      PNG,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("conference_or_forum");
  });

  it("excludes ceremonial praise", () => {
    const r = classifyArticle(
      { title: "Governor praises police for outstanding service at award ceremony" },
      PNG,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("ceremony_or_praise");
  });

  it("excludes a ministerial appointment", () => {
    const r = classifyArticle(
      { title: "New police commissioner appointed to lead the constabulary" },
      PNG,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("appointment_or_leadership");
  });

  it("excludes commentary / opinion", () => {
    const r = classifyArticle(
      { title: "Opinion: why the government must do more on law and order" },
      PNG,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("commentary_or_opinion");
  });

  it("excludes a policy / development announcement", () => {
    const r = classifyArticle(
      { title: "Government signs MoU to launch major road project" },
      PNG,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("policy_or_development_announcement");
  });

  it("excludes a successful routine rescue with no security event", () => {
    const r = classifyArticle(
      { title: "All passengers safely rescued after boat runs aground" },
      PNG,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("successful_routine_response");
  });

  it("excludes judicial / prosecutorial process reporting (legal_process)", () => {
    for (const title of [
      "Medan Corruption Court judge acquits defendant in PTPN IV land corruption case",
      "Former Tapteng health chief sentenced to 5 years for Rp 10.6 billion BOK corruption",
      "Judge's reasoning for granting Bahtiar's pretrial in pineapple seed corruption case",
      "KPK urges law enforcement to coordinate to eradicate corruption in Papua",
    ]) {
      const r = classifyArticle({ title }, INDONESIA);
      expect(r.isEvent).toBe(false);
      expect(r.exclusionReason).toBe("legal_process");
    }
  });

  it("keeps a fresh violent occurrence despite legal-process framing (hard-event override)", () => {
    const r = classifyArticle(
      { title: "Drug case suspect shot dead by police as trial verdict read in court" },
      INDONESIA,
    );
    expect(r.isEvent).toBe(true);
  });

  it("keeps live unrest about a graft case (unrest companion override)", () => {
    const r = classifyArticle(
      { title: "Thousands rally in Philippines over graft case against pro-Duterte senator" },
      getCountryEngineConfig("philippines"),
    );
    expect(r.isEvent).toBe(true);
    expect(r.issueCategory).toBe("Civil unrest");
  });

  it("keeps a physical police raid in a corruption probe (policing companion override)", () => {
    const r = classifyArticle(
      { title: "Police Raid Jakarta Cafe in Probe of Sumatra Blackout Corruption Case" },
      INDONESIA,
    );
    expect(r.isEvent).toBe(true);
  });

  it("excludes preparedness / awareness activity (preparedness_or_awareness)", () => {
    for (const title of [
      "Dry season, BPBD Samarinda strengthens preparedness for forest and land fires",
      "Gunung Megang police chief urges farmers to be frontline in preventing forest and land fires",
      "BMKG holds earthquake and tsunami field school to boost coastal community preparedness",
      "Danrem 042/Gapu surveys fire-prone areas by air to strengthen prevention measures",
    ]) {
      const r = classifyArticle({ title }, INDONESIA);
      expect(r.isEvent).toBe(false);
      expect(r.exclusionReason).toBe("preparedness_or_awareness");
    }
  });

  it("keeps a genuine hazard occurrence untouched by the preparedness rule", () => {
    for (const title of [
      "Plywood factory fire in Kuningan destroys wood raw materials and 15 buildings",
      "Garut disaster agency deploys assessment team as land movement and landslides hit Banjarwangi",
    ]) {
      const r = classifyArticle({ title }, INDONESIA);
      expect(r.isEvent).toBe(true);
      expect(r.exclusionReason).toBeNull();
    }
  });

  it("classifies genuine fire/accident events into Fire and accident with auto-include confidence", () => {
    for (const title of [
      "Fire breaks out at a plywood factory in Bekasi, dozens of workers evacuated",
      "Warehouse fire in Tangerang destroys stored goods",
      "School gutted by fire in Port Moresby overnight",
      "House burns down in Quezon City, family displaced",
      "Massive blaze rips through Jakarta slum area",
      "Gas leak forces evacuation of apartment block in Surabaya",
      "Two workers injured in industrial accident at Cilegon plant",
    ]) {
      const r = classifyArticle({ title }, INDONESIA);
      expect(r.isEvent).toBe(true);
      expect(r.issueCategory).toBe("Fire and accident");
      expect(r.classificationConfidence).toBeGreaterThanOrEqual(70);
    }
  });

  it("keeps fire metaphors and non-fire homonyms out of Fire and accident", () => {
    // Metaphor / dismissal / criticism homonyms must NOT match the fire rule.
    for (const title of [
      "Minister under fire over budget shortfall",
      "Airline draws fire for delayed refunds",
      "Company fires 200 workers amid restructuring",
    ]) {
      const r = classifyArticle({ title }, INDONESIA);
      expect(r.issueCategory).not.toBe("Fire and accident");
    }
    // Gunfire stays a security event, not a Fire and accident record.
    const shooting = classifyArticle(
      { title: "Soldiers opened fire at the checkpoint, two killed" },
      INDONESIA,
    );
    expect(shooting.isEvent).toBe(true);
    expect(shooting.issueCategory).not.toBe("Fire and accident");
  });

  it("fire-prevention PR stays excluded (preparedness beats the new category)", () => {
    const r = classifyArticle(
      { title: "Regency launches fire prevention campaign ahead of dry season" },
      INDONESIA,
    );
    expect(r.isEvent).toBe(false);
    expect(r.exclusionReason).toBe("preparedness_or_awareness");
  });

  it("wildfire stays Natural hazard, arson attack stays with security categories", () => {
    const wild = classifyArticle(
      { title: "Wildfire spreads across plantations in Riau" },
      INDONESIA,
    );
    expect(wild.issueCategory).toBe("Natural hazard");
    const torched = classifyArticle(
      { title: "Rioters torched shops during unrest in Wamena" },
      INDONESIA,
    );
    expect(torched.issueCategory).toBe("Civil unrest");
  });

  it("classifies a genuine violent incident as an event", () => {
    const r = classifyArticle(
      { title: "Three killed in armed robbery at Lae market" },
      PNG,
    );
    expect(r.isEvent).toBe(true);
    expect(r.classificationConfidence).toBeGreaterThanOrEqual(85);
    expect(["Violent crime", "Theft and robbery"]).toContain(r.issueCategory);
  });
});

describe("attributeCountry physical location (§5)", () => {
  it("attributes a Taipei protest about Indonesia to Taiwan", () => {
    const r = attributeCountry(
      input({ id: "1", title: "Protest in Taipei over Indonesia's Papua policy" }),
      INDONESIA,
    );
    expect(r.physicalCountry).toBe("Taiwan");
    expect(r.relatedCountry).toBe("Indonesia");
    expect(r.isForeignVenue).toBe(true);
  });

  it("attributes a Cairns conference attended by PNG officials to Australia", () => {
    const r = attributeCountry(
      input({ id: "2", title: "Conference in Cairns attended by PNG officials" }),
      PNG,
    );
    expect(r.physicalCountry).toBe("Australia");
    expect(r.relatedCountry).toBe("Papua New Guinea");
    expect(r.isForeignVenue).toBe(true);
  });

  it("keeps a home-venue event at home despite a foreign subject mention", () => {
    const r = attributeCountry(
      input({ id: "3", title: "Riot in Port Moresby after Australia visa decision" }),
      PNG,
    );
    expect(r.physicalCountry).toBe("Papua New Guinea");
    expect(r.isForeignVenue).toBe(false);
  });
});

describe("extractEventDate (§6)", () => {
  it("marks 'a year after the riots' as an old, recycled event", () => {
    const r = extractEventDate(
      input({
        id: "4",
        title: "A year after the riots, Port Moresby reflects",
        occurredAt: "2025-01-10T00:00:00.000Z",
      }),
    );
    expect(r.recycled).toBe(true);
    expect(r.dateConfidence).toBeLessThan(50);
  });

  it("prefers an explicit incidentDate", () => {
    const r = extractEventDate(
      input({
        id: "5",
        title: "Shooting reported",
        incidentDate: "2024-06-14T00:00:00.000Z",
        occurredAt: "2024-06-15T00:00:00.000Z",
      }),
    );
    expect(r.eventDate).toBe("2024-06-14");
    expect(r.recycled).toBe(false);
  });
});

describe("assessSeverity (§11)", () => {
  it("rates fatalities High and cites evidence", () => {
    const r = assessSeverity(
      { title: "Three people killed in tribal fight in Enga" },
      "Communal or tribal violence",
    );
    expect(r.severity).toBe("High");
    expect(r.severityReason).toMatch(/fatalit/i);
  });

  it("rates a mass-casualty toll Extreme", () => {
    const r = assessSeverity(
      { title: "Explosion", fatalities: 24 },
      "Terrorism",
    );
    expect(r.severity).toBe("Extreme");
  });
});

describe("assessImpact (§12-13)", () => {
  it("reports Direct impact only from a confirmed effect", () => {
    const r = assessImpact({ title: "Protest blocked the Highlands Highway for hours" });
    expect(r.impactLevel).toBe("Direct");
    expect(r.confirmedOperationalEffect).toBeTruthy();
  });

  it("never invents an effect (Monitor only)", () => {
    const r = assessImpact({ title: "Man arrested for theft in a suburb" });
    expect(r.impactLevel).toBe("Monitor only");
    expect(r.confirmedOperationalEffect).toBeNull();
  });
});

describe("resolveUnderlyingPublisher (§28)", () => {
  it("extracts the trailing masthead and never returns Google News", () => {
    expect(resolveUnderlyingPublisher("Google News", "Riot breaks out in Lae - Post-Courier")).toBe(
      "Post-Courier",
    );
    expect(resolveUnderlyingPublisher("Google News", "Some headline with no masthead")).toBeNull();
  });
});

describe("buildCanonicalEvents orchestration", () => {
  it("merges duplicate police-operation articles into one canonical event with supporting sources", () => {
    const inputs: EngineSourceInput[] = [
      input({
        id: "a",
        title: "Police operation in Mount Hagen nets three suspects",
        summary: "Police raided a settlement in Mount Hagen and arrested three suspects.",
        source: "Post-Courier",
        occurredAt: "2024-06-15T00:00:00.000Z",
      }),
      input({
        id: "b",
        title: "Three suspects arrested in Mount Hagen police operation",
        summary: "A police operation in Mount Hagen led to three suspects being arrested.",
        source: "The National",
        occurredAt: "2024-06-15T06:00:00.000Z",
      }),
    ];
    const res = buildCanonicalEvents(inputs, PNG);
    const merged = res.events.filter((e) => e.supportingSourceIds.length > 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].supportingSourceIds.sort()).toEqual(["a", "b"]);
    expect(res.stats.duplicatesMerged).toBe(1);
    // Two source articles, one canonical INCLUDED event.
    expect(res.included).toHaveLength(1);
  });

  it("excludes a foreign-venue conference event from inclusion", () => {
    const inputs: EngineSourceInput[] = [
      input({
        id: "c",
        title: "Indonesian delegation attends mining conference in Cairns",
        country: "Indonesia",
        source: "Antara",
      }),
    ];
    const res = buildCanonicalEvents(inputs, INDONESIA);
    expect(res.included).toHaveLength(0);
    const ev = res.events[0];
    expect(ev.physicalCountry).toBe("Australia");
    // Excluded either as a conference or a foreign venue — both are correct.
    expect(["foreign_venue", "conference_or_forum"]).toContain(ev.exclusionReason);
    expect(ev.inclusionStatus).toBe("excluded");
  });

  it("excludes ceremonial praise from incident totals", () => {
    const inputs: EngineSourceInput[] = [
      input({ id: "d", title: "Minister praises staff at awards ceremony in Port Moresby" }),
    ];
    const res = buildCanonicalEvents(inputs, PNG);
    expect(res.included).toHaveLength(0);
    expect(res.events[0].exclusionReason).toBe("ceremony_or_praise");
  });

  it("city scope (Jakarta): excludes nationwide Indonesia incidents outside the city footprint", () => {
    const JAKARTA = getCountryEngineConfig("jakarta");
    const inputs: EngineSourceInput[] = [
      input({
        id: "cs1",
        title: "Armed robbery wounds a shopkeeper in Tanah Abang, Jakarta",
        summary: "A shopkeeper was wounded during an armed robbery in Tanah Abang.",
        country: "Indonesia",
        location: "Jakarta",
      }),
      input({
        id: "cs2",
        title: "Riot injures five outside a factory in Surabaya",
        summary: "Five people were injured when a riot broke out outside a factory in Surabaya.",
        country: "Indonesia",
        location: "Surabaya",
      }),
    ];
    const res = buildCanonicalEvents(inputs, JAKARTA);
    // The Jakarta record stays in the city run.
    const jakartaEv = res.events.find((e) => e.supportingSourceIds.includes("cs1"));
    expect(jakartaEv?.inclusionStatus).not.toBe("excluded");
    // The Surabaya record is excluded WITH a stored reason — never silently included.
    const surabayaEv = res.events.find((e) => e.supportingSourceIds.includes("cs2"));
    expect(surabayaEv?.inclusionStatus).toBe("excluded");
    expect(surabayaEv?.exclusionReason).toBe("outside_city_scope");
    expect(res.included.some((e) => e.supportingSourceIds.includes("cs2"))).toBe(false);
  });

  it("national slugs are unaffected by city scoping (Surabaya stays valid under Indonesia)", () => {
    const inputs: EngineSourceInput[] = [
      input({
        id: "cs3",
        title: "Riot injures five outside a factory in Surabaya",
        summary: "Five people were injured when a riot broke out outside a factory in Surabaya.",
        country: "Indonesia",
        location: "Surabaya",
      }),
    ];
    const res = buildCanonicalEvents(inputs, INDONESIA);
    const ev = res.events[0];
    expect(ev.exclusionReason).not.toBe("outside_city_scope");
    expect(ev.inclusionStatus).not.toBe("excluded");
  });

  it("assigns Unknown location precision when no place is resolvable", () => {
    const inputs: EngineSourceInput[] = [
      input({ id: "e", title: "Man shot dead in unrest", summary: "A man was shot dead." }),
    ];
    const res = buildCanonicalEvents(inputs, PNG);
    const ev = res.events[0];
    expect(ev.locationPrecision).toBe("Unknown");
  });

  it("marks a retrospective 'a year after the riots' event recycled and out of window", () => {
    const inputs: EngineSourceInput[] = [
      input({
        id: "f",
        title: "A year after the riots that killed dozens, Port Moresby rebuilds",
        occurredAt: "2025-01-10T00:00:00.000Z",
      }),
    ];
    const res = buildCanonicalEvents(inputs, PNG);
    const ev = res.events[0];
    expect(ev.inclusionStatus).toBe("excluded");
    expect(["recycled_or_out_of_window", "background_or_explainer"]).toContain(ev.exclusionReason);
  });

  it("produces deterministic output for the same inputs", () => {
    const inputs: EngineSourceInput[] = [
      input({ id: "g", title: "Robbery at Lae market", occurredAt: "2024-06-10T00:00:00.000Z" }),
      input({ id: "h", title: "Tribal fight in Enga kills two", occurredAt: "2024-06-12T00:00:00.000Z" }),
    ];
    const a = buildCanonicalEvents(inputs, PNG);
    const b = buildCanonicalEvents(inputs, PNG);
    expect(a.events.map((e) => e.eventId)).toEqual(b.events.map((e) => e.eventId));
    // Sorted by eventDate desc: the 12 June event precedes the 10 June one.
    expect(a.events[0].eventDate! >= a.events[1].eventDate!).toBe(true);
  });

  it("applies analyst overrides last (authoritative)", () => {
    const inputs: EngineSourceInput[] = [
      input({ id: "i", title: "Man shot dead in Port Moresby", occurredAt: "2024-06-15T00:00:00.000Z" }),
    ];
    const res = buildCanonicalEvents(inputs, PNG, [
      { eventId: "i", severity: "Extreme", inclusionStatus: "held" },
    ]);
    const ev = res.events.find((e) => e.eventId === "i")!;
    expect(ev.severity).toBe("Extreme");
    expect(ev.inclusionStatus).toBe("held");
  });

  it("counts reattributed events whose physical country differs from the stored tag", () => {
    const inputs: EngineSourceInput[] = [
      input({
        id: "j",
        title: "Protest in Taipei over Indonesia policy",
        country: "Indonesia",
      }),
    ];
    const res = buildCanonicalEvents(inputs, INDONESIA);
    expect(res.stats.reattributed).toBeGreaterThanOrEqual(1);
  });
});

describe("config registry", () => {
  it("exposes the six active reports", () => {
    expect(Object.keys(COUNTRY_ENGINE_CONFIGS).sort()).toEqual(
      ["indonesia", "jakarta", "papua", "papua-new-guinea", "philippines", "thailand"].sort(),
    );
  });

  it("builds a generic config for any other country", () => {
    const c = getCountryEngineConfig("vanuatu");
    expect(c.countryName.toLowerCase()).toBe("vanuatu");
    expect(c.acceptedTokens).toContain("vanuatu");
    expect(c.mapBounds).toBeNull();
  });
});
