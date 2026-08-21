import {
  cleanDisplayTitle,
  dedupeByTitle,
  normalizeWestPapuaRegionInTitle,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";

describe("cleanDisplayTitle", () => {
  it("strips a leading 'Watch:' video call-to-action and the publisher masthead", () => {
    expect(
      cleanDisplayTitle("Watch: Pride protest held in Manila despite downpour - The Manila Times"),
    ).toBe("Pride protest held in Manila despite downpour");
  });

  it("strips a trailing 'VIDEO BY <credit>' attribution and the publisher masthead", () => {
    expect(
      cleanDisplayTitle("Pride protest held in Manila despite downpour VIDEO BY ALLEN LIMOS - LinkedIn"),
    ).toBe("Pride protest held in Manila despite downpour");
  });

  it("strips trailing '(VIDEO)' / ' - WATCH' tags", () => {
    expect(cleanDisplayTitle("Rally turns tense in Quezon City (VIDEO)")).toBe(
      "Rally turns tense in Quezon City",
    );
    expect(cleanDisplayTitle("Workers march downtown - WATCH")).toBe("Workers march downtown");
  });

  it("does NOT touch a real headline that merely contains the word watch/video", () => {
    expect(cleanDisplayTitle("Watch out for protests this weekend")).toBe(
      "Watch out for protests this weekend",
    );
    expect(cleanDisplayTitle("Protest video goes viral after clashes")).toBe(
      "Protest video goes viral after clashes",
    );
  });

  it("does NOT strip a bare trailing 'watch'/'video' with no separator (no false positives)", () => {
    expect(cleanDisplayTitle("Residents keep a tense overnight watch")).toBe(
      "Residents keep a tense overnight watch",
    );
    expect(cleanDisplayTitle("Crowd captures the clash on video")).toBe(
      "Crowd captures the clash on video",
    );
  });

  it("does NOT strip a natural lowercase 'video by ...' prose clause", () => {
    expect(cleanDisplayTitle("Protest video by citizen journalist goes viral")).toBe(
      "Protest video by citizen journalist goes viral",
    );
    expect(cleanDisplayTitle("Video by far the biggest protest this year")).toBe(
      "Video by far the biggest protest this year",
    );
  });

  it("DOES strip a title-case 'Video by <Name>' trailing credit", () => {
    expect(cleanDisplayTitle("Pride rally floods Manila streets Video by Allen Limos")).toBe(
      "Pride rally floods Manila streets",
    );
  });
});

describe("normalizeWestPapuaRegionInTitle", () => {
  it("appends Indonesia to standalone West Papua place references", () => {
    expect(
      normalizeWestPapuaRegionInTitle(
        "Large demos across West Papua meet with mixed responses by police",
        "Indonesia",
      ),
    ).toBe("Large demos across West Papua, Indonesia meet with mixed responses by police");
  });

  it("prefixes West Papuan with Indonesian when Indonesia is not already in the title", () => {
    expect(
      normalizeWestPapuaRegionInTitle(
        "West Papuan protesters face police crackdown over independence calls",
        "Indonesia",
      ),
    ).toBe("Indonesian West Papuan protesters face police crackdown over independence calls");
  });

  it("leaves Indonesia-framed headlines unchanged", () => {
    expect(
      normalizeWestPapuaRegionInTitle(
        "Indonesia's West Papuan protesters face police crackdown over independence calls",
        "Indonesia",
      ),
    ).toBe("Indonesia's West Papuan protesters face police crackdown over independence calls");
  });
});

describe("dedupeByTitle — video/watch syndication", () => {
  it("collapses a 'Watch:' copy and a 'VIDEO BY' copy of the same event into one row", () => {
    const rows = [
      {
        title:
          "Pride protest held in Manila despite downpour Despite the heavy rain, LGBTQ+ protesters hold their Pride protest at Liwasang Bonifacio in Manila on June 26, 2026 VIDEO BY ALLEN LIMOS - LinkedIn",
        date: new Date("2026-06-27T00:00:00Z"),
        severity: "low",
      },
      {
        title: "Watch: Pride protest held in Manila despite downpour - The Manila Times",
        date: new Date("2026-06-26T00:00:00Z"),
        severity: "low",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(1);
  });

  it("keeps two genuinely different protests apart", () => {
    const rows = [
      {
        title: "Pride protest held in Manila despite downpour",
        date: new Date("2026-06-26T00:00:00Z"),
        severity: "low",
      },
      {
        title: "Farmers blockade highway in Quezon City over fuel prices",
        date: new Date("2026-06-26T00:00:00Z"),
        severity: "moderate",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(2);
  });
});

describe("dedupeByTitle — same-event syndication collapse", () => {
  it("collapses varying casualty-count / place-framing copies of one prison riot into a single row", () => {
    const rows = [
      {
        title: "19 killed in Sri Lanka prison riot",
        date: new Date("2026-07-06T02:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "Sri Lanka prison riot kills 23, wounds more than 100",
        date: new Date("2026-07-06T09:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "Death toll in Negombo prison riot rises to 25",
        date: new Date("2026-07-06T18:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "26 dead after deadly Negombo prison riot in Sri Lanka",
        date: new Date("2026-07-07T01:00:00Z"),
        severity: "extreme",
        country: "Sri Lanka",
      },
      {
        title: "Clash at Negombo prison leaves scores dead across Sri Lanka jails",
        date: new Date("2026-07-07T05:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "Inmates to be transferred following Negombo prison riot",
        date: new Date("2026-07-07T08:00:00Z"),
        severity: "moderate",
        country: "Sri Lanka",
      },
      {
        title: "Sri Lanka prison riot: death toll climbs as violence spreads",
        date: new Date("2026-07-07T12:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "Negombo prison riot: 25 killed, hundreds wounded",
        date: new Date("2026-07-07T20:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
    ];
    const out = dedupeByTitle(rows);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("extreme");
  });

  it("collapses editorial-angle copies of one riot that differ only in framing/procedural vocabulary", () => {
    const rows = [
      {
        title: "Negombo prison riots: Lessons not learnt from Mahara jail violence",
        date: new Date("2026-07-11T19:02:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "Sri Lanka moves to address prison overcrowding after riot kills 28 - Reuters",
        date: new Date("2026-07-10T00:00:00Z"),
        severity: "extreme",
        country: "Sri Lanka",
      },
      {
        title: "Anatomy of the Negombo prison riot: Government should fix the prison system without delay",
        date: new Date("2026-07-09T00:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
    ];
    const out = dedupeByTitle(rows);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("extreme");
  });

  it("keeps two same-type events in different cities apart (exclusive subjects)", () => {
    const rows = [
      {
        title: "Prison riot erupts in Manila amid overcrowding",
        date: new Date("2026-07-06T02:00:00Z"),
        severity: "high",
        country: "Philippines",
      },
      {
        title: "Prison riot erupts in Cebu amid overcrowding",
        date: new Date("2026-07-06T03:00:00Z"),
        severity: "high",
        country: "Philippines",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(2);
  });

  it("keeps two different same-country events apart when only the country name is shared", () => {
    const rows = [
      {
        title: "Sri Lanka prison riot kills 23",
        date: new Date("2026-07-06T02:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
      {
        title: "Riots erupt in Sri Lanka over fuel shortages",
        date: new Date("2026-07-06T05:00:00Z"),
        severity: "moderate",
        country: "Sri Lanka",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(2);
  });

  it("does not merge across different countries even when wording matches", () => {
    const rows = [
      {
        title: "PTI supporters clash with police in Lahore rally",
        date: new Date("2026-07-06T02:00:00Z"),
        severity: "moderate",
        country: "Pakistan",
      },
      {
        title: "Opposition supporters clash with police in Dhaka rally",
        date: new Date("2026-07-06T03:00:00Z"),
        severity: "moderate",
        country: "Bangladesh",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(2);
  });

  it("collapses Jakarta detention and release follow-ups of the same protest into one row", () => {
    const rows = [
      {
        title: "Jakarta police detain 21 protesters after labour rally",
        date: new Date("2026-08-10T08:00:00Z"),
        severity: "moderate",
        country: "Indonesia",
      },
      {
        title: "Jakarta releases 21 detained protesters after labour rally",
        date: new Date("2026-08-11T08:00:00Z"),
        severity: "low",
        country: "Indonesia",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(1);
    expect(dedupeByTitle(rows)[0].severity).toBe("moderate");
  });

  it("collapses Chabad House protest syndication with different dates and severities", () => {
    const rows = [
      {
        title: "Protest outside Chabad House in Colombo over visa rules",
        date: new Date("2026-08-08T08:00:00Z"),
        severity: "low",
        country: "Sri Lanka",
      },
      {
        title: "Sri Lanka Jews rally at Chabad centre over visa restrictions",
        date: new Date("2026-08-09T12:00:00Z"),
        severity: "moderate",
        country: "Sri Lanka",
      },
      {
        title: "Demonstrators gather at Colombo Chabad House over immigration policy",
        date: new Date("2026-08-10T18:00:00Z"),
        severity: "high",
        country: "Sri Lanka",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(1);
    expect(dedupeByTitle(rows)[0].severity).toBe("high");
  });
});
