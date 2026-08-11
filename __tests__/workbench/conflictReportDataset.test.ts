import {
  buildConflictReportDataset,
  isGenericConflictProse,
  type ConflictReportIncident,
} from "../../artifacts/workbench/src/lib/conflictReportDataset";
import {
  reportCadence,
  reportWindowDefaultDays,
} from "../../artifacts/workbench/src/lib/reportWindow";

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
    expect(lead.paragraph).toMatch(/deadly|killed/i);
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

describe("buildConflictReportDataset — no 'worst', no whole-country claim", () => {
  // The user rejected two things outright: a large country being called "the main
  // concern" as a whole (only PARTS of a country are ever the concern), and the
  // word "worst" being repeated across the report.
  const inManipur =
    "Armed clashes between troops and militants reported in Manipur";
  const ds = buildConflictReportDataset(
    [
      inc({ id: 1, country: "India", severity: "high", title: inManipur }),
      inc({ id: 2, country: "India", severity: "high", title: inManipur }),
      inc({ id: 3, country: "India", severity: "high", title: inManipur }),
      inc({ id: 4, country: "Myanmar", severity: "moderate", title: NO_CASUALTY }),
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

  it("never uses the word 'worst' in narrative prose", () => {
    for (const text of narrative) {
      expect(text).not.toMatch(/\bworst\b/i);
    }
  });

  it("never frames a whole country as the concern or 'most serious theatre'", () => {
    // The grammatical subject of the lead judgement must be the activity or the
    // named region, never a bare country. Banned: "India is the main concern",
    // "India is the most serious theatre", "India is/was/remained serious".
    // Allowed: "the most serious activity ... is in India, around Manipur" and
    // "India also saw serious activity this period".
    for (const text of narrative) {
      expect(text).not.toMatch(/is the main concern/i);
      expect(text).not.toMatch(/is the most serious theatre/i);
      expect(text).not.toMatch(/are the most serious theatres/i);
      expect(text).not.toMatch(/\b(is|was|remained) (the most )?serious\b/i);
    }
  });

  it("scopes the lead to its region, not the whole country", () => {
    const lead = ds.topActivityAreas[0]!;
    expect(lead.theatre).toBe("India");
    expect(lead.paragraph).toContain("Manipur");
    // The block is country-grouped so it still opens with the country word, but
    // the SUBJECT is the region — never a blanket "India is the concern".
    expect(lead.paragraph.startsWith("India")).toBe(true);
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

describe("buildConflictReportDataset — sub-national honesty", () => {
  // India is the lead theatre but only ONE of three incidents names a hotspot
  // (Manipur). Coverage is 1/3 < 0.5, so the theatre is NOT "localised": the
  // prose may name the flashpoint but must NOT claim the rest of the country is
  // safe. This guards the honesty failure the hotspot work was built to prevent.
  const MANIPUR =
    "Armed clashes between troops and militants reported in Manipur";
  // id2 and id3 are DISTINCT non-hotspot events, so they must carry distinct
  // titles — the report now folds syndicated same-country copies of one headline,
  // and reusing NO_CASUALTY twice would (correctly) collapse to a single incident
  // and lift Manipur's coverage from 1/3 to 1/2, crossing the ≥50% threshold.
  const NO_CASUALTY_2 =
    "Armed clashes between troops and militants at a rural checkpoint";
  const ds = buildConflictReportDataset(
    [
      inc({ id: 1, country: "India", severity: "high", title: MANIPUR }),
      inc({ id: 2, country: "India", severity: "high", title: NO_CASUALTY }),
      inc({ id: 3, country: "India", severity: "high", title: NO_CASUALTY_2 }),
    ],
    "conflict",
    ISSUE_DATE,
  );
  const lead = ds.topActivityAreas[0];

  it("names the hotspot but does not call a sub-50% theatre concentrated", () => {
    expect(lead.theatre).toBe("India");
    expect(lead.paragraph).toContain("Manipur");
    expect(lead.paragraph).toContain("sharpest activity around");
    // The "rest of the country is far quieter" reassurance is reserved for
    // genuinely localised theatres (≥50% coverage) — never a scattered one.
    expect(lead.paragraph).not.toContain("far quieter");
    expect(lead.paragraph).not.toContain("rather than spread across the country");
    expect(lead.paragraph).not.toContain("not the country as a whole");
  });

  it("withholds countrywide-safety claims across all sections when coverage <50%", () => {
    expect(ds.autoSituation).not.toContain("rather than countrywide");
    expect(ds.autoSituation).not.toContain("concentrated in");
    expect(ds.autoWhatMatters).not.toContain("largely unaffected");
    expect(ds.autoPolestarView).not.toContain("carries on as normal");
    // A sub-50% theatre must not be called country-wide-contained either.
    expect(ds.autoPolestarView).not.toMatch(/countrywide|country-wide/i);
    expect(ds.autoWhatMatters).not.toContain("not a blanket change");
    // ...nor "concentrated around" the flashpoint: that upgrade contradicts the
    // softer non-localised wording the theatre's own paragraph uses.
    expect(ds.autoPolestarView).not.toMatch(/concentrated around Manipur/i);
    // It still names the flashpoint — honesty cuts both ways.
    expect(ds.autoPolestarView).toContain("Manipur");
  });
});

describe("buildConflictReportDataset — high severity, no casualties", () => {
  // Deadly language must track the casualty SIGNAL, not the severity rank: a
  // High-severity window with no confirmed casualties must never read "deadly"
  // or affirmatively claim "casualties reported".
  const ds = buildConflictReportDataset(
    [
      inc({ id: 1, country: "Philippines", severity: "high", title: NO_CASUALTY }),
      inc({ id: 2, country: "Myanmar", severity: "high", title: NO_CASUALTY }),
    ],
    "conflict",
    ISSUE_DATE,
  );
  const narrative = [
    ds.autoSituation,
    ds.autoWhatMatters,
    ds.autoPolestarView,
    ...ds.topActivityAreas.map((a) => a.paragraph),
  ];

  it("never claims deadly violence when no casualties are detected", () => {
    for (const text of narrative) {
      expect(text).not.toMatch(/\bdeadly\b/i);
      expect(text).not.toContain("casualties reported");
    }
  });

  it("still flags the High severity honestly", () => {
    expect(ds.worstSeverityLabel).toBe("High");
    // No false "deadly" framing, but the decision guidance still lands.
    expect(ds.autoPolestarView).not.toMatch(/\bdeadly\b/i);
    expect(ds.autoPolestarView).toContain("evacuation triggers");
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

describe("conflict cadence", () => {
  it("is weekly so the report window matches its weekly reporting cadence", () => {
    expect(reportCadence("conflict")).toBe("weekly");
    expect(reportWindowDefaultDays("conflict")).toBe(7);
  });
});

describe("buildConflictReportDataset — co-leading theatres", () => {
  // Two theatres with effectively equal incident volume must SHARE the lead.
  // Ranking one as the main concern and demoting the co-equal one to "quieter" /
  // "at a lower level" contradicts the per-theatre counts the reader can see —
  // the exact contradiction flagged on the live Conflict Watch report, where
  // Pakistan and India were tied yet India was called "quieter".
  const clash = (country: string) =>
    `Armed clashes between troops and militants reported in ${country}`;
  // Each incident is a DISTINCT event, so its title must be distinct: the
  // report now folds syndicated same-country copies of one headline, so reusing
  // one title per country would (correctly) collapse to a single incident and
  // erase the volume this test needs.
  const many = (country: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      inc({
        id: `${country}-${i}`,
        country,
        severity: "high",
        title: `${clash(country)} (case ${i + 1})`,
      }),
    );
  const ds = buildConflictReportDataset(
    [...many("Pakistan", 6), ...many("India", 6), ...many("Indonesia", 1)],
    "conflict",
    ISSUE_DATE,
  );

  it("names both tied theatres as the main concerns", () => {
    expect(ds.autoSituation).toContain("Pakistan");
    expect(ds.autoSituation).toContain("India");
    expect(ds.autoSituation).toMatch(/Pakistan and India|India and Pakistan/);
  });

  it("never demotes the tied runner-up to 'quieter' or 'lower level'", () => {
    // The "lower level"/"quieter" framing attaches only to the genuinely smaller
    // theatre (Indonesia), never to the co-equal one.
    expect(ds.autoSituation).not.toMatch(/India[^.]*lower level/i);
    expect(ds.autoSituation).not.toMatch(/Pakistan[^.]*lower level/i);
    expect(ds.autoPolestarView).not.toMatch(/India[^.]*quieter/i);
    expect(ds.autoPolestarView).not.toMatch(/Pakistan[^.]*quieter/i);
  });

  it("does not claim one theatre holds most of the period's activity", () => {
    // Pakistan is well under half the window here — the Polestar view must not
    // assert the whole period's activity is concentrated in a single place.
    expect(ds.autoPolestarView).not.toMatch(
      /most of the armed activity is concentrated/i,
    );
  });
});

describe("buildConflictReportDataset — hotspot phrasing hygiene", () => {
  // The lead theatre's named hotspots belong in the Situation overview and the
  // theatre's own Top-Activity block — NOT hammered into every downstream
  // section. Guards the "Afghan border and Khyber Pakhtunkhwa repeated six
  // times" complaint that triggered this work.
  const KP = "Armed clashes between troops and militants in Khyber Pakhtunkhwa";
  const AFG = "Militants ambush an army patrol near the Afghan border";
  const ds = buildConflictReportDataset(
    [
      inc({ id: 1, country: "Pakistan", severity: "high", title: KP }),
      inc({ id: 2, country: "Pakistan", severity: "high", title: AFG }),
      inc({ id: 3, country: "India", severity: "moderate", title: NO_CASUALTY }),
    ],
    "conflict",
    ISSUE_DATE,
  );
  const lead = ds.topActivityAreas[0]!;
  const labels = lead.hotspots.slice(0, 2).map((h) => h.label);
  const fullPhrase =
    labels.length === 2 ? `${labels[0]} and ${labels[1]}` : (labels[0] ?? "");

  it("detects both Pakistan hotspots on the lead theatre", () => {
    expect(lead.theatre).toBe("Pakistan");
    expect(labels.length).toBe(2);
  });

  it("does not repeat the full hotspot phrase in downstream sections", () => {
    expect(ds.autoWhatMatters).not.toContain(fullPhrase);
    expect(ds.autoWatchNext).not.toContain(fullPhrase);
    expect(ds.autoPolestarView).not.toContain(fullPhrase);
  });

  it("names the full hotspot phrase at most twice across the narrative", () => {
    const all = [
      ds.autoSituation,
      lead.paragraph,
      ds.autoWhatMatters,
      ds.autoWatchNext,
      ds.autoPolestarView,
      ds.autoOtherWatched,
    ].join("\n");
    const occurrences = all.split(fullPhrase).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
    expect(occurrences).toBeLessThanOrEqual(2);
  });
});

describe("buildConflictReportDataset — standout event is kinetic, not reaction", () => {
  // The cited standout incident must be a real armed event, never a political /
  // reaction headline ("vigil held", "families demand justice") of the same
  // severity. This guards the live defect where a reaction headline was paraded
  // as the period's most serious incident.
  const KINETIC = "Militants attack an army base, six soldiers killed";
  const REACTION = "Vigil held after six soldiers killed in militant attack";
  const ds = buildConflictReportDataset(
    [
      inc({ id: 1, country: "Philippines", severity: "high", title: REACTION }),
      inc({ id: 2, country: "Philippines", severity: "high", title: KINETIC }),
    ],
    "conflict",
    ISSUE_DATE,
  );

  it("cites the kinetic event as the Situation standout, not the reaction one", () => {
    expect(ds.autoSituation).toMatch(
      /most serious case involved[^.]*military or police base/i,
    );
    expect(ds.autoSituation).not.toMatch(/vigil/i);
    // No pasted article headline.
    expect(ds.autoSituation).not.toContain(KINETIC);
    expect(ds.autoSituation).not.toContain(REACTION);
  });

  it("orders the kinetic event ahead of the reaction event in the lead paragraph", () => {
    const lead = ds.topActivityAreas[0]!;
    expect(lead.paragraph).toMatch(/military or police base/i);
    expect(lead.paragraph).not.toMatch(/vigil/i);
    expect(lead.paragraph).not.toContain(KINETIC);
    expect(lead.paragraph).not.toContain(REACTION);
  });
});

describe("buildConflictReportDataset — impact pull-in (Option B)", () => {
  // Option B: a theatre whose last HIGH-impact attack fell just OUTSIDE the
  // 7-day reporting week is still surfaced (clearly flagged as pre-window) so a
  // live concern is never lost to an arbitrary window edge. LOW pre-window
  // activity is NOT pulled in, and pulled-in records never touch the strict
  // weekly Fast Facts or the related-incidents table.
  const preInc = (
    over: Partial<ConflictReportIncident> & {
      id: number | string;
      severity: string;
      country: string;
      title: string;
    },
  ): ConflictReportIncident =>
    // 7 Jun sits in the pre-window strip (6-9 Jun): inside the 10-day weekly
    // hard cap, but before the 9 Jun window start.
    inc({ occurredAt: "2026-06-07T08:00:00+00:00", ...over });

  describe("with an in-window theatre present", () => {
    const ds = buildConflictReportDataset(
      [
        // In-window, lower severity — the live read still leads here.
        inc({ id: 1, country: "Philippines", severity: "moderate", title: NO_CASUALTY }),
        // Pre-window HIGH attack, no in-window activity → pulled in.
        preInc({ id: 2, country: "Thailand", severity: "high", title: NO_CASUALTY }),
        // Pre-window LOW attack, no in-window activity → NOT pulled in.
        preInc({ id: 3, country: "Cambodia", severity: "low", title: NO_CASUALTY }),
      ],
      "conflict",
      ISSUE_DATE,
    );
    const all = [...ds.topActivityAreas, ...ds.otherWatchedTheatres];
    const thailand = all.find((a) => a.theatre === "Thailand");

    it("pulls in a HIGH pre-window theatre with no in-window activity", () => {
      expect(thailand).toBeDefined();
      expect(thailand!.pulledInFromLookback).toBe(true);
    });

    it("ranks the in-window theatre ABOVE the pulled-in one (no list/prose contradiction)", () => {
      // A theatre with no in-week activity can never be "the most serious this
      // period", so the live in-window theatre leads the Top Activity Areas list
      // even though the pulled-in theatre carries a higher raw severity. This
      // keeps the visible list and the Situation headline in agreement.
      expect(ds.topActivityAreas[0]!.theatre).toBe("Philippines");
      expect(ds.topActivityAreas[0]!.pulledInFromLookback).toBe(false);
      const order = theatres(ds.topActivityAreas);
      expect(order.indexOf("Philippines")).toBeLessThan(order.indexOf("Thailand"));
    });

    it("does NOT pull in a LOW pre-window theatre", () => {
      expect(theatres(all)).not.toContain("Cambodia");
    });

    it("flags the pulled-in theatre's paragraph as pre-window, never in-week", () => {
      expect(thailand!.paragraph).toContain("just before this reporting period");
      expect(thailand!.paragraph).toContain("Nothing new was reported inside the week");
    });

    it("leads the Situation on the in-window theatre and flags the pulled-in one", () => {
      expect(ds.autoSituation).toContain("Philippines");
      expect(ds.autoSituation).toMatch(
        /Thailand[^.]*on watch after high-impact attacks/i,
      );
    });

    it("keeps the weekly window incidents (Fast Facts source) to in-window only", () => {
      expect(ds.windowIncidents).toHaveLength(1);
      expect(ds.windowIncidents[0]!.country).toBe("Philippines");
    });

    it("keeps the related-incidents table to in-window records only", () => {
      expect(ds.relatedIncidents.every((r) => r.country !== "Thailand")).toBe(true);
      expect(ds.relatedIncidents.every((r) => r.country !== "Cambodia")).toBe(true);
    });

    it("carries NO '(N records)' annotations on the pulled-in paragraph", () => {
      expect(thailand!.paragraph).not.toMatch(/\(\s*\d/);
      expect(thailand!.paragraph).not.toMatch(/\d+\s+(incidents?|records?)\b/i);
    });
  });

  describe("quiet week with only a pre-window high-impact theatre", () => {
    const ds = buildConflictReportDataset(
      [preInc({ id: 1, country: "Thailand", severity: "high", title: NO_CASUALTY })],
      "conflict",
      ISSUE_DATE,
    );

    it("surfaces the pulled-in theatre even with an empty reporting week", () => {
      expect(theatres(ds.topActivityAreas)).toContain("Thailand");
      expect(ds.windowIncidents).toHaveLength(0);
    });

    it("frames the Situation and Polestar view as a quiet week with a standing risk", () => {
      expect(ds.autoSituation).toContain(
        "No armed activity was reported inside the reporting week",
      );
      expect(ds.autoSituation).toContain("Thailand");
      expect(ds.autoPolestarView).toContain(
        "No armed activity landed inside the reporting week",
      );
      expect(ds.autoPolestarView).toContain("Thailand");
    });
  });

  describe("casualty-bearing pre-window attack", () => {
    const ds = buildConflictReportDataset(
      [
        inc({ id: 1, country: "Philippines", severity: "high", title: NO_CASUALTY }),
        // Moderate severity but casualty-bearing → still a high-impact driver.
        preInc({ id: 2, country: "Vietnam", severity: "moderate", title: WITH_CASUALTY }),
      ],
      "conflict",
      ISSUE_DATE,
    );
    const all = [...ds.topActivityAreas, ...ds.otherWatchedTheatres];

    it("pulls in a casualty-bearing pre-window theatre even below High severity", () => {
      const vietnam = all.find((a) => a.theatre === "Vietnam");
      expect(vietnam).toBeDefined();
      expect(vietnam!.pulledInFromLookback).toBe(true);
    });
  });
});
