import type { PngReportItem, PngCategory } from "@/lib/pngReportDataset";
import {
  jakartaThemeForCategory,
  buildJakartaIncidentThemes,
  buildJakartaOperationalImpact,
  buildJakartaRecommendedActions,
  buildJakartaBluf,
  buildJakartaCurrentSituation,
  buildJakartaOutlook,
  buildJakartaPolestarView,
  applyJakartaTopThree,
  buildJakartaBrief,
  JAKARTA_THEME_ORDER,
} from "@/lib/jakartaBrief";

const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

function item(
  partial: Partial<PngReportItem> & { category: PngCategory },
): PngReportItem {
  const severity = partial.severity ?? "moderate";
  return {
    id: Math.random().toString(36).slice(2),
    title: "Sample Jakarta incident headline",
    summary: "",
    province: null,
    category: partial.category,
    displayCategory: partial.category,
    businessImpact: "",
    severity,
    severityLabel: severity.charAt(0).toUpperCase() + severity.slice(1),
    severityRank: SEV_RANK[severity] ?? 3,
    reportedDate: new Date("2026-06-20T00:00:00Z"),
    incidentDate: null,
    occurredEarlier: false,
    source: "",
    url: null,
    confidence: "moderate",
    ...partial,
  };
}

// Every string the builders emit, gathered for the count-free / banned-phrase
// house-rule assertions.
function allProse(): string[] {
  const window = [
    item({ category: "Civil unrest / protest", province: "Central Jakarta" }),
    item({ category: "Natural hazard", province: "North Jakarta" }),
    item({ category: "Theft / break-in", province: "West Jakarta", severity: "low" }),
    item({ category: "Road / highway", province: "East Jakarta" }),
    item({ category: "Aviation / airport", province: "Soekarno-Hatta Airport Corridor" }),
    item({ category: "Policing operation", province: "South Jakarta" }),
  ];
  const brief = buildJakartaBrief({
    windowItems: window,
    incidentDetailsItems: window,
    topThree: window.slice(0, 3),
  });
  const empty = buildJakartaBrief({ windowItems: [], incidentDetailsItems: [], topThree: [] });
  return [
    brief.bluf,
    brief.executiveSummary,
    brief.outlook,
    brief.polestarView,
    ...Object.values(brief.polestarViewParts),
    ...brief.recommendedActions,
    ...brief.operationalImpact,
    ...brief.incidentThemes.map((t) => t.heading),
    ...brief.incidentThemes.map((t) => t.paragraph),
    ...brief.topThree.map((t) => t.developmentTitle ?? ""),
    ...brief.topThree.map((t) => t.businessImpact ?? ""),
    empty.bluf,
    empty.executiveSummary,
    empty.outlook,
  ];
}

describe("jakartaThemeForCategory", () => {
  it("maps representative categories to Jakarta themes", () => {
    expect(jakartaThemeForCategory("Civil unrest / protest")).toBe("protest");
    expect(jakartaThemeForCategory("Labour action")).toBe("protest");
    expect(jakartaThemeForCategory("Natural hazard")).toBe("flooding");
    expect(jakartaThemeForCategory("Environmental / haze")).toBe("flooding");
    expect(jakartaThemeForCategory("Theft / break-in")).toBe("crime");
    expect(jakartaThemeForCategory("Fire")).toBe("crime");
    expect(jakartaThemeForCategory("Road / highway")).toBe("traffic");
    expect(jakartaThemeForCategory("Aviation / airport")).toBe("airport");
    expect(jakartaThemeForCategory("Policing operation")).toBe("governance");
    expect(jakartaThemeForCategory("Government stability")).toBe("governance");
  });
});

