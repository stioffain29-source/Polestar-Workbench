import {
  classifyNewsItem,
  ENERGY_CONFIG,
  FUEL_CONFIG,
  FERTILISER_CONFIG,
  CONFLICT_CONFIG,
  INDONESIA_LOCAL_CONFIG,
  APAC_LOCAL_CONFIG,
} from "@workspace/ingest";

// Locks the WRITE-TIME fix for cross-syndicated foreign stories: when a story's
// TITLE unambiguously names exactly one tracked country that differs from the
// feed's default, the incident is attributed to the title-named country — not
// blind-stamped with the feed default and not overridden by an incidental
// country mention in the summary. Previously this class of defect could only be
// repaired retroactively by one-time marker-gated relocate migrations; the fix
// now happens at ingest so no further relocate migrations are needed for new
// rows. Multi-country titles stay conservative (region-first, no guessing).

describe("title-first country attribution at ingest", () => {
  it("stamps a single-country title over the feed default", () => {
    // "Australia fuel crisis" mis-stamped onto an in-region default before.
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Australia power grid strained as blackout risk grows",
      "",
      { defaultCountry: "Myanmar" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Australia");
  });

  it("lets the single-country title beat an incidental summary mention", () => {
    // The summary names an in-region country (region-ordered first in the
    // gazetteer), but the TITLE clearly names France, so France must win.
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Paris hit by nationwide power outage as French grid fails",
      "Comparisons drawn with earlier Pakistan load shedding",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("France");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Pakistan load shedding worsens as Turkey offers electricity supply help",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });

  it("does NOT relocate an in-region story that only names a foreign place in passing", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Iraq-Turkey Pipeline sabotage cuts crude flow after pipeline attack",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Iraq");
  });

  it("falls back to the feed default when the title names no tracked country", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Nationwide power outage plunges the country into darkness",
      "",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });
});

// FUEL and FERTILISER share ENERGY's global gazetteer (GLOBAL_TOPIC_ALIASES) and
// the same title-first `classify` logic, so the SAME mis-attribution defect can
// re-appear if either config's allow list or the gazetteer drifts. These import
// the REAL configs so a gazetteer/ordering change surfaces as a failing test.

