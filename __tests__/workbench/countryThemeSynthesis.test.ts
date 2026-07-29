import {
  synthesiseAssessedThemes,
  buildAssessedThemeGroups,
  MAX_ASSESSED_THEMES,
} from "../../artifacts/workbench/src/lib/countryThemeSynthesis";
import type { PngReportItem } from "../../artifacts/workbench/src/lib/pngReportDataset";
import type { PngCategory } from "@workspace/ingest/pngExtract";

// Guards the assessed-theme synthesiser: every country/city brief now LEADS with
// two-to-three explicitly assessed themes (concentration + business exposure +
// trajectory-vs-baseline), selected by assessed value, deterministic, count-free.

function item(
  over: Partial<PngReportItem> & {
    id: string;
    category: PngCategory;
    severity: string;
    severityRank: number;
  },
): PngReportItem {
  return {
    title: `Incident ${over.id}`,
    rawTitle: `Incident ${over.id}`,
    summary: "",
    source: "Test Wire",
    url: `https://example.test/${over.id}`,
    province: null,
    location: null,
    displayCategory: undefined,
    reportedDate: new Date("2026-06-27T08:00:00+00:00"),
    incidentDate: null,
    occurredEarlier: false,
    confidence: "unrated",
    severityLabel: over.severity[0]!.toUpperCase() + over.severity.slice(1),
    ...over,
  } as PngReportItem;
}

const PROTEST_HI = item({
  id: "p1",
  title: "Large protest blocks the main road in Manila",
  rawTitle: "Large protest blocks the main road in Manila",
  category: "Civil unrest / protest" as PngCategory,
  severity: "high",
  severityRank: 4,
  province: "Manila",
});
const PROTEST_LO = item({
  id: "p2",
  title: "Small rally disperses peacefully in Cebu",
  rawTitle: "Small rally disperses peacefully in Cebu",
  category: "Civil unrest / protest" as PngCategory,
  severity: "low",
  severityRank: 2,
  province: "Cebu",
});
const CRIME = item({
  id: "c1",
  title: "Armed robbery at a warehouse in Davao",
  rawTitle: "Armed robbery at a warehouse in Davao",
  category: "Crime / theft" as PngCategory,
  severity: "moderate",
  severityRank: 3,
  province: "Davao",
});

const WINDOW = [PROTEST_HI, PROTEST_LO, CRIME];

describe("synthesiseAssessedThemes", () => {
  it("buckets by theme and caps to two-to-three themes", () => {
    const themes = synthesiseAssessedThemes(WINDOW, [], { hasBaseline: false });
    expect(themes.length).toBeGreaterThanOrEqual(1);
    expect(themes.length).toBeLessThanOrEqual(MAX_ASSESSED_THEMES);
    const keys = themes.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length); // distinct
    const protest = themes.find((t) => t.key === "protest");
    expect(protest).toBeDefined();
    expect(protest!.items.map((i) => i.id).sort()).toEqual(["p1", "p2"]);
  });

  it("ranks the highest-severity item first within a theme", () => {
    const [protest] = synthesiseAssessedThemes([PROTEST_LO, PROTEST_HI], [], {
      hasBaseline: false,
    });
    expect(protest!.items[0]!.id).toBe("p1");
  });

  it("carries concentration, business exposure and a trajectory", () => {
    const themes = synthesiseAssessedThemes(WINDOW, [], { hasBaseline: false });
    for (const t of themes) {
      expect(t.concentration.trim().length).toBeGreaterThan(0);
      expect(t.businessExposure.trim().length).toBeGreaterThan(0);
      expect(t.narrative.trim().length).toBeGreaterThan(0);
    }
  });

  it("returns no themes for an empty window (no fabrication)", () => {
    expect(synthesiseAssessedThemes([], [], { hasBaseline: false })).toEqual([]);
  });

  describe("trajectory vs baseline", () => {
    it("reads 'nobasis' when no prior window is supplied", () => {
      const [t] = synthesiseAssessedThemes([PROTEST_HI], [], { hasBaseline: false });
      expect(t!.trajectory).toBe("nobasis");
    });
    it("reads 'new' when the theme was absent a week earlier", () => {
      const [t] = synthesiseAssessedThemes([PROTEST_HI], [CRIME], { hasBaseline: true });
      expect(t!.trajectory).toBe("new");
    });
    it("reads 'rising' when severity climbed against the baseline", () => {
      const [t] = synthesiseAssessedThemes([PROTEST_HI], [PROTEST_LO], {
        hasBaseline: true,
      });
      expect(t!.trajectory).toBe("rising");
    });
    it("reads 'easing' when severity fell against the baseline", () => {
      const [t] = synthesiseAssessedThemes([PROTEST_LO], [PROTEST_HI], {
        hasBaseline: true,
      });
      expect(t!.trajectory).toBe("easing");
    });
    it("reads 'steady' when the theme holds level", () => {
      const [t] = synthesiseAssessedThemes([PROTEST_HI], [PROTEST_HI], {
        hasBaseline: true,
      });
      expect(t!.trajectory).toBe("steady");
    });
  });

  it("is deterministic — repeated calls give identical output", () => {
    const a = synthesiseAssessedThemes(WINDOW, [], { hasBaseline: false });
    const b = synthesiseAssessedThemes(WINDOW, [], { hasBaseline: false });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("theme prose helpers are count-free", () => {
  const themes = synthesiseAssessedThemes(WINDOW, [PROTEST_LO], { hasBaseline: true });

  it("never leaks an incident/record count", () => {
    const texts = [
      ...themes.map((t) => t.narrative),
      ...buildAssessedThemeGroups(WINDOW, [], { hasBaseline: false }).map(
        (g) => g.paragraph,
      ),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\(\s*\d/);
      expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
    }
  });


});
