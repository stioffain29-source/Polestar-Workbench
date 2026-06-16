import {
  buildConflictReportDataset,
  isGenericConflictProse,
  type ConflictReportIncident,
} from "../../artifacts/workbench/src/lib/conflictReportDataset";

// Guards the Conflict Watch report's data-driven, LOCATION-LED restructure.
// The same dataset feeds ConflictReportPreview (screen) and
// exportConflictReportPdf (PDF), so the ranking and prose proven here is the
// exact ranking and prose both surfaces render — the parity guarantee. These
// tests pin: dynamic theatre ranking (severity first), the casualty-signal
// tiebreak, the top-3 / other-watched split, strict 5-tier severity vocab,
// and the rule that narrative prose carries NO "(N records)" annotations.

const ISSUE_DATE = "2026-06-15";

function inc(
  over: Partial<ConflictReportIncident> & {
    id: number | string;
    severity: string;
    country: string;
    title: string;
  },
): ConflictReportIncident {
  return {
    topic: "conflict",
    // Inside the weekly window that ends on ISSUE_DATE.
    occurredAt: "2026-06-14T08:00:00+00:00",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${over.id}`,
    location: null,
    ...over,
  };
}

// Every title below carries an unambiguous conflict actor cue so it survives
// isTopicRelevant("conflict") — otherwise the window filter would drop it and
// the ranking under test would never see it.
const NO_CASUALTY = "Armed clashes between troops and militants near the outpost";
const WITH_CASUALTY =
  "Armed clashes between troops and militants left five soldiers killed";

function theatres(areas: { theatre: string }[]): string[] {
  return areas.map((a) => a.theatre);
}

describe("buildConflictReportDataset — dynamic ranking", () => {
  it("orders Top Activity Areas by worst severity first", () => {
    const ds = buildConflictReportDataset(
      [
        inc({ id: 1, country: "Myanmar", severity: "moderate", title: NO_CASUALTY }),
        inc({ id: 2, country: "Philippines", severity: "extreme", title: NO_CASUALTY }),
        inc({ id: 3, country: "India", severity: "low", title: NO_CASUALTY }),
      ],
      "conflict",
      ISSUE_DATE,
    );
    expect(theatres(ds.topActivityAreas)).toEqual([
      "Philippines",
      "Myanmar",
      "India",
    ]);
  });

  it("breaks a severity tie on the casualty signal", () => {
    const ds = buildConflictReportDataset(
      [
        // Same severity + same incident count; only the casualty signal differs.
        inc({ id: 1, country: "Somalia", severity: "high", title: NO_CASUALTY }),
        inc({ id: 2, country: "Nigeria", severity: "high", title: WITH_CASUALTY }),
      ],
      "conflict",
      ISSUE_DATE,
    );
    expect(theatres(ds.topActivityAreas)).toEqual(["Nigeria", "Somalia"]);
    const lead = ds.topActivityAreas[0];
    expect(lead.casualtySignalCount).toBeGreaterThan(0);
    // The casualty signal must surface in the location paragraph, never as a count.
    expect(lead.paragraph).toContain("casualties reported");
  });

  it("breaks a severity+casualty tie on incident count", () => {
    const ds = buildConflictReportDataset(
      [
        inc({ id: 1, country: "Yemen", severity: "high", title: NO_CASUALTY }),
        inc({ id: 2, country: "Mali", severity: "high", title: NO_CASUALTY }),
        inc({ id: 3, country: "Mali", severity: "high", title: NO_CASUALTY }),
      ],
      "conflict",
      ISSUE_DATE,
    );
    // Mali has two records vs Yemen's one — at equal severity/casualty it leads.
    expect(theatres(ds.topActivityAreas)).toEqual(["Mali", "Yemen"]);
  });
});

describe("buildConflictReportDataset — top-3 / other-watched split", () => {
  it("caps Top Activity Areas at three and pushes the rest to Other Watched", () => {
    const ds = buildConflictReportDataset(
      [
        inc({ id: 1, country: "Philippines", severity: "extreme", title: NO_CASUALTY }),
        inc({ id: 2, country: "Myanmar", severity: "high", title: NO_CASUALTY }),
        inc({ id: 3, country: "India", severity: "moderate", title: NO_CASUALTY }),
        inc({ id: 4, country: "Pakistan", severity: "low", title: NO_CASUALTY }),
        inc({ id: 5, country: "Thailand", severity: "insignificant", title: NO_CASUALTY }),
      ],
      "conflict",
      ISSUE_DATE,
    );
    expect(ds.topActivityAreas).toHaveLength(3);
    expect(ds.otherWatchedTheatres).toHaveLength(2);
    expect(theatres(ds.topActivityAreas)).toEqual([
      "Philippines",
      "Myanmar",
      "India",
    ]);
    expect(theatres(ds.otherWatchedTheatres)).toEqual(["Pakistan", "Thailand"]);
    // Every top area is a country-led block: heading + a paragraph that opens
    // with that theatre name.
    for (const area of ds.topActivityAreas) {
      expect(area.paragraph.startsWith(area.theatre)).toBe(true);
    }
    // The Other Watched prose names the lower-priority theatres.
    expect(ds.autoOtherWatched).toContain("Pakistan");
    expect(ds.autoOtherWatched).toContain("Thailand");
  });
});

describe("buildConflictReportDataset — vocabulary & prose hygiene", () => {
  const ds = buildConflictReportDataset(
    [
      inc({ id: 1, country: "Philippines", severity: "extreme", title: WITH_CASUALTY }),
      inc({ id: 2, country: "Myanmar", severity: "high", title: NO_CASUALTY }),
      inc({ id: 3, country: "India", severity: "moderate", title: NO_CASUALTY }),
      inc({ id: 4, country: "Pakistan", severity: "low", title: NO_CASUALTY }),
    ],
    "conflict",
    ISSUE_DATE,
  );

  const narrative = [
    ds.autoSituation,
    ds.autoOtherWatched,
    ds.autoWhatMatters,
    ds.autoWatchNext,
    ds.autoPolestarView,
    ...ds.topActivityAreas.map((a) => a.paragraph),
    ...ds.otherWatchedTheatres.map((a) => a.paragraph),
  ];

  const FIVE_TIER = new Set([
    "Insignificant",
    "Low",
    "Moderate",
    "High",
    "Extreme",
  ]);

  it("never uses the banned word 'Severe'", () => {
    for (const text of narrative) {
      expect(text).not.toMatch(/\bsevere\b/i);
    }
  });

  it("labels worst severity with the 5-tier vocabulary only", () => {
    expect(FIVE_TIER.has(ds.worstSeverityLabel)).toBe(true);
    for (const area of [...ds.topActivityAreas, ...ds.otherWatchedTheatres]) {
      expect(FIVE_TIER.has(area.worstSeverityLabel)).toBe(true);
    }
  });

  it("carries NO '(N records)' annotations in narrative prose", () => {
    for (const text of narrative) {
      // No parenthesised number, and no "<n> record(s)" phrasing.
      expect(text).not.toMatch(/\(\s*\d/);
      expect(text).not.toMatch(/\d+\s+incidents?\b/i);
      expect(text).not.toMatch(/\d+\s+records?\b/i);
    }
  });

  it("names the lead theatre in the Situation overview", () => {
    expect(ds.autoSituation).toContain("Philippines");
  });
});

describe("buildConflictReportDataset — empty window", () => {
  const ds = buildConflictReportDataset([], "conflict", ISSUE_DATE);

  it("yields no theatres and a quiet-period Situation", () => {
    expect(ds.topActivityAreas).toHaveLength(0);
    expect(ds.otherWatchedTheatres).toHaveLength(0);
    expect(ds.autoSituation).toContain("No armed activity was reported");
  });

  it("keeps 5-tier hygiene even when quiet", () => {
    for (const text of [
      ds.autoSituation,
      ds.autoOtherWatched,
      ds.autoWhatMatters,
      ds.autoWatchNext,
      ds.autoPolestarView,
    ]) {
      expect(text).not.toMatch(/\bsevere\b/i);
    }
  });
});

describe("isGenericConflictProse", () => {
  it("flags legacy CONFLICT-pack seeds so they get replaced by auto-prose", () => {
    expect(
      isGenericConflictProse(
        "Conflict Watch is flagging kinetic, casualty-grade risk rather than a rise in headlines.",
      ),
    ).toBe(true);
  });

  it("passes fresh data-driven auto-prose through untouched", () => {
    const ds = buildConflictReportDataset(
      [inc({ id: 1, country: "Philippines", severity: "high", title: NO_CASUALTY })],
      "conflict",
      ISSUE_DATE,
    );
    expect(isGenericConflictProse(ds.autoSituation)).toBe(false);
    expect(isGenericConflictProse(ds.autoPolestarView)).toBe(false);
  });

  it("treats empty text as non-generic", () => {
    expect(isGenericConflictProse("")).toBe(false);
  });
});
