import {
  applyIncidentCurations,
  applyTopThreeCuration,
} from "../../artifacts/workbench/src/lib/countrySectionOverrides";

// Analyst Top 3 Developments curation + exact severity overrides. Pins lead
// the section in pin order; section excludes drop an automatic pick only;
// severityOverrides set an exact tier in EITHER direction (explicit analyst
// judgement) and win over demote-only entries for the same id.

const item = (id: string, severity = "low") => ({ id, severity });

describe("applyTopThreeCuration", () => {
  const pool = [item("1"), item("2"), item("3"), item("4"), item("5")];
  const auto = [item("1"), item("2"), item("3")];

  it("returns the automatic picks untouched with no curation", () => {
    expect(applyTopThreeCuration(auto, pool, null)).toBe(auto);
    expect(applyTopThreeCuration(auto, pool, {})).toBe(auto);
  });

  it("pins lead the section in pin order and displace the last auto pick", () => {
    const out = applyTopThreeCuration(auto, pool, { top3PinnedIds: ["4"] });
    expect(out.map((i) => i.id)).toEqual(["4", "1", "2"]);
  });

  it("a section exclude drops the auto pick and backfills from remaining autos", () => {
    const out = applyTopThreeCuration(auto, pool, { top3ExcludedIds: ["2"] });
    expect(out.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("pinning more than three keeps every pinned item", () => {
    const out = applyTopThreeCuration(auto, pool, {
      top3PinnedIds: ["4", "5", "3", "2"],
    });
    expect(out.map((i) => i.id)).toEqual(["4", "5", "3", "2"]);
  });

  it("a pinned id no longer in the window pool is skipped, never fabricated", () => {
    const out = applyTopThreeCuration(auto, pool, { top3PinnedIds: ["999"] });
    expect(out.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("pinning an id already auto-picked deduplicates (moves it to the front)", () => {
    const out = applyTopThreeCuration(auto, pool, { top3PinnedIds: ["3"] });
    expect(out.map((i) => i.id)).toEqual(["3", "1", "2"]);
  });
});

describe("applyIncidentCurations severityOverrides", () => {
  it("sets an exact severity in either direction", () => {
    const out = applyIncidentCurations(
      [item("1", "low"), item("2", "high")],
      { severityOverrides: { "1": "high", "2": "low" } },
    );
    expect(out.map((i) => i.severity)).toEqual(["high", "low"]);
  });

  it("wins over a demote-only entry for the same id", () => {
    const out = applyIncidentCurations([item("1", "high")], {
      severityDemotions: { "1": "insignificant" },
      severityOverrides: { "1": "moderate" },
    });
    expect(out[0].severity).toBe("moderate");
  });

  it("ignores an unknown severity label rather than storing garbage", () => {
    const out = applyIncidentCurations([item("1", "high")], {
      severityOverrides: { "1": "catastrophic" },
    });
    expect(out[0].severity).toBe("high");
  });

  it("demote-only guard still applies when no override is present", () => {
    const out = applyIncidentCurations([item("1", "low")], {
      severityDemotions: { "1": "high" },
    });
    expect(out[0].severity).toBe("low");
  });
});

// --- Analyst prose overrides (theme paragraphs / recommended actions) -------
import {
  overrideThemeParagraphs,
  overrideActionGroups,
} from "../../artifacts/workbench/src/lib/countryIncidentThemes";

describe("overrideThemeParagraphs", () => {
  const groups = [
    { key: "crime", paragraph: "auto crime" },
    { key: "governance", paragraph: "auto gov" },
  ];
  it("replaces only edited keys; blank/absent keep auto", () => {
    const out = overrideThemeParagraphs(groups, { governance: "edited gov", crime: "  " });
    expect(out[0].paragraph).toBe("auto crime");
    expect(out[1].paragraph).toBe("edited gov");
  });
  it("no overrides -> unchanged reference", () => {
    expect(overrideThemeParagraphs(groups, undefined)).toBe(groups);
  });
});

describe("overrideActionGroups", () => {
  const groups = [{ key: "movement", actions: ["a", "b"] }];
  it("splits edited text into one bullet per non-empty line", () => {
    const out = overrideActionGroups(groups, { movement: "x\n\n  y  \n" });
    expect(out[0].actions).toEqual(["x", "y"]);
  });
  it("blank entry keeps auto bullets", () => {
    expect(overrideActionGroups(groups, { movement: "   " })[0].actions).toEqual(["a", "b"]);
  });
});
