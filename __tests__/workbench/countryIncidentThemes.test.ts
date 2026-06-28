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
