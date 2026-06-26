import { buildCountryOperatingRiskDataset } from "../../artifacts/workbench/src/lib/countryOperatingRiskDataset";
import type {
  BuildArgs,
  PngSourceIncident,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// The generic operating-risk builder produces the SAME PngReportDataset every
// non-curated country renders (PngCountryReportBody → DOM-rasterised PDF). These
// tests guard the four things the wiring depends on:
//   1. It classifies raw window incidents into themed Key Developments groups,
//      each carrying a business-impact line (the tile-card contract).
//   2. It tags the dataset as the operating-risk variant so CountryReport skips
//      the AI prose overlay (deterministic, no-fabrication).
//   3. It derives the Location Watchlist from each incident's own location.
//   4. The no-count invariant holds: NO narrative string carries a parenthetical
//      record/incident count annotation or a bare "N incidents" tally.
//   5. An empty window builds without throwing and degrades to standing caveats.

function inc(over: Partial<PngSourceIncident> & { title: string }): PngSourceIncident {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    severity: over.severity ?? "moderate",
    occurredAt: over.occurredAt ?? "2026-06-14T08:00:00+00:00",
    country: over.country ?? "Philippines",
    ...over,
  };
}

function makeArgs(windowIncidents: PngSourceIncident[]): BuildArgs {
  return {
    windowIncidents,
    previousWindowIncidents: [],
    thirtyDay: windowIncidents,
    ninetyDay: windowIncidents,
    baselineWatchlist: ["Metro Manila"],
    periodLabel: "Week of 09–15 Jun 2026",
  };
}

// Count-annotation patterns the brand spec bans from prose: "(2 records)",
// "(12 of 30 incidents)", "3 incidents", "5 records". Years (2026) and the
// period label are NOT prose and are excluded from this scan.
const COUNT_PATTERNS: RegExp[] = [
  /\(\s*\d+\s*(?:records?|incidents?)/i,
  /\b\d+\s+of\s+\d+\b/i,
  /\b\d+\s+(?:records?|incidents?|reports?|events?)\b/i,
];

function assertNoCounts(label: string, text: string) {
  for (const re of COUNT_PATTERNS) {
    expect({ label, text, matched: re.test(text) }).toEqual({
      label,
      text,
      matched: false,
    });
  }
}

describe("buildCountryOperatingRiskDataset — generic operating-risk brief", () => {
  const incidents = [
    inc({
      id: "a1",
      title: "Armed robbery and carjacking reported in Quezon City",
      summary: "Gunmen robbed a convoy and seized a vehicle overnight.",
      severity: "high",
      location: "Quezon City",
      source: "Test Wire",
    }),
    inc({
      id: "a2",
      title: "Second armed robbery hits a depot in Quezon City",
      summary: "A storage depot was raided by an armed group.",
      severity: "moderate",
      location: "Quezon City",
      source: "Test Wire",
    }),
    inc({
      id: "a3",
      title: "Clashes between security forces and militants in Mindanao",
      summary: "An exchange of fire was reported during an operation.",
      severity: "high",
      location: "Mindanao",
      source: "Test Wire",
    }),
    inc({
      id: "a4",
      title: "Workers stage a protest over a wage dispute in Cebu",
      summary: "A demonstration gathered outside a government office.",
      severity: "low",
      location: "Cebu",
      source: "Test Wire",
    }),
  ];

  const dataset = buildCountryOperatingRiskDataset(makeArgs(incidents), "Philippines");

  it("tags the dataset as the operating-risk variant", () => {
    expect(dataset.proseVariant).toBe("operating-risk");
  });

  it("ingests every window incident into windowItems", () => {
    expect(dataset.windowItems.length).toBe(incidents.length);
  });

  it("groups incidents into themed Key Developments, each with a business impact", () => {
    expect(dataset.keyDevelopments.length).toBeGreaterThanOrEqual(1);
    for (const group of dataset.keyDevelopments) {
      expect(group.heading.trim().length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThanOrEqual(1);
      expect(group.businessImpact.trim().length).toBeGreaterThan(0);
    }
  });

  it("derives the Location Watchlist from incident locations", () => {
    const labels = dataset.locationWatchlist.map((w) => w.location.toLowerCase());
    expect(labels.some((l) => l.includes("quezon"))).toBe(true);
    for (const entry of dataset.locationWatchlist) {
      expect(entry.why.trim().length).toBeGreaterThan(0);
      expect(entry.action.trim().length).toBeGreaterThan(0);
    }
  });

  it("populates What Matters bullets and Escalation indicators", () => {
    expect(dataset.whatMattersBullets.length).toBeGreaterThanOrEqual(1);
    expect(dataset.escalationIndicators.length).toBeGreaterThanOrEqual(1);
  });

  it("carries no incident-count annotations in any narrative field", () => {
    assertNoCounts("bluf", dataset.bluf);
    assertNoCounts("executiveSummary", dataset.executiveSummary);
    assertNoCounts("whatChanged", dataset.whatChanged);
    assertNoCounts("outlook", dataset.outlook);
    assertNoCounts("polestarView", dataset.polestarView);
    dataset.whatMattersBullets.forEach((b, i) => assertNoCounts(`whatMatters[${i}]`, b));
    dataset.escalationIndicators.forEach((b, i) => assertNoCounts(`escalation[${i}]`, b));
    dataset.businessImpact.forEach((b, i) => assertNoCounts(`priority[${i}]`, b));
    dataset.keyDevelopments.forEach((g, i) =>
      assertNoCounts(`keyDev[${i}].businessImpact`, g.businessImpact),
    );
  });
});

describe("buildCountryOperatingRiskDataset — empty window", () => {
  it("builds standing-caveat sections without throwing", () => {
    const dataset = buildCountryOperatingRiskDataset(makeArgs([]), "Philippines");
    expect(dataset.windowItems.length).toBe(0);
    expect(dataset.keyDevelopments.length).toBe(0);
    // Standing caveats still populate the brief rather than leaving it blank.
    expect(dataset.bluf.trim().length).toBeGreaterThan(0);
    expect(dataset.outlook.trim().length).toBeGreaterThan(0);
    expect(dataset.polestarView.trim().length).toBeGreaterThan(0);
    expect(dataset.whatMattersBullets.length).toBeGreaterThanOrEqual(1);
    // The curated baseline watchlist still backstops the section.
    expect(dataset.locationWatchlist.length).toBeGreaterThanOrEqual(1);
  });
});
