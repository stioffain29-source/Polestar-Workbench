import {
  buildCustomerRelevance,
  issuePhrasesForThemes,
  driverPhrasesForThemes,
  exposureLabelsForThemes,
  scenarioForThemes,
} from "@/lib/countryCustomerRelevance";
import type { CountryIncidentTheme } from "@/lib/countryIncidentThemes";

// The Customer Relevance section (spec §13) must be DERIVED from the incident
// mix and the theatre audience, not hardcoded country prose, and stay
// count-free / British English. The same theme→phrase maps also feed the
// Polestar View so the two sections cannot drift.

const COUNT_RE = /\b\d+\b/;

describe("buildCustomerRelevance — populated window", () => {
  const out = buildCustomerRelevance({
    audience: "field operations staff and contractors in country",
    presentThemeKeys: ["protest", "fire"],
    empty: false,
  });

  it("opens with the configured audience", () => {
    expect(out).toContain("Most relevant to field operations staff and contractors in country.");
  });

  it("lists the period's main issues drawn from the present themes", () => {
    expect(out).toContain("Main issues this period are");
    expect(out).toContain("protest disruption");
    expect(out).toContain("fire and continuity disruption");
  });

  it("is count-free", () => {
    expect(COUNT_RE.test(out)).toBe(false);
  });
});

describe("buildCustomerRelevance — quiet window (no fabrication)", () => {
  const out = buildCustomerRelevance({
    audience: "office-based staff in the capital",
    presentThemeKeys: [],
    empty: true,
  });

  it("states standing exposures apply rather than inventing issues", () => {
    expect(out).toContain("No fresh incident-driven issues were identified this period");
    expect(out).toContain("standing exposures continue to apply");
    expect(out).not.toContain("Main issues this period");
  });

  it("falls back to a generic audience when none configured", () => {
    const bare = buildCustomerRelevance({ audience: "  ", presentThemeKeys: [], empty: true });
    expect(bare).toContain("organisations operating in the country");
  });
});

describe("theme→phrase maps (shared with Polestar View)", () => {
  const all: CountryIncidentTheme[] = [
    "protest",
    "crime",
    "natural",
    "governance",
    "fire",
    "other",
  ];

  it("issue phrases dedupe and respect order/cap", () => {
    const phrases = issuePhrasesForThemes(["protest", "protest", "crime"]);
    expect(phrases).toEqual(["protest disruption", "violent and opportunistic crime exposure"]);
  });

  it("driver phrases cap at three and stay first-seen ordered", () => {
    const drivers = driverPhrasesForThemes(["fire", "protest", "crime", "natural"]);
    expect(drivers).toHaveLength(3);
    expect(drivers[0]).toBe("fire and explosion incidents");
  });

  it("exposure labels flatten + dedupe across themes, capped at three", () => {
    const labels = exposureLabelsForThemes(["fire", "protest"]);
    expect(labels.length).toBeLessThanOrEqual(3);
    expect(labels).toContain("business continuity");
    expect(labels).toContain("site access");
  });

  it("scenario takes the most prominent theme; empty when no themes", () => {
    expect(scenarioForThemes(["protest", "fire"])).toBe(
      "further protest activity and associated movement disruption",
    );
    expect(scenarioForThemes([])).toBe("");
  });

  it("every theme yields count-free, defined phrases", () => {
    for (const k of all) {
      expect(issuePhrasesForThemes([k])[0]).toBeTruthy();
      expect(driverPhrasesForThemes([k])[0]).toBeTruthy();
      expect(exposureLabelsForThemes([k])[0]).toBeTruthy();
      expect(scenarioForThemes([k])).toBeTruthy();
      expect(COUNT_RE.test(scenarioForThemes([k]))).toBe(false);
    }
  });
});
