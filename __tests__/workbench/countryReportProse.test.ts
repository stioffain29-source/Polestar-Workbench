import {
  buildPngReportDataset,
  buildWestPapuaReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Guards the GLOBAL REPORT CONTENT STANDARD applied to the deterministic
// (no-AI-key) country-report prose. In dev there is no OpenAI key, so the
// deterministic path alone must satisfy the standard. Two invariants are pinned:
//  - BANNED FILLER never appears in any prose field of the dataset (the standard
//    explicitly proscribes these hedge phrases), across empty / populated /
//    extreme / previous-window scenarios for BOTH structured theatres.
//  - TOP 3 SAME-STORY CLUSTERING collapses syndicated re-runs of one event into
//    a single representative, and excludes the cluster members from the
//    remaining Incident Details set.

const PERIOD = "23–29 June 2026";

// Banned hedge phrases (case-insensitive). The standard removes these; the
// deterministic builders must never re-introduce them in any string field.
const BANNED: string[] = [
  "was led by",
  "treat any quiet stretch as provisional",
  "treat any single quiet week as provisional",
  "reported this period, centred on",
  "hold non-essential movement to affected areas until conditions are confirmed stable",
  "a single quiet week",
  "open-source coverage is uneven",
  "uneven open-source coverage",
];

function inc(
  over: Partial<PngSourceIncident> & {
    id: number | string;
    title: string;
    severity: string;
  },
): PngSourceIncident {
  return {
    occurredAt: "2026-06-27T08:00:00+00:00",
    incidentDate: "2026-06-27",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.test/${over.id}`,
    country: "Indonesia",
    location: null,
    province: "Papua",
    category: "Other security",
    businessImpact: "Localised disruption to movement and access.",
    ...over,
  };
}

function build(incidents: PngSourceIncident[]): PngReportDataset {
  return buildPngReportDataset({
    windowIncidents: incidents,
    thirtyDay: incidents,
    ninetyDay: incidents,
    baselineWatchlist: [],
    periodLabel: PERIOD,
  });
}

// Recursively collect every string value reachable in the dataset object so the
// banned-phrase assertion covers prose ANYWHERE — section fields, watchlist
// entries, grouped recommended actions, etc., not just the headline paragraphs.
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

function assertNoBanned(ds: PngReportDataset): void {
  const haystack = collectStrings(ds).join("\n").toLowerCase();
  for (const phrase of BANNED) {
    expect(haystack).not.toContain(phrase);
  }
}

const POPULATED: PngSourceIncident[] = [
  inc({
    id: "a1",
    title: "Gunmen ambush a police patrol in the central highlands, three killed",
    severity: "High",
    province: "Papua Pegunungan",
    category: "Tribal / communal violence",
  }),
  inc({
    id: "a2",
    title: "Students stage a large protest in Jayapura over land rights",
    severity: "Moderate",
    province: "Papua",
    category: "Civil unrest / protest",
  }),
  inc({
    id: "a3",
    title: "Armed robbery reported on the trans-Papua road near Wamena",
    severity: "Low",
    province: "Papua Pegunungan",
    category: "Crime",
  }),
];

const PREVIOUS: PngSourceIncident[] = [
  inc({ id: "p1", title: "Minor protest dispersed in Jayapura", severity: "Low" }),
];

describe("country report deterministic prose — banned filler", () => {
  it("omits banned phrases for an empty window", () => {
    assertNoBanned(build([]));
    assertNoBanned(buildWestPapuaReportDataset({
      windowIncidents: [],
      thirtyDay: [],
      ninetyDay: [],
      baselineWatchlist: [],
      periodLabel: PERIOD,
    }));
  });

  it("omits banned phrases for a populated window", () => {
    assertNoBanned(build(POPULATED));
  });

  it("omits banned phrases with a previous window (trend prose active)", () => {
    const ds = buildPngReportDataset({
      windowIncidents: POPULATED,
      previousWindowIncidents: PREVIOUS,
      thirtyDay: POPULATED,
      ninetyDay: POPULATED,
      baselineWatchlist: [],
      periodLabel: PERIOD,
    });
    assertNoBanned(ds);
  });

  it("omits banned phrases for an extreme-severity window", () => {
    assertNoBanned(
      build([
        inc({
          id: "x1",
          title: "Coordinated armed attack kills dozens in the highlands",
          severity: "Extreme",
          province: "Papua Pegunungan",
          category: "Tribal / communal violence",
        }),
      ]),
    );
  });
});

describe("country report outlook — standard structure", () => {
  // The shared country-engine now authors the Outlook (owner brief §36). It
  // states the most-likely near-term picture and the locations to keep under
  // review in controlled, count-free prose (no fixed "concern would ease" /
  // "deteriorate" template from the old generator).
  it("states a forward-looking most-likely picture for a populated window", () => {
    const ds = build(POPULATED);
    expect(ds.outlook.trim().length).toBeGreaterThan(0);
    expect(ds.outlook.toLowerCase()).toContain("next seven days");
  });

  // Recommended Actions are now drawn from the shared engine's approved menu and
  // grouped by its recommendation groups (Movement / Site security / …). Each
  // emitted group carries at least one action; groups are non-empty.
  it("emits grouped recommended actions from the engine menu", () => {
    const ds = build(POPULATED);
    expect(ds.recommendedActions.length).toBeGreaterThan(0);
    for (const g of ds.recommendedActions) {
      expect(g.heading.trim().length).toBeGreaterThan(0);
      expect(g.actions.length).toBeGreaterThan(0);
    }
  });
});

describe("top 3 same-story clustering", () => {
  // Three syndicated re-runs of ONE event: same province, same date, same
  // category, near-identical headlines (one carries a masthead tail).
  const SYN: PngSourceIncident[] = [
    inc({
      id: "s1",
      title: "Gunmen kill three in highlands ambush near Wamena",
      severity: "High",
      province: "Papua Pegunungan",
      category: "Tribal / communal violence",
    }),
    inc({
      id: "s2",
      title: "Gunmen kill three in highlands ambush near Wamena - The Jakarta Post",
      severity: "High",
      province: "Papua Pegunungan",
      category: "Tribal / communal violence",
    }),
    inc({
      id: "s3",
      title: "Three killed as gunmen ambush a vehicle in the Wamena highlands",
      severity: "High",
      province: "Papua Pegunungan",
      category: "Tribal / communal violence",
    }),
  ];

  const DISTINCT: PngSourceIncident[] = [
    inc({
      id: "d1",
      title:
        "Students clash with police and several are injured during a large protest in Jayapura over land rights",
      severity: "High",
      province: "Papua",
      category: "Civil unrest / protest",
    }),
    inc({
      id: "d2",
      title:
        "Explosion and fire halt port operations and block cargo access at Sorong harbour",
      severity: "High",
      province: "Papua Barat Daya",
      category: "Maritime / port",
    }),
  ];

  it("collapses syndicated re-runs into a single representative", () => {
    const ds = build(SYN);
    expect(ds.topThree).toHaveLength(1);
    // The two non-representative syndicated rows are cluster members, so they
    // are excluded from the remaining Incident Details set.
    expect(ds.incidentDetailsItems).toHaveLength(0);
  });

  it("keeps distinct stories separate while collapsing the syndicated cluster", () => {
    const ds = build([...SYN, ...DISTINCT]);
    expect(ds.topThree).toHaveLength(3);
    const ambushReps = ds.topThree.filter((it) =>
      it.title.toLowerCase().includes("ambush"),
    );
    expect(ambushReps).toHaveLength(1);
  });
});
