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
  it("always returns the six themes in fixed order", () => {
    const groups = buildCountryIncidentThemes([]);
    expect(groups.map((g) => g.key)).toEqual([
      "protest",
      "crime",
      "natural",
      "governance",
      "fire",
      "other",
    ]);
  });

  it("marks empty themes not-reported and never emits counts", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Civil unrest / protest", province: "Jakarta" }),
    ]);
    const protest = groups.find((g) => g.key === "protest")!;
    const crime = groups.find((g) => g.key === "crime")!;
    expect(protest.present).toBe(true);
    expect(protest.narrative).toContain("Jakarta");
    expect(crime.present).toBe(false);
    expect(crime.narrative).toBe("Not reported this period.");
    // No digits in any generated narrative (count-free house rule).
    for (const g of groups) {
      expect(g.narrative).not.toMatch(/\d/);
    }
  });

  it("surfaces the worst severity present without a count", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Homicide / violent crime", severity: "extreme", province: "Lae" }),
      item({ category: "Theft / break-in", severity: "low", province: "Lae" }),
    ]);
    const crime = groups.find((g) => g.key === "crime")!;
    expect(crime.narrative).toContain("extreme-severity");
    expect(crime.narrative).toContain("Lae");
  });

  it("ranks provinces by frequency", () => {
    const groups = buildCountryIncidentThemes([
      item({ category: "Civil unrest / protest", province: "Port Moresby" }),
      item({ category: "Civil unrest / protest", province: "Port Moresby" }),
      item({ category: "Civil unrest / protest", province: "Lae" }),
    ]);
    const protest = groups.find((g) => g.key === "protest")!;
    expect(protest.narrative).toContain("Port Moresby and Lae");
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
