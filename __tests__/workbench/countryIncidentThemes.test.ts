import type { PngReportItem, PngCategory } from "@/lib/pngReportDataset";
import {
  COUNTRY_INCIDENT_THEMES,
  themeForCategory,
  buildCountryIncidentThemes,
  buildOperationalImpactBullets,
} from "@/lib/countryIncidentThemes";

function item(partial: Partial<PngReportItem> & { category: PngCategory }): PngReportItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Sample incident",
    summary: "",
    province: null,
    displayCategory: partial.category,
    businessImpact: "",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank: 3,
    reportedDate: new Date("2026-06-20T00:00:00Z"),
    incidentDate: null,
    occurredEarlier: false,
    source: "",
    url: null,
    confidence: "moderate",
    ...partial,
  };
}

const ALL_CATEGORIES: PngCategory[] = [
  "Terrorism / militancy",
  "Armed robbery / hold-up",
  "Tribal / communal violence",
  "Homicide / violent crime",
  "Theft / break-in",
  "Civil unrest / protest",
  "Labour action",
  "Policing operation",
  "Community policing",
  "Intelligence / training",
  "Corrections / detention",
  "Aviation / airport",
  "Maritime / port",
  "Road / highway",
  "Natural hazard",
  "Fire",
  "Environmental / haze",
  "Power / utilities",
  "Telecoms / connectivity",
  "Government stability",
  "Other security",
];

describe("themeForCategory", () => {
  it("maps every category to one of the six themes", () => {
    const themes = new Set(COUNTRY_INCIDENT_THEMES.map((t) => t.key));
    for (const c of ALL_CATEGORIES) {
      expect(themes.has(themeForCategory(c))).toBe(true);
    }
  });

  it("classifies representative categories correctly", () => {
    expect(themeForCategory("Civil unrest / protest")).toBe("protest");
    expect(themeForCategory("Labour action")).toBe("protest");
    expect(themeForCategory("Armed robbery / hold-up")).toBe("crime");
    expect(themeForCategory("Terrorism / militancy")).toBe("crime");
    expect(themeForCategory("Natural hazard")).toBe("natural");
    expect(themeForCategory("Environmental / haze")).toBe("natural");
    expect(themeForCategory("Government stability")).toBe("governance");
    expect(themeForCategory("Policing operation")).toBe("governance");
    expect(themeForCategory("Fire")).toBe("fire");
    expect(themeForCategory("Road / highway")).toBe("other");
    expect(themeForCategory("Telecoms / connectivity")).toBe("other");
  });
});

