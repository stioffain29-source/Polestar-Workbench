import {
  hasUpcomingSignal,
  buildUpcomingSignalRows,
  formatAnnouncedDate,
  upcomingSignalLine,
  type UpcomingSignalSource,
} from "../../artifacts/workbench/src/lib/upcomingSignals";
import {
  buildStructuredReportDataset,
  INDONESIA_REPORT_CONFIG,
  PNG_REPORT_CONFIG,
  type PngSourceIncident,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

describe("upcomingSignals — advance-warning detection authority", () => {
  it("detects a genuine announced march", () => {
    expect(
      hasUpcomingSignal({
        title: "KAMMI calls for a march on Friday in Jakarta",
      }),
    ).toBe(true);
  });

  it("detects other self-sufficient future protest cues", () => {
    expect(hasUpcomingSignal({ title: "Union calls for a strike over unpaid wages" })).toBe(true);
    expect(hasUpcomingSignal({ title: "Students to protest outside parliament next week" })).toBe(
      true,
    );
    expect(hasUpcomingSignal({ title: "Opposition to hold a rally against fuel prices" })).toBe(
      true,
    );
  });

  it("rejects sports / diplomacy homonyms with no protest object + future cue", () => {
    // "team-mates rally" — sports homonym, no future cue.
    expect(hasUpcomingSignal({ title: "Pakistan team-mates rally in the second innings" })).toBe(
      false,
    );
    // "faces ex-world champ" — sports, no future cue.
    expect(hasUpcomingSignal({ title: "Local boxer faces ex-world champ this weekend" })).toBe(
      false,
    );
    // Bare temporal cue with a non-protest object ("talks").
    expect(hasUpcomingSignal({ title: "Malaysia to begin talks with Kongsberg" })).toBe(false);
    // Sports "set for final" — temporal cue, no protest object.
    expect(hasUpcomingSignal({ title: "Champions set for the final on Sunday" })).toBe(false);
  });

  it("rejects kinetic-strike and market-rally homonyms ('X on ' false positives)", () => {
    // Kinetic military strike, not a labour strike notice.
    expect(hasUpcomingSignal({ title: "Drone strike on convoy kills three" })).toBe(false);
    // Financial-markets rally, not a protest rally.
    expect(hasUpcomingSignal({ title: "Shares rally on rate-cut hopes" })).toBe(false);
  });

  it("still detects a genuinely scheduled march via the temporal+object path", () => {
    expect(
      hasUpcomingSignal({ title: "Farmers to march on parliament on Friday" }),
    ).toBe(true);
  });

  it("rejects already-completed protest reporting (past, not forewarning)", () => {
    expect(
      hasUpcomingSignal({ title: "Thousands joined a rally yesterday that has ended" }),
    ).toBe(false);
    expect(hasUpcomingSignal({ title: "Protest march took place over the weekend" })).toBe(false);
  });

  it("rejects natural-hazard bulletins ('volcanic unrest' / 'will strike' are not protests)", () => {
    // Real prod leak: "volcanic unrest" hits the protest-object token and the
    // announcement day-of-week ("on Monday") supplies the temporal cue.
    expect(
      hasUpcomingSignal({
        title: "Taal Volcano logs 61 quakes, 60 tremors in 24 hours",
        summary:
          "Phivolcs reported on Monday an increase in seismic activity, indicating low-level volcanic unrest; steam-driven phreatic eruptions may occur.",
      }),
    ).toBe(false);
    // Second leak vector: hazard "will strike" matches FUTURE_STRONG_RE.
    expect(
      hasUpcomingSignal({ title: "Typhoon will strike the coast this weekend" }),
    ).toBe(false);
    expect(
      hasUpcomingSignal({ title: "Magnitude 6.1 earthquake to strike offshore, agency warns" }),
    ).toBe(false);
  });

  it("still keeps a genuine hazard-triggered protest (hazard + real protest action)", () => {
    // Fixture genuinely fires BOTH regexes: "flooding" (hazard) + "march"
    // (protest action), so the co-occurrence keep-path is actually exercised.
    expect(
      hasUpcomingSignal({
        title: "Residents to march over flooding response failures next week",
      }),
    ).toBe(true);
  });
});

describe("buildUpcomingSignalRows — windowing, dedup, formatting", () => {
  const now = new Date("2026-07-08T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  it("keeps in-window announcements and drops stale ones beyond the window", () => {
    const rows: UpcomingSignalSource[] = [
      { title: "Union announces strike next week", country: "Indonesia", occurredAt: daysAgo(2) },
      { title: "Students plan a march", country: "Indonesia", occurredAt: daysAgo(30) },
    ];
    const out = buildUpcomingSignalRows(rows, { now });
    expect(out).toHaveLength(1);
    expect(out[0].country).toBe("Indonesia");
    expect(out[0].announcedAt).toBe(rows[0].occurredAt);
  });

  it("collapses duplicate (country, signal) pairs", () => {
    const rows: UpcomingSignalSource[] = [
      { title: "Union calls for a strike over unpaid wages", country: "Indonesia", occurredAt: daysAgo(1) },
      { title: "Union calls for a strike over unpaid wages", country: "Indonesia", occurredAt: daysAgo(3) },
    ];
    expect(buildUpcomingSignalRows(rows, { now })).toHaveLength(1);
  });

  it("returns [] when nothing qualifies", () => {
    const rows: UpcomingSignalSource[] = [
      { title: "Quiet week reported across the region", country: "Indonesia", occurredAt: daysAgo(1) },
    ];
    expect(buildUpcomingSignalRows(rows, { now })).toEqual([]);
  });
});

describe("upcomingSignals — shared announcement-date + line formatters", () => {
  it("formats an announcement date in UTC as DD Mon YYYY", () => {
    expect(formatAnnouncedDate("2026-07-03T14:00:00Z")).toBe("03 Jul 2026");
  });

  it("returns an em dash for an unparseable date", () => {
    expect(formatAnnouncedDate("not-a-date")).toBe("—");
  });

  it("renders one brief bullet line: signal, meaning, announcement date", () => {
    const line = upcomingSignalLine({
      country: "Indonesia",
      signal: "Sectoral strike notice",
      meaning: "Supply-chain friction and sectoral closures 24-72h ahead.",
      announcedAt: "2026-07-03T14:00:00Z",
      title: "Union announces strike",
    });
    expect(line).toBe(
      "Sectoral strike notice: Supply-chain friction and sectoral closures 24-72h ahead. (reported 03 Jul 2026).",
    );
  });
});

describe("structured brief — upcomingSignals gated to Indonesia", () => {
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const march: PngSourceIncident = {
    title: "KAMMI calls for a march on Friday in Jakarta",
    severity: "moderate",
    occurredAt: recent,
    country: "Indonesia",
  };
  const args = {
    windowIncidents: [],
    thirtyDay: [march],
    ninetyDay: [march],
    baselineWatchlist: [],
    periodLabel: "test window",
  };

  it("populates the Indonesia brief from period reporting", () => {
    const d = buildStructuredReportDataset(args, INDONESIA_REPORT_CONFIG);
    expect(d.upcomingSignals.length).toBeGreaterThan(0);
    expect(d.upcomingSignals[0].country).toBe("Indonesia");
  });

  it("leaves every other theatre byte-identical (empty upcomingSignals)", () => {
    const d = buildStructuredReportDataset(args, PNG_REPORT_CONFIG);
    expect(d.upcomingSignals).toEqual([]);
  });
});