describe("FUEL title-first country attribution at ingest", () => {
  it("stamps a single-country title over an in-region feed default", () => {
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "Fuel shortage hits French gas stations nationwide",
      "",
      { defaultCountry: "Vietnam" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("France");
  });

  it("lets the single-country title beat an incidental summary mention", () => {
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "Australia fuel crisis deepens as diesel shortage spreads",
      "Compared to earlier Pakistan fuel queues",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Australia");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "India and Bangladesh both hit by a severe fuel crisis",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("India");
  });
});

describe("FERTILISER title-first country attribution at ingest", () => {
  it("stamps a single-country title over an in-region feed default", () => {
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "Poland urea shortage forces farmers to cut planting",
      "",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Poland");
  });

  it("lets the single-country title beat an incidental summary mention", () => {
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "France fertiliser price surge squeezes farmers",
      "Growers recalled the earlier India fertiliser subsidy row",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("France");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "Pakistan and India both face a deepening urea shortage",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("India");
  });
});

// Regression lock for the one-time relocate migration
// `fuel_fertiliser_foreign_syndication_relocate_v1` (migrations.ts): every
// foreign story it had to retroactively re-stamp must now classify to the
// correct country AT WRITE TIME, so no future relocate migration is needed for
// new rows. Each case sets an in-region (wrong) feed default to prove the
// title-named country overrides it. The migration is the source of truth for
// the expected countries (France, Poland, Australia, UK, Ukraine, India).
describe("relocate-migration examples now classify correctly at write time", () => {
  const cases: {
    country: string;
    title: string;
    wrongDefault: string;
  }[] = [
    // "Fuel shortage in French gas stations" was stored Vietnam.
    { country: "France", title: "Fuel shortage in French gas stations", wrongDefault: "Vietnam" },
    // "Scotland vulnerable after Grangemouth closure" was stored India.
    {
      country: "United Kingdom",
      title: "Scotland fuel supply vulnerable after Grangemouth refinery shutdown",
      wrongDefault: "India",
    },
    // "Australia fuel crisis" was stored Myanmar/Philippines.
    { country: "Australia", title: "Australia fuel crisis worsens", wrongDefault: "Myanmar" },
    // "Fuel shortage grows in Crimea" was stored Bangladesh/India.
    { country: "Ukraine", title: "Fuel shortage grows in Crimea", wrongDefault: "Bangladesh" },
    // "Kerala Assembly ... fuel crisis" was stored Philippines.
    {
      country: "India",
      title: "Kerala Assembly grapples with a worsening fuel crisis",
      wrongDefault: "Philippines",
    },
    // Poland is a relocate target in the same migration.
    { country: "Poland", title: "Poland fuel shortage worsens as diesel rationing begins", wrongDefault: "Pakistan" },
  ];

  for (const { country, title, wrongDefault } of cases) {
    it(`attributes "${title}" to ${country}`, () => {
      const c = classifyNewsItem(FUEL_CONFIG, title, "", { defaultCountry: wrongDefault });
      expect(c.kept).toBe(true);
      expect(c.country).toBe(country);
    });
  }
});

// The SAME shared `classify`/title-first logic also drives CONFLICT and the two
// local topics, but each uses its OWN gazetteer (CONFLICT_ALIASES,
// INDONESIA_LOCAL_ALIASES, APAC_LOCAL_ALIASES) — NOT the global one the energy/
// fuel/fertiliser cases above exercise. A gazetteer reorder or alias drift on
// these configs could silently mis-attribute a country with no failing test.
// These import the REAL configs so that drift surfaces here.

describe("CONFLICT title-first country attribution at ingest", () => {
  it("stamps a single-country title over an in-region feed default", () => {
    // A cross-syndicated Myanmar story arriving on the India insurgency feed
    // must resolve to Myanmar, not the feed's India default.
    const c = classifyNewsItem(
      CONFLICT_CONFIG,
      "Myanmar junta airstrike kills dozens in latest offensive",
      "",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Myanmar");
  });

  it("lets the single-country title beat an incidental summary mention", () => {
    // The summary names India (region-ordered before Philippines), but the
    // TITLE clearly names only the Philippines, so the Philippines must win.
    const c = classifyNewsItem(
      CONFLICT_CONFIG,
      "Philippines troops clash with Abu Sayyaf militants in Sulu",
      "Compared with an earlier India insurgency operation",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Philippines");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    // India is region-ordered before Myanmar in CONFLICT_ALIASES, so a
    // two-country title falls back to the region-first scan and picks India.
    const c = classifyNewsItem(
      CONFLICT_CONFIG,
      "India and Myanmar armies clash with insurgents along the border",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("India");
  });

  it("keeps the standing West Papua separation over an Indonesia default", () => {
    // West Papua is the FIRST alias; a Papua insurgency story must never be
    // mis-stamped Indonesia by the feed default.
    const c = classifyNewsItem(
      CONFLICT_CONFIG,
      "TPNPB gunmen ambush security forces near Timika",
      "",
      { defaultCountry: "Indonesia" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("West Papua");
  });
});

describe("INDONESIA_LOCAL title-first country attribution at ingest", () => {
  it("stamps a single-country title over an in-region feed default", () => {
    // A Malaysia story cross-syndicated onto the Indonesia default feed must
    // resolve to Malaysia, not blind-stamp Indonesia.
    const c = classifyNewsItem(
      INDONESIA_LOCAL_CONFIG,
      "Malaysia police break up protest in Kuala Lumpur",
      "",
      { defaultCountry: "Indonesia" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Malaysia");
  });

  it("diverts a Papua title to West Papua over the Indonesia default", () => {
    // West Papua is listed FIRST so any Papua story is diverted to its own tag
    // and NEVER mis-stamped Indonesia.
    const c = classifyNewsItem(
      INDONESIA_LOCAL_CONFIG,
      "Penembakan di Timika, Papua tewaskan seorang warga",
      "",
      { defaultCountry: "Indonesia" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("West Papua");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    // Malaysia is region-ordered before Indonesia, so a two-country title
    // falls back to the region-first scan and picks Malaysia.
    const c = classifyNewsItem(
      INDONESIA_LOCAL_CONFIG,
      "Malaysia and Indonesia both hit by flood as monsoon rains intensify",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Malaysia");
  });
});

describe("APAC_LOCAL title-first country attribution at ingest", () => {
  it("stamps a single-country title over a multi-country desk default", () => {
    // The RNZ Pacific / BenarNews desks default to Unknown; a title naming only
    // the Philippines must resolve to the Philippines.
    const c = classifyNewsItem(
      APAC_LOCAL_CONFIG,
      "Philippines protest erupts in Manila over fuel prices",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Philippines");
  });

  it("lets the single-country title beat an incidental summary mention", () => {
    // The summary names the Philippines (region-ordered before Thailand), but
    // the TITLE names only Thailand, so Thailand must win.
    const c = classifyNewsItem(
      APAC_LOCAL_CONFIG,
      "Thailand deep-south bombing wounds soldiers in Narathiwat",
      "Compared to an earlier Philippines Mindanao clash",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Thailand");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    // West Papua is the FIRST alias, so a Papua+Philippines title resolves to
    // West Papua under the region-first scan.
    const c = classifyNewsItem(
      APAC_LOCAL_CONFIG,
      "West Papua and Philippines both report deadly clash this week",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("West Papua");
  });
});