describe("buildCountryIncidentThemes", () => {
  it("returns an empty list for an empty window", () => {
    expect(buildCountryIncidentThemes([])).toEqual([]);
  });

  it("emits only the themes that actually occurred, in fixed order", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Fire", province: "Lae" }),
      item({ category: "Civil unrest / protest", province: "Jakarta" }),
    ]);
    // Present themes only, in COUNTRY_INCIDENT_THEMES order (protest before fire);
    // absent themes (crime, natural, governance, other) are omitted entirely.
    expect(groups.map((g) => g.key)).toEqual(["protest", "fire"]);
  });

  it("emits four analytical parts and never emits counts", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Civil unrest / protest", province: "Jakarta" }),
    ]);
    const protest = groups.find((g) => g.key === "protest")!;
    expect(protest.where).toContain("Jakarta");
    expect(protest.whatHappened.length).toBeGreaterThan(0);
    expect(protest.whyItMatters.length).toBeGreaterThan(0);
    expect(protest.whatCouldBeAffected.length).toBeGreaterThan(0);
    // No digits in any generated field (count-free house rule).
    for (const g of groups) {
      for (const part of [g.whatHappened, g.where, g.whyItMatters, g.whatCouldBeAffected]) {
        expect(part).not.toMatch(/\d/);
      }
    }
  });

  it("surfaces the worst severity present without a count", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Homicide / violent crime", severity: "extreme", province: "Lae" }),
      item({ category: "Theft / break-in", severity: "low", province: "Lae" }),
    ]);
    const crime = groups.find((g) => g.key === "crime")!;
    expect(crime.whyItMatters).toContain("Extreme-severity");
    expect(crime.where).toContain("Lae");
  });

  it("ranks provinces by frequency", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Civil unrest / protest", province: "Port Moresby" }),
      item({ category: "Civil unrest / protest", province: "Port Moresby" }),
      item({ category: "Civil unrest / protest", province: "Lae" }),
    ]);
    const protest = groups.find((g) => g.key === "protest")!;
    expect(protest.where).toContain("Port Moresby and Lae");
  });

  it("drops a single low-severity theme as not meaningful, keeps it once it recurs", () => {
    // One Low theft item alone carries no analytical weight → omitted from the
    // narrative (it still counts in totals/charts/map elsewhere).
    expect(
      buildCountryIncidentThemes([
        item({ category: "Theft / break-in", severity: "low" }),
      ]),
    ).toEqual([]);
    // Two of them clear the count gate.
    const two = buildCountryIncidentThemes([
      item({ category: "Theft / break-in", severity: "low" }),
      item({ category: "Theft / break-in", severity: "low" }),
    ]);
    expect(two.map((g) => g.key)).toEqual(["crime"]);
    // A single Moderate item clears the severity gate on its own.
    const one = buildCountryIncidentThemes([
      item({ category: "Theft / break-in", severity: "moderate" }),
    ]);
    expect(one.map((g) => g.key)).toEqual(["crime"]);
  });

  it("emits one short count-free paragraph per theme", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Civil unrest / protest", province: "Jakarta" }),
    ]);
    const protest = groups.find((g) => g.key === "protest")!;
    expect(protest.paragraph.length).toBeGreaterThan(0);
    expect(protest.paragraph).toContain("Jakarta");
    for (const g of groups) expect(g.paragraph).not.toMatch(/\d/);
  });

  // Defect B(a): a category list must read as clean nouns, never the old
  // "homicide and violent crime, theft and break-in and terrorism and militancy"
  // run created by expanding every "A / B" slash to "A and B".
  it("renders category labels as clean single nouns without 'and … and' runs", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Homicide / violent crime", province: "Papua" }),
      item({ category: "Theft / break-in", province: "Papua" }),
      item({ category: "Terrorism / militancy", province: "Papua" }),
    ]);
    const crime = groups.find((g) => g.key === "crime")!;
    expect(crime.paragraph).toContain("violent crime");
    // The slash-expanded forms must be gone.
    expect(crime.paragraph).not.toContain("homicide and violent crime");
    expect(crime.paragraph).not.toContain("theft and break-in");
    // At most one "and" in the category list itself (the final list conjunction).
    const catClause = crime.paragraph.match(/including ([^.]+)\./)?.[1] ?? "";
    expect((catClause.match(/\band\b/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  // Defect B(b): the paragraph must name the single most serious REAL incident
  // (highest severity, then most recent) with its assessed severity — turning a
  // generic template into a specific account. No fabrication (real title/fields).
  it("names the most serious real incident and its assessed severity", () => {
    const groups = buildCountryIncidentThemes([
      item({
        category: "Homicide / violent crime",
        title: "Pastor shot dead during military operation in Intan Jaya",
        province: "Papua",
        severity: "high",
        severityLabel: "High",
        severityRank: 4,
        reportedDate: new Date("2026-06-28T00:00:00Z"),
      }),
      item({
        category: "Theft / break-in",
        title: "Break-in at store",
        province: "Papua",
        severity: "low",
        severityLabel: "Low",
        severityRank: 1,
        reportedDate: new Date("2026-06-25T00:00:00Z"),
      }),
    ]);
    const crime = groups.find((g) => g.key === "crime")!;
    expect(crime.paragraph).toContain(
      "The most serious reported was Pastor shot dead during military operation in Intan Jaya",
    );
    expect(crime.paragraph).toContain("assessed as High severity");
  });

  // The lead sentence is NOT added to the source-safe fire paragraph (fire prose
  // must never carry a severity assessment that could imply a cause).
  it("does not add a lead sentence to the fire paragraph", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Fire", title: "Fire guts market", province: "Lae" }),
      item({ category: "Fire", title: "Blaze at depot", province: "Lae" }),
    ]);
    const fire = groups.find((g) => g.key === "fire")!;
    expect(fire.paragraph).not.toContain("The most serious reported was");
  });
});

describe("buildCountryIncidentThemes — source-safe fire paragraph", () => {
  it("states the cause is not identified by default and never classifies cause", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Fire", title: "Fire guts warehouse overnight", province: "Lae" }),
    ]);
    const fire = groups.find((g) => g.key === "fire")!;
    expect(fire.paragraph).toContain("Fire and explosion incidents were reported");
    expect(fire.paragraph).toContain("Available reporting did not consistently identify cause.");
    expect(fire.paragraph).toContain("the operational concern is local disruption");
    expect(fire.paragraph).not.toMatch(/deliberate fire or arson|security relevant/);
  });

  it("does NOT infer a deliberate cause from protest-adjacent fire reporting", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Fire", title: "Fire breaks out near protest march", province: "Jakarta" }),
    ]);
    const fire = groups.find((g) => g.key === "fire")!;
    expect(fire.paragraph).toContain("Available reporting did not consistently identify cause.");
    expect(fire.paragraph).not.toMatch(/deliberate fire or arson|security relevant/);
  });

  it("uses the security-relevant wording ONLY when a source states arson or attack", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Fire", title: "Arson suspected in warehouse blaze", province: "Lae" }),
    ]);
    const fire = groups.find((g) => g.key === "fire")!;
    expect(fire.paragraph).toContain("Where source reporting identified deliberate fire or arson");
    expect(fire.paragraph).toContain("security relevant");
    expect(fire.paragraph).toContain("the operational concern is local disruption");
  });
});

describe("buildOperationalImpactBullets", () => {
  it("returns an empty list for an empty window", () => {
    expect(buildOperationalImpactBullets([])).toEqual([]);
  });

  it("emits one impact bullet per present theme, in fixed order, count-free", () => {
    const bullets = buildOperationalImpactBullets([
      item({ category: "Fire" }),
      item({ category: "Civil unrest / protest" }),
      item({ category: "Armed robbery / hold-up" }),
    ]);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toMatch(/^Protest & civil unrest — /);
    expect(bullets[1]).toMatch(/^Crime, theft & robbery — /);
    expect(bullets[2]).toMatch(/^Fire & explosion — /);
    for (const b of bullets) expect(b).not.toMatch(/\d/);
  });
});