describe("buildJakartaIncidentThemes", () => {
  it("returns an empty list for an empty window (no fabrication)", () => {
    expect(buildJakartaIncidentThemes([])).toEqual([]);
  });

  it("emits only present themes, in fixed Jakarta order", () => {
    const groups = buildJakartaIncidentThemes([
      item({ category: "Policing operation" }),
      item({ category: "Civil unrest / protest" }),
      item({ category: "Natural hazard" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["protest", "flooding", "governance"]);
    // Order matches the declared JAKARTA_THEME_ORDER.
    const order = JAKARTA_THEME_ORDER.filter((t) => groups.some((g) => g.key === t));
    expect(groups.map((g) => g.key)).toEqual(order);
  });

  it("includes the resolved area in the paragraph and stays count-free", () => {
    const groups = buildJakartaIncidentThemes([
      item({ category: "Civil unrest / protest", province: "Central Jakarta" }),
    ]);
    const protest = groups.find((g) => g.key === "protest")!;
    expect(protest.paragraph).toContain("Central Jakarta");
    for (const g of groups) expect(g.paragraph).not.toMatch(/\d/);
  });

  it("never describes a Low-only theme as a severity escalation", () => {
    const groups = buildJakartaIncidentThemes([
      item({ category: "Theft / break-in", severity: "low" }),
    ]);
    const crime = groups.find((g) => g.key === "crime")!;
    expect(crime.paragraph.toLowerCase()).not.toMatch(/escalat|high severity|extreme severity/);
  });

  it("surfaces high/extreme severity in the tail when present", () => {
    const groups = buildJakartaIncidentThemes([
      item({ category: "Homicide / violent crime", severity: "extreme" }),
    ]);
    const crime = groups.find((g) => g.key === "crime")!;
    expect(crime.paragraph.toLowerCase()).toContain("extreme severity");
  });
});

describe("buildJakartaOperationalImpact", () => {
  it("returns an empty list for an empty window", () => {
    expect(buildJakartaOperationalImpact([])).toEqual([]);
  });

  it("emits a present-gated, count-free bullet set with a route-confirmation close", () => {
    const bullets = buildJakartaOperationalImpact([
      item({ category: "Civil unrest / protest" }),
      item({ category: "Natural hazard" }),
    ]);
    expect(bullets.some((b) => /protest/i.test(b))).toBe(true);
    expect(bullets.some((b) => /flood/i.test(b))).toBe(true);
    // Absent themes do not appear.
    expect(bullets.some((b) => /airport corridor/i.test(b))).toBe(false);
    // Always closes on route confirmation.
    expect(bullets[bullets.length - 1]).toMatch(/confirm routes/i);
    for (const b of bullets) expect(b).not.toMatch(/\d/);
  });
});

describe("buildJakartaRecommendedActions", () => {
  it("emits practical, location-based, count-free actions", () => {
    const actions = buildJakartaRecommendedActions();
    expect(actions.length).toBeGreaterThanOrEqual(5);
    expect(actions.some((a) => /Central Jakarta/.test(a))).toBe(true);
    expect(actions.some((a) => /airport transfers/i.test(a))).toBe(true);
    for (const a of actions) expect(a).not.toMatch(/\d/);
  });
});

describe("BLUF / Current Situation / Outlook", () => {
  it("BLUF gives a standing assessment for an empty window and names themes otherwise", () => {
    expect(buildJakartaBluf([])).toMatch(/manageable but disruption-prone/i);
    const live = buildJakartaBluf([item({ category: "Civil unrest / protest", province: "Central Jakarta" })]);
    expect(live).toMatch(/protest activity/i);
    expect(live).toContain("Central Jakarta");
  });

  it("Current Situation holds the standing pattern when empty", () => {
    expect(buildJakartaCurrentSituation([])).toMatch(/standing pattern/i);
  });

  it("Outlook is a next-seven-days most-likely scenario", () => {
    const outlook = buildJakartaOutlook();
    expect(outlook).toMatch(/next seven days/i);
    expect(outlook).toMatch(/localised disruption/i);
    expect(outlook).not.toMatch(/\d/);
  });
});

describe("Polestar View", () => {
  it("is a structured, count-free standing judgement", () => {
    const parts = buildJakartaPolestarView();
    expect(parts.paragraph).toMatch(/route checks/i);
    for (const v of Object.values(parts)) expect(v).not.toMatch(/\d/);
  });
});

describe("applyJakartaTopThree", () => {
  it("rewrites titles as analyst developments with an operational relevance line, without mutating inputs", () => {
    const input = [
      item({ category: "Civil unrest / protest", province: "Central Jakarta", title: "raw headline one" }),
    ];
    const out = applyJakartaTopThree(input);
    expect(out[0].developmentTitle).toBe("Protest activity in Central Jakarta");
    expect(out[0].businessImpact).toMatch(/confirm routes/i);
    // Inputs are not mutated.
    expect(input[0].developmentTitle).toBeUndefined();
    expect(input[0].businessImpact).toBe("");
  });

  it("falls back to a Jakarta-wide lead when the area is unknown", () => {
    const out = applyJakartaTopThree([item({ category: "Theft / break-in", province: null })]);
    expect(out[0].developmentTitle).toBe("Crime and public-safety incident reported in Jakarta");
  });

  it("disambiguates two same-theme same-area developments", () => {
    const out = applyJakartaTopThree([
      item({ category: "Civil unrest / protest", province: "Central Jakarta", title: "first protest near palace" }),
      item({ category: "Civil unrest / protest", province: "Central Jakarta", title: "second protest near parliament" }),
    ]);
    expect(out[0].developmentTitle).not.toBe(out[1].developmentTitle);
  });
});

describe("house rules across the whole brief", () => {
  it("never emits digits in any generated prose", () => {
    for (const s of allProse()) expect(s).not.toMatch(/\d/);
  });

  it("avoids the spec's banned generic phrasing", () => {
    const banned = [
      "remain important",
      "Monitor localised flooding",
      "Maintain awareness",
      "maintain standard movement precautions",
    ];
    const joined = allProse().join("\n").toLowerCase();
    for (const phrase of banned) expect(joined).not.toContain(phrase.toLowerCase());
  });
});

describe("buildJakartaBrief aggregator", () => {
  it("returns every override field and rewrites the Top 3", () => {
    const window = [
      item({ category: "Civil unrest / protest", province: "Central Jakarta" }),
      item({ category: "Natural hazard", province: "North Jakarta" }),
    ];
    const brief = buildJakartaBrief({
      windowItems: window,
      incidentDetailsItems: window,
      topThree: window,
    });
    expect(brief.bluf.length).toBeGreaterThan(0);
    expect(brief.executiveSummary.length).toBeGreaterThan(0);
    expect(brief.outlook.length).toBeGreaterThan(0);
    expect(brief.polestarView.length).toBeGreaterThan(0);
    expect(brief.recommendedActions.length).toBeGreaterThan(0);
    expect(brief.operationalImpact.length).toBeGreaterThan(0);
    expect(brief.incidentThemes.length).toBeGreaterThan(0);
    expect(brief.topThree.every((t) => !!t.developmentTitle)).toBe(true);
  });
});
