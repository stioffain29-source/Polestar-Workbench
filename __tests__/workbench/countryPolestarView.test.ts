import { buildPolestarView } from "@/lib/countryPolestarView";

// The Polestar View must read as an assessed judgement (spec §15), not a
// summary: seven explicit components flattened into one count-free, British
// English paragraph. A quiet window yields a standing assessment, never an
// invented "all clear".

const COUNT_RE = /\b\d+\b/;

describe("buildPolestarView — populated window", () => {
  const parts = buildPolestarView({
    countryName: "Indonesia",
    empty: false,
    direction: "deteriorating",
    drivers: ["protest and civil unrest", "fire and explosion incidents"],
    exposedAreas: ["Jakarta", "West Java"],
    exposedActivities: ["staff movement", "business continuity"],
    likelyDisruption: "further protest activity and associated movement disruption",
    trigger: "larger-scale incidents emerge around wage decisions",
    action: "tighten movement planning at the exposed locations",
  });

  it("emits all seven structured components, each non-empty", () => {
    expect(parts.direction.trim().length).toBeGreaterThan(0);
    expect(parts.driver.trim().length).toBeGreaterThan(0);
    expect(parts.exposedGeography.trim().length).toBeGreaterThan(0);
    expect(parts.exposedActivity.trim().length).toBeGreaterThan(0);
    expect(parts.likelyDisruption.trim().length).toBeGreaterThan(0);
    expect(parts.whatWouldChange.trim().length).toBeGreaterThan(0);
    expect(parts.practicalJudgement.trim().length).toBeGreaterThan(0);
  });

  it("paragraph carries the direction, driver, geography, activity, disruption, trigger and action", () => {
    const p = parts.paragraph;
    expect(p).toContain("Indonesia");
    expect(p).toContain("deteriorating");
    expect(p).toContain("driven by");
    expect(p).toContain("main business exposure");
    expect(p).toContain("most exposed areas");
    expect(p).toContain("next seven days");
    expect(p).toContain("would worsen if");
    expect(p).toContain("operators should");
  });

  it("is count-free", () => {
    expect(COUNT_RE.test(parts.paragraph)).toBe(false);
    for (const v of Object.values(parts)) expect(COUNT_RE.test(v)).toBe(false);
  });

  it("falls back gracefully when areas/activities are empty (no dangling text)", () => {
    const bare = buildPolestarView({
      countryName: "Testland",
      empty: false,
      direction: "stable",
      drivers: [],
      exposedAreas: [],
      exposedActivities: [],
      likelyDisruption: "",
      trigger: "conditions deteriorate",
      action: "",
    });
    expect(bare.paragraph).toContain("no single dominant centre");
    expect(bare.paragraph).not.toContain("driven by .");
    expect(bare.paragraph.endsWith(".")).toBe(true);
  });
});

describe("buildPolestarView — quiet window (no fabrication)", () => {
  const parts = buildPolestarView({
    countryName: "Papua New Guinea",
    empty: true,
    direction: "stable",
    drivers: [],
    exposedAreas: [],
    exposedActivities: [],
    likelyDisruption: "",
    trigger: "",
    action: "",
  });

  it("holds a standing assessment rather than declaring calm", () => {
    expect(parts.paragraph).toContain("no fresh reporting");
    expect(parts.paragraph).toContain("standing assessment");
    expect(parts.paragraph.toLowerCase()).not.toContain("no risk");
  });

  it("still emits all seven components and stays count-free", () => {
    expect(parts.direction.trim().length).toBeGreaterThan(0);
    expect(parts.practicalJudgement.trim().length).toBeGreaterThan(0);
    expect(COUNT_RE.test(parts.paragraph)).toBe(false);
  });
});
